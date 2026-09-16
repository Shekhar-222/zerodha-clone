CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kite_sessions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  access_token TEXT,
  public_token TEXT,
  login_time TEXT
);

CREATE TABLE IF NOT EXISTS funds (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  available_balance REAL NOT NULL,
  used_margin REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS instruments (
  instrument_token INTEGER PRIMARY KEY,
  tradingsymbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  name TEXT,
  lot_size INTEGER NOT NULL DEFAULT 1,
  tick_size REAL NOT NULL DEFAULT 0.05,
  instrument_type TEXT,
  segment TEXT,
  expiry TEXT,
  strike REAL
);
CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(tradingsymbol);

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tradingsymbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  instrument_token INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, instrument_token)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tradingsymbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  instrument_token INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('BUY','SELL')),
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET','LIMIT','SL','SL-M')),
  product TEXT NOT NULL CHECK (product IN ('MIS','CNC','NRML')),
  quantity INTEGER NOT NULL,
  price REAL,
  trigger_price REAL,
  triggered INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETE','CANCELLED','REJECTED')) DEFAULT 'OPEN',
  filled_price REAL,
  reject_reason TEXT,
  -- Bracket order support: an entry order carries the requested exit prices until it fills;
  -- its two child exit legs (created at fill time) point back via bracket_parent_id and are
  -- tagged SL/TARGET so whichever fills first can cancel the other (one-cancels-other).
  bracket_stoploss REAL,
  bracket_target REAL,
  bracket_parent_id INTEGER REFERENCES orders(id),
  bracket_role TEXT CHECK (bracket_role IN ('SL','TARGET')),
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_instrument ON orders(instrument_token);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  tradingsymbol TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Permanent record of every fill, independent of `orders`/`trades` — those two are wiped
-- nightly to mirror Kite's Orders page (current trading day only), but this table is never
-- touched, so trade timing/history stays available indefinitely.
CREATE TABLE IF NOT EXISTS trade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tradingsymbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  instrument_token INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  order_type TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  charges REAL NOT NULL DEFAULT 0,
  -- F&O only: the margin blocked for the resulting position immediately after this fill (NULL
  -- for equity, which doesn't block margin the same way). Captured at fill time going forward;
  -- older rows get it filled in later by a one-off backfill script using today's margin rates
  -- as an approximation, since Kite has no historical margin-rate lookup.
  margin_used REAL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trade_history_user ON trade_history(user_id, executed_at);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tradingsymbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  instrument_token INTEGER NOT NULL,
  product TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_price REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  margin_blocked REAL NOT NULL DEFAULT 0,
  -- When this position was most recently opened (went from flat to non-zero) — reset on every
  -- fresh entry, including a re-entry after a full close, so the Positions tab can show
  -- positions oldest-entry-first regardless of a row's original `id`.
  opened_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, instrument_token, product)
);

CREATE TABLE IF NOT EXISTS fund_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_transactions_user ON fund_transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tradingsymbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  instrument_token INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_price REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, instrument_token)
);
