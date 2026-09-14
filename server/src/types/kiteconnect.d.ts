declare module "kiteconnect" {
  export class KiteConnect {
    constructor(opts: { api_key: string; access_token?: string });
    getLoginURL(): string;
    setAccessToken(token: string): void;
    generateSession(requestToken: string, apiSecret: string): Promise<{
      access_token: string;
      public_token: string;
      [key: string]: any;
    }>;
    getInstruments(exchange?: string): Promise<any[]>;
    getQuote(instruments: string[]): Promise<Record<string, any>>;
    getLTP(instruments: string[]): Promise<Record<string, { instrument_token: number; last_price: number }>>;
    getProfile(): Promise<{ user_id: string; user_name: string; user_shortname: string; [key: string]: any }>;
    invalidateAccessToken(accessToken?: string): Promise<any>;
    getHistoricalData(
      instrumentToken: number,
      interval: "minute" | "day" | "3minute" | "5minute" | "10minute" | "15minute" | "30minute" | "60minute",
      fromDate: string,
      toDate: string,
      continuous?: boolean,
      oi?: boolean
    ): Promise<
      Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        oi?: number;
      }>
    >;
    orderMargins(
      orders: Array<{
        exchange: string;
        tradingsymbol: string;
        transaction_type: "BUY" | "SELL";
        variety: string;
        product: string;
        order_type: string;
        quantity: number;
        price?: number;
        trigger_price?: number;
      }>,
      mode?: string | null
    ): Promise<
      Array<{
        type: string;
        tradingsymbol: string;
        exchange: string;
        span: number;
        exposure: number;
        option_premium: number;
        additional: number;
        bo: number;
        cash: number;
        var: number;
        total: number;
        charges?: {
          transaction_tax: number;
          transaction_tax_type: string;
          exchange_turnover_charge: number;
          sebi_turnover_charge: number;
          brokerage: number;
          stamp_duty: number;
          gst: { igst: number; cgst: number; sgst: number; total: number };
          total: number;
        };
        [key: string]: any;
      }>
    >;
    [key: string]: any;
  }

  export class KiteTicker {
    constructor(opts: { api_key: string; access_token: string });
    connect(): void;
    disconnect(): void;
    connected(): boolean;
    subscribe(tokens: number[]): void;
    unsubscribe(tokens: number[]): void;
    setMode(mode: string, tokens: number[]): void;
    modeLTP: string;
    modeQuote: string;
    modeFull: string;
    on(event: string, callback: (...args: any[]) => void): void;
  }
}
