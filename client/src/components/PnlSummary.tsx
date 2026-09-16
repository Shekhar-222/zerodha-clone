import { useEffect, useState } from "react";
import { api, PnlSummaryItem } from "../api";
import { ContractLabel } from "./ContractLabel";

// NFO F&O quantity is real units (e.g. 500 shares = 1 lot of RELIANCE) — divide by lot_size
// to show lots. MCX quantity already IS a lot count (Kite's order/margin API treats it that
// way, even though its own lot_size field unhelpfully reports 1 there) — showing it as-is,
// just labelled "lot(s)", is correct; dividing it again would be wrong.
function formatQty(item: PnlSummaryItem): string {
  if (item.exchange === "MCX") {
    return `${item.quantity} lot${item.quantity === 1 ? "" : "s"}`;
  }
  if (item.lot_size && item.lot_size > 1) {
    const lots = item.quantity / item.lot_size;
    return `${lots} lot${lots === 1 ? "" : "s"}`;
  }
  return `${item.quantity}`;
}

function formatMoney(n: number): string {
  return `${n >= 0 ? "+" : "-"}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Closed trades only — a still-open position hasn't actually booked anything yet, so it
 * shouldn't count toward "booked" profit/loss. Uses net_pnl (after real trading charges),
 * the same figure the "Incl. charges" column already shows per row. */
function BookedSummary({ items }: { items: PnlSummaryItem[] }) {
  const closed = items.filter((i) => i.status === "closed");
  const totalProfit = closed.filter((i) => i.net_pnl > 0).reduce((sum, i) => sum + i.net_pnl, 0);
  const totalLoss = closed.filter((i) => i.net_pnl < 0).reduce((sum, i) => sum + i.net_pnl, 0);
  const netPnl = totalProfit + totalLoss;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 border-b border-gray-100 pb-4 sm:grid-cols-3">
      <div className="rounded border border-gray-100 p-4 text-center">
        <div className="text-2xl font-semibold text-gain">{formatMoney(totalProfit)}</div>
        <div className="text-xs text-gray-500">Total profit booked</div>
      </div>
      <div className="rounded border border-gray-100 p-4 text-center">
        <div className="text-2xl font-semibold text-loss">{formatMoney(totalLoss)}</div>
        <div className="text-xs text-gray-500">Total loss booked</div>
      </div>
      <div className="rounded border border-gray-100 p-4 text-center">
        <div className={`text-2xl font-semibold ${netPnl >= 0 ? "text-gain" : "text-loss"}`}>
          {formatMoney(netPnl)}
        </div>
        <div className="text-xs text-gray-500">Net P&amp;L</div>
      </div>
    </div>
  );
}

export function PnlSummary() {
  const [items, setItems] = useState<PnlSummaryItem[] | null>(null);

  useEffect(() => {
    api.getPnlSummary().then(setItems).catch(console.error);
  }, []);

  if (items === null) {
    return <div className="py-4 text-center text-sm text-gray-400">Loading…</div>;
  }

  if (items.length === 0) {
    return <div className="py-4 text-center text-sm text-gray-400">No profit or loss yet.</div>;
  }

  return (
    <div>
      <BookedSummary items={items} />

      <div className="flex items-center justify-between pb-1 text-xs text-gray-400">
        <span>Symbol</span>
        <div className="flex gap-6">
          <span className="w-20 whitespace-nowrap text-right">P&amp;L</span>
          <span className="w-24 whitespace-nowrap text-right">Incl. charges</span>
          <span className="w-24 whitespace-nowrap text-right">Margin used</span>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-2 text-[15px]">
            <div>
              <ContractLabel item={item} className="text-gray-800" />
              <span className="ml-2 text-xs text-gray-400">
                {item.status === "open" ? `${formatQty(item)} open` : `${formatQty(item)} · ${item.product}`}
                {item.executed_at &&
                  ` · ${new Date(item.executed_at + "Z").toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
              </span>
            </div>
            <div className="flex gap-6">
              <span className={`w-20 text-right font-medium tabular-nums ${item.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                {item.pnl >= 0 ? "+" : ""}
                {item.pnl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              <span className={`w-24 text-right tabular-nums ${item.net_pnl >= 0 ? "text-gain" : "text-loss"}`}>
                {item.net_pnl >= 0 ? "+" : ""}
                {item.net_pnl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              <span className="w-24 text-right tabular-nums text-gray-500">
                {item.margin_used != null
                  ? `₹${item.margin_used.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                  : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
