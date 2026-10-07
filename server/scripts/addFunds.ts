// Deposits virtual cash into the account and records it in the funds ledger as a DEPOSIT,
// without touching positions, holdings, or orders. Safe to run while the server is up (SQLite
// WAL mode) — the running server picks up the new balance on its next funds read.
//
// Run with: npx tsx scripts/addFunds.ts 100000
import { db } from "../src/db/db";
import { config } from "../src/config";

const amount = Number(process.argv[2]);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error("Usage: npx tsx scripts/addFunds.ts <amount>   e.g. 100000");
  process.exit(1);
}

const userId = config.defaultUserId;

db.transaction(() => {
  db.prepare(
    "UPDATE funds SET available_balance = available_balance + ?, updated_at = datetime('now') WHERE user_id = ?"
  ).run(amount, userId);
  const row = db.prepare("SELECT available_balance FROM funds WHERE user_id = ?").get(userId) as {
    available_balance: number;
  };
  db.prepare(
    `INSERT INTO fund_transactions (user_id, order_id, type, amount, balance_after, description)
     VALUES (?, NULL, 'DEPOSIT', ?, ?, ?)`
  ).run(userId, amount, row.available_balance, `Added funds ₹${amount.toFixed(2)}`);
  console.log(`Added ₹${amount.toFixed(2)}. Cash balance is now ₹${row.available_balance.toFixed(2)}.`);
})();
