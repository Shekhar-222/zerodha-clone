import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import { api, Instrument, OptionChainLeg, Quote } from "../api";
import { OrderWindow } from "./OrderWindow";

const STRIKES_EACH_SIDE = 10;

function formatExpiry(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function legToInstrument(leg: OptionChainLeg): Instrument {
  return {
    instrument_token: leg.instrument_token,
    tradingsymbol: leg.tradingsymbol,
    exchange: leg.exchange,
    name: leg.tradingsymbol,
    instrument_type: leg.instrument_type,
    lot_size: leg.lot_size,
    strike: leg.strike,
  };
}

function LegCell({
  leg,
  quote,
  align,
  itm,
  onBuy,
  onSell,
  onWatch,
  watched,
}: {
  leg: OptionChainLeg | undefined;
  quote: Quote | undefined;
  align: "left" | "right";
  itm: boolean;
  onBuy: () => void;
  onSell: () => void;
  onWatch: () => void;
  watched: boolean;
}) {
  if (!leg) return <td className="py-1.5"></td>;

  const ltp = quote?.last_price;
  const close = quote?.ohlc.close;
  const pct = ltp !== undefined && close ? ((ltp - close) / close) * 100 : null;
  const positive = pct !== null && pct >= 0;

  const priceEl = (
    <span className="whitespace-nowrap">
      <span className="font-medium text-gray-800">{ltp !== undefined ? ltp.toFixed(2) : "—"}</span>
      {pct !== null && (
        <span className={`ml-1.5 text-[12px] ${positive ? "text-gain" : "text-loss"}`}>
          {positive ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      )}
    </span>
  );

  const buttonsEl = (
    <span className="hidden items-center gap-1 group-hover:flex">
      <button
        onClick={onBuy}
        className="flex h-6 w-6 items-center justify-center rounded bg-link text-[12px] font-semibold text-white hover:bg-blue-600"
        title="Buy"
      >
        B
      </button>
      <button
        onClick={onSell}
        className="flex h-6 w-6 items-center justify-center rounded bg-loss text-[12px] font-semibold text-white hover:bg-red-600"
        title="Sell"
      >
        S
      </button>
      <button
        onClick={onWatch}
        className={`flex h-6 w-6 items-center justify-center rounded border ${
          watched ? "border-accent text-accent" : "border-gray-200 text-gray-500 hover:bg-gray-50"
        }`}
        title={watched ? "In watchlist" : "Add to watchlist"}
      >
        <Star size={12} fill={watched ? "currentColor" : "none"} />
      </button>
    </span>
  );

  return (
    <td className={`py-1.5 ${align === "left" ? "pl-3" : "pr-3"} ${itm ? "bg-amber-50" : ""}`}>
      <div className={`flex w-full items-center gap-2 ${align === "left" ? "justify-between" : "flex-row-reverse justify-between"}`}>
        {priceEl}
        {buttonsEl}
      </div>
    </td>
  );
}

export function OptionChain({
  underlying,
  spotLtp,
  onClose,
  onOrderPlaced,
  onWatchlistChanged,
}: {
  underlying: Instrument;
  spotLtp?: number;
  onClose: () => void;
  onOrderPlaced: () => void;
  onWatchlistChanged: () => void;
}) {
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionChainLeg[]>([]);
  const [quotes, setQuotes] = useState<Record<number, Quote>>({});
  const [watched, setWatched] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{ instrument: Instrument; side: "BUY" | "SELL" } | null>(null);

  // Equities (and indices, via the backend's alias map) key their derivatives off the
  // tradingsymbol. But when the "underlying" here is itself a derivative row — e.g. a
  // commodity futures contract like CRUDEOIL26SEPFUT, which has no separate spot/EQ
  // instrument to add to the watchlist — the tradingsymbol is contract-specific and won't
  // match anything; the instrument's own `name` field ("CRUDEOIL") is the right key there.
  const isDerivativeRow =
    underlying.instrument_type === "FUT" ||
    underlying.instrument_type === "CE" ||
    underlying.instrument_type === "PE";
  const underlyingKey = isDerivativeRow ? underlying.name || underlying.tradingsymbol : underlying.tradingsymbol;

  useEffect(() => {
    api
      .getOptionExpiries(underlyingKey)
      .then((res) => {
        setExpiries(res.expiries);
        setExpiry(res.expiries[0] ?? null);
        if (res.expiries.length === 0) setLoading(false);
      })
      .catch((err) => {
        setError(err.message ?? "Failed to load expiries");
        setLoading(false);
      });

    api
      .getWatchlist()
      .then((rows) => setWatched(new Set(rows.map((r) => r.instrument_token))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlyingKey]);

  function loadQuotes(tokens: number[]) {
    api
      .getQuotes(tokens)
      .then((res) => setQuotes(res))
      .catch(() => {});
  }

  useEffect(() => {
    if (!expiry) return;
    setLoading(true);
    api
      .getOptionChain(underlyingKey, expiry)
      .then((legs) => {
        setChain(legs);
        setLoading(false);
        loadQuotes(legs.map((l) => l.instrument_token));
      })
      .catch((err) => setError(err.message ?? "Failed to load option chain"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiry, underlyingKey]);

  useEffect(() => {
    if (!expiry || chain.length === 0) return;
    const interval = setInterval(() => loadQuotes(chain.map((l) => l.instrument_token)), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiry, chain]);

  async function addToWatchlist(token: number) {
    await api.addToWatchlist(token);
    setWatched((prev) => new Set(prev).add(token));
    onWatchlistChanged();
  }

  const strikes = Array.from(new Set(chain.map((l) => l.strike))).sort((a, b) => a - b);
  const atmStrike =
    spotLtp !== undefined && strikes.length > 0
      ? strikes.reduce((closest, s) => (Math.abs(s - spotLtp) < Math.abs(closest - spotLtp) ? s : closest))
      : null;
  const atmIndex = atmStrike !== null ? strikes.indexOf(atmStrike) : Math.floor(strikes.length / 2);
  const visibleStrikes = strikes.slice(
    Math.max(0, atmIndex - STRIKES_EACH_SIDE),
    atmIndex + STRIKES_EACH_SIDE + 1
  );

  const byStrike = new Map<number, { ce?: OptionChainLeg; pe?: OptionChainLeg }>();
  for (const leg of chain) {
    const entry = byStrike.get(leg.strike) ?? {};
    if (leg.instrument_type === "CE") entry.ce = leg;
    else entry.pe = leg;
    byStrike.set(leg.strike, entry);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">{underlyingKey} Option Chain</div>
            {spotLtp !== undefined && <div className="text-xs text-gray-500">Spot ₹{spotLtp.toFixed(2)}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>

        {expiries.length > 0 && (
          <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 py-2">
            {expiries.map((e) => (
              <button
                key={e}
                onClick={() => setExpiry(e)}
                className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium ${
                  expiry === e ? "bg-accent text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {formatExpiry(e)}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-4 border-b border-gray-100 py-1.5 text-[12px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-amber-50 border border-amber-200" /> ITM
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-white border border-gray-200" /> OTM
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <div className="p-4 text-sm text-loss">{error}</div>}
          {!error && loading && <div className="p-8 text-center text-sm text-gray-400">Loading…</div>}
          {!error && !loading && expiries.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-400">
              No F&O contracts available for {underlyingKey}.
            </div>
          )}

          {!error && !loading && expiries.length > 0 && (
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col className="w-[42%]" />
                <col className="w-[16%]" />
                <col className="w-[42%]" />
              </colgroup>
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 pl-3 text-left font-normal">Call LTP</th>
                  <th className="py-2 text-center font-normal">Strike</th>
                  <th className="py-2 pr-3 text-right font-normal">Put LTP</th>
                </tr>
              </thead>
              <tbody>
                {visibleStrikes.map((strike) => {
                  const { ce, pe } = byStrike.get(strike) ?? {};
                  const isAtm = strike === atmStrike;
                  const ceItm = spotLtp !== undefined && strike < spotLtp;
                  const peItm = spotLtp !== undefined && strike > spotLtp;
                  const ceQuote = ce ? quotes[ce.instrument_token] : undefined;
                  const peQuote = pe ? quotes[pe.instrument_token] : undefined;

                  return (
                    <tr key={strike} className="group border-b border-gray-50 hover:bg-gray-50">
                      <LegCell
                        leg={ce}
                        quote={ceQuote}
                        align="left"
                        itm={ceItm}
                        onBuy={() => ce && setOrder({ instrument: legToInstrument(ce), side: "BUY" })}
                        onSell={() => ce && setOrder({ instrument: legToInstrument(ce), side: "SELL" })}
                        onWatch={() => ce && addToWatchlist(ce.instrument_token)}
                        watched={ce ? watched.has(ce.instrument_token) : false}
                      />
                      <td
                        className={`py-1.5 text-center tabular-nums ${
                          isAtm ? "bg-gray-800 font-semibold text-white" : "font-medium text-gray-700"
                        }`}
                      >
                        {strike}
                      </td>
                      <LegCell
                        leg={pe}
                        quote={peQuote}
                        align="right"
                        itm={peItm}
                        onBuy={() => pe && setOrder({ instrument: legToInstrument(pe), side: "BUY" })}
                        onSell={() => pe && setOrder({ instrument: legToInstrument(pe), side: "SELL" })}
                        onWatch={() => pe && addToWatchlist(pe.instrument_token)}
                        watched={pe ? watched.has(pe.instrument_token) : false}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {order && (
        <OrderWindow
          instrument={order.instrument}
          transactionType={order.side}
          ltp={quotes[order.instrument.instrument_token]?.last_price}
          onClose={() => setOrder(null)}
          onPlaced={onOrderPlaced}
        />
      )}
    </div>,
    document.body
  );
}
