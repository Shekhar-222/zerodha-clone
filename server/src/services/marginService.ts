import { kite } from "../kite/kiteClient";

export type OrderCosts = {
  /** Real SPAN+exposure margin (F&O) or Kite's reported requirement for equity. */
  margin: number;
  /** Brokerage + STT + exchange/SEBI charges + stamp duty + GST, combined. */
  charges: number;
};

/**
 * Pulls real margin AND real charges from Kite's own order-margin calculator — the same
 * brokerage/STT/exchange/SEBI/stamp-duty/GST breakdown real Kite shows before you place an
 * order — for any instrument, not just F&O. We use `.margin` for F&O funds accounting, and
 * `.charges` universally so every trade (equity included) pays realistic charges instead of
 * being fee-free.
 */
export async function calculateOrderCosts(params: {
  exchange: string;
  tradingsymbol: string;
  transactionType: "BUY" | "SELL";
  product: "MIS" | "CNC" | "NRML";
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  quantity: number;
  price?: number;
  triggerPrice?: number;
}): Promise<OrderCosts> {
  const [result] = await kite.orderMargins([
    {
      exchange: params.exchange,
      tradingsymbol: params.tradingsymbol,
      transaction_type: params.transactionType,
      variety: "regular",
      product: params.product,
      order_type: params.orderType,
      quantity: params.quantity,
      price: params.orderType === "LIMIT" || params.orderType === "SL" ? params.price ?? 0 : 0,
      trigger_price: params.orderType === "SL" || params.orderType === "SL-M" ? params.triggerPrice ?? 0 : 0,
    },
  ]);

  if (!result || typeof result.total !== "number") {
    throw new Error("Margin API returned no result");
  }
  return { margin: result.total, charges: result.charges?.total ?? 0 };
}
