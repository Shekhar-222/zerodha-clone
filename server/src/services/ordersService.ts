import { EventEmitter } from "events";
import { db } from "../db/db";
import { config } from "../config";
import { kite } from "../kite/kiteClient";
import { getCachedLtp, subscribeTokens, tickerEvents, Tick } from "../kite/ticker";
import { getInstrumentByToken } from "../kite/instruments";
import { getFunds, adjustBalance, recordTransaction } from "./fundsService";
import {
  getHoldingQuantity,
  recordFillInPortfolio,
  getPositionMarginBlocked,
  getPositionQuantity,
  setPositionMargin,
} from "./portfolioService";
import { calculateOrderCosts } from "./marginService";

const FNO_TYPES = new Set(["FUT", "CE", "PE"]);

/**
 * The margin a F&O trade actually needs is not "fresh margin for this order in isolation" —
 * it's the margin for the *resulting net position* minus whatever's already blocked for it.
 * A trade that only reduces/closes existing exposure needs zero incremental margin (it
 * releases margin instead); only opening or adding to a position needs new margin. Without
 * this, exiting any F&O position — profitable or not — gets wrongly margin-checked as if it
 * were a brand new position, which can reject the exit even though it needs no more funds.
 */
export async function computeFnoMarginDelta(params: {
  userId: number;
  instrumentToken: number;
  product: "MIS" | "NRML";
  exchange: string;
  tradingsymbol: string;
  transactionType: "BUY" | "SELL";
  quantity: number;
  price: number;
}) {
  const currentQty = getPositionQuantity(params.instrumentToken, params.product, params.userId);
  const beforeMargin = getPositionMarginBlocked(params.instrumentToken, params.product, params.userId);
  const signedTradeQty = params.transactionType === "BUY" ? params.quantity : -params.quantity;
  const newQty = currentQty + signedTradeQty;
  const newQtyAbs = Math.abs(newQty);

  let newMargin = 0;
  if (newQtyAbs > 0) {
    try {
      newMargin = (
        await calculateOrderCosts({
          exchange: params.exchange,
          tradingsymbol: params.tradingsymbol,
          transactionType: newQty > 0 ? "BUY" : "SELL",
          product: params.product,
          orderType: "MARKET",
          quantity: newQtyAbs,
          price: params.price,
        })
      ).margin;
    } catch (err) {
      console.warn("[margin] recompute failed, falling back to full notional estimate", err);
      newMargin = newQtyAbs * params.price;
    }
  }

  return { beforeMargin, newMargin, newQty, incrementalMargin: Math.max(0, newMargin - beforeMargin) };
}

export const orderEvents = new EventEmitter();

export type OrderRow = {
  id: number;
  user_id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  transaction_type: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
  product: "MIS" | "CNC" | "NRML";
  quantity: number;
  price: number | null;
  trigger_price: number | null;
  triggered: number;
  status: "OPEN" | "COMPLETE" | "CANCELLED" | "REJECTED";
  filled_price: number | null;
  reject_reason: string | null;
  bracket_stoploss: number | null;
  bracket_target: number | null;
  bracket_parent_id: number | null;
  bracket_role: "SL" | "TARGET" | null;
  placed_at: string;
  updated_at: string;
  name?: string | null;
  instrument_type?: string | null;
  expiry?: string | null;
  strike?: number | null;
};

export class OrderValidationError extends Error {}

async function resolveLtp(instrumentToken: number, exchange: string, tradingsymbol: string): Promise<number> {
  const cached = getCachedLtp(instrumentToken);
  if (cached !== undefined) return cached;

  const key = `${exchange}:${tradingsymbol}`;
  const resp = await kite.getLTP([key]);
  const ltp = (resp as any)[key]?.last_price;
  if (typeof ltp !== "number") {
    throw new OrderValidationError("Could not resolve current market price for this instrument");
  }
  return ltp;
}

function insertOrderRow(order: {
  userId: number;
  tradingsymbol: string;
  exchange: string;
  instrumentToken: number;
  transactionType: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  product: "MIS" | "CNC" | "NRML";
  quantity: number;
  price: number | null;
  triggerPrice?: number | null;
  bracketStoploss?: number | null;
  bracketTarget?: number | null;
  bracketParentId?: number | null;
  bracketRole?: "SL" | "TARGET" | null;
}): OrderRow {
  const result = db
    .prepare(
      `INSERT INTO orders (user_id, tradingsymbol, exchange, instrument_token, transaction_type, order_type, product, quantity, price, trigger_price, bracket_stoploss, bracket_target, bracket_parent_id, bracket_role)
       VALUES (@userId, @tradingsymbol, @exchange, @instrumentToken, @transactionType, @orderType, @product, @quantity, @price, @triggerPrice, @bracketStoploss, @bracketTarget, @bracketParentId, @bracketRole)`
    )
    .run({
      triggerPrice: null,
      bracketStoploss: null,
      bracketTarget: null,
      bracketParentId: null,
      bracketRole: null,
      ...order,
    });

  return db.prepare("SELECT * FROM orders WHERE id = ?").get(result.lastInsertRowid) as OrderRow;
}

/** When one leg of a bracket (SL/TARGET) fills or is cancelled, the other is no longer
 * needed — the position it was guarding is already closed — so cancel it too (OCO). */
function cancelBracketSibling(order: OrderRow, reason: string) {
  if (!order.bracket_parent_id) return;
  const sibling = db
    .prepare("SELECT * FROM orders WHERE bracket_parent_id = ? AND id != ? AND status = 'OPEN'")
    .get(order.bracket_parent_id, order.id) as OrderRow | undefined;
  if (sibling) {
    markOrder(sibling.id, { status: "CANCELLED", reject_reason: reason });
  }
}

/** Once a bracket entry order fills, spin up its SL/TARGET exit legs — sized and directioned
 * to close exactly the position the entry just opened, at the prices requested up front. */
async function createBracketLegs(entryOrder: OrderRow, fillPrice: number) {
  if (entryOrder.bracket_stoploss == null && entryOrder.bracket_target == null) return;

  const exitSide: "BUY" | "SELL" = entryOrder.transaction_type === "BUY" ? "SELL" : "BUY";
  const legs: { orderType: "SL-M" | "LIMIT"; price: number | null; triggerPrice: number | null; role: "SL" | "TARGET" }[] = [];
  if (entryOrder.bracket_stoploss != null) {
    legs.push({ orderType: "SL-M", price: null, triggerPrice: entryOrder.bracket_stoploss, role: "SL" });
  }
  if (entryOrder.bracket_target != null) {
    legs.push({ orderType: "LIMIT", price: entryOrder.bracket_target, triggerPrice: null, role: "TARGET" });
  }

  for (const leg of legs) {
    const child = insertOrderRow({
      userId: entryOrder.user_id,
      tradingsymbol: entryOrder.tradingsymbol,
      exchange: entryOrder.exchange,
      instrumentToken: entryOrder.instrument_token,
      transactionType: exitSide,
      orderType: leg.orderType,
      product: entryOrder.product,
      quantity: entryOrder.quantity,
      price: leg.price,
      triggerPrice: leg.triggerPrice,
      bracketParentId: entryOrder.id,
      bracketRole: leg.role,
    });

    const ltp = getCachedLtp(entryOrder.instrument_token) ?? fillPrice;
    await tryMatchOrder(child, ltp);
  }
}

function markOrder(id: number, fields: Partial<OrderRow>) {
  const sets = Object.keys(fields)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({
    id,
    ...fields,
  });
}

async function fillOrder(order: OrderRow, fillPrice: number) {
  markOrder(order.id, { status: "COMPLETE", filled_price: fillPrice });

  db.prepare(
    `INSERT INTO trades (order_id, user_id, tradingsymbol, transaction_type, quantity, price)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(order.id, order.user_id, order.tradingsymbol, order.transaction_type, order.quantity, fillPrice);

  const instrument = getInstrumentByToken(order.instrument_token) as
    | { exchange: string; tradingsymbol: string; instrument_type: string; name: string | null }
    | undefined;
  const isFno = instrument !== undefined && FNO_TYPES.has(instrument.instrument_type);

  // Real charges (brokerage/STT/exchange/SEBI/stamp-duty/GST) apply to every fill regardless
  // of segment — computed once here and stored permanently on trade_history so per-symbol
  // P&L can be reported net of trading costs, not just gross price movement.
  let charges = 0;
  try {
    charges = (
      await calculateOrderCosts({
        exchange: order.exchange,
        tradingsymbol: order.tradingsymbol,
        transactionType: order.transaction_type,
        product: order.product,
        orderType: "MARKET",
        quantity: order.quantity,
        price: fillPrice,
      })
    ).charges;
  } catch (err) {
    console.warn("[charges] calculation failed for this fill, proceeding with zero charges", err);
  }

  const historyResult = db
    .prepare(
      `INSERT INTO trade_history (user_id, tradingsymbol, exchange, instrument_token, transaction_type, order_type, product, quantity, price, charges)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      order.user_id,
      order.tradingsymbol,
      order.exchange,
      order.instrument_token,
      order.transaction_type,
      order.order_type,
      order.product,
      order.quantity,
      fillPrice,
      charges
    );
  const historyId = historyResult.lastInsertRowid;

  if (isFno && instrument) {
    // F&O cash impact is a margin block/release, not the full contract value: recompute the
    // margin needed for the resulting net position and settle the difference, plus any
    // realized P&L from the portion of this trade that closed existing exposure. Computed
    // before recordFillInPortfolio so "current position" reflects the pre-trade state.
    const { beforeMargin, newMargin } = await computeFnoMarginDelta({
      userId: order.user_id,
      instrumentToken: order.instrument_token,
      product: order.product as "MIS" | "NRML",
      exchange: instrument.exchange,
      tradingsymbol: instrument.tradingsymbol,
      transactionType: order.transaction_type,
      quantity: order.quantity,
      price: fillPrice,
    });

    const { realizedPnlDelta } = recordFillInPortfolio({
      userId: order.user_id,
      tradingsymbol: order.tradingsymbol,
      exchange: order.exchange,
      instrumentToken: order.instrument_token,
      product: order.product,
      transactionType: order.transaction_type,
      quantity: order.quantity,
      fillPrice,
      name: instrument.name,
    });

    setPositionMargin(order.instrument_token, order.product, newMargin, order.user_id);
    // "Margin used for this trade" — for an opening/adding trade that's the fresh requirement
    // it just created (newMargin); for a trade that reduces/closes the position, newMargin
    // drops toward zero, so the meaningful number is what had been tied up in the position
    // this trade is releasing (beforeMargin). Taking the larger of the two covers both without
    // needing to special-case which kind of trade this is.
    const marginUsedForTrade = Math.max(beforeMargin, newMargin);
    db.prepare("UPDATE trade_history SET margin_used = ? WHERE id = ?").run(marginUsedForTrade, historyId);

    const cashDelta = -(newMargin - beforeMargin) + realizedPnlDelta - charges;
    adjustBalance(cashDelta, order.user_id);

    const marginDelta = newMargin - beforeMargin;
    const parts = [
      `${order.transaction_type} ${order.quantity} ${order.tradingsymbol} @ ₹${fillPrice.toFixed(2)}`,
    ];
    if (marginDelta > 0) parts.push(`margin blocked ₹${marginDelta.toFixed(2)}`);
    else if (marginDelta < 0) parts.push(`margin released ₹${Math.abs(marginDelta).toFixed(2)}`);
    if (realizedPnlDelta !== 0) {
      parts.push(`P&L ${realizedPnlDelta >= 0 ? "+" : ""}₹${realizedPnlDelta.toFixed(2)}`);
    }
    if (charges > 0) parts.push(`charges ₹${charges.toFixed(2)}`);
    recordTransaction({
      userId: order.user_id,
      orderId: order.id,
      type: order.transaction_type,
      amount: cashDelta,
      description: `${parts[0]} (${parts.slice(1).join(", ") || "no margin change"})`,
    });
  } else {
    const notional = order.quantity * fillPrice;
    const cashDelta = (order.transaction_type === "BUY" ? -notional : notional) - charges;
    adjustBalance(cashDelta, order.user_id);

    recordFillInPortfolio({
      userId: order.user_id,
      tradingsymbol: order.tradingsymbol,
      exchange: order.exchange,
      instrumentToken: order.instrument_token,
      product: order.product,
      transactionType: order.transaction_type,
      quantity: order.quantity,
      fillPrice,
      name: instrument?.name,
    });

    recordTransaction({
      userId: order.user_id,
      orderId: order.id,
      type: order.transaction_type,
      amount: cashDelta,
      description: `${order.transaction_type} ${order.quantity} ${order.tradingsymbol} @ ₹${fillPrice.toFixed(2)} (${order.product})${
        charges > 0 ? ` · charges ₹${charges.toFixed(2)}` : ""
      }`,
    });
  }

  cancelBracketSibling(order, "Cancelled: other bracket leg was filled");
  await createBracketLegs(order, fillPrice);

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id) as OrderRow;
  orderEvents.emit("fill", updated);
}

async function validateAffordability(params: {
  userId: number;
  transactionType: "BUY" | "SELL";
  product: "MIS" | "CNC" | "NRML";
  instrumentToken: number;
  exchange: string;
  tradingsymbol: string;
  instrumentType: string;
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  quantity: number;
  estimatedPrice: number;
  triggerPrice?: number;
}) {
  const {
    userId,
    transactionType,
    product,
    instrumentToken,
    exchange,
    tradingsymbol,
    instrumentType,
    orderType,
    quantity,
    estimatedPrice,
    triggerPrice,
  } = params;

  // Futures/options margin is SPAN+exposure (typically ~10-20% of notional for futures,
  // just the premium for buying options) — nowhere near the full contract value, so this
  // needs Kite's real margin calculator rather than a naive qty*price estimate. And a trade
  // that closes/reduces an existing position needs no *new* margin at all — only the
  // incremental margin for the resulting net position (if any) is actually required.
  if (FNO_TYPES.has(instrumentType)) {
    let charges = 0;
    try {
      charges = (
        await calculateOrderCosts({
          exchange,
          tradingsymbol,
          transactionType,
          product: product as "MIS" | "NRML",
          orderType,
          quantity,
          price: estimatedPrice,
          triggerPrice,
        })
      ).charges;
    } catch (err) {
      console.warn("[charges] Kite charges API call failed, proceeding without charges in the check", err);
    }

    const { incrementalMargin } = await computeFnoMarginDelta({
      userId,
      instrumentToken,
      product: product as "MIS" | "NRML",
      exchange,
      tradingsymbol,
      transactionType,
      quantity,
      price: estimatedPrice,
    });
    const required = incrementalMargin + charges;

    const funds = getFunds(userId);
    if (!funds || funds.available_balance < required) {
      throw new OrderValidationError(
        `Insufficient margin: need ~₹${required.toFixed(2)}, available ₹${(funds?.available_balance ?? 0).toFixed(2)}`
      );
    }
    return;
  }

  if (transactionType === "BUY") {
    let charges = 0;
    try {
      charges = (
        await calculateOrderCosts({
          exchange,
          tradingsymbol,
          transactionType,
          product,
          orderType,
          quantity,
          price: estimatedPrice,
          triggerPrice,
        })
      ).charges;
    } catch (err) {
      console.warn("[charges] Kite charges API call failed, proceeding without charges in the check", err);
    }

    const funds = getFunds(userId);
    const required = quantity * estimatedPrice + charges;
    if (!funds || funds.available_balance < required) {
      throw new OrderValidationError(
        `Insufficient funds: need ~₹${required.toFixed(2)}, available ₹${(funds?.available_balance ?? 0).toFixed(2)}`
      );
    }
  } else if (transactionType === "SELL" && product === "CNC") {
    const held = getHoldingQuantity(instrumentToken, userId);
    if (held < quantity) {
      throw new OrderValidationError(
        `Cannot sell ${quantity} — only ${held} held in delivery holdings for this stock`
      );
    }
  }
}

export async function placeOrder(input: {
  userId?: number;
  instrumentToken: number;
  transactionType: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  product: "MIS" | "CNC" | "NRML";
  quantity: number;
  price?: number;
  triggerPrice?: number;
  bracketStoploss?: number;
  bracketTarget?: number;
}): Promise<OrderRow> {
  const userId = input.userId ?? config.defaultUserId;

  if (input.quantity <= 0) {
    throw new OrderValidationError("Quantity must be greater than zero");
  }
  if ((input.orderType === "LIMIT" || input.orderType === "SL") && (!input.price || input.price <= 0)) {
    throw new OrderValidationError(`${input.orderType === "SL" ? "Stop-loss" : "Limit"} orders require a positive price`);
  }
  if ((input.orderType === "SL" || input.orderType === "SL-M") && (!input.triggerPrice || input.triggerPrice <= 0)) {
    throw new OrderValidationError("Stop-loss orders require a positive trigger price");
  }
  if ((input.bracketStoploss || input.bracketTarget) && input.orderType !== "MARKET" && input.orderType !== "LIMIT") {
    throw new OrderValidationError("A bracket stoploss/target can only be attached to a Market or Limit entry order");
  }

  // A bracket exit only makes sense on the opposite side of the entry price: a BUY entry's
  // stoploss must sit below (protects against a fall) and target above (locks in a rise);
  // it's the mirror image for a SELL entry.
  function validateBracketPrices(referencePrice: number) {
    if (input.bracketStoploss != null && input.bracketStoploss <= 0) {
      throw new OrderValidationError("Stoploss price must be greater than zero");
    }
    if (input.bracketTarget != null && input.bracketTarget <= 0) {
      throw new OrderValidationError("Target price must be greater than zero");
    }
    if (input.transactionType === "BUY") {
      if (input.bracketStoploss != null && input.bracketStoploss >= referencePrice) {
        throw new OrderValidationError("Stoploss price must be below the entry price for a buy order");
      }
      if (input.bracketTarget != null && input.bracketTarget <= referencePrice) {
        throw new OrderValidationError("Target price must be above the entry price for a buy order");
      }
    } else {
      if (input.bracketStoploss != null && input.bracketStoploss <= referencePrice) {
        throw new OrderValidationError("Stoploss price must be above the entry price for a sell order");
      }
      if (input.bracketTarget != null && input.bracketTarget >= referencePrice) {
        throw new OrderValidationError("Target price must be below the entry price for a sell order");
      }
    }
  }

  const instrument = getInstrumentByToken(input.instrumentToken) as
    | { tradingsymbol: string; exchange: string; lot_size: number; instrument_type: string }
    | undefined;
  if (!instrument) {
    throw new OrderValidationError("Unknown instrument");
  }

  if (FNO_TYPES.has(instrument.instrument_type)) {
    if (input.quantity % instrument.lot_size !== 0) {
      throw new OrderValidationError(
        `Quantity must be a multiple of the lot size (${instrument.lot_size}) for ${instrument.tradingsymbol}`
      );
    }
    if (input.product === "CNC") {
      throw new OrderValidationError("CNC (delivery) is not valid for futures/options — use MIS or NRML");
    }
  }

  subscribeTokens([input.instrumentToken]);

  if (input.orderType === "MARKET") {
    const ltp = await resolveLtp(input.instrumentToken, instrument.exchange, instrument.tradingsymbol);
    validateBracketPrices(ltp);
    await validateAffordability({
      userId,
      transactionType: input.transactionType,
      product: input.product,
      instrumentToken: input.instrumentToken,
      exchange: instrument.exchange,
      tradingsymbol: instrument.tradingsymbol,
      instrumentType: instrument.instrument_type,
      orderType: input.orderType,
      quantity: input.quantity,
      estimatedPrice: ltp,
    });

    const order = insertOrderRow({
      userId,
      tradingsymbol: instrument.tradingsymbol,
      exchange: instrument.exchange,
      instrumentToken: input.instrumentToken,
      transactionType: input.transactionType,
      orderType: input.orderType,
      product: input.product,
      quantity: input.quantity,
      price: null,
      bracketStoploss: input.bracketStoploss ?? null,
      bracketTarget: input.bracketTarget ?? null,
    });

    await fillOrder(order, ltp);
    return db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id) as OrderRow;
  }

  // LIMIT / SL / SL-M — rests on the book until price action triggers/crosses it.
  if (input.orderType === "SL" || input.orderType === "SL-M") {
    // A stop-loss only makes sense on the opposite side of the current price: a BUY stop
    // waits for the price to rise through the trigger, a SELL stop waits for it to fall
    // through — matching real Kite's SL/SL-M validation.
    const ltp = await resolveLtp(input.instrumentToken, instrument.exchange, instrument.tradingsymbol);
    if (input.transactionType === "BUY" && input.triggerPrice! <= ltp) {
      throw new OrderValidationError(
        `Trigger price must be above the current market price (₹${ltp.toFixed(2)}) for a buy stop-loss`
      );
    }
    if (input.transactionType === "SELL" && input.triggerPrice! >= ltp) {
      throw new OrderValidationError(
        `Trigger price must be below the current market price (₹${ltp.toFixed(2)}) for a sell stop-loss`
      );
    }
    if (input.orderType === "SL") {
      if (input.transactionType === "BUY" && input.price! < input.triggerPrice!) {
        throw new OrderValidationError("Limit price must be at or above the trigger price for a buy stop-loss");
      }
      if (input.transactionType === "SELL" && input.price! > input.triggerPrice!) {
        throw new OrderValidationError("Limit price must be at or below the trigger price for a sell stop-loss");
      }
    }
  }

  if (input.orderType === "LIMIT") {
    validateBracketPrices(input.price!);
  }

  const estimatedPrice = input.orderType === "SL-M" ? input.triggerPrice! : input.price!;
  await validateAffordability({
    userId,
    transactionType: input.transactionType,
    product: input.product,
    instrumentToken: input.instrumentToken,
    exchange: instrument.exchange,
    tradingsymbol: instrument.tradingsymbol,
    instrumentType: instrument.instrument_type,
    orderType: input.orderType,
    quantity: input.quantity,
    estimatedPrice,
    triggerPrice: input.triggerPrice,
  });

  const order = insertOrderRow({
    userId,
    tradingsymbol: instrument.tradingsymbol,
    exchange: instrument.exchange,
    instrumentToken: input.instrumentToken,
    transactionType: input.transactionType,
    orderType: input.orderType,
    product: input.product,
    quantity: input.quantity,
    price: input.orderType === "SL-M" ? null : input.price!,
    triggerPrice: input.triggerPrice ?? null,
    bracketStoploss: input.bracketStoploss ?? null,
    bracketTarget: input.bracketTarget ?? null,
  });

  // In case a plain LIMIT is already crossable against the last known price (SL/SL-M can't
  // be, since the direction check above guarantees the trigger hasn't already passed).
  const ltp = getCachedLtp(input.instrumentToken);
  if (ltp !== undefined) {
    await tryMatchOrder(order, ltp);
  }

  return order;
}

async function tryMatchOrder(order: OrderRow, ltp: number) {
  if (order.status !== "OPEN") return;

  // Re-check against the DB: a bracket sibling processed earlier in the same tick batch may
  // have just cancelled this order, and the in-memory snapshot passed in wouldn't reflect it.
  const fresh = db.prepare("SELECT status FROM orders WHERE id = ?").get(order.id) as { status: string } | undefined;
  if (!fresh || fresh.status !== "OPEN") return;

  if (order.order_type === "LIMIT") {
    if (order.price === null) return;
    const crosses = order.transaction_type === "BUY" ? ltp <= order.price : ltp >= order.price;
    if (crosses) await fillOrder(order, order.price);
    return;
  }

  if (order.order_type === "SL-M") {
    if (order.trigger_price === null) return;
    const triggered = order.transaction_type === "BUY" ? ltp >= order.trigger_price : ltp <= order.trigger_price;
    if (triggered) await fillOrder(order, ltp);
    return;
  }

  if (order.order_type === "SL") {
    if (order.trigger_price === null || order.price === null) return;
    const limitPrice = order.price;
    if (!order.triggered) {
      const crossedTrigger =
        order.transaction_type === "BUY" ? ltp >= order.trigger_price : ltp <= order.trigger_price;
      if (!crossedTrigger) return;
      markOrder(order.id, { triggered: 1 });
    }
    // Once triggered, an SL order behaves exactly like a resting limit order at `price`.
    const crossesLimit = order.transaction_type === "BUY" ? ltp <= limitPrice : ltp >= limitPrice;
    if (crossesLimit) await fillOrder(order, limitPrice);
  }
}

tickerEvents.on("ticks", async (ticks: Tick[]) => {
  for (const tick of ticks) {
    const openOrders = db
      .prepare(
        "SELECT * FROM orders WHERE status = 'OPEN' AND order_type IN ('LIMIT','SL','SL-M') AND instrument_token = ?"
      )
      .all(tick.instrument_token) as OrderRow[];

    for (const order of openOrders) {
      await tryMatchOrder(order, tick.last_price);
    }
  }
});

export function cancelOrder(orderId: number, userId: number = config.defaultUserId): OrderRow {
  const order = db
    .prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?")
    .get(orderId, userId) as OrderRow | undefined;

  if (!order) throw new OrderValidationError("Order not found");
  if (order.status !== "OPEN") throw new OrderValidationError("Only open orders can be cancelled");

  markOrder(orderId, { status: "CANCELLED" });
  cancelBracketSibling(order, "Cancelled: other bracket leg was cancelled");
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow;
}

export function listOrders(userId: number = config.defaultUserId): OrderRow[] {
  return db
    .prepare(
      `SELECT o.*, i.name, i.instrument_type, i.expiry, i.strike
       FROM orders o
       LEFT JOIN instruments i ON i.instrument_token = o.instrument_token
       WHERE o.user_id = ?
       ORDER BY o.placed_at DESC`
    )
    .all(userId) as OrderRow[];
}

export function listTrades(userId: number = config.defaultUserId) {
  return db
    .prepare("SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC")
    .all(userId);
}

export function listTradeHistory(userId: number = config.defaultUserId, limit = 500) {
  // Pick the most recent `limit` trades (innermost ORDER BY + LIMIT), then display them
  // oldest-first so the most recently executed trade ends up at the bottom of the list.
  return db
    .prepare(
      `SELECT * FROM (
         SELECT th.*, i.name, i.instrument_type, i.expiry, i.strike
         FROM trade_history th
         LEFT JOIN instruments i ON i.instrument_token = th.instrument_token
         WHERE th.user_id = ?
         ORDER BY th.executed_at DESC, th.id DESC
         LIMIT ?
       )
       ORDER BY executed_at ASC, id ASC`
    )
    .all(userId, limit);
}
