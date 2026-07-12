import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

// База лежит в data/ (в .gitignore) — переживает перезапуски, не попадает в git.
// Используем встроенный node:sqlite (Node 22+): без нативных зависимостей.
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "tracker.db");

// В dev Next.js перезагружает модули — держим единственное соединение в globalThis.
const globalForDb = globalThis as unknown as { __trackerDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__trackerDb) return globalForDb.__trackerDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  globalForDb.__trackerDb = db;
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Сырые исполнения (fills) с биржи. exchange_fill_id уникален => идемпотентность синка.
    CREATE TABLE IF NOT EXISTS fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exchange_fill_id TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,              -- BUY | SELL
      position_side TEXT NOT NULL,     -- LONG | SHORT | BOTH
      price REAL NOT NULL,
      qty REAL NOT NULL,
      commission REAL NOT NULL DEFAULT 0,
      ts INTEGER NOT NULL,             -- unix ms, UTC
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fills_symbol_ts ON fills(symbol, position_side, ts);

    -- Записи income (фандинг и т.п.). Уникальность по бирже.
    CREATE TABLE IF NOT EXISTS income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exchange_income_id TEXT NOT NULL UNIQUE,
      income_type TEXT NOT NULL,       -- FUNDING_FEE | ...
      symbol TEXT NOT NULL,
      amount REAL NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_income_symbol_ts ON income(symbol, ts);

    -- Реконструированные сделки (round-trip). Пересобираются из fills детерминированно.
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_key TEXT NOT NULL UNIQUE,  -- symbol|positionSide|ts первого fill — стабильный ключ между пересборками
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,         -- long | short
      status TEXT NOT NULL,            -- open | closed
      qty REAL NOT NULL,               -- суммарный объём входа (в монетах)
      avg_entry REAL NOT NULL,
      avg_exit REAL,                   -- NULL пока открыта
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      realized_pnl REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      funding REAL NOT NULL DEFAULT 0,
      leverage REAL,
      fill_ids TEXT NOT NULL           -- JSON-массив id из fills (входы и выходы)
    );
    CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

    -- Заметки «почему зашёл»: привязаны к trade_key, переживают пересборку сделок.
    CREATE TABLE IF NOT EXISTS notes (
      trade_key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Снапшоты капитала для кривой.
    CREATE TABLE IF NOT EXISTS equity_snapshots (
      ts INTEGER PRIMARY KEY,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      unrealized_pnl REAL NOT NULL
    );

    -- Кэш свечей: страница сделки работает без сети.
    CREATE TABLE IF NOT EXISTS candles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      ts INTEGER NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (symbol, interval, ts)
    );

    -- Открытые позиции (последний снапшот с биржи).
    CREATE TABLE IF NOT EXISTS positions (
      symbol TEXT NOT NULL,
      position_side TEXT NOT NULL,
      qty REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      leverage REAL,
      opened_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (symbol, position_side)
    );

    -- Служебное состояние синхронизации.
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // v1.1: сделки из истории позиций биржи (источник истины).
  const tradeCols = (db.prepare("PRAGMA table_info(trades)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!tradeCols.includes("position_id")) {
    db.exec("ALTER TABLE trades ADD COLUMN position_id TEXT");
  }
  if (!tradeCols.includes("margin_mode")) {
    db.exec("ALTER TABLE trades ADD COLUMN margin_mode TEXT");
  }
  if (!tradeCols.includes("net_profit")) {
    // Итог сделки по данным биржи (Realized PnL BingX). Если есть — источник
    // истины для «чистого PnL» вместо нашей формулы.
    db.exec("ALTER TABLE trades ADD COLUMN net_profit REAL");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id) WHERE position_id IS NOT NULL",
  );

  // v1.1-фикс: режим маржи текущих позиций (для открытых сделок).
  const posCols = (db.prepare("PRAGMA table_info(positions)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!posCols.includes("margin_mode")) {
    db.exec("ALTER TABLE positions ADD COLUMN margin_mode TEXT");
  }
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

// Скрытые инструменты: сделки по ним не показываются в списках и статистике.
// Скрываем, а не удаляем — синхронизация иначе пересоздала бы их из fills.
export function getHiddenSymbols(): string[] {
  const raw = getSetting("hidden_symbols");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function setHiddenSymbols(symbols: string[]) {
  setSetting("hidden_symbols", JSON.stringify([...new Set(symbols)].sort()));
}

export function getSyncState(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSyncState(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
