import { Router } from "express";
import {
  searchInstruments,
  syncInstrumentsIfNeeded,
  resolveUnderlyingName,
  getOptionExpiries,
  getOptionChain,
} from "../kite/instruments";

export const instrumentsRouter = Router();

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
