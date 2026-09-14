import { Router } from "express";
import {
  searchInstruments,
  syncInstrumentsIfNeeded,
  resolveUnderlyingName,
  getOptionExpiries,
  getOptionChain,
} from "../kite/instruments";
import { kite } from "../kite/kiteClient";

export const instrumentsRouter = Router();

const HISTORY_INTERVALS = new Set([
  "minute",
  "day",
  "3minute",
  "5minute",
  "10minute",
  "15minute",
  "30minute",
  "60minute",
]);

instrumentsRouter.get("/history", async (req, res) => {
  const token = Number(req.query.token);
  const interval = (req.query.interval as string | undefined) ?? "day";
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!token || !from || !to) {
    res.status(400).json({ error: "token, from, and to query params are required" });
    return;
  }
  if (!HISTORY_INTERVALS.has(interval)) {
    res.status(400).json({ error: `interval must be one of: ${[...HISTORY_INTERVALS].join(", ")}` });
    return;
  }

  try {
    const candles = await kite.getHistoricalData(token, interval as any, from, to, false);
    res.json(candles);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch historical data" });
  }
});

instrumentsRouter.get("/option-chain/expiries", async (req, res) => {
  const symbol = (req.query.symbol as string | undefined)?.trim();
  if (!symbol) {
    res.status(400).json({ error: "symbol query param is required" });
    return;
  }
  try {
    await syncInstrumentsIfNeeded();
    const underlying = resolveUnderlyingName(symbol.toUpperCase());
    res.json({ underlying, expiries: getOptionExpiries(underlying) });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch expiries" });
  }
});

instrumentsRouter.get("/option-chain", async (req, res) => {
  const symbol = (req.query.symbol as string | undefined)?.trim();
  const expiry = (req.query.expiry as string | undefined)?.trim();
  if (!symbol || !expiry) {
    res.status(400).json({ error: "symbol and expiry query params are required" });
    return;
  }
  try {
    const underlying = resolveUnderlyingName(symbol.toUpperCase());
    res.json(getOptionChain(underlying, expiry));
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch option chain" });
  }
});

instrumentsRouter.get("/search", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const query = (req.query.q as string | undefined)?.trim();
  if (!query || query.length < 1) {
    res.json([]);
    return;
  }
  try {
    await syncInstrumentsIfNeeded();
    res.json(searchInstruments(query));
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to search instruments" });
  }
});

instrumentsRouter.post("/sync", async (_req, res) => {
  try {
    await syncInstrumentsIfNeeded();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to sync instruments" });
  }
});
