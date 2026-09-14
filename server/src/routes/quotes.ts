import { Router } from "express";
import { kite } from "../kite/kiteClient";
import { getCachedLtp } from "../kite/ticker";
import { getInstrumentByToken, getInstrumentBySymbol } from "../kite/instruments";

export const quotesRouter = Router();

// Widely-stable Kite instrument tokens, used only if the local instrument cache
// hasn't been synced yet (e.g. right after a fresh login).
const INDEX_FALLBACKS = {
  NIFTY: { exchange: "NSE", tradingsymbol: "NIFTY 50", fallbackToken: 256265 },
  SENSEX: { exchange: "BSE", tradingsymbol: "SENSEX", fallbackToken: 265 },
};

quotesRouter.get("/indices", async (_req, res) => {
  try {
    const entries = Object.entries(INDEX_FALLBACKS).map(([key, def]) => {
      const found = getInstrumentBySymbol(def.exchange, def.tradingsymbol);
      const token = found?.instrument_token ?? def.fallbackToken;
      return { key, exchange: def.exchange, tradingsymbol: def.tradingsymbol, key_str: `${def.exchange}:${def.tradingsymbol}`, token };
    });

    const quotes = await kite.getQuote(entries.map((e) => e.key_str));

    const result: Record<string, { name: string; last_price: number; change: number; change_percent: number }> = {};
    for (const entry of entries) {
      const q = quotes[entry.key_str];
      if (!q) continue;
      const prevClose = q.ohlc?.close ?? q.last_price;
      const change = q.last_price - prevClose;
      result[entry.key] = {
        name: entry.tradingsymbol,
        last_price: q.last_price,
        change,
        change_percent: prevClose ? (change / prevClose) * 100 : 0,
      };
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch index quotes" });
  }
});

// Full quote (OHLC, LTP) for initial page loads; live updates arrive over WS after this.
quotesRouter.get("/", async (req, res) => {
  const tokensParam = req.query.tokens as string | undefined;
  if (!tokensParam) {
    res.status(400).json({ error: "tokens query param is required (comma-separated instrument tokens)" });
    return;
  }

  const tokens = tokensParam.split(",").map((t) => Number(t.trim())).filter(Boolean);
  const tokenToKey = new Map<number, string>();
  for (const t of tokens) {
    const instrument = getInstrumentByToken(t) as { exchange: string; tradingsymbol: string } | undefined;
    if (instrument) tokenToKey.set(t, `${instrument.exchange}:${instrument.tradingsymbol}`);
  }

  if (tokenToKey.size === 0) {
    res.json({});
    return;
  }

  try {
    const quotes = await kite.getQuote(Array.from(tokenToKey.values()));
    const byToken: Record<number, any> = {};
    for (const [token, key] of tokenToKey) {
      if (quotes[key]) byToken[token] = quotes[key];
    }
    res.json(byToken);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch quotes" });
  }
});

quotesRouter.get("/ltp/:token", (req, res) => {
  const token = Number(req.params.token);
  const ltp = getCachedLtp(token);
  res.json({ instrument_token: token, ltp: ltp ?? null });
});
