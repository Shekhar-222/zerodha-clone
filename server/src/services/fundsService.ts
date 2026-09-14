import { db } from "../db/db";
import { config } from "../config";
import { getTotalMarginBlocked, getTotalFnoUnrealizedPnl } from "./portfolioService";

export function getFunds(userId: number = config.defaultUserId) {
  const row = db
    .prepare("SELECT user_id, available_balance, updated_at FROM funds WHERE user_id = ?")
    .get(userId) as { user_id: number; available_balance: number; updated_at: string } | undefined;

  if (!row) return undefined;

  // used_margin is derived from positions.margin_blocked rather than stored, so it can
  // never drift out of sync with what's actually locked up in open F&O positions.
  //
  // available_balance is adjusted for running F&O P&L (mark-to-market) rather than just
  // the settled cash ledger — real brokers do this continuously, so a losing position eats
  // into your usable margin (and blocks new orders) well before you actually close it.
  const cashBalance = row.available_balance;
  const unrealizedFnoPnl = getTotalFnoUnrealizedPnl(userId);

  return {
    ...row,
    cash_balance: cashBalance,
    available_balance: cashBalance + unrealizedFnoPnl,
    used_margin: getTotalMarginBlocked(userId),
  };
}

export function adjustBalance(delta: number, userId: number = config.defaultUserId) {
  db.prepare(
    `UPDATE funds SET available_balance = available_balance + ?, updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(delta, userId);
}

export function recordTransaction(params: {
  userId?: number;
  orderId?: number | null;
  type: string;
  amount: number;
  description: string;
}) {
  const userId = params.userId ?? config.defaultUserId;
  const row = db.prepare("SELECT available_balance FROM funds WHERE user_id = ?").get(userId) as {
    available_balance: number;
  };
  db.prepare(
    `INSERT INTO fund_transactions (user_id, order_id, type, amount, balance_after, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, params.orderId ?? null, params.type, params.amount, row.available_balance, params.description);
}

export function getTransactions(userId: number = config.defaultUserId, limit = 200) {
  return db
    .prepare(
      "SELECT * FROM fund_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(userId, limit);
}

/**
 * Full paper-account reset: wipes every order, trade, position, holding, and the permanent
 * trade history, and puts cash back to the configured starting capital. Child tables (trades,
 * fund_transactions) are cleared before orders to satisfy the foreign key.
 */
export function resetAccount(userId: number = config.defaultUserId) {
  db.transaction(() => {
    db.prepare("DELETE FROM fund_transactions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM trades WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM trade_history WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM orders WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM positions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM holdings WHERE user_id = ?").run(userId);
    db.prepare(
      "UPDATE funds SET available_balance = ?, updated_at = datetime('now') WHERE user_id = ?"
    ).run(config.virtualCapital, userId);
  })();

  recordTransaction({
    userId,
    type: "DEPOSIT",
    amount: config.virtualCapital,
    description: "Starting virtual capital",
  });
}
