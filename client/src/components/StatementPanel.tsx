import { useEffect, useMemo, useState } from "react";
import { api, PnlSummaryItem } from "../api";
import { ContractLabel } from "./ContractLabel";

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// NFO F&O quantity is real units (e.g. 500 shares = 1 lot of RELIANCE) — divide by lot_size
// to show lots. MCX quantity already IS a lot count — showing it as-is, labelled "lot(s)",
// is correct; dividing it again would be wrong.
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

// Same basis as the Positions/Funds tabs' P&L% — net P&L against the margin that trade
// actually tied up. Equity has no margin concept, so there's nothing to divide by.
function pnlPct(item: PnlSummaryItem): number | null {
  if (item.margin_used == null || item.margin_used === 0) return null;
  return (item.net_pnl / item.margin_used) * 100;
}

const PAGE_SIZE = 20;

// executed_at is a UTC "YYYY-MM-DD HH:MM:SS" string — the same "+ Z" parsing trick used
// elsewhere, rendered back out in IST so a trade just before/after midnight lands on the
// calendar day it actually happened in for an Indian user.
function toISTDateString(utcDatetime: string): string {
  return new Date(`${utcDatetime}Z`).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function monthsBetween(startIso: string, endIso: string): { year: number; month: number }[] {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const months: { year: number; month: number }[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return months;
}

function formatMoney(n: number): string {
  return `${n >= 0 ? "+" : "-"}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const CALENDAR_GREEN = "#31C431";
const CALENDAR_RED = "#FD0000";

function mixWithWhite(hex: string, whiteAmount: number): string {
  const t = Math.max(0, Math.min(1, whiteAmount));
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function cellColor(pnl: number, maxProfit: number, maxLossAbs: number): string {
  if (pnl > 0) {
    const intensity = maxProfit > 0 ? Math.max(0.2, pnl / maxProfit) : 1;
    return mixWithWhite(CALENDAR_GREEN, 1 - intensity);
  }
  const intensity = maxLossAbs > 0 ? Math.max(0.2, Math.abs(pnl) / maxLossAbs) : 1;
  return mixWithWhite(CALENDAR_RED, 1 - intensity);
}

function MonthGrid({
  year,
  month,
  dailyPnl,
  maxProfit,
  maxLossAbs,
}: {
  year: number;
  month: number;
  dailyPnl: Record<string, number>;
  maxProfit: number;
  maxLossAbs: number;
}) {
  const numDays = daysInMonth(year, month);
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells: { day: number | null; pnl: number | null }[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, pnl: null });
  for (let d = 1; d <= numDays; d++) {
    const key = `${year}-${pad(month + 1)}-${pad(d)}`;
    cells.push({ day: d, pnl: dailyPnl[key] ?? null });
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((c, i) => (
          <div
            key={i}
            title={
              c.day !== null
                ? `${year}-${pad(month + 1)}-${pad(c.day)}${
                    c.pnl != null ? `: ${c.pnl >= 0 ? "+" : ""}₹${c.pnl.toFixed(2)}` : ""
                  }`
                : undefined
            }
            className={`h-3.5 w-3.5 rounded-sm ${
              c.day === null ? "" : c.pnl === null ? "bg-gray-100" : c.pnl === 0 ? "bg-gray-300" : ""
            }`}
            style={c.day !== null && c.pnl ? { backgroundColor: cellColor(c.pnl, maxProfit, maxLossAbs) } : undefined}
          />
        ))}
      </div>
      <div className="text-[11px] font-medium text-gray-500">{monthLabel(year, month)}</div>
    </div>
  );
}

export function StatementPanel() {
  const [items, setItems] = useState<PnlSummaryItem[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api
      .getPnlSummary()
      .then((all) => {
        const closed = all.filter((i) => i.status === "closed" && i.executed_at);
        setItems(closed);
        if (closed.length > 0) {
          const dates = closed.map((i) => toISTDateString(i.executed_at!));
          setFrom(dates.reduce((a, b) => (a < b ? a : b)));
          setTo(dates.reduce((a, b) => (a > b ? a : b)));
        }
      })
      .catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    if (!items || !from || !to) return [];
    return items.filter((i) => {
      const day = toISTDateString(i.executed_at!);
      return day >= from && day <= to;
    });
  }, [items, from, to]);

  // Reset to page 1 whenever the date range changes the underlying set of rows.
  useEffect(() => {
    setPage(1);
  }, [from, to]);

  if (items === null) {
    return <div className="py-4 text-center text-sm text-gray-400">Loading…</div>;
  }

  if (items.length === 0) {
    return <div className="py-4 text-center text-sm text-gray-400">No booked trades yet.</div>;
  }

  const totalProfit = filtered.filter((i) => i.net_pnl > 0).reduce((sum, i) => sum + i.net_pnl, 0);
  const totalLoss = filtered.filter((i) => i.net_pnl < 0).reduce((sum, i) => sum + i.net_pnl, 0);
  const netPnl = totalProfit + totalLoss;

  const dailyPnl: Record<string, number> = {};
  for (const i of filtered) {
    const day = toISTDateString(i.executed_at!);
    dailyPnl[day] = (dailyPnl[day] ?? 0) + i.net_pnl;
  }
  const pnlValues = Object.values(dailyPnl);
  const maxProfit = Math.max(0, ...pnlValues.filter((v) => v > 0));
  const maxLossAbs = Math.max(0, ...pnlValues.filter((v) => v < 0).map((v) => Math.abs(v)));
  const months = from && to ? monthsBetween(from, to) : [];

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 border-b border-gray-100 pb-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">From</label>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-700"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">To</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-700"
          />
        </div>
        <span className="pb-1.5 text-xs text-gray-400">{filtered.length} booked trade{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {months.length > 0 && (
        <div className="mb-4 flex gap-6 overflow-x-auto pb-2">
          {months.map(({ year, month }) => (
            <MonthGrid
              key={`${year}-${month}`}
              year={year}
              month={month}
              dailyPnl={dailyPnl}
              maxProfit={maxProfit}
              maxLossAbs={maxLossAbs}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 border-b border-gray-100 pb-4 sm:grid-cols-3">
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

      {filtered.length === 0 ? (
        <div className="py-4 text-center text-sm text-gray-400">No booked trades in this date range.</div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between pb-1 text-xs text-gray-400">
            <span>Symbol</span>
            <div className="flex gap-6">
              <span className="w-20 whitespace-nowrap text-right">P&amp;L</span>
              <span className="w-24 whitespace-nowrap text-right">Incl. charges</span>
              <span className="w-20 whitespace-nowrap text-right">P&amp;L %</span>
              <span className="w-24 whitespace-nowrap text-right">Margin used</span>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {pageItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-[15px]">
                <div>
                  <ContractLabel item={item} className="text-gray-800" />
                  <span className="ml-2 text-xs text-gray-400">
                    {formatQty(item)} · {item.product}
                    {item.executed_at &&
                      ` · ${new Date(`${item.executed_at}Z`).toLocaleString("en-IN", {
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
                  {(() => {
                    const pctVal = pnlPct(item);
                    return (
                      <span
                        className={`w-20 text-right tabular-nums ${
                          pctVal === null ? "text-gray-400" : pctVal >= 0 ? "text-gain" : "text-loss"
                        }`}
                      >
                        {pctVal === null ? "—" : `${pctVal >= 0 ? "+" : ""}${pctVal.toFixed(2)}%`}
                      </span>
                    );
                  })()}
                  <span className="w-24 text-right tabular-nums text-gray-500">
                    {item.margin_used != null
                      ? `₹${item.margin_used.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 text-sm">
              <span className="text-xs text-gray-400">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs text-gray-500">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
