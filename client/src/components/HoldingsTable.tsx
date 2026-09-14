import { Holding } from "../api";
import { EmptyState } from "./EmptyState";

export function HoldingsTable({
  holdings,
  ltpByToken,
  onGetStarted,
}: {
  holdings: Holding[];
  ltpByToken: Record<number, number>;
  onGetStarted: () => void;
}) {
  if (holdings.length === 0) {
    return <EmptyState message="You don't have any holdings yet" ctaLabel="Get started" onCta={onGetStarted} />;
  }

  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[480px] text-[15px]">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
          <th className="py-2 font-normal">Symbol</th>
          <th className="py-2 font-normal text-right">Qty</th>
          <th className="py-2 font-normal text-right">Avg</th>
          <th className="py-2 font-normal text-right">LTP</th>
          <th className="py-2 font-normal text-right">P&L</th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((h) => {
          const ltp = ltpByToken[h.instrument_token] ?? h.ltp;
          const pnl = (ltp - h.avg_price) * h.quantity;
          return (
            <tr key={h.id} className="border-b border-gray-100">
              <td className="py-2.5">{h.tradingsymbol}</td>
              <td className="py-2.5 text-right tabular-nums">{h.quantity}</td>
              <td className="py-2.5 text-right tabular-nums">{h.avg_price.toFixed(2)}</td>
              <td className="py-2.5 text-right tabular-nums">{ltp.toFixed(2)}</td>
              <td className={`py-2.5 text-right tabular-nums ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
                {pnl.toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
