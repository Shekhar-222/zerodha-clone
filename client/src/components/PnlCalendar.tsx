import { useEffect, useState } from "react";
import { api, PnlCalendarData } from "../api";

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
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

// Rough Zerodha-style "1.2k" compaction for the big totals — keeps the summary row readable
// once trade history spans a while.
function formatCompact(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  const abs = Math.abs(n);
  const body = abs >= 1000 ? `${(abs / 1000).toFixed(2)}k` : abs.toFixed(2);
  return `${sign}₹${body}`;
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

// Darker/more saturated the bigger that day's profit or loss was relative to the biggest
// profit/loss day in the whole calendar — a ₹50 win and a ₹50,000 win both show green, but
// the ₹50,000 one is unmistakably the darker square. Every non-zero day still gets at least
// a 20% intensity floor so small days stay visibly colored rather than fading to near-white.
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
  dailyNetPnl,
  maxProfit,
  maxLossAbs,
}: {
  year: number;
  month: number;
  dailyNetPnl: Record<string, number>;
  maxProfit: number;
  maxLossAbs: number;
}) {
  const numDays = daysInMonth(year, month);
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells: { day: number | null; pnl: number | null }[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, pnl: null });
  for (let d = 1; d <= numDays; d++) {
    const key = `${year}-${pad(month + 1)}-${pad(d)}`;
    cells.push({ day: d, pnl: dailyNetPnl[key] ?? null });
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

export function PnlCalendar() {
  const [data, setData] = useState<PnlCalendarData | null>(null);

  useEffect(() => {
    api.getPnlCalendar().then(setData).catch(console.error);
  }, []);

  if (data === null) {
    return <div className="py-4 text-center text-sm text-gray-400">Loading…</div>;
  }

  if (!data.firstTradeDate || !data.lastTradeDate) {
    return null;
  }

  const months = monthsBetween(data.firstTradeDate, data.lastTradeDate);
  const pnlValues = Object.values(data.dailyNetPnl);
  const maxProfit = Math.max(0, ...pnlValues.filter((v) => v > 0));
  const maxLossAbs = Math.max(0, ...pnlValues.filter((v) => v < 0).map((v) => Math.abs(v)));

  return (
    <div className="mb-4 rounded-md border border-gray-100 p-4">
      <div className="mb-4 flex gap-6 overflow-x-auto pb-2">
        {months.map(({ year, month }) => (
          <MonthGrid
            key={`${year}-${month}`}
            year={year}
            month={month}
            dailyNetPnl={data.dailyNetPnl}
            maxProfit={maxProfit}
            maxLossAbs={maxLossAbs}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-center sm:grid-cols-4">
        <div>
          <div className={`text-lg font-semibold ${data.realisedPnl >= 0 ? "text-gain" : "text-loss"}`}>
            {formatCompact(data.realisedPnl)}
          </div>
          <div className="text-xs text-gray-500">Realised P&amp;L</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-gray-700">
            ₹{data.chargesAndTaxes.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs text-gray-500">Charges &amp; taxes</div>
        </div>
        <div>
          <div className={`text-lg font-semibold ${data.netRealisedPnl >= 0 ? "text-gain" : "text-loss"}`}>
            {formatCompact(data.netRealisedPnl)}
          </div>
          <div className="text-xs text-gray-500">Net realised P&amp;L</div>
        </div>
        <div>
          <div className={`text-lg font-semibold ${data.unrealisedPnl >= 0 ? "text-gain" : "text-loss"}`}>
            {formatCompact(data.unrealisedPnl)}
          </div>
          <div className="text-xs text-gray-500">Unrealised P&amp;L</div>
        </div>
      </div>
    </div>
  );
}
