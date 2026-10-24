import { useState } from "react";
import { api, Instrument, Position } from "../api";
import { EmptyState } from "./EmptyState";
import { OrderWindow } from "./OrderWindow";
import { formatContractLabel } from "../formatContract";
import { mcxUnitMultiplier } from "../mcxLotSizes";

const FNO_TYPES = new Set(["FUT", "CE", "PE"]);
const INSTANT_EXIT_KEY = "positions.instantExit";

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

/**
 * Instant exit: when on, a row's Exit button squares off that position at market straight
 * away, with no order popup to confirm. Remembered per browser so it survives a reload. The
 * state lives in App because the switch sits beside the page heading, outside this table.
 */
export function useInstantExit(): [boolean, (on: boolean) => void] {
  const [instantExit, setInstantExit] = useState(() => {
    try {
      return localStorage.getItem(INSTANT_EXIT_KEY) === "1";
    } catch {
      return false;
    }
  });

  function setPersisted(on: boolean) {
    setInstantExit(on);
    try {
      localStorage.setItem(INSTANT_EXIT_KEY, on ? "1" : "0");
    } catch {
      // Storage blocked (private mode etc.) — the switch still works for this session.
    }
  }

  return [instantExit, setPersisted];
}

export function InstantExitToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label
      className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-600"
      title="When on, a row's Exit button exits that position at market immediately, without the order popup"
    >
      <input type="checkbox" className="peer sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-loss">
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
      Instant exit
    </label>
  );
}

export function PositionsTable({
  positions,
  ltpByToken,
  instantExit,
  onGetStarted,
  onChanged,
}: {
  positions: Position[];
  ltpByToken: Record<number, number>;
  instantExit: boolean;
  onGetStarted: () => void;
  onChanged: () => void;
}) {
  const [exiting, setExiting] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [instantExitingIds, setInstantExitingIds] = useState<Set<number>>(new Set());
  const [exitError, setExitError] = useState<string | null>(null);

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

  async function instantExitPosition(p: Position) {
    if (instantExitingIds.has(p.id)) return; // ignore double clicks while the order is in flight
    setExitError(null);
    setInstantExitingIds((prev) => new Set(prev).add(p.id));
    try {
      await api.placeOrder({
        instrument_token: p.instrument_token,
        transaction_type: p.quantity > 0 ? "SELL" : "BUY",
        order_type: "MARKET",
        product: p.product,
        quantity: Math.abs(p.quantity),
      });
      onChanged();
    } catch (err: any) {
      setExitError(`Could not exit ${formatContractLabel(p)}: ${err.message ?? "order failed"}`);
    } finally {
      setInstantExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }

  const totalPnl = positions.reduce((sum, p) => {
    const ltp = ltpByToken[p.instrument_token] ?? p.ltp;
    return sum + (ltp - p.avg_price) * p.quantity * mcxUnitMultiplier(p.exchange, p.name);
  }, 0);
  const totalMargin = positions.reduce((sum, p) => sum + (p.margin_blocked || 0), 0);
  // Same base each row's own P&L% uses (margin for F&O, invested value for equity), summed
  // across every position — so the overall percentage is a true weighted average, not just
  // an average of averages.
  const totalMarginBase = positions.reduce((sum, p) => {
    const multiplier = mcxUnitMultiplier(p.exchange, p.name);
    const isFno = FNO_TYPES.has(p.instrument_type ?? "");
    return sum + (isFno ? p.margin_blocked : Math.abs(p.avg_price * p.quantity * multiplier));
  }, 0);
  const totalPnlPct = totalMarginBase > 0 ? (totalPnl / totalMarginBase) * 100 : null;

  return (
    <>
      {exitError && <div className="mb-2 text-xs text-loss">{exitError}</div>}
      <div className="max-h-[70vh] overflow-auto">
      <table className="w-full min-w-[640px] text-[15px]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-gray-200 text-center text-xs text-gray-500">
            <th className="w-8 py-2 font-normal">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === positions.length}
                onChange={toggleAll}
                className="accent-link"
              />
            </th>
            <th className="py-2 font-normal">Product</th>
            <th className="py-2 text-left font-normal">Instrument</th>
            <th className="py-2 font-normal">Qty.</th>
            <th className="py-2 font-normal">Avg</th>
            <th className="py-2 font-normal">LTP</th>
            <th className="py-2 font-normal">P&L</th>
            <th className="py-2 font-normal">Margin used</th>
            <th className="py-2 font-normal">P&L %</th>
            <th className="w-14 py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const ltp = ltpByToken[p.instrument_token] ?? p.ltp;
            const multiplier = mcxUnitMultiplier(p.exchange, p.name);
            const pnl = (ltp - p.avg_price) * p.quantity * multiplier;
            const exactQty = p.quantity * multiplier;
            const isFno = FNO_TYPES.has(p.instrument_type ?? "");
            const marginBase = isFno ? p.margin_blocked : Math.abs(p.avg_price * exactQty);
            const pnlPct = marginBase > 0 ? (pnl / marginBase) * 100 : null;
            return (
              <tr key={p.id} className="group border-b border-gray-100 text-center hover:bg-gray-50">
                <td className="py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="accent-link"
                  />
                </td>
                <td className="py-2.5">
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[12px] font-medium text-purple-600">
                    {p.product}
                  </span>
                </td>
                <td className="py-2.5 text-left">
                  <span className="font-medium text-gray-800">{formatContractLabel(p)}</span>{" "}
                  <span className="text-xs text-gray-400">{p.exchange}</span>
                </td>
                <td
                  className={`py-2.5 tabular-nums font-medium ${
                    p.quantity >= 0 ? "text-link" : "text-loss"
                  }`}
                >
                  {exactQty}
                  {p.exchange === "MCX" && (
                    <div className="text-[12px] font-normal text-gray-400">
                      {p.quantity} lot{Math.abs(p.quantity) === 1 ? "" : "s"}
                    </div>
                  )}
                </td>
                <td className="py-2.5 tabular-nums text-gray-600">{p.avg_price.toFixed(2)}</td>
                <td className="py-2.5 tabular-nums text-gray-800">{ltp.toFixed(2)}</td>
                <td className={`py-2.5 tabular-nums font-medium ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
                  {pnl.toFixed(2)}
                </td>
                <td className="py-2.5 tabular-nums text-gray-600">
                  {isFno ? `₹${p.margin_blocked.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                </td>
                <td
                  className={`py-2.5 tabular-nums font-medium ${
                    pnlPct === null ? "text-gray-400" : pnlPct >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {pnlPct === null ? "—" : `${pnlPct.toFixed(2)}%`}
                </td>
                <td
                  className={`py-2.5 transition-opacity group-hover:opacity-100 ${
                    instantExitingIds.has(p.id) ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {instantExit ? (
                    <button
                      onClick={() => instantExitPosition(p)}
                      disabled={instantExitingIds.has(p.id)}
                      title="Exit at market now — no confirmation"
                      className="rounded bg-loss px-2 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-60"
                    >
                      {instantExitingIds.has(p.id) ? "Exiting…" : "Exit"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setExiting(p)}
                      className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Exit
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* Pinned to the bottom of the scroll area so the total stays visible with many
            positions. A box-shadow stands in for the top border, which doesn't render on a
            sticky row in a collapsed-border table. */}
        <tfoot className="sticky bottom-0 z-10 bg-white shadow-[0_-1px_0_0_#e5e7eb]">
          <tr className="text-center">
            <td colSpan={6} className="py-2.5 text-right text-xs font-medium text-gray-500">
              Total
            </td>
            <td className={`py-2.5 tabular-nums font-medium ${totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
              {totalPnl.toFixed(2)}
            </td>
            <td className="py-2.5 tabular-nums font-medium text-gray-600">
              {totalMargin > 0 ? `₹${totalMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
            </td>
            <td
              className={`py-2.5 tabular-nums font-medium ${
                totalPnlPct === null ? "text-gray-400" : totalPnlPct >= 0 ? "text-gain" : "text-loss"
              }`}
            >
              {totalPnlPct === null ? "—" : `${totalPnlPct.toFixed(2)}%`}
            </td>
            <td></td>
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
