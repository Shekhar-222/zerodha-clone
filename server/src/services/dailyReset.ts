import { db } from "../db/db";

/**
 * Real Kite's Orders page only ever shows the current trading day's orders — yesterday's
 * are gone from view once a new day starts (available separately as historical reports,
 * which this app doesn't need). We mirror that by wiping the orders/trades tables at
 * midnight rather than filtering by date, since this is a practice account with no need to
 * keep a long history. Positions/holdings/funds are untouched — their running totals
 * (avg price, realized P&L, margin) already live in their own tables, not derived from
 * order history on read.
 */
export function clearDailyOrders() {
  const result = db.transaction(() => {
    const orderCount = (db.prepare("SELECT COUNT(*) as c FROM orders").get() as { c: number }).c;
    db.prepare("UPDATE fund_transactions SET order_id = NULL WHERE order_id IS NOT NULL").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM orders").run();
    return orderCount;
  })();

  console.log(`[daily-reset] Cleared ${result} order(s) and their trades for the new trading day`);
}

function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function scheduleDailyOrderReset() {
  function scheduleNext() {
    const delay = msUntilNextMidnight();
    setTimeout(() => {
      clearDailyOrders();
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}
