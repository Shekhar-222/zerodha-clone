import { Router } from "express";
import { db } from "../db/db";
import { config } from "../config";
import { getInstrumentByToken } from "../kite/instruments";
import { subscribeTokens } from "../kite/ticker";

export const watchlistRouter = Router();

watchlistRouter.get("/groups", (_req, res) => {
  const rows = db
    .prepare("SELECT id, name, sort_order FROM watchlist_groups WHERE user_id = ? ORDER BY sort_order, id")
    .all(config.defaultUserId);
  res.json(rows);
});

watchlistRouter.post("/groups", (req, res) => {
  const { name } = req.body as { name?: string };

  const count = (
    db.prepare("SELECT COUNT(*) as c FROM watchlist_groups WHERE user_id = ?").get(config.defaultUserId) as {
      c: number;
    }
  ).c;
  const nextSortOrder = (
    db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM watchlist_groups WHERE user_id = ?").get(
      config.defaultUserId
    ) as { next: number }
  ).next;

  const finalName = name?.trim() || `Watchlist ${count + 1}`;
  const result = db
    .prepare("INSERT INTO watchlist_groups (user_id, name, sort_order) VALUES (?, ?, ?)")
    .run(config.defaultUserId, finalName, nextSortOrder);

  res.json({ id: result.lastInsertRowid, name: finalName, sort_order: nextSortOrder });
});

watchlistRouter.put("/groups/:id", (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  db.prepare("UPDATE watchlist_groups SET name = ? WHERE id = ? AND user_id = ?").run(
    name.trim(),
    req.params.id,
    config.defaultUserId
  );
  res.json({ ok: true });
});

watchlistRouter.delete("/groups/:id", (req, res) => {
  const count = (
    db.prepare("SELECT COUNT(*) as c FROM watchlist_groups WHERE user_id = ?").get(config.defaultUserId) as {
      c: number;
    }
  ).c;
  if (count <= 1) {
    res.status(400).json({ error: "Can't delete your last remaining watchlist" });
    return;
  }

  db.transaction(() => {
    db.prepare("DELETE FROM watchlist WHERE group_id = ? AND user_id = ?").run(req.params.id, config.defaultUserId);
    db.prepare("DELETE FROM watchlist_groups WHERE id = ? AND user_id = ?").run(
      req.params.id,
      config.defaultUserId
    );
  })();

  res.json({ ok: true });
});

watchlistRouter.get("/", (req, res) => {
  const groupId = Number(req.query.group_id);
  if (!groupId) {
    res.status(400).json({ error: "group_id query param is required" });
    return;
  }
  const rows = db
    .prepare(
      `SELECT w.id, w.tradingsymbol, w.exchange, w.instrument_token, w.sort_order,
              i.name, i.instrument_type, i.lot_size, i.expiry, i.strike
       FROM watchlist w
       LEFT JOIN instruments i ON i.instrument_token = w.instrument_token
       WHERE w.user_id = ? AND w.group_id = ?
       ORDER BY w.sort_order, w.id`
    )
    .all(config.defaultUserId, groupId);
  res.json(rows);
});

watchlistRouter.post("/", (req, res) => {
  const { instrument_token, group_id } = req.body as { instrument_token?: number; group_id?: number };
  if (!instrument_token || !group_id) {
    res.status(400).json({ error: "instrument_token and group_id are required" });
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
    db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM watchlist WHERE user_id = ? AND group_id = ?")
      .get(config.defaultUserId, group_id) as { next: number }
  ).next;

  db.prepare(
    `INSERT OR IGNORE INTO watchlist (user_id, group_id, tradingsymbol, exchange, instrument_token, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(config.defaultUserId, group_id, instrument.tradingsymbol, instrument.exchange, instrument_token, nextSortOrder);

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
