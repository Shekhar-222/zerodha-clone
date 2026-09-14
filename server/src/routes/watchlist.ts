import { Router } from "express";
import { db } from "../db/db";
import { config } from "../config";
import { getInstrumentByToken } from "../kite/instruments";
import { subscribeTokens } from "../kite/ticker";

export const watchlistRouter = Router();

watchlistRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT w.id, w.tradingsymbol, w.exchange, w.instrument_token, w.sort_order,
              i.name, i.instrument_type, i.lot_size, i.expiry, i.strike
       FROM watchlist w
       LEFT JOIN instruments i ON i.instrument_token = w.instrument_token
       WHERE w.user_id = ?
       ORDER BY w.sort_order, w.id`
    )
    .all(config.defaultUserId);
  res.json(rows);
});

watchlistRouter.post("/", (req, res) => {
  const { instrument_token } = req.body as { instrument_token?: number };
  if (!instrument_token) {
    res.status(400).json({ error: "instrument_token is required" });
    return;
  }

  const instrument = getInstrumentByToken(instrument_token) as
    | { tradingsymbol: string; exchange: string }
    | undefined;
  if (!instrument) {
    res.status(404).json({ error: "Unknown instrument" });
    return;
  }

  const nextSortOrder = (
    db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM watchlist WHERE user_id = ?").get(
      config.defaultUserId
    ) as { next: number }
  ).next;

  db.prepare(
    `INSERT OR IGNORE INTO watchlist (user_id, tradingsymbol, exchange, instrument_token, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(config.defaultUserId, instrument.tradingsymbol, instrument.exchange, instrument_token, nextSortOrder);

  subscribeTokens([instrument_token]);
  res.json({ ok: true });
});

watchlistRouter.put("/reorder", (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids must be an array of watchlist row ids" });
    return;
  }

  const update = db.prepare("UPDATE watchlist SET sort_order = ? WHERE id = ? AND user_id = ?");
  const updateMany = db.transaction((rows: number[]) => {
    rows.forEach((id, index) => update.run(index, id, config.defaultUserId));
  });
  updateMany(ids);

  res.json({ ok: true });
});

watchlistRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM watchlist WHERE id = ? AND user_id = ?").run(
    req.params.id,
    config.defaultUserId
  );
  res.json({ ok: true });
});
