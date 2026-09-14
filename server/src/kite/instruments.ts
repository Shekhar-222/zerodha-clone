import { kite } from "./kiteClient";
import { db } from "../db/db";

// NSE/BSE equities, NFO F&O, and MCX commodities (crude oil, gold, silver, etc.).
// Currency derivatives (CDS) are still out of scope.
const SUPPORTED_EXCHANGES = ["NSE", "BSE", "NFO", "MCX"];
const SUPPORTED_INSTRUMENT_TYPES = new Set(["EQ", "FUT", "CE", "PE"]);

// Bump this whenever the set of synced exchanges/instrument types changes, so existing
// installs re-sync instead of trusting a stale "already have rows" cache.
const SYNC_VERSION = "3";

function getMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setMeta(key: string, value: string) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value
  );
}

function toIsoDate(expiry: unknown): string | null {
  if (expiry instanceof Date && !isNaN(expiry.getTime())) {
    return expiry.toISOString().slice(0, 10);
  }
  return null;
}

export async function syncInstrumentsIfNeeded(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const marker = `${SYNC_VERSION}:${today}`;
  if (getMeta("instruments_synced") === marker) return;

  const instrumentLists = await Promise.all(
    SUPPORTED_EXCHANGES.map((exchange) => kite.getInstruments(exchange))
  );
  const instruments = instrumentLists.flat();

  const insert = db.prepare(
    `INSERT INTO instruments (instrument_token, tradingsymbol, exchange, name, lot_size, tick_size, instrument_type, segment, expiry, strike)
     VALUES (@instrument_token, @tradingsymbol, @exchange, @name, @lot_size, @tick_size, @instrument_type, @segment, @expiry, @strike)
     ON CONFLICT(instrument_token) DO UPDATE SET
       tradingsymbol = excluded.tradingsymbol,
       exchange = excluded.exchange,
       name = excluded.name,
       lot_size = excluded.lot_size,
       tick_size = excluded.tick_size,
       instrument_type = excluded.instrument_type,
       segment = excluded.segment,
       expiry = excluded.expiry,
       strike = excluded.strike`
  );

  const insertMany = db.transaction((rows: any[]) => {
    for (const r of rows) {
      if (!SUPPORTED_INSTRUMENT_TYPES.has(r.instrument_type)) continue;
      insert.run({
        instrument_token: r.instrument_token,
        tradingsymbol: r.tradingsymbol,
        exchange: r.exchange,
        name: r.name,
        lot_size: r.lot_size,
        tick_size: r.tick_size,
        instrument_type: r.instrument_type,
        segment: r.segment,
        expiry: toIsoDate(r.expiry),
        strike: r.strike || null,
      });
    }
  });

  insertMany(instruments as any[]);
  setMeta("instruments_synced", marker);
}

const SEARCH_FIELDS =
  "instrument_token, tradingsymbol, exchange, name, instrument_type, expiry, strike, lot_size";

const CONTRACT_TYPE_KEYWORDS = new Set(["CE", "PE", "FUT"]);

export function searchInstruments(query: string, limit = 20) {
  let tokens = query.toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // A trailing "CE"/"PE"/"FUT" almost always means "options/futures contracts for X",
  // not "a symbol containing the letters CE/PE/FUT" (e.g. RELIANCE contains "CE").
  // Treat it as an exact instrument_type filter instead of a substring match.
  let instrumentTypeFilter: string | null = null;
  if (tokens.length > 1 && CONTRACT_TYPE_KEYWORDS.has(tokens[tokens.length - 1])) {
    instrumentTypeFilter = tokens[tokens.length - 1];
    tokens = tokens.slice(0, -1);
  }

  const conditions = tokens.map(() => `(tradingsymbol LIKE ? OR name LIKE ?)`).join(" AND ");
  const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`]);

  const exact = tokens.join("");
  const startsWith = `${tokens[0]}%`;

  const whereClause = instrumentTypeFilter ? `(${conditions}) AND instrument_type = ?` : conditions;
  const whereParams = instrumentTypeFilter ? [...params, instrumentTypeFilter] : params;

  return db
    .prepare(
      `SELECT ${SEARCH_FIELDS} FROM instruments
       WHERE ${whereClause}
       ORDER BY
         CASE
           WHEN tradingsymbol = ? THEN 0
           WHEN tradingsymbol LIKE ? THEN 1
           ELSE 2
         END,
         CASE instrument_type
           WHEN 'EQ' THEN 0
           WHEN 'FUT' THEN 1
           ELSE 2
         END,
         expiry,
         strike,
         LENGTH(tradingsymbol),
         tradingsymbol
       LIMIT ?`
    )
    .all(...whereParams, exact, startsWith, limit);
}

export function getInstrumentBySymbol(exchange: string, tradingsymbol: string) {
  return db
    .prepare(
      "SELECT instrument_token, tradingsymbol, exchange FROM instruments WHERE exchange = ? AND tradingsymbol = ?"
    )
    .get(exchange, tradingsymbol) as { instrument_token: number; tradingsymbol: string; exchange: string } | undefined;
}

export function getInstrumentByToken(token: number) {
  return db
    .prepare(
      `SELECT instrument_token, tradingsymbol, exchange, name, lot_size, tick_size, instrument_type, expiry, strike
       FROM instruments WHERE instrument_token = ?`
    )
    .get(token);
}

// Kite's option/future "name" field for indices doesn't match the index's own tradingsymbol
// (e.g. the NIFTY 50 index vs. "NIFTY" futures/options) — equities don't have this problem
// since a stock's options are named after its own tradingsymbol.
const INDEX_UNDERLYING_ALIAS: Record<string, string> = {
  "NIFTY 50": "NIFTY",
  "NIFTY BANK": "BANKNIFTY",
  "NIFTY FIN SERVICE": "FINNIFTY",
  "NIFTY MIDCAP SELECT": "MIDCPNIFTY",
  "NIFTY NEXT 50": "NIFTYNXT50",
};

export function resolveUnderlyingName(tradingsymbol: string): string {
  return INDEX_UNDERLYING_ALIAS[tradingsymbol] ?? tradingsymbol;
}

export function getOptionExpiries(underlyingName: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT expiry FROM instruments
         WHERE name = ? AND instrument_type IN ('CE','PE') AND expiry IS NOT NULL
         ORDER BY expiry`
      )
      .all(underlyingName) as { expiry: string }[]
  ).map((r) => r.expiry);
}

export function getOptionChain(underlyingName: string, expiry: string) {
  return db
    .prepare(
      `SELECT instrument_token, tradingsymbol, exchange, instrument_type, strike, lot_size
       FROM instruments
       WHERE name = ? AND expiry = ? AND instrument_type IN ('CE','PE')
       ORDER BY strike`
    )
    .all(underlyingName, expiry) as {
    instrument_token: number;
    tradingsymbol: string;
    exchange: string;
    instrument_type: "CE" | "PE";
    strike: number;
    lot_size: number;
  }[];
}
