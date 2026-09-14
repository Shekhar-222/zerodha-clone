import { KiteTicker } from "kiteconnect";
import { EventEmitter } from "events";
import { config } from "../config";

export type Tick = {
  instrument_token: number;
  last_price: number;
};

export const tickerEvents = new EventEmitter();

const ltpCache = new Map<number, number>();
let ticker: KiteTicker | null = null;
let subscribedTokens = new Set<number>();

export function getCachedLtp(token: number): number | undefined {
  return ltpCache.get(token);
}

export function startTicker(accessToken: string) {
  if (ticker) {
    ticker.disconnect();
  }

  ticker = new KiteTicker({
    api_key: config.kiteApiKey,
    access_token: accessToken,
  });

  ticker.on("connect", () => {
    console.log("[kite-ticker] connected");
    if (subscribedTokens.size > 0) {
      const tokens = Array.from(subscribedTokens);
      ticker!.subscribe(tokens);
      ticker!.setMode(ticker!.modeLTP, tokens);
    }
  });

  ticker.on("ticks", (ticks: Tick[]) => {
    for (const tick of ticks) {
      ltpCache.set(tick.instrument_token, tick.last_price);
    }
    tickerEvents.emit("ticks", ticks);
  });

  ticker.on("disconnect", (error: unknown) => {
    console.warn("[kite-ticker] disconnected", error);
  });

  ticker.on("error", (error: unknown) => {
    console.error("[kite-ticker] error", error);
  });

  ticker.connect();
}

export function subscribeTokens(tokens: number[]) {
  const newTokens = tokens.filter((t) => !subscribedTokens.has(t));
  newTokens.forEach((t) => subscribedTokens.add(t));

  if (newTokens.length > 0 && ticker && ticker.connected()) {
    ticker.subscribe(newTokens);
    ticker.setMode(ticker.modeLTP, newTokens);
  }
}

export function unsubscribeTokens(tokens: number[]) {
  tokens.forEach((t) => subscribedTokens.delete(t));
  if (ticker && ticker.connected()) {
    ticker.unsubscribe(tokens);
  }
}

export function isTickerConnected(): boolean {
  return ticker?.connected() ?? false;
}

export function stopTicker() {
  if (ticker) {
    ticker.disconnect();
    ticker = null;
  }
}
