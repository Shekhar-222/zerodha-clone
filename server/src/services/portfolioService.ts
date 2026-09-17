import { db } from "../db/db";
import { config } from "../config";
import { getCachedLtp } from "../kite/ticker";
import { mcxUnitMultiplier } from "./mcxLotSizes";

const FNO_TYPES = new Set(["FUT", "CE", "PE"]);

export type PositionRow = {
  id: number;
  user_id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  product: string;
  quantity: number;
  avg_price: number;
  realized_pnl: number;
  margin_blocked: number;
  opened_at: string | null;
  updated_at: string;
  name: string | null;
  instrument_type: string | null;
  lot_size: number | null;
  expiry: string | null;
  strike: number | null;
};

export type HoldingRow = {
  id: number;
  user_id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  quantity: number;
  avg_price: number;
  instrument_type: string | null;
  lot_size: number | null;
};

export function getPositions(userId: number = config.defaultUserId) {
  const rows = db
    .prepare(
      `SELECT p.*, i.name, i.instrument_type, i.lot_size, i.expiry, i.strike
       FROM positions p
       LEFT JOIN instruments i ON i.instrument_token = p.instrument_token
       WHERE p.user_id = ? AND p.quantity != 0
       ORDER BY COALESCE(p.opened_at, p.updated_at) ASC, p.id ASC`
    )
    .all(userId) as PositionRow[];

  return rows.map((row) => {
    const ltp = getCachedLtp(row.instrument_token) ?? row.avg_price;
    const unrealized_pnl = (ltp - row.avg_price) * row.quantity * mcxUnitMultiplier(row.exchange, row.name);
    return { ...row, ltp, unrealized_pnl };
  });
}

export function getHoldings(userId: number = config.defaultUserId) {
  const rows = db
    .prepare(
      `SELECT h.*, i.instrument_type, i.lot_size
       FROM holdings h
       LEFT JOIN instruments i ON i.instrument_token = h.instrument_token
       WHERE h.user_id = ? AND h.quantity != 0`
    )
    .all(userId) as HoldingRow[];

  return rows.map((row) => {
    const ltp = getCachedLtp(row.instrument_token) ?? row.avg_price;
    const unrealized_pnl = (ltp - row.avg_price) * row.quantity;
    return { ...row, ltp, unrealized_pnl };
  });
}

function upsertPosition(
  userId: number,
  tradingsymbol: string,
  exchange: string,
  instrumentToken: number,
  product: string,
  transactionType: "BUY" | "SELL",
  tradeQty: number,
  fillPrice: number,
  name: string | null
): { quantity: number; realizedPnlDelta: number } {
  const existing = db
    .prepare(
      "SELECT * FROM positions WHERE user_id = ? AND instrument_token = ? AND product = ?"
    )
    .get(userId, instrumentToken, product) as PositionRow | undefined;

  const current = existing ?? {
    quantity: 0,
    avg_price: 0,
    realized_pnl: 0,
  };

  const { quantity, avg_price, realized_pnl, realized_pnl_delta } = applyFill(
    current.quantity,
    current.avg_price,
    current.realized_pnl,
    transactionType,
    tradeQty,
    fillPrice,
    mcxUnitMultiplier(exchange, name)
  );

  db.prepare(
    `INSERT INTO positions (user_id, tradingsymbol, exchange, instrument_token, product, quantity, avg_price, realized_pnl, opened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id, instrument_token, product) DO UPDATE SET
       quantity = excluded.quantity,
       avg_price = excluded.avg_price,
       realized_pnl = excluded.realized_pnl,
       -- A fresh entry (this row was flat before this fill) resets opened_at to now; adding to
       -- or partially reducing an already-open position leaves its original entry time alone.
       opened_at = CASE WHEN positions.quantity = 0 THEN excluded.opened_at ELSE positions.opened_at END,
       updated_at = datetime('now')`
  ).run(userId, tradingsymbol, exchange, instrumentToken, product, quantity, avg_price, realized_pnl);

  return { quantity, realizedPnlDelta: realized_pnl_delta };
}

function upsertHolding(
  userId: number,
  tradingsymbol: string,
  exchange: string,
  instrumentToken: number,
  transactionType: "BUY" | "SELL",
  tradeQty: number,
  fillPrice: number
) {
  const existing = db
    .prepare("SELECT * FROM holdings WHERE user_id = ? AND instrument_token = ?")
    .get(userId, instrumentToken) as HoldingRow | undefined;

  const current = existing ?? { quantity: 0, avg_price: 0 };
  const { quantity, avg_price } = applyFill(
    current.quantity,
    current.avg_price,
    0,
    transactionType,
    tradeQty,
    fillPrice
  );

  db.prepare(
    `INSERT INTO holdings (user_id, tradingsymbol, exchange, instrument_token, quantity, avg_price)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, instrument_token) DO UPDATE SET
       quantity = excluded.quantity,
       avg_price = excluded.avg_price`
  ).run(userId, tradingsymbol, exchange, instrumentToken, quantity, avg_price);
}

/**
 * Weighted-average position math on a signed-quantity position (positive = long, negative = short).
 * Handles adding to a position, partial/full closes, and direction flips in one pass.
 */
export function applyFill(
  quantity: number,
  avgPrice: number,
  realizedPnl: number,
  transactionType: "BUY" | "SELL",
  tradeQty: number,
  fillPrice: number,
  unitMultiplier: number = 1
): { quantity: number; avg_price: number; realized_pnl: number; realized_pnl_delta: number; closingQty: number } {
  const signedTradeQty = transactionType === "BUY" ? tradeQty : -tradeQty;

  if (quantity === 0 || Math.sign(quantity) === Math.sign(signedTradeQty)) {
    const newQuantity = quantity + signedTradeQty;
    const newAvgPrice =
      (Math.abs(quantity) * avgPrice + tradeQty * fillPrice) / Math.abs(newQuantity);
    return {
      quantity: newQuantity,
      avg_price: newAvgPrice,
      realized_pnl: realizedPnl,
      realized_pnl_delta: 0,
      closingQty: 0,
    };
  }

  const closingQty = Math.min(Math.abs(signedTradeQty), Math.abs(quantity));
  const pnlPerUnit = quantity > 0 ? fillPrice - avgPrice : avgPrice - fillPrice;
  const pnlDelta = pnlPerUnit * closingQty * unitMultiplier;
  const newRealizedPnl = realizedPnl + pnlDelta;

  const newQuantity = quantity + signedTradeQty;
  const remainingTradeQty = Math.abs(signedTradeQty) - closingQty;

  let newAvgPrice = avgPrice;
  if (newQuantity === 0) {
    newAvgPrice = 0;
  } else if (remainingTradeQty > 0) {
    newAvgPrice = fillPrice;
  }

  return {
    quantity: newQuantity,
    avg_price: newAvgPrice,
    realized_pnl: newRealizedPnl,
    realized_pnl_delta: pnlDelta,
    closingQty,
  };
}

export function recordFillInPortfolio(params: {
  userId: number;
  tradingsymbol: string;
  exchange: string;
  instrumentToken: number;
  product: "MIS" | "CNC" | "NRML";
  transactionType: "BUY" | "SELL";
  quantity: number;
  fillPrice: number;
  name?: string | null;
}): { quantity: number; realizedPnlDelta: number } {
  const { userId, tradingsymbol, exchange, instrumentToken, product, transactionType, quantity, fillPrice, name } =
    params;

  const result = upsertPosition(
    userId,
    tradingsymbol,
    exchange,
    instrumentToken,
    product,
    transactionType,
    quantity,
    fillPrice,
    name ?? null
  );

  if (product === "CNC") {
    upsertHolding(userId, tradingsymbol, exchange, instrumentToken, transactionType, quantity, fillPrice);
  }

  return result;
}

export type PnlSummaryItem = {
  tradingsymbol: string;
  exchange: string;
  name: string | null;
  instrument_type: string | null;
  expiry: string | null;
  strike: number | null;
  product: string;
  status: "closed" | "open";
  executed_at: string | null;
  quantity: number;
  lot_size: number | null;
  pnl: number;
  charges: number;
  net_pnl: number;
  /** F&O only: margin blocked for the position right after this trade (or currently blocked,
   * for a still-open position). Null for equity, and for closed F&O trades placed before this
   * field existed (backfilled separately, approximated from today's margin rates). */
  margin_used: number | null;
};

/**
 * Per-trade P&L, not per-symbol: if you round-tripped the same stock three times today,
 * you get three separate rows (one per closing trade), each with its own realized P&L and
 * that trade's own charges — not one number that hides how each individual trade actually
 * went. Replays trade_history in order through the same weighted-average logic positions
 * use, so a closing trade's realized_pnl_delta is exactly what that trade contributed.
 * Currently open positions get one row each for live unrealized P&L (nothing to split up
 * yet since they haven't been closed).
 */
export function getPnlSummary(userId: number = config.defaultUserId): PnlSummaryItem[] {
  const trades = db
    .prepare(
      `SELECT th.tradingsymbol, th.exchange, th.product, th.transaction_type, th.quantity, th.price, th.charges, th.executed_at, th.margin_used,
              i.name, i.instrument_type, i.lot_size, i.expiry, i.strike
       FROM trade_history th
       LEFT JOIN instruments i ON i.instrument_token = th.instrument_token
       WHERE th.user_id = ? ORDER BY th.executed_at ASC, th.id ASC`
    )
    .all(userId) as {
    tradingsymbol: string;
    exchange: string;
    product: string;
    transaction_type: "BUY" | "SELL";
    quantity: number;
    price: number;
    charges: number;
    executed_at: string;
    margin_used: number | null;
    name: string | null;
    instrument_type: string | null;
    lot_size: number | null;
    expiry: string | null;
    strike: number | null;
  }[];

  const state = new Map<string, { quantity: number; avg_price: number; realized_pnl: number }>();
  const closedRows: PnlSummaryItem[] = [];

  for (const trade of trades) {
    const key = `${trade.tradingsymbol}::${trade.product}`;
    const current = state.get(key) ?? { quantity: 0, avg_price: 0, realized_pnl: 0 };
    const result = applyFill(
      current.quantity,
      current.avg_price,
      current.realized_pnl,
      trade.transaction_type,
      trade.quantity,
      trade.price,
      mcxUnitMultiplier(trade.exchange, trade.name)
    );
    state.set(key, { quantity: result.quantity, avg_price: result.avg_price, realized_pnl: result.realized_pnl });

    // Only trades that actually closed some existing exposure count as a P&L event — a pure
    // opening trade has real charges too, but no P&L yet, so it shouldn't show up here as
    // one. A closing trade at an unchanged price (zero gross P&L) still counts, since it
    // still cost real charges that shouldn't silently disappear.
    if (result.closingQty > 0) {
      closedRows.push({
        tradingsymbol: trade.tradingsymbol,
        exchange: trade.exchange,
        name: trade.name,
        instrument_type: trade.instrument_type,
        expiry: trade.expiry,
        strike: trade.strike,
        product: trade.product,
        status: "closed",
        executed_at: trade.executed_at,
        quantity: trade.quantity,
        lot_size: trade.lot_size,
        pnl: result.realized_pnl_delta,
        charges: trade.charges,
        net_pnl: result.realized_pnl_delta - trade.charges,
        margin_used: trade.margin_used,
      });
    }
  }

  // Open positions are shown on the Positions tab already — this list is exited trades only.
  return closedRows.sort((a, b) => (b.executed_at ?? "").localeCompare(a.executed_at ?? ""));
}

export function getHoldingQuantity(instrumentToken: number, userId: number = config.defaultUserId): number {
  const row = db
    .prepare("SELECT quantity FROM holdings WHERE user_id = ? AND instrument_token = ?")
    .get(userId, instrumentToken) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

export function getPositionMarginBlocked(
  instrumentToken: number,
  product: string,
  userId: number = config.defaultUserId
): number {
  const row = db
    .prepare("SELECT margin_blocked FROM positions WHERE user_id = ? AND instrument_token = ? AND product = ?")
    .get(userId, instrumentToken, product) as { margin_blocked: number } | undefined;
  return row?.margin_blocked ?? 0;
}

export function getPositionQuantity(
  instrumentToken: number,
  product: string,
  userId: number = config.defaultUserId
): number {
  const row = db
    .prepare("SELECT quantity FROM positions WHERE user_id = ? AND instrument_token = ? AND product = ?")
    .get(userId, instrumentToken, product) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

export function setPositionMargin(
  instrumentToken: number,
  product: string,
  marginBlocked: number,
  userId: number = config.defaultUserId
) {
  db.prepare(
    "UPDATE positions SET margin_blocked = ? WHERE user_id = ? AND instrument_token = ? AND product = ?"
  ).run(marginBlocked, userId, instrumentToken, product);
}

export function getTotalMarginBlocked(userId: number = config.defaultUserId): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(margin_blocked), 0) as total FROM positions WHERE user_id = ? AND quantity != 0")
    .get(userId) as { total: number };
  return row.total;
}

/**
 * Real brokers mark F&O positions to market continuously, so a running loss eats into your
 * usable margin well before you close the position — not just at settlement. Equity is left
 * out here since delivery/MIS equity already debits the full cash amount at trade time, so
 * an unrealized equity loss is already reflected in "less cash + a less valuable holding"
 * rather than something that should further reduce available margin.
 */
export function getTotalFnoUnrealizedPnl(userId: number = config.defaultUserId): number {
  const rows = db
    .prepare(
      `SELECT p.instrument_token, p.quantity, p.avg_price, p.exchange, i.name
       FROM positions p
       JOIN instruments i ON i.instrument_token = p.instrument_token
       WHERE p.user_id = ? AND p.quantity != 0 AND i.instrument_type IN ('FUT','CE','PE')`
    )
    .all(userId) as {
    instrument_token: number;
    quantity: number;
    avg_price: number;
    exchange: string;
    name: string | null;
  }[];

  return rows.reduce((sum, row) => {
    const ltp = getCachedLtp(row.instrument_token) ?? row.avg_price;
    return sum + (ltp - row.avg_price) * row.quantity * mcxUnitMultiplier(row.exchange, row.name);
  }, 0);
}
