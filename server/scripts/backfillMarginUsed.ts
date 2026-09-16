// One-off backfill: fills in trade_history.margin_used for F&O trades placed before that
// column existed. Kite has no historical margin-rate lookup, so this recomputes margin using
// TODAY's rates against each trade's real historical quantity/price — an approximation, not
// the exact figure that applied on that day. Every trade placed after this script's
// corresponding code change already gets the exact real number captured at fill time.
//
// Run once with: npx tsx scripts/backfillMarginUsed.ts
import { db } from "../src/db/db";
import { initDb } from "../src/db/db";
import { loadStoredSession } from "../src/kite/kiteClient";
import { calculateOrderCosts } from "../src/services/marginService";

const FNO_TYPES = new Set(["FUT", "CE", "PE"]);

async function main() {
  initDb();
  if (!loadStoredSession()) {
    console.error("No stored Kite session found — log in via the app first, then re-run this script.");
    process.exit(1);
  }

  // Re-running is safe/idempotent: this recomputes every F&O row from scratch (not just NULL
  // ones), since the margin_used definition changed after the first backfill pass.
  const rows = db
    .prepare(
      `SELECT th.id, th.instrument_token, th.product, th.transaction_type, th.quantity, th.price,
              th.exchange, th.tradingsymbol, th.executed_at, i.instrument_type, i.name
       FROM trade_history th
       LEFT JOIN instruments i ON i.instrument_token = th.instrument_token
       ORDER BY th.instrument_token, th.product, th.executed_at ASC, th.id ASC`
    )
    .all() as {
    id: number;
    instrument_token: number;
    product: "MIS" | "NRML" | "CNC";
    transaction_type: "BUY" | "SELL";
    quantity: number;
    price: number;
    exchange: string;
    tradingsymbol: string;
    executed_at: string;
    instrument_type: string | null;
    name: string | null;
  }[];

  const fnoRows = rows.filter((r) => FNO_TYPES.has(r.instrument_type ?? ""));
  console.log(`Found ${fnoRows.length} F&O trade_history rows to (re)compute margin_used for.`);

  // Replay each instrument+product's running quantity chronologically so every row sees the
  // margin before and after it, same as at fill time.
  const runningQty = new Map<string, number>();
  const marginCache = new Map<string, number>(); // key: instrumentToken::product::qtyAbs::side -> margin

  async function marginFor(row: (typeof fnoRows)[number], qtyAbs: number, side: "BUY" | "SELL"): Promise<number> {
    if (qtyAbs === 0) return 0;
    const cacheKey = `${row.instrument_token}::${row.product}::${qtyAbs}::${side}`;
    const cached = marginCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const margin = (
      await calculateOrderCosts({
        exchange: row.exchange,
        tradingsymbol: row.tradingsymbol,
        transactionType: side,
        product: row.product as "MIS" | "NRML",
        orderType: "MARKET",
        quantity: qtyAbs,
        price: row.price,
      })
    ).margin;
    marginCache.set(cacheKey, margin);
    await new Promise((r) => setTimeout(r, 350)); // be polite to Kite's margin API rate limit
    return margin;
  }

  for (const row of fnoRows) {
    const key = `${row.instrument_token}::${row.product}`;
    const beforeQty = runningQty.get(key) ?? 0;
    const signedTradeQty = row.transaction_type === "BUY" ? row.quantity : -row.quantity;
    const afterQty = beforeQty + signedTradeQty;
    runningQty.set(key, afterQty);

    let beforeMargin = 0;
    let afterMargin = 0;
    try {
      beforeMargin = await marginFor(row, Math.abs(beforeQty), beforeQty > 0 ? "BUY" : "SELL");
      afterMargin = await marginFor(row, Math.abs(afterQty), afterQty > 0 ? "BUY" : "SELL");
    } catch (err) {
      console.warn(`  [skip] id=${row.id} ${row.tradingsymbol} margin lookup failed:`, (err as Error).message);
      continue;
    }

    const marginUsed = Math.max(beforeMargin, afterMargin);
    db.prepare("UPDATE trade_history SET margin_used = ? WHERE id = ?").run(marginUsed, row.id);
    console.log(
      `  id=${row.id} ${row.executed_at} ${row.tradingsymbol} ${row.transaction_type} ${row.quantity} -> margin_used=₹${marginUsed.toFixed(2)} (qty ${beforeQty} -> ${afterQty})`
    );
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
