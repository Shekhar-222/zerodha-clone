import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { api, Candle, Instrument } from "../api";
import { formatContractLabel } from "../formatContract";
import { OrderWindow } from "./OrderWindow";

const GAIN = "#00a862";
const LOSS = "#eb5b3c";

// The full timeframe list — add a new one here (must be a value Kite's historical API
// accepts: minute/3minute/5minute/10minute/15minute/30minute/60minute/day) plus how far back
// to load for it, and it shows up as a new button automatically. lookbackDays is how much
// history to pull for that candle size — Kite's API rejects overly long ranges for
// fine-grained intervals, so finer candles get a shorter window.
const TIMEFRAMES = [
  { value: "minute", label: "1m", lookbackDays: 5 },
  { value: "3minute", label: "3m", lookbackDays: 15 },
  { value: "5minute", label: "5m", lookbackDays: 30 },
  { value: "10minute", label: "10m", lookbackDays: 60 },
  { value: "15minute", label: "15m", lookbackDays: 90 },
  { value: "30minute", label: "30m", lookbackDays: 120 },
  { value: "60minute", label: "1h", lookbackDays: 180 },
  { value: "day", label: "1D", lookbackDays: 365 },
];

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateRangeFor(interval: string): { from: string; to: string } {
  const lookbackDays = TIMEFRAMES.find((t) => t.value === interval)?.lookbackDays ?? 90;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  return { from: toDateParam(from), to: toDateParam(to) };
}

/** Plain, embeddable candlestick chart — sits inline in a tab's content card, the same way
 * PositionsTable/OrdersTable do, rather than as a popup overlay. */
export function ChartPanel({
  instrument,
  ltp,
  onOrderPlaced,
}: {
  instrument: Instrument;
  ltp?: number;
  onOrderPlaced: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);

  const [candleInterval, setCandleInterval] = useState("day");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<"BUY" | "SELL" | null>(null);

  // Chart + series creation happens once per mount — switching timeframe or instrument just
  // re-fetches and re-sets data on the existing series rather than tearing the chart down.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#ffffff" }, textColor: "#5a5a5a" },
      grid: { vertLines: { color: "#f1f1f1" }, horzLines: { color: "#f1f1f1" } },
      timeScale: { timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: GAIN,
      downColor: LOSS,
      borderVisible: false,
      wickUpColor: GAIN,
      wickDownColor: LOSS,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    (chart as any)._volumeSeries = volumeSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [instrument.instrument_token]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const { from, to } = dateRangeFor(candleInterval);

    api
      .getHistory(instrument.instrument_token, candleInterval, from, to)
      .then((candles) => {
        if (!candleSeriesRef.current || !chartRef.current) return;
        const data = candles.map((c) => ({
          time: (new Date(c.date).getTime() / 1000) as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        const volumeData = candles.map((c) => ({
          time: (new Date(c.date).getTime() / 1000) as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? `${GAIN}66` : `${LOSS}66`,
        }));
        candleSeriesRef.current.setData(data);
        (chartRef.current as any)._volumeSeries?.setData(volumeData);
        lastCandleRef.current = candles[candles.length - 1] ?? null;
        chartRef.current.timeScale().fitContent();
      })
      .catch((err) => setError(err.message ?? "Failed to load chart"))
      .finally(() => setLoading(false));
  }, [instrument.instrument_token, candleInterval]);

  // Live tick: nudge the most recent candle's close (and high/low if breached) so the chart
  // isn't frozen at whatever price it loaded at — full tick-to-candle aggregation is out of
  // scope for now, this just keeps the last bar honest.
  useEffect(() => {
    if (ltp === undefined || !candleSeriesRef.current || !lastCandleRef.current) return;
    const last = lastCandleRef.current;
    const updated = {
      ...last,
      close: ltp,
      high: Math.max(last.high, ltp),
      low: Math.min(last.low, ltp),
    };
    lastCandleRef.current = updated;
    candleSeriesRef.current.update({
      time: (new Date(updated.date).getTime() / 1000) as UTCTimestamp,
      open: updated.open,
      high: updated.high,
      low: updated.low,
      close: updated.close,
    });
  }, [ltp]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 pb-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-800">{formatContractLabel(instrument)}</div>
          <div className="text-xs text-gray-400">{instrument.exchange}</div>
        </div>
        {ltp !== undefined && (
          <span className="text-lg font-semibold tabular-nums text-gray-800">₹{ltp.toFixed(2)}</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.value}
              onClick={() => setCandleInterval(t.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                t.value === candleInterval ? "bg-accent/10 text-accent" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setOrder("BUY")}
            className="rounded bg-link px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-600"
          >
            BUY
          </button>
          <button
            onClick={() => setOrder("SELL")}
            className="rounded bg-loss px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
          >
            SELL
          </button>
        </div>
      </div>

      <div className="relative mt-3 h-[540px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-gray-400">
            Loading chart…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-loss">{error}</div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {order && (
        <OrderWindow
          instrument={instrument}
          transactionType={order}
          ltp={ltp}
          onClose={() => setOrder(null)}
          onPlaced={onOrderPlaced}
        />
      )}
    </div>
  );
}
