import { Router } from "express";
import {
  placeOrder,
  cancelOrder,
  listOrders,
  listTrades,
  listTradeHistory,
  computeFnoMarginDelta,
  OrderValidationError,
} from "../services/ordersService";
import { getInstrumentByToken } from "../kite/instruments";
import { calculateOrderCosts } from "../services/marginService";
import { config } from "../config";

export const ordersRouter = Router();

ordersRouter.post("/margin", async (req, res) => {
  try {
    const { instrument_token, transaction_type, order_type, product, quantity, price, trigger_price } = req.body;
    const instrument = getInstrumentByToken(Number(instrument_token)) as
      | { tradingsymbol: string; exchange: string; instrument_type: string }
      | undefined;
    if (!instrument) {
      res.status(404).json({ error: "Unknown instrument" });
      return;
    }

    const isFno = ["FUT", "CE", "PE"].includes(instrument.instrument_type);
    const notional = Number(quantity) * Number(price);

    try {
      const costs = await calculateOrderCosts({
        exchange: instrument.exchange,
        tradingsymbol: instrument.tradingsymbol,
        transactionType: transaction_type,
        product,
        orderType: order_type,
        quantity: Number(quantity),
        price: Number(price),
        triggerPrice: trigger_price ? Number(trigger_price) : undefined,
      });

      if (isFno) {
        // Show the same incremental margin the order engine will actually charge — a trade
        // that closes/reduces an existing position needs no *new* margin, so the preview
        // shouldn't show the full fresh-position margin as if this were a brand new trade.
        const { incrementalMargin } = await computeFnoMarginDelta({
          userId: config.defaultUserId,
          instrumentToken: Number(instrument_token),
          product,
          exchange: instrument.exchange,
          tradingsymbol: instrument.tradingsymbol,
          transactionType: transaction_type,
          quantity: Number(quantity),
          price: Number(price),
        });
        res.json({ required: incrementalMargin + costs.charges, charges: costs.charges, source: "kite" });
        return;
      }

      res.json({ required: notional + costs.charges, charges: costs.charges, source: "kite" });
    } catch (err) {
      console.warn("[margin] Kite margin API call failed, falling back to full notional estimate", err);
      res.json({ required: notional, charges: 0, source: "estimate" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to calculate margin" });
  }
});

ordersRouter.get("/", (_req, res) => {
  res.json(listOrders());
});

ordersRouter.get("/trades", (_req, res) => {
  res.json(listTrades());
});

ordersRouter.get("/history", (_req, res) => {
  res.json(listTradeHistory());
});

ordersRouter.post("/", async (req, res) => {
  try {
    const {
      instrument_token,
      transaction_type,
      order_type,
      product,
      quantity,
      price,
      trigger_price,
      bracket_stoploss,
      bracket_target,
    } = req.body;
    const order = await placeOrder({
      instrumentToken: Number(instrument_token),
      transactionType: transaction_type,
      orderType: order_type,
      product,
      quantity: Number(quantity),
      price: price ? Number(price) : undefined,
      triggerPrice: trigger_price ? Number(trigger_price) : undefined,
      bracketStoploss: bracket_stoploss ? Number(bracket_stoploss) : undefined,
      bracketTarget: bracket_target ? Number(bracket_target) : undefined,
    });
    res.status(201).json(order);
  } catch (err: any) {
    if (err instanceof OrderValidationError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error("[orders] place order failed", err);
      res.status(500).json({ error: "Failed to place order" });
    }
  }
});

ordersRouter.delete("/:id", (req, res) => {
  try {
    const order = cancelOrder(Number(req.params.id));
    res.json(order);
  } catch (err: any) {
    if (err instanceof OrderValidationError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Failed to cancel order" });
    }
  }
});
