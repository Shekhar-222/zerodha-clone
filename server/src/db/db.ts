import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * For any still-open position with no opened_at yet (pre-existing rows from before that
 * column existed), replay trade_history to find when it was *most recently* opened — the
 * last time its running quantity crossed from zero to non-zero — so a position that's been
 * closed and reopened gets today's re-entry time, not its very first-ever trade. No Kite API
 * involved, so this is cheap enough to just run on every startup; it no-ops once caught up.
 */
function backfillPositionOpenedAt() {
  const pending = db
    .prepare("SELECT COUNT(*) as cnt FROM positions WHERE quantity != 0 AND opened_at IS NULL")
    .get() as { cnt: number };
  if (pending.cnt === 0) return;

  const trades = db
    .prepare(
      `SELECT user_id, instrument_token, product, transaction_type, quantity, executed_at
       FROM trade_history
       ORDER BY user_id, instrument_token, product, executed_at ASC, id ASC`
    )
    .all() as {
    user_id: number;
    instrument_token: number;
    product: string;
    transaction_type: "BUY" | "SELL";
    quantity: number;
    executed_at: string;
  }[];

  const runningQty = new Map<string, number>();
  const lastOpenedAt = new Map<string, string>();

  for (const t of trades) {
    const key = `${t.user_id}::${t.instrument_token}::${t.product}`;
    const before = runningQty.get(key) ?? 0;
    const signed = t.transaction_type === "BUY" ? t.quantity : -t.quantity;
    const after = before + signed;
    runningQty.set(key, after);
    if (before === 0 && after !== 0) {
      lastOpenedAt.set(key, t.executed_at);
    }
  }

  const update = db.prepare(
    `UPDATE positions SET opened_at = ?
     WHERE user_id = ? AND instrument_token = ? AND product = ? AND opened_at IS NULL`
  );
  for (const [key, openedAt] of lastOpenedAt) {
    const [userId, instrumentToken, product] = key.split("::");
    update.run(openedAt, Number(userId), Number(instrumentToken), product);
  }

  // Any position with no matching trade_history at all (e.g. very old pre-history data) falls
  // back to its last-updated time so it still sorts sensibly instead of staying NULL forever.
  db.exec("UPDATE positions SET opened_at = updated_at WHERE quantity != 0 AND opened_at IS NULL");
}

function migrate() {
  const schema = fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);

  // Patch up databases created before F&O support (expiry/strike columns, NRML product).
  const instrumentCols = (db.prepare("PRAGMA table_info(instruments)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!instrumentCols.includes("expiry")) {
    db.exec("ALTER TABLE instruments ADD COLUMN expiry TEXT");
  }
  if (!instrumentCols.includes("strike")) {
    db.exec("ALTER TABLE instruments ADD COLUMN strike REAL");
  }

  const positionCols = (db.prepare("PRAGMA table_info(positions)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!positionCols.includes("margin_blocked")) {
    db.exec("ALTER TABLE positions ADD COLUMN margin_blocked REAL NOT NULL DEFAULT 0");
  }
  if (!positionCols.includes("opened_at")) {
    db.exec("ALTER TABLE positions ADD COLUMN opened_at TEXT");
  }
  backfillPositionOpenedAt();

  const tradeHistoryCols = (
    db.prepare("PRAGMA table_info(trade_history)").all() as { name: string }[]
  ).map((c) => c.name);
  if (tradeHistoryCols.length > 0 && !tradeHistoryCols.includes("charges")) {
    db.exec("ALTER TABLE trade_history ADD COLUMN charges REAL NOT NULL DEFAULT 0");
  }
  if (tradeHistoryCols.length > 0 && !tradeHistoryCols.includes("margin_used")) {
    db.exec("ALTER TABLE trade_history ADD COLUMN margin_used REAL");
  }

  const ordersTableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    .get() as { sql: string } | undefined;
  if (ordersTableSql && !ordersTableSql.sql.includes("'NRML'")) {
    // Renaming a table SQLite thinks other tables have a foreign key into triggers two
    // separate rewrite behaviors that both need to be disabled, not just one: foreign_keys
    // OFF alone still lets legacy_alter_table rewrite other tables' REFERENCES clauses (e.g.
    // trades.order_id) to point at the renamed table — confirmed by direct reproduction.
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    db.exec(`
      ALTER TABLE orders RENAME TO orders_old;
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tradingsymbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        instrument_token INTEGER NOT NULL,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('BUY','SELL')),
        order_type TEXT NOT NULL CHECK (order_type IN ('MARKET','LIMIT')),
        product TEXT NOT NULL CHECK (product IN ('MIS','CNC','NRML')),
        quantity INTEGER NOT NULL,
        price REAL,
        status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETE','CANCELLED','REJECTED')) DEFAULT 'OPEN',
        filled_price REAL,
        reject_reason TEXT,
        placed_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO orders SELECT * FROM orders_old;
      DROP TABLE orders_old;
      CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_orders_instrument ON orders(instrument_token);
    `);
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  // Patch up databases created before stop-loss order support (SL/SL-M order types +
  // trigger_price/triggered columns).
  const ordersTableSql2 = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    .get() as { sql: string } | undefined;
  if (ordersTableSql2 && !ordersTableSql2.sql.includes("'SL-M'")) {
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    db.exec(`
      ALTER TABLE orders RENAME TO orders_old;
      CREATE TABLE orders (
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
        placed_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO orders (id, user_id, tradingsymbol, exchange, instrument_token, transaction_type,
        order_type, product, quantity, price, status, filled_price, reject_reason, placed_at, updated_at)
      SELECT id, user_id, tradingsymbol, exchange, instrument_token, transaction_type,
        order_type, product, quantity, price, status, filled_price, reject_reason, placed_at, updated_at
      FROM orders_old;
      DROP TABLE orders_old;
      CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_orders_instrument ON orders(instrument_token);
    `);
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  // Patch up databases created before bracket order support (SL + target legs attached to
  // an entry order, linked via bracket_parent_id/bracket_role).
  const ordersTableSql3 = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    .get() as { sql: string } | undefined;
  if (ordersTableSql3 && !ordersTableSql3.sql.includes("bracket_parent_id")) {
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    db.exec(`
      ALTER TABLE orders RENAME TO orders_old;
      CREATE TABLE orders (
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
        bracket_stoploss REAL,
        bracket_target REAL,
        bracket_parent_id INTEGER REFERENCES orders(id),
        bracket_role TEXT CHECK (bracket_role IN ('SL','TARGET')),
        placed_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO orders (id, user_id, tradingsymbol, exchange, instrument_token, transaction_type,
        order_type, product, quantity, price, trigger_price, triggered, status, filled_price,
        reject_reason, placed_at, updated_at)
      SELECT id, user_id, tradingsymbol, exchange, instrument_token, transaction_type,
        order_type, product, quantity, price, trigger_price, triggered, status, filled_price,
        reject_reason, placed_at, updated_at
      FROM orders_old;
      DROP TABLE orders_old;
      CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_orders_instrument ON orders(instrument_token);
    `);
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  // Repair fallout from earlier migrations that ran before legacy_alter_table was known to
  // matter here: foreign_keys=OFF alone does not stop SQLite from rewriting *other* tables'
  // REFERENCES clauses to the renamed orders_old on an ALTER TABLE RENAME — only
  // legacy_alter_table=ON does. Detect and rebuild any table left pointing at orders_old.
  const danglingRefs = db.pragma("foreign_key_check") as { table: string; parent: string }[];
  const tablesToRepair = new Set(danglingRefs.filter((r) => r.parent === "orders_old").map((r) => r.table));
  if (tablesToRepair.has("trades")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      ALTER TABLE trades RENAME TO trades_old;
      CREATE TABLE trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        tradingsymbol TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO trades SELECT * FROM trades_old;
      DROP TABLE trades_old;
    `);
    db.pragma("foreign_keys = ON");
  }
  if (tablesToRepair.has("fund_transactions")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      ALTER TABLE fund_transactions RENAME TO fund_transactions_old;
      CREATE TABLE fund_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        order_id INTEGER REFERENCES orders(id),
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance_after REAL NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO fund_transactions SELECT * FROM fund_transactions_old;
      DROP TABLE fund_transactions_old;
      CREATE INDEX IF NOT EXISTS idx_fund_transactions_user ON fund_transactions(user_id, created_at);
    `);
    db.pragma("foreign_keys = ON");
  }
}

function seed() {
  const existing = db
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(config.defaultUserId);

  if (!existing) {
    db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)").run(
      config.defaultUserId,
      "trader@local",
      "Default Trader"
    );
    db.prepare(
      "INSERT INTO funds (user_id, available_balance, used_margin) VALUES (?, ?, 0)"
    ).run(config.defaultUserId, config.virtualCapital);
  }

  // Backfill a "starting capital" ledger entry for installs created before the fund
  // transaction log existed, so the statement always has a starting point.
  const hasDeposit = db
    .prepare("SELECT id FROM fund_transactions WHERE user_id = ? AND type = 'DEPOSIT' LIMIT 1")
    .get(config.defaultUserId);
  if (!hasDeposit) {
    db.prepare(
      `INSERT INTO fund_transactions (user_id, type, amount, balance_after, description)
       VALUES (?, 'DEPOSIT', ?, ?, 'Starting virtual capital')`
    ).run(config.defaultUserId, config.virtualCapital, config.virtualCapital);
  }
}

export function initDb() {
  migrate();
  seed();
}

// Every instrument the app needs live prices for — used to resubscribe the Kite ticker
// after a process/login restart, since the ticker itself has no memory of past subscriptions.
export function getAllTrackedInstrumentTokens(): number[] {
  const rows = db
    .prepare(
      `SELECT instrument_token FROM watchlist
       UNION
       SELECT instrument_token FROM positions WHERE quantity != 0
       UNION
       SELECT instrument_token FROM orders WHERE status = 'OPEN'`
    )
    .all() as { instrument_token: number }[];
  return rows.map((r) => r.instrument_token);
}
