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
      <div className="flex items-center justify-between pb-1 text-xs text-gray-400">
        <span>Symbol</span>
        <div className="flex gap-6">
          <span className="w-20 whitespace-nowrap text-right">P&amp;L</span>
          <span className="w-24 whitespace-nowrap text-right">Incl. charges</span>
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
