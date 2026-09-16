import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, RotateCcw } from "lucide-react";
import { api, Funds, Instrument } from "../api";
import { formatContractLabel } from "../formatContract";

function inr(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Market orders only — Limit and standalone Stoploss order types are disabled here per
// request, everywhere this popup is used (Watchlist, Option Chain, Positions exit, Chart).
// The bracket stoploss/target-at-entry feature below is unaffected — it attaches to a Market
// entry, it isn't a different order type of its own.
export function OrderWindow({
  instrument,
  transactionType,
  ltp,
  onClose,
  onPlaced,
  initialQuantity,
  initialProduct,
  lockSide,
  lockProduct,
  lockExchange,
  title,
}: {
  instrument: Instrument;
  transactionType: "BUY" | "SELL";
  ltp?: number;
  onClose: () => void;
  onPlaced: () => void;
  initialQuantity?: number;
  initialProduct?: "MIS" | "CNC" | "NRML";
  lockSide?: boolean;
  lockProduct?: boolean;
  lockExchange?: boolean;
  title?: string;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">(transactionType);
  const [exchangeOptions, setExchangeOptions] = useState<
    { instrument: Instrument; price: number }[]
  >([{ instrument, price: ltp ?? 0 }]);
  const [selected, setSelected] = useState<Instrument>(instrument);

  const isFno = instrument.instrument_type != null && instrument.instrument_type !== "EQ";
  const lotSize = instrument.lot_size && instrument.lot_size > 0 ? instrument.lot_size : 1;

  const [product, setProduct] = useState<"MIS" | "CNC" | "NRML">(
    initialProduct ?? (isFno ? "NRML" : "CNC")
  );
  const [quantity, setQuantity] = useState(initialQuantity ?? (isFno ? lotSize : 1));

  const canBracket = !lockSide;
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [bracketStoploss, setBracketStoploss] = useState(ltp ?? 0);
  const [bracketTarget, setBracketTarget] = useState(ltp ?? 0);
  const [funds, setFunds] = useState<Funds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isBuy = side === "BUY";

  function loadFunds() {
    api.getFunds().then(setFunds).catch(console.error);
  }

  useEffect(() => {
    loadFunds();

    if (lockExchange) return;

    api
      .searchInstruments(instrument.tradingsymbol)
      .then((results) => {
        const matches = results.filter((r) => r.tradingsymbol === instrument.tradingsymbol);
        if (matches.length === 0) return;
        api
          .getQuotes(matches.map((m) => m.instrument_token))
          .then((quotes) => {
            const options = matches.map((m) => ({
              instrument: m,
              price: quotes[m.instrument_token]?.last_price ?? (m.instrument_token === instrument.instrument_token ? ltp ?? 0 : 0),
            }));
            setExchangeOptions(options);
          })
          .catch(console.error);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument.tradingsymbol]);

  const currentOption = exchangeOptions.find((o) => o.instrument.exchange === selected.exchange) ?? exchangeOptions[0];
  const currentPrice = currentOption?.price ?? ltp ?? 0;

  useEffect(() => {
    if (!canBracket) setBracketEnabled(false);
  }, [canBracket]);

  // Seed sensible bracket stoploss/target the moment the checkbox is turned on, mirrored
  // around the current price.
  useEffect(() => {
    if (!bracketEnabled) return;
    const offset = currentPrice * 0.01;
    setBracketStoploss(Math.round((isBuy ? currentPrice - offset : currentPrice + offset) * 20) / 20);
    setBracketTarget(Math.round((isBuy ? currentPrice + offset : currentPrice - offset) * 20) / 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketEnabled]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.placeOrder({
        instrument_token: selected.instrument_token,
        transaction_type: side,
        order_type: "MARKET",
        product,
        quantity,
        bracket_stoploss: canBracket && bracketEnabled ? bracketStoploss : undefined,
        bracket_target: canBracket && bracketEnabled ? bracketTarget : undefined,
      });
      onPlaced();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  }

  const [serverRequired, setServerRequired] = useState<number | null>(null);
  const [charges, setCharges] = useState<number | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);

  useEffect(() => {
    if (quantity <= 0 || currentPrice <= 0) {
      setServerRequired(null);
      setCharges(null);
      return;
    }
    setMarginLoading(true);
    const handle = setTimeout(() => {
      api
        .getRequiredMargin({
          instrument_token: selected.instrument_token,
          transaction_type: side,
          order_type: "MARKET",
          product,
          quantity,
          price: currentPrice,
        })
        .then((res) => {
          setServerRequired(res.required);
          setCharges(res.charges);
        })
        .catch(() => {
          setServerRequired(null);
          setCharges(null);
        })
        .finally(() => setMarginLoading(false));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.instrument_token, side, product, quantity, currentPrice]);

  const required = serverRequired ?? quantity * currentPrice;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-full w-full max-w-[520px] overflow-y-auto rounded-md bg-white shadow-xl">
        {/* Header */}
        <div className={`px-5 pt-4 pb-3 text-white ${isBuy ? "bg-link" : "bg-loss"}`}>
          <div className="flex items-center justify-between">
            <div>
              {title && <div className="text-xs font-medium uppercase tracking-wide text-white/80">{title}</div>}
              <div className="text-lg font-semibold">{formatContractLabel(selected)}</div>
              {isFno && selected.expiry && (
                <div className="text-xs text-white/80">Expires {selected.expiry}</div>
              )}
            </div>
            {!lockSide && (
              <label className="flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={!isBuy}
                  onChange={(e) => setSide(e.target.checked ? "SELL" : "BUY")}
                />
                <span className="relative h-5 w-9 rounded-full bg-white/30 transition-colors peer-checked:bg-white/50">
                  <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                </span>
              </label>
            )}
          </div>
          <div className="mt-1 flex gap-4 text-sm text-white/90">
            {lockExchange ? (
              <span>
                {selected.exchange} ₹{inr(ltp ?? 0)}
              </span>
            ) : (
              exchangeOptions.map((opt) => (
                <label key={opt.instrument.exchange} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    className="accent-white"
                    checked={selected.exchange === opt.instrument.exchange}
                    onChange={() => setSelected(opt.instrument)}
                  />
                  {opt.instrument.exchange} ₹{inr(opt.price)}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Order tabs */}
        <div className="flex items-center border-b border-gray-200 px-5 text-sm text-gray-400">
          <span className="cursor-default border-b-2 border-link py-2.5 font-medium text-link">Regular</span>
        </div>

        <div className="px-5 py-4">
          {/* Product */}
          <div className={`mb-4 flex items-center justify-between text-sm ${lockProduct ? "opacity-60" : ""}`}>
            <div className="flex gap-6">
              <label className={`flex items-center gap-1.5 ${lockProduct ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="radio"
                  disabled={lockProduct}
                  checked={product === "MIS"}
                  onChange={() => setProduct("MIS")}
                  className="accent-link"
                />
                Intraday <span className="text-gray-400">MIS</span>
              </label>
              {isFno ? (
                <label className={`flex items-center gap-1.5 ${lockProduct ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <input
                    type="radio"
                    disabled={lockProduct}
                    checked={product === "NRML"}
                    onChange={() => setProduct("NRML")}
                    className="accent-link"
                  />
                  Carryforward <span className="text-gray-400">NRML</span>
                </label>
              ) : (
                <label className={`flex items-center gap-1.5 ${lockProduct ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <input
                    type="radio"
                    disabled={lockProduct}
                    checked={product === "CNC"}
                    onChange={() => setProduct("CNC")}
                    className="accent-link"
                  />
                  Longterm <span className="text-gray-400">CNC</span>
                </label>
              )}
            </div>
          </div>

          {/* Qty / Price */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 text-xs text-gray-400">Qty.</div>
              <div className="relative">
                <input
                  type="number"
                  min={isFno ? lotSize : 1}
                  step={isFno ? lotSize : 1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(isFno ? lotSize : 1, Number(e.target.value)))}
                  className="w-full border-b border-gray-300 pb-1 pr-6 text-xl text-gray-800 focus:border-link focus:outline-none"
                />
                <Layers size={15} className="absolute right-0 top-1.5 text-gray-300" />
              </div>
              {isFno && (
                <div className="mt-1 text-xs text-gray-400">
                  Lot size: {lotSize}
                  {quantity % lotSize !== 0 && (
                    <span className="text-loss"> · must be a multiple of {lotSize}</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs text-gray-400">Price</div>
              <input
                type="number"
                disabled
                value={currentPrice}
                className="w-full border-b border-gray-300 pb-1 text-xl text-gray-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Bracket order: attach an SL + target exit at entry time */}
          {canBracket && (
            <div className="mt-1 border-t border-gray-100 pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={bracketEnabled}
                  onChange={(e) => setBracketEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 accent-link"
                />
                Add stoploss &amp; target
              </label>
              {bracketEnabled && (
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <div className="mb-1 text-xs text-gray-400">Stoploss price</div>
                    <input
                      type="number"
                      step="0.05"
                      value={bracketStoploss}
                      onChange={(e) => setBracketStoploss(Number(e.target.value))}
                      className="w-full border-b border-gray-300 pb-1 text-lg text-gray-800 focus:border-link focus:outline-none"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-gray-400">Target price</div>
                    <input
                      type="number"
                      step="0.05"
                      value={bracketTarget}
                      onChange={(e) => setBracketTarget(Number(e.target.value))}
                      className="w-full border-b border-gray-300 pb-1 text-lg text-gray-800 focus:border-link focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <div className="px-5 pb-2 text-sm text-loss">{error}</div>}

        {/* Footer */}
        <div className="flex items-center justify-between bg-gray-50 px-5 py-3">
          <div className="text-xs text-gray-500">
            {isFno ? "Margin required" : "Required"}{" "}
            <span className="font-medium text-gray-700">
              {marginLoading ? "…" : `₹${inr(required)}`}
            </span>
            {!marginLoading && charges !== null && charges > 0 && (
              <span className="text-gray-400"> (incl. ₹{inr(charges)} charges)</span>
            )}
            <span className="mx-2 text-gray-300">·</span>
            Available <span className="font-medium text-gray-700">₹{funds ? inr(funds.available_balance) : "—"}</span>
            <button onClick={loadFunds} className="ml-1 align-middle text-gray-300 hover:text-gray-500">
              <RotateCcw size={12} />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitting || (canBracket && bracketEnabled && (bracketStoploss <= 0 || bracketTarget <= 0))}
              className={`rounded px-6 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                isBuy ? "bg-link hover:bg-blue-600" : "bg-loss hover:bg-red-600"
              }`}
            >
              {submitting ? "Placing…" : isBuy ? "Buy" : "Sell"}
            </button>
            <button
              onClick={onClose}
              className="rounded border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
