import { useEffect, useState } from "react";
import { api, TradeHistoryItem } from "../api";
import { EmptyState } from "./EmptyState";
import { formatContractLabel } from "../formatContract";

export function TradeHistoryTable() {
  const [trades, setTrades] = useState<TradeHistoryItem[] | null>(null);

  useEffect(() => {
    api.getTradeHistory().then(setTrades).catch(console.error);
  }, []);

  if (trades === null) {
    return <div className="py-8 text-center text-sm text-gray-400">Loading…</div>;
  }

  if (trades.length === 0) {
    return <EmptyState message="No trades yet — your fills will show up here permanently, even after the daily order reset." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="py-2 font-normal">Date &amp; Time</th>
            <th className="py-2 font-normal">Type</th>
            <th className="py-2 font-normal">Instrument</th>
            <th className="py-2 font-normal">Product</th>
            <th className="py-2 font-normal text-right">Qty</th>
            <th className="py-2 font-normal text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-b border-gray-100">
              <td className="py-2.5 text-xs text-gray-400">
                {new Date(t.executed_at + "Z").toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </td>
              <td className="py-2.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    t.transaction_type === "BUY" ? "bg-link/10 text-link" : "bg-loss/10 text-loss"
                  }`}
                >
                  {t.transaction_type}
                </span>
              </td>
              <td className="py-2.5">
                <span className="font-medium text-gray-800">{formatContractLabel(t)}</span>{" "}
                <span className="text-xs text-gray-400">{t.exchange}</span>
              </td>
              <td className="py-2.5 text-gray-500">{t.product}</td>
              <td className="py-2.5 text-right tabular-nums">{t.quantity}</td>
              <td className="py-2.5 text-right tabular-nums">{t.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
