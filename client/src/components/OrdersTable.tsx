import { useState } from "react";
import { X } from "lucide-react";
import { api, Order } from "../api";
import { EmptyState } from "./EmptyState";
import { formatContractLabel } from "../formatContract";

const STATUS_STYLE: Record<Order["status"], string> = {
  COMPLETE: "bg-gain/10 text-gain",
  OPEN: "bg-yellow-100 text-yellow-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  REJECTED: "bg-loss/10 text-loss",
};

export function OrdersTable({
  orders,
  ltpByToken,
  onChanged,
  onGetStarted,
}: {
  orders: Order[];
  ltpByToken: Record<number, number>;
  onChanged: () => void;
  onGetStarted: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (orders.length === 0) {
    return <EmptyState message="You haven't placed any orders today" ctaLabel="Get started" onCta={onGetStarted} />;
  }

  const cancellableIds = orders.filter((o) => o.status === "OPEN").map((o) => o.id);
  const allCancellableSelected = cancellableIds.length > 0 && cancellableIds.every((id) => selected.has(id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allCancellableSelected ? new Set() : new Set(cancellableIds));
  }

  async function cancel(id: number) {
    setError(null);
    setCancellingId(id);
    try {
      await api.cancelOrder(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Left disabled until the refreshed order list confirms CANCELLED and the button
      // disappears — clearing it here would flash it back to active for a moment first,
      // since onChanged()'s refetch resolves a beat after this request does.
      onChanged();
    } catch (err: any) {
      setError(err.message ?? "Failed to cancel order");
      setCancellingId(null);
    }
  }

  async function cancelSelected() {
    setError(null);
    try {
      await Promise.all(Array.from(selected).map((id) => api.cancelOrder(id)));
      setSelected(new Set());
      onChanged();
    } catch (err: any) {
      setError(err.message ?? "Failed to cancel one or more orders");
      onChanged();
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[15px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="w-8 py-2 font-normal">
              <input
                type="checkbox"
                checked={allCancellableSelected}
                onChange={toggleAll}
                disabled={cancellableIds.length === 0}
                className="accent-link"
              />
            </th>
            <th className="py-2 font-normal">Time</th>
            <th className="py-2 font-normal">Type</th>
            <th className="py-2 font-normal">Instrument</th>
            <th className="py-2 font-normal">Product</th>
            <th className="py-2 font-normal text-right">Qty.</th>
            <th className="py-2 font-normal text-right">LTP</th>
            <th className="py-2 font-normal text-right">Price</th>
            <th className="py-2 font-normal">Status</th>
            <th className="w-8 py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const filledQty = o.status === "COMPLETE" ? o.quantity : 0;
            const ltp = ltpByToken[o.instrument_token];
            const isCancellable = o.status === "OPEN";
            return (
              <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    disabled={!isCancellable}
                    className="accent-link disabled:opacity-30"
                  />
                </td>
                <td className="py-2.5 text-xs text-gray-400">
                  {new Date(o.placed_at + "Z").toLocaleTimeString()}
                </td>
                <td className="py-2.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${
                      o.transaction_type === "BUY" ? "bg-link/10 text-link" : "bg-loss/10 text-loss"
                    }`}
                  >
                    {o.transaction_type}
                  </span>
                </td>
                <td className="py-2.5">
                  <span className="font-medium text-gray-800">{formatContractLabel(o)}</span>{" "}
                  <span className="text-xs text-gray-400">{o.exchange}</span>
                  {(o.bracket_stoploss != null || o.bracket_target != null) && (
                    <div className="text-[12px] text-gray-400">
                      Bracket · SL {o.bracket_stoploss?.toFixed(2) ?? "—"} / Target {o.bracket_target?.toFixed(2) ?? "—"}
                    </div>
                  )}
                  {o.bracket_role && (
                    <div className="text-[12px] text-gray-400">
                      {o.bracket_role === "SL" ? "Bracket stoploss leg" : "Bracket target leg"}
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-gray-500">{o.product}</td>
                <td className="py-2.5 text-right tabular-nums text-gray-500">
                  {filledQty} / {o.quantity}
                </td>
                <td className="py-2.5 text-right tabular-nums">{ltp !== undefined ? ltp.toFixed(2) : "—"}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {(o.filled_price ?? o.price ?? 0).toFixed(2)}
                  {(o.order_type === "SL" || o.order_type === "SL-M") && o.trigger_price != null && (
                    <div className="text-[12px] font-normal text-gray-400">
                      Stoploss @ {o.trigger_price.toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${STATUS_STYLE[o.status]}`}>
                    {o.status}
                  </span>
                </td>
                <td className="py-2.5 text-right">
                  {isCancellable && (
                    <button
                      onClick={() => cancel(o.id)}
                      disabled={cancellingId === o.id}
                      title="Cancel order"
                      className="text-gray-400 hover:text-loss disabled:opacity-40"
                    >
                      <X size={15} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {error && <div className="mt-3 text-sm text-loss">{error}</div>}

      {selected.size > 0 && (
        <div className="mt-3">
          <button
            onClick={cancelSelected}
            className="rounded bg-link px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Cancel {selected.size} order{selected.size > 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
}
