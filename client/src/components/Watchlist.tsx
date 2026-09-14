import { RefObject, useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  CandlestickChart,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Link2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api, Instrument, WatchlistItem } from "../api";
import { OrderWindow } from "./OrderWindow";
import { OptionChain } from "./OptionChain";
import { ContractLabel } from "./ContractLabel";
import { formatContractLabel } from "../formatContract";

const MAX_STOCKS = 250;

function formatExpiry(expiry?: string | null): string | null {
  if (!expiry) return null;
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function toInstrument(item: WatchlistItem): Instrument {
  return {
    instrument_token: item.instrument_token,
    tradingsymbol: item.tradingsymbol,
    exchange: item.exchange,
    name: item.name || item.tradingsymbol,
    instrument_type: item.instrument_type,
    lot_size: item.lot_size,
    expiry: item.expiry,
    strike: item.strike,
  };
}

export function Watchlist({
  ltpByToken,
  onOrderPlaced,
  searchInputRef,
  onClose,
  onOpenChart,
}: {
  ltpByToken: Record<number, number>;
  onOrderPlaced: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
  onClose?: () => void;
  onOpenChart: (instrument: Instrument) => void;
}) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [prevClose, setPrevClose] = useState<Record<number, number>>({});
  const [restLtp, setRestLtp] = useState<Record<number, number>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [selectedResults, setSelectedResults] = useState<Map<number, Instrument>>(new Map());
  const [adding, setAdding] = useState(false);
  const [order, setOrder] = useState<{ instrument: Instrument; side: "BUY" | "SELL" } | null>(
    null
  );
  const [chainFor, setChainFor] = useState<{ instrument: Instrument; ltp?: number } | null>(null);
  const [sortDir, setSortDir] = useState<"none" | "asc" | "desc">("none");
  const [dragId, setDragId] = useState<number | null>(null);
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? internalSearchRef;
  const searchBoxRef = useRef<HTMLDivElement>(null);

  function refresh() {
    api.getWatchlist().then((rows) => {
      setItems(rows);
      if (rows.length > 0) {
        api
          .getQuotes(rows.map((r) => r.instrument_token))
          .then((quotes) => {
            const nextClose: Record<number, number> = {};
            const nextLtp: Record<number, number> = {};
            for (const row of rows) {
              const q = quotes[row.instrument_token];
              if (q) {
                nextClose[row.instrument_token] = q.ohlc.close;
                nextLtp[row.instrument_token] = q.last_price;
              }
            }
            setPrevClose(nextClose);
            setRestLtp(nextLtp);
          })
          .catch(console.error);
      }
    }).catch(console.error);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.searchInstruments(query).then(setResults).catch(console.error);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setResults([]);
        setSelectedResults(new Map());
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggleSelected(instrument: Instrument) {
    setSelectedResults((prev) => {
      const next = new Map(prev);
      if (next.has(instrument.instrument_token)) {
        next.delete(instrument.instrument_token);
      } else {
        next.set(instrument.instrument_token, instrument);
      }
      return next;
    });
  }

  async function addSelected() {
    if (selectedResults.size === 0) return;
    setAdding(true);
    try {
      await Promise.all(
        Array.from(selectedResults.values()).map((i) => api.addToWatchlist(i.instrument_token))
      );
      setQuery("");
      setResults([]);
      setSelectedResults(new Map());
      refresh();
    } finally {
      setAdding(false);
    }
  }

  async function addSingle(instrument: Instrument) {
    await api.addToWatchlist(instrument.instrument_token);
    setQuery("");
    setResults([]);
    setSelectedResults(new Map());
    refresh();
  }

  async function remove(id: number) {
    await api.removeFromWatchlist(id);
    refresh();
  }

  function handleDrop(targetId: number) {
    if (dragId === null || dragId === targetId) {
      setDragId(null);
      return;
    }
    const draggedIndex = items.findIndex((i) => i.id === dragId);
    const targetIndex = items.findIndex((i) => i.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) {
      setDragId(null);
      return;
    }

    const reordered = [...items];
    const [dragged] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, dragged);

    setItems(reordered);
    setSortDir("none");
    setDragId(null);
    api.reorderWatchlist(reordered.map((i) => i.id)).catch(console.error);
  }

  // Backend already returns items oldest-first (by id), so the newest addition lands at the
  // bottom by default — matches how a watchlist is expected to grow. The sort button is an
  // opt-in override to view alphabetically instead.
  const sorted =
    sortDir === "none"
      ? items
      : [...items].sort((a, b) =>
          sortDir === "asc"
            ? a.tradingsymbol.localeCompare(b.tradingsymbol)
            : b.tradingsymbol.localeCompare(a.tradingsymbol)
        );

  return (
    <aside className="flex h-full w-[85vw] max-w-[380px] flex-shrink-0 flex-col border-r border-gray-200 bg-white shadow-lg md:w-[380px] md:shadow-none">
      <div ref={searchBoxRef} className="flex items-center gap-2 border-b border-gray-100 p-2">
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 md:hidden"
            title="Close"
          >
            <X size={16} />
          </button>
        )}
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (selectedResults.size > 0) addSelected();
                else if (results.length > 0) addSingle(results[0]);
              }
            }}
            placeholder="Search eg: infy bse, nifty fut, index fund, et"
            className="w-full rounded border border-gray-200 bg-white py-1.5 pl-8 pr-14 text-[15px] placeholder:text-gray-400 focus:border-accent focus:outline-none"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border border-gray-200 px-1 text-[11px] text-gray-400 hidden sm:inline-block">
            Ctrl + K
          </span>

          {results.length > 0 && (
            <div className="absolute left-0 right-0 z-10 mt-1 max-h-80 overflow-hidden rounded border border-gray-200 bg-white shadow-lg">
            <div className="max-h-64 overflow-auto">
              {results.map((r) => {
                const isSelected = selectedResults.has(r.instrument_token);
                return (
                  <div
                    key={r.instrument_token}
                    onClick={() => toggleSelected(r)}
                    className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-gray-50 ${
                      isSelected ? "bg-accent/5" : ""
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected ? "border-accent bg-accent text-white" : "border-gray-300"
                      }`}
                    >
                      {isSelected && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{formatContractLabel(r)}</span>
                    <span className="ml-2 flex shrink-0 items-center gap-1.5 text-xs text-gray-400">
                      {r.instrument_type && r.instrument_type !== "EQ" && formatExpiry(r.expiry) && (
                        <span className="rounded bg-gray-100 px-1 py-0.5 font-medium text-gray-500">
                          {formatExpiry(r.expiry)}
                        </span>
                      )}
                      {r.exchange}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-500">
                {selectedResults.size > 0 ? `${selectedResults.size} selected` : "Select one or more"}
              </span>
              <div className="flex gap-2">
                {selectedResults.size > 0 && (
                  <button
                    onClick={() => setSelectedResults(new Map())}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={addSelected}
                  disabled={selectedResults.size === 0 || adding}
                  className="rounded bg-link px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {adding ? "Adding…" : `Add${selectedResults.size > 0 ? ` (${selectedResults.size})` : ""}`}
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-500">
        <span>
          Stocks ({items.length}/{MAX_STOCKS})
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              setSortDir((d) => (d === "none" ? "asc" : d === "asc" ? "desc" : "none"))
            }
            className={sortDir === "none" ? "hover:text-gray-800" : "text-accent"}
            title={
              sortDir === "none"
                ? "Sort: recently added"
                : sortDir === "asc"
                ? "Sort: A-Z"
                : "Sort: Z-A"
            }
          >
            <ArrowDownUp size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto border-t border-gray-100">
        {sorted.map((item) => {
          const ltp = ltpByToken[item.instrument_token] ?? restLtp[item.instrument_token];
          const close = prevClose[item.instrument_token];
          const hasData = ltp !== undefined && close !== undefined;
          const change = hasData ? ltp - close : 0;
          const changePct = hasData && close ? (change / close) * 100 : 0;
          const positive = change >= 0;
          const color = !hasData ? "text-gray-800" : positive ? "text-gain" : "text-loss";

          return (
            <div
              key={item.id}
              draggable={sortDir === "none"}
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              onDragEnd={() => setDragId(null)}
              className={`group relative flex items-center gap-1 border-b border-gray-100 py-2 pl-1 pr-3 hover:bg-gray-50 ${
                dragId === item.id ? "opacity-40" : ""
              }`}
            >
              <span
                className={`flex w-4 shrink-0 items-center justify-center text-gray-300 opacity-0 group-hover:opacity-100 ${
                  sortDir === "none" ? "cursor-grab active:cursor-grabbing" : "invisible"
                }`}
              >
                <GripVertical size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <ContractLabel item={item} className={`truncate text-[15px] ${color}`} />
              </div>

              {hasData ? (
                <div className="flex items-center gap-2.5 text-[15px] tabular-nums">
                  <span className={`flex w-16 items-center justify-end gap-0.5 ${color}`}>
                    {positive ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {Math.abs(changePct).toFixed(2)}%
                  </span>
                  <span className={`w-16 text-right font-medium ${color}`}>{ltp.toFixed(2)}</span>
                </div>
              ) : (
                <span className="w-[130px] text-right text-[15px] text-gray-400">—</span>
              )}

              <div className="absolute inset-y-0 right-2 hidden items-center gap-1.5 bg-white pl-6 group-hover:flex">
                <button
                  onClick={() => setOrder({ instrument: toInstrument(item), side: "BUY" })}
                  className="flex h-7 w-8 items-center justify-center rounded bg-link text-xs font-semibold text-white hover:bg-blue-600"
                  title="Buy"
                >
                  B
                </button>
                <button
                  onClick={() => setOrder({ instrument: toInstrument(item), side: "SELL" })}
                  className="flex h-7 w-8 items-center justify-center rounded bg-loss text-xs font-semibold text-white hover:bg-red-600"
                  title="Sell"
                >
                  S
                </button>
                <button
                  onClick={() => onOpenChart(toInstrument(item))}
                  className="flex h-7 w-8 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  title="Chart"
                >
                  <CandlestickChart size={14} />
                </button>
                <button
                  onClick={() => setChainFor({ instrument: toInstrument(item), ltp })}
                  className="flex h-7 w-8 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  title="Option Chain"
                >
                  <Link2 size={14} />
                </button>
                <button
                  onClick={() => remove(item.id)}
                  className="flex h-7 w-8 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Your watchlist is empty — search above to add instruments.
          </div>
        )}
      </div>

      {order && (
        <OrderWindow
          instrument={order.instrument}
          transactionType={order.side}
          ltp={ltpByToken[order.instrument.instrument_token] ?? restLtp[order.instrument.instrument_token]}
          onClose={() => setOrder(null)}
          onPlaced={onOrderPlaced}
        />
      )}

      {chainFor && (
        <OptionChain
          underlying={chainFor.instrument}
          spotLtp={chainFor.ltp}
          onClose={() => setChainFor(null)}
          onOrderPlaced={onOrderPlaced}
          onWatchlistChanged={refresh}
        />
      )}
    </aside>
  );
}
