import { useEffect, useState } from "react";
import { api, Instrument, Position } from "../api";
import { EmptyState } from "./EmptyState";
import { OrderWindow } from "./OrderWindow";
import { formatContractLabel } from "../formatContract";
import { mcxUnitMultiplier } from "../mcxLotSizes";

function toInstrument(p: Position): Instrument {
  return {
    instrument_token: p.instrument_token,
    tradingsymbol: p.tradingsymbol,
    exchange: p.exchange,
    name: p.name || p.tradingsymbol,
    instrument_type: p.instrument_type ?? undefined,
    lot_size: p.lot_size ?? undefined,
    expiry: p.expiry,
    strike: p.strike,
  };
}

export function PositionsTable({
  positions,
  ltpByToken,
  onGetStarted,
  onChanged,
}: {
  positions: Position[];
  ltpByToken: Record<number, number>;
  onGetStarted: () => void;
  onChanged: () => void;
}) {
  const [exiting, setExiting] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [prevClose, setPrevClose] = useState<Record<number, number>>({});

  const tokenKey = positions.map((p) => p.instrument_token).join(",");

  useEffect(() => {
    if (positions.length === 0) return;
    api
      .getQuotes(positions.map((p) => p.instrument_token))
      .then((quotes) => {
        const next: Record<number, number> = {};
        for (const p of positions) {
          const q = quotes[p.instrument_token];
          if (q) next[p.instrument_token] = q.ohlc.close;
        }
        setPrevClose(next);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey]);

  if (positions.length === 0) {
    return (
      <EmptyState message="You don't have any positions yet" ctaLabel="Get started" onCta={onGetStarted} />
    );
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selected.size === positions.length ? new Set() : new Set(positions.map((p) => p.id)));
  }

  async function exitSelected() {
    const toExit = positions.filter((p) => selected.has(p.id));
    await Promise.all(
      toExit.map((p) =>
        api.placeOrder({
          instrument_token: p.instrument_token,
          transaction_type: p.quantity > 0 ? "SELL" : "BUY",
          order_type: "MARKET",
          product: p.product,
          quantity: Math.abs(p.quantity),
        })
      )
    );
    setSelected(new Set());
    onChanged();
  }

  const totalPnl = positions.reduce((sum, p) => {
    const ltp = ltpByToken[p.instrument_token] ?? p.ltp;
    return sum + (ltp - p.avg_price) * p.quantity * mcxUnitMultiplier(p.exchange, p.name);
  }, 0);

  return (
    <>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="w-8 py-2 font-normal">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === positions.length}
                onChange={toggleAll}
                className="accent-link"
              />
            </th>
            <th className="py-2 font-normal">Product</th>
            <th className="py-2 font-normal">Instrument</th>
            <th className="py-2 font-normal text-right">Qty.</th>
            <th className="py-2 font-normal text-right">Avg</th>
            <th className="py-2 font-normal text-right">LTP</th>
            <th className="py-2 font-normal text-right">P&L</th>
            <th className="py-2 font-normal text-right">Chg</th>
            <th className="w-14 py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const ltp = ltpByToken[p.instrument_token] ?? p.ltp;
            const pnl = (ltp - p.avg_price) * p.quantity * mcxUnitMultiplier(p.exchange, p.name);
            const close = prevClose[p.instrument_token];
            const chgPct = close ? ((ltp - close) / close) * 100 : null;
            return (
              <tr key={p.id} className="group border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="accent-link"
                  />
                </td>
                <td className="py-2.5">
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-600">
                    {p.product}
                  </span>
                </td>
                <td className="py-2.5">
                  <span className="font-medium text-gray-800">{formatContractLabel(p)}</span>{" "}
                  <span className="text-xs text-gray-400">{p.exchange}</span>
                </td>
                <td
                  className={`py-2.5 text-right tabular-nums font-medium ${
                    p.quantity >= 0 ? "text-link" : "text-loss"
                  }`}
                >
                  {p.quantity}
                </td>
                <td className="py-2.5 text-right tabular-nums text-gray-600">{p.avg_price.toFixed(2)}</td>
                <td className="py-2.5 text-right tabular-nums text-gray-800">{ltp.toFixed(2)}</td>
                <td className={`py-2.5 text-right tabular-nums font-medium ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
                  {pnl.toFixed(2)}
                </td>
                <td
                  className={`py-2.5 text-right tabular-nums ${
                    chgPct === null ? "text-gray-400" : chgPct >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {chgPct === null ? "—" : `${chgPct.toFixed(2)}%`}
                </td>
                <td className="py-2.5 text-right opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => setExiting(p)}
                    className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Exit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="py-2.5 text-right text-xs font-medium text-gray-500">
              Total
            </td>
            <td className={`py-2.5 text-right tabular-nums font-medium ${totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
              {totalPnl.toFixed(2)}
            </td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
      </div>

      {selected.size > 0 && (
        <div className="mt-3">
          <button
            onClick={exitSelected}
            className="rounded bg-link px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Exit {selected.size} position{selected.size > 1 ? "s" : ""}
          </button>
        </div>
      )}

      {exiting && (
        <OrderWindow
          title="Exit position"
          instrument={toInstrument(exiting)}
          transactionType={exiting.quantity > 0 ? "SELL" : "BUY"}
          ltp={ltpByToken[exiting.instrument_token] ?? exiting.ltp}
          initialQuantity={Math.abs(exiting.quantity)}
          initialProduct={exiting.product}
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
