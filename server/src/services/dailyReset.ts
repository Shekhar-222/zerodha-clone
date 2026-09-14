import { db } from "../db/db";

/**
 * Real Kite's Orders page only ever shows the current trading day's settled orders —
 * yesterday's are gone from view once a new day starts (available separately as historical
 * reports, which this app doesn't need). We mirror that by wiping COMPLETE/CANCELLED/
 * REJECTED orders at midnight rather than filtering by date, since this is a practice
 * account with no need to keep a long history.
 *
 * Still-OPEN orders are deliberately left alone: a pending limit order, or a stoploss/target
 * leg still protecting a carried-forward position, hasn't finished being acted on — deleting
 * it here wouldn't be "starting a fresh day", it would silently strip the protection off an
 * open position with no record it ever happened. Positions/holdings/funds are untouched
 * either way — their running totals (avg price, realized P&L, margin) already live in their
 * own tables, not derived from order history on read.
 */
// An order is kept if it's still OPEN itself, or if it's the (now-settled) entry order a
// still-open bracket leg points back to via bracket_parent_id — deleting that parent while a
// live child still references it would violate that self-referencing foreign key.
const KEEP_CLAUSE = `(
  status = 'OPEN'
  OR id IN (SELECT bracket_parent_id FROM orders WHERE status = 'OPEN' AND bracket_parent_id IS NOT NULL)
)`;

export function clearDailyOrders() {
  const result = db.transaction(() => {
    const orderCount = (
      db.prepare(`SELECT COUNT(*) as c FROM orders WHERE NOT ${KEEP_CLAUSE}`).get() as { c: number }
    ).c;
    db.prepare(
      `UPDATE fund_transactions SET order_id = NULL
       WHERE order_id IN (SELECT id FROM orders WHERE NOT ${KEEP_CLAUSE})`
    ).run();
    db.prepare(`DELETE FROM trades WHERE order_id IN (SELECT id FROM orders WHERE NOT ${KEEP_CLAUSE})`).run();
    db.prepare(`DELETE FROM orders WHERE NOT ${KEEP_CLAUSE}`).run();
    return orderCount;
  })();

  console.log(
    `[daily-reset] Cleared ${result} settled order(s) and their trades for the new trading day — still-open orders (and their bracket parents) are kept`
  );
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
