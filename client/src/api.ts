const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return body as T;
}

export type Instrument = {
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  name: string;
  instrument_type?: "EQ" | "FUT" | "CE" | "PE";
  expiry?: string | null;
  strike?: number | null;
  lot_size?: number;
};

export type WatchlistItem = {
  id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  sort_order: number;
  name?: string | null;
  instrument_type?: "EQ" | "FUT" | "CE" | "PE";
  lot_size?: number;
  expiry?: string | null;
  strike?: number | null;
};

export type Order = {
  id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  transaction_type: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
  product: "MIS" | "CNC" | "NRML";
  quantity: number;
  price: number | null;
  trigger_price?: number | null;
  status: "OPEN" | "COMPLETE" | "CANCELLED" | "REJECTED";
  filled_price: number | null;
  placed_at: string;
  bracket_stoploss?: number | null;
  bracket_target?: number | null;
  bracket_parent_id?: number | null;
  bracket_role?: "SL" | "TARGET" | null;
  name?: string | null;
  instrument_type?: "EQ" | "FUT" | "CE" | "PE" | null;
  expiry?: string | null;
  strike?: number | null;
};

export type TradeHistoryItem = {
  id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  transaction_type: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
  product: "MIS" | "CNC" | "NRML";
  quantity: number;
  price: number;
  executed_at: string;
  name?: string | null;
  instrument_type?: "EQ" | "FUT" | "CE" | "PE" | null;
  expiry?: string | null;
  strike?: number | null;
};

export type Position = {
  id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  product: "MIS" | "CNC" | "NRML";
  quantity: number;
  avg_price: number;
  realized_pnl: number;
  ltp: number;
  unrealized_pnl: number;
  name?: string | null;
  instrument_type?: "EQ" | "FUT" | "CE" | "PE" | null;
  lot_size?: number | null;
  expiry?: string | null;
  strike?: number | null;
};

export type Holding = {
  id: number;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  quantity: number;
  avg_price: number;
  ltp: number;
  unrealized_pnl: number;
};

export type Funds = {
  user_id: number;
  available_balance: number;
  cash_balance: number;
  used_margin: number;
};

export type PnlSummaryItem = {
  tradingsymbol: string;
  name?: string | null;
  instrument_type?: "EQ" | "FUT" | "CE" | "PE" | null;
  expiry?: string | null;
  strike?: number | null;
  product: string;
  status: "closed" | "open";
  executed_at: string | null;
  quantity: number;
  pnl: number;
  charges: number;
  net_pnl: number;
};

export type Transaction = {
  id: number;
  order_id: number | null;
  type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
};

export type IndexQuote = {
  name: string;
  last_price: number;
  change: number;
  change_percent: number;
};

export type Profile = {
  user_id: string;
  user_name: string;
  user_shortname: string;
};

export type Quote = {
  last_price: number;
  net_change: number;
  ohlc: { open: number; high: number; low: number; close: number };
};

export type OptionChainLeg = {
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  instrument_type: "CE" | "PE";
  strike: number;
  lot_size: number;
};

export const api = {
  authStatus: () => request<{ loggedIn: boolean }>("/api/auth/status"),
  loginUrl: () => `${API_URL}/api/auth/login`,
  autoLogin: () => request<{ ok: boolean }>("/api/auth/auto-login", { method: "POST" }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  searchInstruments: (q: string) =>
    request<Instrument[]>(`/api/instruments/search?q=${encodeURIComponent(q)}`),

  getWatchlist: () => request<WatchlistItem[]>("/api/watchlist"),
  addToWatchlist: (instrument_token: number) =>
    request("/api/watchlist", { method: "POST", body: JSON.stringify({ instrument_token }) }),
  removeFromWatchlist: (id: number) => request(`/api/watchlist/${id}`, { method: "DELETE" }),
  reorderWatchlist: (ids: number[]) =>
    request("/api/watchlist/reorder", { method: "PUT", body: JSON.stringify({ ids }) }),

  getQuotes: (tokens: number[]) =>
    request<Record<number, Quote>>(`/api/quotes?tokens=${tokens.join(",")}`),
  getIndices: () => request<Record<string, IndexQuote>>("/api/quotes/indices"),

  getProfile: () => request<Profile>("/api/auth/profile"),

  getOrders: () => request<Order[]>("/api/orders"),
  getTradeHistory: () => request<TradeHistoryItem[]>("/api/orders/history"),
  placeOrder: (input: {
    instrument_token: number;
    transaction_type: "BUY" | "SELL";
    order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
    product: "MIS" | "CNC" | "NRML";
    quantity: number;
    price?: number;
    trigger_price?: number;
    bracket_stoploss?: number;
    bracket_target?: number;
  }) => request<Order>("/api/orders", { method: "POST", body: JSON.stringify(input) }),
  cancelOrder: (id: number) => request<Order>(`/api/orders/${id}`, { method: "DELETE" }),

  getOptionExpiries: (symbol: string) =>
    request<{ underlying: string; expiries: string[] }>(
      `/api/instruments/option-chain/expiries?symbol=${encodeURIComponent(symbol)}`
    ),
  getOptionChain: (symbol: string, expiry: string) =>
    request<OptionChainLeg[]>(
      `/api/instruments/option-chain?symbol=${encodeURIComponent(symbol)}&expiry=${expiry}`
    ),

  getRequiredMargin: (input: {
    instrument_token: number;
    transaction_type: "BUY" | "SELL";
    order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
    product: "MIS" | "CNC" | "NRML";
    quantity: number;
    price: number;
    trigger_price?: number;
  }) =>
    request<{ required: number; charges: number; source: "kite" | "estimate" }>("/api/orders/margin", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getPositions: () => request<Position[]>("/api/portfolio/positions"),
  getHoldings: () => request<Holding[]>("/api/portfolio/holdings"),
  getFunds: () => request<Funds>("/api/portfolio/funds"),
  getTransactions: () => request<Transaction[]>("/api/portfolio/transactions"),
  getPnlSummary: () => request<PnlSummaryItem[]>("/api/portfolio/pnl-summary"),
  resetAccount: () => request<{ ok: boolean }>("/api/portfolio/reset", { method: "POST" }),
};
