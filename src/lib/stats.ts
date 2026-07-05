import { getDb, getHiddenSymbols } from "./db";

// SQL-фрагмент для исключения скрытых инструментов + параметры к нему.
export function hiddenFilter(): { clause: string; params: string[] } {
  const hidden = getHiddenSymbols();
  if (hidden.length === 0) return { clause: "", params: [] };
  return { clause: ` AND symbol NOT IN (${hidden.map(() => "?").join(",")})`, params: hidden };
}

export interface PeriodStats {
  period: number;                 // дней
  totalPnl: number;               // реализованный PnL с учётом комиссий и фандинга
  pnlPercent: number | null;      // % от капитала на начало периода (null если нет снапшота)
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;         // null если сделок нет
  profitFactor: number | null;    // null если нет сделок; Infinity => отдаём null + флаг
  profitFactorDisplay: string;    // "1.85" | "∞" | "—"
  avgWin: number | null;
  avgLoss: number | null;
  totalCommission: number;
  totalFunding: number;
}

export interface TradeRow {
  id: number;
  trade_key: string;
  symbol: string;
  direction: string;
  status: string;
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  opened_at: number;
  closed_at: number | null;
  realized_pnl: number;
  commission: number;
  funding: number;
  leverage: number | null;
  fill_ids: string;
  has_note?: number;
  note?: string | null;
}

/** Чистый результат сделки: ценовой PnL + фандинг (со знаком биржи) - комиссия. */
export function netPnl(t: { realized_pnl: number; commission: number; funding: number }): number {
  return t.realized_pnl - t.commission + t.funding;
}

export function getPeriodStats(days: number): PeriodStats {
  const db = getDb();
  const since = Date.now() - days * 86_400_000;

  const hf = hiddenFilter();
  const trades = db
    .prepare(`SELECT * FROM trades WHERE status = 'closed' AND closed_at >= ?${hf.clause}`)
    .all(since, ...hf.params) as unknown as TradeRow[];

  const results = trades.map(netPnl);
  const wins = results.filter((r) => r > 0);
  const losses = results.filter((r) => r <= 0);
  const grossProfit = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  const totalPnl = results.reduce((s, r) => s + r, 0);

  // Капитал на начало периода — ближайший снапшот до since (или первый после).
  const startEquity =
    (db.prepare("SELECT equity FROM equity_snapshots WHERE ts <= ? ORDER BY ts DESC LIMIT 1").get(since) as
      | { equity: number }
      | undefined) ??
    (db.prepare("SELECT equity FROM equity_snapshots WHERE ts > ? ORDER BY ts ASC LIMIT 1").get(since) as
      | { equity: number }
      | undefined);

  let profitFactor: number | null = null;
  let profitFactorDisplay = "—";
  if (trades.length > 0) {
    if (grossLoss > 0) {
      profitFactor = grossProfit / grossLoss;
      profitFactorDisplay = profitFactor.toFixed(2);
    } else if (grossProfit > 0) {
      profitFactorDisplay = "∞"; // нет убыточных сделок — единообразно показываем ∞ (спека, крайние случаи)
    }
  }

  return {
    period: days,
    totalPnl,
    pnlPercent: startEquity && startEquity.equity > 0 ? (totalPnl / startEquity.equity) * 100 : null,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : null,
    profitFactor,
    profitFactorDisplay,
    avgWin: wins.length > 0 ? grossProfit / wins.length : null,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    totalCommission: trades.reduce((s, t) => s + t.commission, 0),
    totalFunding: trades.reduce((s, t) => s + t.funding, 0),
  };
}

export function getEquityCurve(days: number): Array<{ ts: number; equity: number }> {
  const since = Date.now() - days * 86_400_000;
  return getDb()
    .prepare("SELECT ts, equity FROM equity_snapshots WHERE ts >= ? ORDER BY ts")
    .all(since) as unknown as Array<{ ts: number; equity: number }>;
}

export function getCurrentEquity(): { balance: number; equity: number; unrealized_pnl: number; ts: number } | null {
  return (getDb()
    .prepare("SELECT ts, balance, equity, unrealized_pnl FROM equity_snapshots ORDER BY ts DESC LIMIT 1")
    .get() ?? null) as { balance: number; equity: number; unrealized_pnl: number; ts: number } | null;
}
