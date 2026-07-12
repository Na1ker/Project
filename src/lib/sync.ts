import { getDb, getSetting, getSyncState, setSyncState } from "./db";
import { BingxConnector } from "./exchange/bingx";
import { ExchangeAuthError, ExchangeConnector, ExchangeRateLimitError } from "./exchange/types";
import { FillRow, reconstructGroup } from "./trades";

const SYNC_INTERVAL_MS = 60_000;              // спека: каждые 60 секунд
const HISTORY_DEPTH_MS = 200 * 86_400_000;    // первый синк: 200 дней (>180 по спеке)
const WINDOW_MS = 6.5 * 86_400_000;           // окна запросов < 7 дней (лимит API)

const globalForSync = globalThis as unknown as {
  __syncTimer?: ReturnType<typeof setInterval>;
  __syncRunning?: boolean;
  __backoffUntil?: number;
  __backoffMs?: number;
};

export function getConnector(): ExchangeConnector | null {
  const key = getSetting("bingx_api_key");
  const secret = getSetting("bingx_api_secret");
  if (!key || !secret) return null;
  return new BingxConnector(key, secret);
}

export function startSyncLoop() {
  if (globalForSync.__syncTimer) return;
  // Первый запуск сразу, дальше каждую минуту.
  void runSync();
  globalForSync.__syncTimer = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
}

export type SyncStatus = {
  lastSyncAt: number | null;
  lastError: string | null;
  authOk: boolean;
  initialSyncDone: boolean;
};

export function getSyncStatus(): SyncStatus {
  return {
    lastSyncAt: Number(getSyncState("last_sync_at")) || null,
    lastError: getSyncState("last_error") || null,
    authOk: getSyncState("auth_ok") !== "false",
    initialSyncDone: getSyncState("initial_sync_done") === "true",
  };
}

export async function runSync(): Promise<void> {
  if (globalForSync.__syncRunning) return;
  // Экспоненциальный backoff после rate limit: пропускаем циклы.
  if (globalForSync.__backoffUntil && Date.now() < globalForSync.__backoffUntil) return;

  const connector = getConnector();
  if (!connector) return; // ключи ещё не введены — онбординг

  globalForSync.__syncRunning = true;
  try {
    await syncBalanceAndPositions(connector);
    await syncFillsAndIncome(connector);
    if (connector.getPositionHistory) {
      // v1.1: источник истины — история позиций биржи. Реконструкция из fills
      // не запускается (остаётся резервом для бирж без такого API).
      await syncPositionHistory(connector);
      syncOpenTrades();
      migrateFillsTrades();
    } else {
      rebuildTrades();
    }
    setSyncState("last_sync_at", String(Date.now()));
    setSyncState("last_error", "");
    setSyncState("auth_ok", "true");
    globalForSync.__backoffMs = 0;
  } catch (e) {
    if (e instanceof ExchangeAuthError) {
      setSyncState("auth_ok", "false");
      setSyncState("last_error", "Неверный или просроченный API-ключ BingX");
    } else if (e instanceof ExchangeRateLimitError) {
      const prev = globalForSync.__backoffMs ?? 0;
      const next = Math.min(prev ? prev * 2 : 2 * SYNC_INTERVAL_MS, 30 * 60_000);
      globalForSync.__backoffMs = next;
      globalForSync.__backoffUntil = Date.now() + next;
      setSyncState("last_error", "Rate limit BingX — синхронизация приостановлена");
    } else {
      setSyncState("last_error", e instanceof Error ? e.message : String(e));
    }
  } finally {
    globalForSync.__syncRunning = false;
  }
}

async function syncBalanceAndPositions(connector: ExchangeConnector) {
  const db = getDb();
  const balance = await connector.getBalance();
  const now = Date.now();

  // Внутридневной снапшот капитала при каждом цикле (требование 7).
  db.prepare(
    "INSERT INTO equity_snapshots (ts, balance, equity, unrealized_pnl) VALUES (?, ?, ?, ?) ON CONFLICT(ts) DO NOTHING",
  ).run(now, balance.balance, balance.equity, balance.unrealizedPnl);

  const positions = await connector.getOpenPositions();
  db.exec("DELETE FROM positions");
  const ins = db.prepare(
    `INSERT INTO positions (symbol, position_side, qty, entry_price, mark_price, unrealized_pnl, leverage, margin_mode, opened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of positions) {
    ins.run(p.symbol, p.positionSide, p.qty, p.entryPrice, p.markPrice, p.unrealizedPnl, p.leverage, p.marginMode, p.openedAt, now);
  }
}

async function syncFillsAndIncome(connector: ExchangeConnector) {
  const db = getDb();
  const now = Date.now();

  // Догоняем с места последнего успешного окна (обрыв синка не оставляет дыр:
  // курсор двигается только после успешной записи окна).
  const cursorRaw = getSyncState("fills_cursor");
  let cursor = cursorRaw ? Number(cursorRaw) : now - HISTORY_DEPTH_MS;
  // Перекрытие 1 час на случай поздно опубликованных биржей записей; дубли отсекает UNIQUE.
  cursor = Math.max(cursor - 3_600_000, now - HISTORY_DEPTH_MS);

  const insFill = db.prepare(
    `INSERT INTO fills (exchange_fill_id, order_id, symbol, side, position_side, price, qty, commission, ts, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(exchange_fill_id) DO NOTHING`,
  );
  const insIncome = db.prepare(
    `INSERT INTO income (exchange_income_id, income_type, symbol, amount, ts)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(exchange_income_id) DO NOTHING`,
  );

  while (cursor < now) {
    const windowEnd = Math.min(cursor + WINDOW_MS, now);
    const [fills, income] = await Promise.all([
      connector.getFills(cursor, windowEnd),
      connector.getIncome(cursor, windowEnd),
    ]);
    for (const f of fills) {
      insFill.run(f.fillId, f.orderId, f.symbol, f.side, f.positionSide, f.price, f.qty, f.commission, f.ts, JSON.stringify(f.raw ?? null));
    }
    for (const r of income) {
      insIncome.run(r.incomeId, r.type, r.symbol, r.amount, r.ts);
    }
    cursor = windowEnd;
    setSyncState("fills_cursor", String(cursor));
  }
  setSyncState("initial_sync_done", "true");
}

/**
 * v1.1: синхронизация истории закрытых позиций — источник истины для сделок.
 * Курсор двигается только после успешной записи окна (обрыв не оставляет дыр).
 */
async function syncPositionHistory(connector: ExchangeConnector) {
  if (!connector.getPositionHistory) return;
  const db = getDb();
  const now = Date.now();

  // BingX отдаёт историю только по символу — берём все инструменты из
  // исполнений, текущих позиций И income (фандинга): fills бывают неполными,
  // а фандинг начисляется по любой удерживаемой позиции, так что income
  // покрывает инструменты, потерянные allFillOrders (фикс из ревью v1.1).
  const symbols = (db
    .prepare(
      `SELECT DISTINCT symbol FROM fills WHERE symbol != ''
       UNION SELECT DISTINCT symbol FROM positions WHERE symbol != ''
       UNION SELECT DISTINCT symbol FROM income WHERE symbol != ''`,
    )
    .all() as Array<{ symbol: string }>).map((r) => r.symbol);

  const upsert = db.prepare(
    `INSERT INTO trades (trade_key, position_id, symbol, direction, status, qty, avg_entry, avg_exit,
       opened_at, closed_at, realized_pnl, commission, funding, leverage, margin_mode, net_profit, fill_ids)
     VALUES (?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
     ON CONFLICT(trade_key) DO UPDATE SET
       qty = excluded.qty, avg_entry = excluded.avg_entry, avg_exit = excluded.avg_exit,
       opened_at = excluded.opened_at, closed_at = excluded.closed_at,
       realized_pnl = excluded.realized_pnl, commission = excluded.commission,
       funding = excluded.funding, leverage = excluded.leverage,
       margin_mode = excluded.margin_mode, net_profit = excluded.net_profit`,
  );
  const sumFunding = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM income
     WHERE income_type = 'FUNDING_FEE' AND symbol = ? AND ts >= ? AND ts <= ?`,
  );
  const sumFillCommission = db.prepare(
    `SELECT COALESCE(SUM(commission), 0) AS s FROM fills
     WHERE symbol = ? AND ts >= ? AND ts <= ?`,
  );

  // Окно проверено на живом API: 30 дней работает; берём 25 с запасом.
  const POSITION_WINDOW_MS = 25 * 86_400_000;

  for (const symbol of symbols) {
    const cursorKey = `positions_cursor|${symbol}`;
    const cursorRaw = getSyncState(cursorKey);
    let cursor = cursorRaw ? Number(cursorRaw) : now - HISTORY_DEPTH_MS;
    // Перекрытие 1 час: позиция попадает в историю в момент закрытия.
    cursor = Math.max(cursor - 3_600_000, now - HISTORY_DEPTH_MS);

    while (cursor < now) {
      const windowEnd = Math.min(cursor + POSITION_WINDOW_MS, now);
      const positions = await connector.getPositionHistory(symbol, cursor, windowEnd);
      for (const p of positions) {
        // Чего эндпоинт не отдал — дополняем из fills/income (требование 2 спеки).
        const commission =
          p.commission > 0
            ? p.commission
            : (sumFillCommission.get(p.symbol, p.openedAt - 60_000, p.closedAt + 60_000) as { s: number }).s;
        const funding =
          p.funding !== 0 ? p.funding : (sumFunding.get(p.symbol, p.openedAt, p.closedAt) as { s: number }).s;
        upsert.run(
          `pos|${p.positionId}`, p.positionId, p.symbol, p.direction, p.qty, p.avgEntry,
          p.avgExit, p.openedAt, p.closedAt, p.realizedPnl, commission, funding,
          p.leverage, p.marginMode, p.netProfit,
        );
      }
      cursor = windowEnd;
      setSyncState(cursorKey, String(cursor));
    }
  }
}

/**
 * v1.1: открытые сделки создаются из снапшота текущих позиций (в истории
 * позиций их ещё нет). Ключ стабилен, пока позиция открыта; после закрытия
 * запись удаляется (закрытая сделка приходит из истории позиций без дублей).
 */
function syncOpenTrades() {
  const db = getDb();
  const positions = db.prepare("SELECT * FROM positions").all() as Array<{
    symbol: string;
    position_side: string;
    qty: number;
    entry_price: number;
    leverage: number | null;
    margin_mode: string | null;
    opened_at: number | null;
    updated_at: number;
  }>;

  const upsert = db.prepare(
    `INSERT INTO trades (trade_key, position_id, symbol, direction, status, qty, avg_entry, avg_exit,
       opened_at, closed_at, realized_pnl, commission, funding, leverage, margin_mode, net_profit, fill_ids)
     VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, ?, NULL, 0, 0, 0, ?, ?, NULL, '[]')
     ON CONFLICT(trade_key) DO UPDATE SET
       qty = excluded.qty, avg_entry = excluded.avg_entry, leverage = excluded.leverage,
       margin_mode = excluded.margin_mode, opened_at = excluded.opened_at`,
  );

  const liveKeys: string[] = [];
  for (const p of positions) {
    const direction = p.position_side === "SHORT" ? "short" : "long";
    const key = `open|${p.symbol}|${p.position_side}`;
    upsert.run(key, `open|${p.symbol}|${p.position_side}`, p.symbol, direction, p.qty, p.entry_price, p.opened_at ?? p.updated_at, p.leverage, p.margin_mode);
    liveKeys.push(key);
  }

  // Позиции, которых больше нет на бирже: переносим заметку на закрытую сделку
  // из истории позиций (тот же матчинг ±5 минут, что и в миграции) и удаляем.
  const stale = db
    .prepare(`SELECT trade_key, symbol, opened_at FROM trades WHERE status = 'open' AND trade_key LIKE 'open|%'`)
    .all() as Array<{ trade_key: string; symbol: string; opened_at: number }>;
  for (const t of stale) {
    if (liveKeys.includes(t.trade_key)) continue;
    migrateNote(t.trade_key, t.symbol, t.opened_at);
    db.prepare("DELETE FROM trades WHERE trade_key = ?").run(t.trade_key);
  }
}

/** Перенос заметки на позиционную сделку того же инструмента с открытием ±5 минут. */
function migrateNote(oldKey: string, symbol: string, openedAt: number) {
  const db = getDb();
  const note = db.prepare("SELECT text, updated_at FROM notes WHERE trade_key = ?").get(oldKey) as
    | { text: string; updated_at: number }
    | undefined;
  if (!note) return;
  const target = db
    .prepare(
      `SELECT trade_key FROM trades
       WHERE position_id IS NOT NULL AND trade_key LIKE 'pos|%' AND symbol = ? AND ABS(opened_at - ?) <= 300000
       LIMIT 1`,
    )
    .get(symbol, openedAt) as { trade_key: string } | undefined;
  if (!target) return; // заметка остаётся в базе под старым ключом (спека: не удаляем)
  db.prepare(
    `INSERT INTO notes (trade_key, text, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(trade_key) DO NOTHING`,
  ).run(target.trade_key, note.text, note.updated_at);
}

/**
 * v1.1, разовая миграция: сделки, реконструированные из fills в v1
 * (trade_key без префиксов pos|/open|), заменяются историей позиций.
 * Заметки переносятся по инструменту и времени открытия ±5 минут.
 */
function migrateFillsTrades() {
  const db = getDb();
  const old = db
    .prepare(
      `SELECT trade_key, symbol, opened_at FROM trades
       WHERE position_id IS NULL AND trade_key NOT LIKE 'pos|%' AND trade_key NOT LIKE 'open|%'`,
    )
    .all() as Array<{ trade_key: string; symbol: string; opened_at: number }>;
  for (const t of old) {
    migrateNote(t.trade_key, t.symbol, t.opened_at);
    db.prepare("DELETE FROM trades WHERE trade_key = ?").run(t.trade_key);
  }
}

/**
 * Полная детерминированная пересборка сделок из fills.
 * trade_key стабилен (symbol|side|ts первого входа), поэтому заметки,
 * привязанные к trade_key, переживают пересборку.
 */
export function rebuildTrades() {
  const db = getDb();
  const fills = db
    .prepare("SELECT id, symbol, side, position_side, price, qty, commission, ts FROM fills ORDER BY ts, id")
    .all() as unknown as FillRow[];

  const groups = new Map<string, FillRow[]>();
  for (const f of fills) {
    const key = `${f.symbol}|${f.position_side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const sumFunding = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM income
     WHERE income_type = 'FUNDING_FEE' AND symbol = ? AND ts >= ? AND ts <= ?`,
  );

  const upsert = db.prepare(
    `INSERT INTO trades (trade_key, symbol, direction, status, qty, avg_entry, avg_exit, opened_at, closed_at, realized_pnl, commission, funding, leverage, fill_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(trade_key) DO UPDATE SET
       status = excluded.status, qty = excluded.qty, avg_entry = excluded.avg_entry,
       avg_exit = excluded.avg_exit, closed_at = excluded.closed_at,
       realized_pnl = excluded.realized_pnl, commission = excluded.commission,
       funding = excluded.funding, fill_ids = excluded.fill_ids`,
  );

  const seenKeys: string[] = [];
  db.exec("BEGIN");
  try {
    for (const groupFills of groups.values()) {
      for (const t of reconstructGroup(groupFills)) {
        const fundingEnd = t.closedAt ?? Date.now();
        const funding = (sumFunding.get(t.symbol, t.openedAt, fundingEnd) as { s: number }).s;
        upsert.run(
          t.tradeKey, t.symbol, t.direction, t.status, t.qty, t.avgEntry, t.avgExit,
          t.openedAt, t.closedAt, t.realizedPnl, t.commission, funding,
          JSON.stringify(t.fillIds),
        );
        seenKeys.push(t.tradeKey);
      }
    }
    // Сделки, исчезнувшие после пересборки (не должно случаться, но на всякий случай).
    if (seenKeys.length > 0) {
      const placeholders = seenKeys.map(() => "?").join(",");
      db.prepare(`DELETE FROM trades WHERE trade_key NOT IN (${placeholders})`).run(...seenKeys);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
