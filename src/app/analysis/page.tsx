"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FanChart } from "@/components/FanChart";
import { PnlHistogram } from "@/components/PnlHistogram";
import {
  AnalysisTrade, McResult, computeDrawdown, computeHistogram, computeProfile,
  computeStreaks, computeTimeBreakdown, runMonteCarlo,
} from "@/lib/mc";
import { fmtDuration, fmtMoney, pnlColor } from "@/lib/format";

const PERIODS = [
  { key: "7", label: "7 дн" },
  { key: "30", label: "30 дн" },
  { key: "90", label: "90 дн" },
  { key: "180", label: "180 дн" },
  { key: "all", label: "Всё время" },
] as const;

const HORIZONS = [50, 100, 200, 500];
const RUNS = [1000, 5000, 10000];
const MIN_TRADES = 20; // порог достоверности (требование 3 спеки)

export default function AnalysisPage() {
  const [period, setPeriod] = useState<string>("all");
  const [horizon, setHorizon] = useState(100);
  const [runs, setRuns] = useState(1000);

  const [trades, setTrades] = useState<AnalysisTrade[] | null>(null);
  const [startEquity, setStartEquity] = useState<number | null>(null);
  const [mc, setMc] = useState<McResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // Поколение расчёта: смена периода/параметров отменяет предыдущий прогон.
  const generation = useRef(0);

  useEffect(() => {
    // Смена периода отменяет бегущую симуляцию сразу (крайний случай спеки):
    // прогон увидит смену поколения на ближайшем чанке и не закоммитит результат.
    generation.current++;
    setMc(null);
    setProgress(null);
    setTrades(null);
    fetch(`/api/analysis?period=${period}`)
      .then((r) => r.json())
      .then((d) => {
        setTrades(d.trades ?? []);
        setStartEquity(d.currentEquity);
      })
      .catch(() => setTrades([]));
  }, [period]);

  const simulate = useCallback(async (tradesArg: AnalysisTrade[], equityArg: number | null) => {
    const gen = ++generation.current;
    setMc(null);
    if (tradesArg.length < MIN_TRADES) return;
    // Нет снапшотов капитала — стартуем с суммы |PnL| выборки (крайний случай спеки).
    const start = equityArg ?? tradesArg.reduce((s, t) => s + Math.abs(t.pnl), 0);
    setProgress(0);
    const result = await runMonteCarlo(
      {
        pnls: tradesArg.map((t) => t.pnl),
        startEquity: start,
        horizon,
        runs,
        samplePaths: 50,
        maxChartPoints: 100,
      },
      (done, total) => { if (generation.current === gen) setProgress(Math.round((done / total) * 100)); },
      () => generation.current !== gen,
    );
    if (generation.current !== gen) return; // отменён — результаты не смешиваем
    setProgress(null);
    if (result) setMc(result);
  }, [horizon, runs]);

  useEffect(() => {
    if (trades) void simulate(trades, startEquity);
  }, [trades, startEquity, simulate]);

  if (trades === null) {
    return <div className="py-16 text-center text-muted text-sm loading-pulse">Загрузка…</div>;
  }

  const tooFew = trades.length < MIN_TRADES;
  const pnls = trades.map((t) => t.pnl);
  const profile = computeProfile(pnls);
  const streaks = computeStreaks(pnls);
  const simStart = startEquity ?? pnls.reduce((s, p) => s + Math.abs(p), 0);
  const drawdown = startEquity != null ? computeDrawdown(trades, startEquity - pnls.reduce((s, p) => s + p, 0)) : computeDrawdown(trades, simStart);
  const breakdown = computeTimeBreakdown(trades);
  const bins = computeHistogram(pnls);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Анализ</h1>
        <div className="flex gap-1 card p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-xl text-sm pressable ${
                period === p.key ? "bg-accent text-white" : "text-muted hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {tooFew ? (
        <div className="card px-6 py-14 text-center rise-in">
          <div className="text-lg mb-1">Мало данных для анализа</div>
          <div className="text-muted text-sm">
            {trades.length} из {MIN_TRADES} сделок за выбранный период. Выбери период подлиннее —
            статистика на малой выборке обманчива.
          </div>
        </div>
      ) : (
        <>
          {/* Монте-Карло */}
          <div className="card p-5 rise-in">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-sm font-medium">Монте-Карло · что будет с депозитом</div>
                <div className="text-xs text-muted mt-0.5">
                  {runs.toLocaleString("ru-RU")} прогонов × {horizon} сделок вперёд · bootstrap из {trades.length} твоих
                  сделок · старт {Math.round(simStart).toLocaleString("ru-RU")} USDT
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <div className="flex gap-1 card p-1">
                  {HORIZONS.map((h) => (
                    <button key={h} onClick={() => setHorizon(h)}
                      className={`px-2.5 py-1 rounded-lg pressable ${horizon === h ? "bg-accent text-white" : "text-muted hover:text-white"}`}>
                      {h}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 card p-1">
                  {RUNS.map((r) => (
                    <button key={r} onClick={() => setRuns(r)}
                      className={`px-2.5 py-1 rounded-lg pressable ${runs === r ? "bg-accent text-white" : "text-muted hover:text-white"}`}>
                      {r >= 1000 ? `${r / 1000}k` : r}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => trades && void simulate(trades, startEquity)}
                  className="px-3 py-1 rounded-lg bg-accent hover:bg-accent-bright pressable"
                >
                  Пересчитать
                </button>
              </div>
            </div>

            {mc ? (
              <>
                <FanChart result={mc} startEquity={simStart} />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
                  <SimCard label="Медиана (P50)" value={`${Math.round(mc.medianFinal).toLocaleString("ru-RU")}`} sub={pct(mc.medianFinal, simStart)} tone={mc.medianFinal >= simStart ? "profit" : "loss"} />
                  <SimCard label="Лучший (P95)" value={`${Math.round(mc.p95Final).toLocaleString("ru-RU")}`} sub={pct(mc.p95Final, simStart)} tone="profit" />
                  <SimCard label="Худший (P5)" value={`${Math.round(mc.p5Final).toLocaleString("ru-RU")}`} sub={pct(mc.p5Final, simStart)} tone="loss" />
                  <SimCard label="Вероятность минуса" value={`${mc.probLoss.toFixed(1)}%`} tone={mc.probLoss > 50 ? "loss" : undefined} />
                  <SimCard label="Просадка ≥25%" value={`${mc.probDd25.toFixed(1)}%`} tone={mc.probDd25 > 30 ? "loss" : undefined} />
                  <SimCard label="Просадка ≥50%" value={`${mc.probDd50.toFixed(1)}%`} tone={mc.probDd50 > 10 ? "loss" : undefined} />
                </div>
              </>
            ) : (
              <div className="h-[380px] flex flex-col items-center justify-center text-muted text-sm gap-2 loading-pulse">
                Симуляция… {progress != null ? `${progress}%` : ""}
              </div>
            )}
          </div>

          {/* Риск */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card px-5 py-4 rise-in" style={{ "--rise-delay": "40ms" } as React.CSSProperties}>
              <div className="text-xs text-muted uppercase tracking-wider mb-1.5">Серии сделок (история)</div>
              <div className="text-2xl font-semibold num">
                <span className="text-loss">{streaks.maxLoss}</span>
                <span className="text-muted text-base"> убыточных подряд · </span>
                <span className="text-profit">{streaks.maxWin}</span>
                <span className="text-muted text-base"> прибыльных</span>
              </div>
              {mc && (
                <div className="text-xs text-muted mt-1">
                  ожидаемая макс. серия убытков на {horizon} сделок: <span className="text-loss num">{Math.round(mc.expMaxLossStreak)}</span>
                </div>
              )}
            </div>
            <div className="card px-5 py-4 rise-in" style={{ "--rise-delay": "80ms" } as React.CSSProperties}>
              <div className="text-xs text-muted uppercase tracking-wider mb-1.5">Макс. просадка (история)</div>
              <div className="text-2xl font-semibold num text-loss">
                −{drawdown.pct.toFixed(1)}% <span className="text-base">({fmtMoney(-drawdown.usdt)} USDT)</span>
              </div>
              <div className="text-xs text-muted mt-1">длилась {fmtDuration(drawdown.durationMs)}</div>
            </div>
            <div className="card px-5 py-4 rise-in" style={{ "--rise-delay": "120ms" } as React.CSSProperties}>
              <div className="text-xs text-muted uppercase tracking-wider mb-1.5">Экспектанси</div>
              <div className={`text-2xl font-semibold num ${pnlColor(profile.expectancy)}`}>
                {fmtMoney(profile.expectancy)} USDT<span className="text-base text-muted"> / сделка</span>
              </div>
              <div className="text-xs text-muted mt-1 num">
                σ {profile.stddev.toFixed(2)} · выигрыш/проигрыш{" "}
                {profile.winLossRatio != null ? profile.winLossRatio.toFixed(2) : profile.wins > 0 ? "∞" : "—"} · винрейт{" "}
                {profile.winRate != null ? `${profile.winRate.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>

          {/* Распределение */}
          <div className="card p-5 rise-in" style={{ "--rise-delay": "160ms" } as React.CSSProperties}>
            <div className="text-sm text-muted mb-3">Распределение результатов · чистый PnL, USDT · {trades.length} сделок</div>
            <PnlHistogram bins={bins} />
          </div>

          {/* Время */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TimeTable title="По дням недели (вход)" buckets={breakdown.weekdays} />
            <TimeTable title="По времени суток (вход, локальное)" buckets={breakdown.hours} />
          </div>
        </>
      )}
    </div>
  );
}

function pct(v: number, base: number): string {
  if (base <= 0) return "";
  const p = ((v - base) / base) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function SimCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "profit" | "loss" }) {
  return (
    <div className="bg-bg border border-border rounded-xl px-4 py-3">
      <div className="text-[11px] text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-semibold num ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted num">{sub}</div>}
    </div>
  );
}

function TimeTable({ title, buckets }: { title: string; buckets: Array<{ label: string; trades: number; wins: number; pnl: number }> }) {
  return (
    <div className="card p-5 rise-in" style={{ "--rise-delay": "200ms" } as React.CSSProperties}>
      <div className="text-sm text-muted mb-3">{title}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted text-left border-b border-border text-xs">
            <th className="pb-2 font-normal"></th>
            <th className="pb-2 font-normal text-right">Сделок</th>
            <th className="pb-2 font-normal text-right">Винрейт</th>
            <th className="pb-2 font-normal text-right">PnL</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            // < 3 сделок — малодостоверно, приглушаем (требование 13 спеки).
            const dim = b.trades < 3;
            return (
              <tr key={b.label} className={`border-b border-border/40 last:border-0 ${dim ? "opacity-40" : ""}`}>
                <td className="py-1.5">{b.label}{dim && b.trades > 0 ? " *" : ""}</td>
                <td className="py-1.5 text-right num">{b.trades || "—"}</td>
                <td className="py-1.5 text-right num">
                  {b.trades > 0 ? `${((b.wins / b.trades) * 100).toFixed(0)}%` : "—"}
                </td>
                <td className={`py-1.5 text-right num ${b.trades > 0 ? pnlColor(b.pnl) : "text-muted"}`}>
                  {b.trades > 0 ? fmtMoney(b.pnl) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-[11px] text-muted mt-2">* меньше 3 сделок — малодостоверно</div>
    </div>
  );
}
