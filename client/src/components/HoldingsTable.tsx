import { useEffect, useState } from "react";
import { api, Holding, Instrument } from "../api";
import { EmptyState } from "./EmptyState";
import { OrderWindow } from "./OrderWindow";

function toInstrument(h: Holding): Instrument {
  return {
    instrument_token: h.instrument_token,
    tradingsymbol: h.tradingsymbol,
    exchange: h.exchange,
    name: h.tradingsymbol,
    instrument_type: h.instrument_type ?? undefined,
    lot_size: h.lot_size ?? undefined,
  };
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function HoldingsTable({
  holdings,
  ltpByToken,
  onGetStarted,
  onChanged,
}: {
  holdings: Holding[];
  ltpByToken: Record<number, number>;
  onGetStarted: () => void;
  onChanged: () => void;
}) {
  const [exiting, setExiting] = useState<Holding | null>(null);
  // Previous day's close per instrument — needed for "Day chg.", separate from the live
  // ltpByToken feed (which only carries the latest traded price, not a full quote).
  const [prevClose, setPrevClose] = useState<Record<number, number>>({});

  useEffect(() => {
    if (holdings.length === 0) return;
    api
      .getQuotes(holdings.map((h) => h.instrument_token))
      .then((quotes) => {
        const next: Record<number, number> = {};
        for (const h of holdings) {
          const q = quotes[h.instrument_token];
          if (q) next[h.instrument_token] = q.ohlc.close;
        }
        setPrevClose(next);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.map((h) => h.instrument_token).join(",")]);

  if (holdings.length === 0) {
    return <EmptyState message="You don't have any holdings yet" ctaLabel="Get started" onCta={onGetStarted} />;
  }

  const rows = holdings.map((h) => {
    const ltp = ltpByToken[h.instrument_token] ?? h.ltp;
    const close = prevClose[h.instrument_token];
    const invested = h.avg_price * h.quantity;
    const curVal = ltp * h.quantity;
    const pnl = curVal - invested;
    const netChgPct = invested !== 0 ? (pnl / invested) * 100 : null;
    const dayChgPct = close ? ((ltp - close) / close) * 100 : null;
    const dayPnl = close !== undefined ? (ltp - close) * h.quantity : null;
    return { h, ltp, invested, curVal, pnl, netChgPct, dayChgPct, dayPnl, prevValue: close !== undefined ? close * h.quantity : null };
  });

  const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
  const totalCurVal = rows.reduce((s, r) => s + r.curVal, 0);
  const totalPnl = totalCurVal - totalInvested;
  const totalNetChgPct = totalInvested !== 0 ? (totalPnl / totalInvested) * 100 : null;
  const rowsWithDayData = rows.filter((r) => r.dayPnl !== null && r.prevValue !== null);
  const totalDayPnl = rowsWithDayData.reduce((s, r) => s + (r.dayPnl ?? 0), 0);
  const totalPrevValue = rowsWithDayData.reduce((s, r) => s + (r.prevValue ?? 0), 0);
  const totalDayChgPct = totalPrevValue !== 0 ? (totalDayPnl / totalPrevValue) * 100 : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3 border-b border-gray-100 pb-4 text-sm">
        <div>
          <div className="text-lg font-semibold text-gray-800">₹{inr(totalInvested)}</div>
          <div className="text-xs text-gray-500">Total investment</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-gray-800">₹{inr(totalCurVal)}</div>
          <div className="text-xs text-gray-500">Current value</div>
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold ${totalDayPnl >= 0 ? "text-gain" : "text-loss"}`}>
              {totalDayPnl >= 0 ? "+" : "-"}₹{inr(Math.abs(totalDayPnl))}
            </span>
            {totalDayChgPct !== null && (
              <span
                className={`rounded px-1 text-xs font-medium ${
                  totalDayChgPct >= 0 ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
                }`}
              >
                {pct(totalDayChgPct)}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">Day&apos;s P&amp;L</div>
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold ${totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
              {totalPnl >= 0 ? "+" : "-"}₹{inr(Math.abs(totalPnl))}
            </span>
            {totalNetChgPct !== null && (
              <span
                className={`rounded px-1 text-xs font-medium ${
                  totalNetChgPct >= 0 ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
                }`}
              >
                {pct(totalNetChgPct)}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">Total P&amp;L</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[15px]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-2 font-normal">Instrument</th>
              <th className="py-2 font-normal text-right">Qty.</th>
              <th className="py-2 font-normal text-right">Avg. cost</th>
              <th className="py-2 font-normal text-right">LTP</th>
              <th className="py-2 font-normal text-right">Invested</th>
              <th className="py-2 font-normal text-right">Cur. val</th>
              <th className="py-2 font-normal text-right">P&amp;L</th>
              <th className="py-2 font-normal text-right">Net chg.</th>
              <th className="py-2 font-normal text-right">Day chg.</th>
              <th className="w-14 py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ h, ltp, invested, curVal, pnl, netChgPct, dayChgPct }) => (
              <tr key={h.id} className="group border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5">{h.tradingsymbol}</td>
                <td className="py-2.5 text-right tabular-nums">{h.quantity}</td>
                <td className="py-2.5 text-right tabular-nums text-gray-600">{h.avg_price.toFixed(2)}</td>
                <td className="py-2.5 text-right tabular-nums text-gray-800">{ltp.toFixed(2)}</td>
                <td className="py-2.5 text-right tabular-nums text-gray-600">{inr(invested)}</td>
                <td className="py-2.5 text-right tabular-nums text-gray-800">{inr(curVal)}</td>
                <td className={`py-2.5 text-right tabular-nums font-medium ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
                  {inr(pnl)}
                </td>
                <td
                  className={`py-2.5 text-right tabular-nums ${
                    netChgPct === null ? "text-gray-400" : netChgPct >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {netChgPct === null ? "—" : pct(netChgPct)}
                </td>
                <td
                  className={`py-2.5 text-right tabular-nums ${
                    dayChgPct === null ? "text-gray-400" : dayChgPct >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {dayChgPct === null ? "—" : pct(dayChgPct)}
                </td>
                <td className="py-2.5 text-right opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => setExiting(h)}
                    className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Exit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2.5 text-right text-xs font-medium text-gray-500">
                Total
              </td>
              <td className="py-2.5 text-right tabular-nums font-medium text-gray-600">{inr(totalInvested)}</td>
              <td className="py-2.5 text-right tabular-nums font-medium text-gray-800">{inr(totalCurVal)}</td>
              <td className={`py-2.5 text-right tabular-nums font-medium ${totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
                {inr(totalPnl)}
              </td>
              <td
                className={`py-2.5 text-right tabular-nums font-medium ${
                  totalNetChgPct === null ? "text-gray-400" : totalNetChgPct >= 0 ? "text-gain" : "text-loss"
                }`}
              >
                {totalNetChgPct === null ? "—" : pct(totalNetChgPct)}
              </td>
              <td
                className={`py-2.5 text-right tabular-nums font-medium ${
                  totalDayChgPct === null ? "text-gray-400" : totalDayChgPct >= 0 ? "text-gain" : "text-loss"
                }`}
              >
                {totalDayChgPct === null ? "—" : pct(totalDayChgPct)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {exiting && (
        <OrderWindow
          title="Exit holding"
          instrument={toInstrument(exiting)}
          transactionType="SELL"
          ltp={ltpByToken[exiting.instrument_token] ?? exiting.ltp}
          initialQuantity={exiting.quantity}
          initialProduct="CNC"
          lockSide
          lockProduct
          lockExchange
          onClose={() => setExiting(null)}
          onPlaced={onChanged}
        />
      )}
    </>
  );
}
