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
    rebuildTrades();
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
    `INSERT INTO positions (symbol, position_side, qty, entry_price, mark_price, unrealized_pnl, leverage, opened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of positions) {
    ins.run(p.symbol, p.positionSide, p.qty, p.entryPrice, p.markPrice, p.unrealizedPnl, p.leverage, p.openedAt, now);
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
