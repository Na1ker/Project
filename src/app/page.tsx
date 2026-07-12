"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EquityChart } from "@/components/EquityChart";
import { fmtDateTime, fmtDuration, fmtMoney, fmtPercent, fmtPrice, fmtQty, pnlColor } from "@/lib/format";

const PERIODS = [7, 30, 90, 180] as const;

interface Stats {
  period: number;
  totalPnl: number;
  pnlPercent: number | null;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactorDisplay: string;
  avgWin: number | null;
  avgLoss: number | null;
  totalCommission: number;
  totalFunding: number;
}

interface Position {
  symbol: string;
  position_side: string;
  qty: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  leverage: number | null;
  opened_at: number | null;
}

interface OpenTrade {
  id: number;
  symbol: string;
  direction: string;
}

interface StatusInfo {
  hasKeys: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  authOk: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const [period, setPeriod] = useState<number>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [equityCurve, setEquityCurve] = useState<Array<{ ts: number; equity: number }>>([]);
  const [currentEquity, setCurrentEquity] = useState<{ equity: number; balance: number; unrealized_pnl: number } | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
  const [status, setStatus] = useState<StatusInfo | null>(null);

  const load = useCallback(() => {
    fetch(`/api/stats?period=${period}`)
      .then((r) => r.json())
      .then((d) => {
        setStats(d.stats);
        setEquityCurve(d.equityCurve ?? []);
        setCurrentEquity(d.currentEquity);
      })
      .catch(() => {});
    fetch("/api/positions").then((r) => r.json()).then((d) => setPositions(d.positions ?? [])).catch(() => {});
    fetch("/api/trades?status=open").then((r) => r.json()).then((d) => setOpenTrades(d.trades ?? [])).catch(() => {});
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, [period]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Онбординг: ключи не введены — форма вместо пустого дашборда с нулями.
  useEffect(() => {
    if (status && !status.hasKeys) router.replace("/settings?onboarding=1");
  }, [status, router]);

  if (status && !status.hasKeys) return null;

  return (
    <div className="space-y-6">
      {/* Баннер проблем с BingX: приложение живо, показывает данные из базы */}
      {status && (!status.authOk || status.lastError) && (
        <div className="card px-5 py-4 border-l-4 !border-l-loss flex items-center gap-3">
          <span className="text-loss text-lg">⚠</span>
          <div>
            <div className="font-medium">
              {!status.authOk ? "Нет соединения с BingX — проверь API-ключи" : "Проблема с синхронизацией"}
            </div>
            <div className="text-sm text-muted">
              {status.lastError || "Показаны данные из локальной базы."}{" "}
              <Link href="/settings" className="text-accent-bright hover:underline">Настройки →</Link>
            </div>
          </div>
        </div>
      )}

      {/* Главная связка по скетчу v1.1: слева большая кривая капитала (1),
          справа колонка с капиталом и метриками (2). Над графиком — ничего. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 card p-5 rise-in">
          <div className="text-sm text-muted mb-3">Кривая капитала · {period} дн</div>
          <EquityChart data={equityCurve} height={440} />
        </div>

        <div className="space-y-4">
          <div className="card px-5 py-4 rise-in" style={{ "--rise-delay": "40ms" } as React.CSSProperties}>
            <div className="text-xs text-muted uppercase tracking-wider mb-1.5">Общий капитал</div>
            <div className="text-3xl font-semibold num">
              {currentEquity ? `${currentEquity.equity.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT` : "—"}
            </div>
            {currentEquity && (
              <div className="text-sm text-muted mt-1 num">
                баланс {currentEquity.balance.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ·{" "}
                нереализ. PnL{" "}
                <span className={pnlColor(currentEquity.unrealized_pnl)}>{fmtMoney(currentEquity.unrealized_pnl)}</span>
              </div>
            )}
          </div>

          <div className="flex gap-1 card p-1 rise-in" style={{ "--rise-delay": "80ms" } as React.CSSProperties}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 px-3 py-1.5 rounded-xl text-sm pressable ${
                  period === p ? "bg-accent text-white" : "text-muted hover:text-white"
                }`}
              >
                {p} дн
              </button>
            ))}
          </div>

          {stats && stats.trades === 0 ? (
            <div className="card px-5 py-8 text-center text-muted text-sm rise-in" style={{ "--rise-delay": "120ms" } as React.CSSProperties}>
              Нет закрытых сделок за выбранный период
            </div>
          ) : stats ? (
            <div className="card px-5 py-4 space-y-3 text-sm rise-in" style={{ "--rise-delay": "120ms" } as React.CSSProperties}>
              <StatRow
                label={`PnL за ${period} дн`}
                value={
                  <span className={pnlColor(stats.totalPnl)}>
                    {fmtMoney(stats.totalPnl)} USDT
                    {stats.pnlPercent != null && (
                      <span className="text-muted"> · {fmtPercent(stats.pnlPercent)}</span>
                    )}
                  </span>
                }
              />
              <StatRow
                label="Винрейт"
                value={
                  <>
                    {stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : "—"}
                    <span className="text-muted"> · {stats.wins}W/{stats.losses}L</span>
                  </>
                }
              />
              <StatRow label="Профит-фактор" value={stats.profitFactorDisplay} />
              <StatRow
                label="Средняя сделка"
                value={
                  <>
                    <span className="text-profit">{fmtMoney(stats.avgWin)}</span>
                    {" / "}
                    <span className="text-loss">{fmtMoney(stats.avgLoss)}</span>
                  </>
                }
              />
              <StatRow
                label="Комиссии"
                value={<span className="text-loss">−{Math.abs(stats.totalCommission).toFixed(2)} USDT</span>}
              />
              <StatRow
                label="Фандинг"
                value={<span className={pnlColor(stats.totalFunding)}>{fmtMoney(stats.totalFunding)} USDT</span>}
              />
              <StatRow label="Сделок" value={String(stats.trades)} />
              <div className="pt-1 border-t border-border">
                <Link href="/trades" className="text-accent-bright hover:underline text-sm pressable inline-block">
                  Все сделки →
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Открытые позиции */}
      <div className="card p-5 rise-in" style={{ "--rise-delay": "160ms" } as React.CSSProperties}>
        <div className="text-sm text-muted mb-3">Открытые позиции</div>
        {positions.length === 0 ? (
          <div className="py-6 text-center text-muted text-sm">Нет открытых позиций</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-left border-b border-border">
                <th className="pb-2 font-normal">Инструмент</th>
                <th className="pb-2 font-normal">Сторона</th>
                <th className="pb-2 font-normal text-right">Объём</th>
                <th className="pb-2 font-normal text-right">Вход</th>
                <th className="pb-2 font-normal text-right">Сейчас</th>
                <th className="pb-2 font-normal text-right">PnL</th>
                <th className="pb-2 font-normal text-right">В позиции</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                // Ссылка на страницу открытой сделки (крайний случай спеки
                // «позиция ещё открыта»): матчим по инструменту и направлению.
                const wantedDir = p.position_side === "SHORT" ? "short" : "long";
                const trade = openTrades.find(
                  (t) => t.symbol === p.symbol && (p.position_side === "BOTH" || t.direction === wantedDir),
                );
                return (
                <tr
                  key={`${p.symbol}-${p.position_side}`}
                  onClick={trade ? () => router.push(`/trades/${trade.id}`) : undefined}
                  className={`border-b border-border/50 last:border-0 ${
                    trade ? "cursor-pointer hover:bg-card-hover row-hover" : ""
                  }`}
                >
                  <td className="py-2.5 font-medium">{p.symbol}{trade ? " ↗" : ""}</td>
                  <td className={p.position_side === "SHORT" ? "text-loss" : "text-profit"}>
                    {p.position_side === "SHORT" ? "Short" : "Long"}
                    {p.leverage ? ` ×${p.leverage}` : ""}
                  </td>
                  <td className="text-right num">{fmtQty(p.qty)}</td>
                  <td className="text-right num">{fmtPrice(p.entry_price)}</td>
                  <td className="text-right num">{fmtPrice(p.mark_price)}</td>
                  <td className={`text-right num ${pnlColor(p.unrealized_pnl)}`}>{fmtMoney(p.unrealized_pnl)}</td>
                  <td className="text-right text-muted">
                    {p.opened_at ? fmtDuration(Date.now() - p.opened_at) : fmtDateTime(null)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="num text-right font-medium">{value}</span>
    </div>
  );
}
