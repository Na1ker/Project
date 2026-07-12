// Движок анализа v1.2: чистые функции без внешних импортов —
// используются страницей «Анализ» и юнит-тестами напрямую.

export interface AnalysisTrade {
  pnl: number;       // чистый PnL сделки (цифра биржи)
  openedAt: number;  // unix ms
  closedAt: number;
}

// ---------- Исторические метрики ----------

export function computeStreaks(pnls: number[]): { maxLoss: number; maxWin: number } {
  let maxLoss = 0, maxWin = 0, curLoss = 0, curWin = 0;
  for (const p of pnls) {
    if (p < 0) { curLoss++; curWin = 0; } else if (p > 0) { curWin++; curLoss = 0; } else { curLoss = 0; curWin = 0; }
    if (curLoss > maxLoss) maxLoss = curLoss;
    if (curWin > maxWin) maxWin = curWin;
  }
  return { maxLoss, maxWin };
}

/**
 * Максимальная просадка кривой капитала, построенной из сделок выборки
 * (стартовый капитал + накопленный PnL в порядке закрытия).
 */
export function computeDrawdown(
  trades: AnalysisTrade[],
  startEquity: number,
): { pct: number; usdt: number; durationMs: number } {
  let eq = startEquity;
  let peak = startEquity;
  let peakTs = trades.length > 0 ? trades[0].closedAt : 0;
  let maxDdUsdt = 0, maxDdPct = 0, maxDurationMs = 0;

  for (const t of trades) {
    eq += t.pnl;
    if (eq > peak) {
      peak = eq;
      peakTs = t.closedAt;
    } else {
      const dd = peak - eq;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDdUsdt) {
        maxDdUsdt = dd;
        maxDdPct = ddPct;
        maxDurationMs = t.closedAt - peakTs;
      }
    }
  }
  return { pct: maxDdPct, usdt: maxDdUsdt, durationMs: maxDurationMs };
}

export interface Profile {
  expectancy: number;
  stddev: number;
  avgWin: number | null;
  avgLoss: number | null;
  winLossRatio: number | null; // null => нет проигрышей («∞») или нет данных
  winRate: number | null;
  wins: number;
  losses: number;
}

export function computeProfile(pnls: number[]): Profile {
  const n = pnls.length;
  if (n === 0) {
    return { expectancy: 0, stddev: 0, avgWin: null, avgLoss: null, winLossRatio: null, winRate: null, wins: 0, losses: 0 };
  }
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const mean = pnls.reduce((s, p) => s + p, 0) / n;
  const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : null;
  const avgLoss = losses.length > 0 ? losses.reduce((s, p) => s + p, 0) / losses.length : null;
  return {
    expectancy: mean,
    stddev: Math.sqrt(variance),
    avgWin,
    avgLoss,
    winLossRatio: avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    winRate: (wins.length / n) * 100,
    wins: wins.length,
    losses: losses.length,
  };
}

export interface TimeBucket {
  label: string;
  trades: number;
  wins: number;
  pnl: number;
}

/** Разбивка по дням недели (Пн..Вс) и 4-часовым интервалам времени ВХОДА, локальная таймзона. */
export function computeTimeBreakdown(trades: AnalysisTrade[]): { weekdays: TimeBucket[]; hours: TimeBucket[] } {
  const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const weekdays: TimeBucket[] = dayNames.map((label) => ({ label, trades: 0, wins: 0, pnl: 0 }));
  const hours: TimeBucket[] = Array.from({ length: 6 }, (_, i) => ({
    label: `${i * 4}–${i * 4 + 4}`,
    trades: 0, wins: 0, pnl: 0,
  }));
  for (const t of trades) {
    const d = new Date(t.openedAt);
    const day = (d.getDay() + 6) % 7; // JS: 0=вс -> наш индекс 0=пн
    const hourBucket = Math.floor(d.getHours() / 4);
    for (const b of [weekdays[day], hours[hourBucket]]) {
      b.trades++;
      if (t.pnl > 0) b.wins++;
      b.pnl += t.pnl;
    }
  }
  return { weekdays, hours };
}

// ---------- Гистограмма ----------

export interface HistogramBin {
  from: number;   // -Infinity для нижнего крайнего бина
  to: number;     // +Infinity для верхнего
  count: number;
  isEdge: boolean;
}

/**
 * Бины между P5 и P95 (чтобы выброс не схлопывал гистограмму),
 * крайние сделки собираются в помеченные краевые бины.
 */
export function computeHistogram(pnls: number[], binCount = 13): HistogramBin[] {
  if (pnls.length === 0) return [];
  const sorted = [...pnls].sort((a, b) => a - b);
  const lo = percentileSorted(sorted, 5);
  const hi = percentileSorted(sorted, 95);
  if (lo === hi) {
    return [{ from: lo, to: hi, count: pnls.length, isEdge: false }];
  }
  const width = (hi - lo) / binCount;
  const bins: HistogramBin[] = [
    { from: -Infinity, to: lo, count: 0, isEdge: true },
    ...Array.from({ length: binCount }, (_, i) => ({
      from: lo + i * width,
      to: lo + (i + 1) * width,
      count: 0,
      isEdge: false,
    })),
    { from: hi, to: Infinity, count: 0, isEdge: true },
  ];
  for (const p of pnls) {
    if (p < lo) bins[0].count++;
    else if (p >= hi) bins[bins.length - 1].count++;
    else bins[1 + Math.min(Math.floor((p - lo) / width), binCount - 1)].count++;
  }
  return bins;
}

export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------- Монте-Карло (bootstrap) ----------

export interface McParams {
  pnls: number[];
  startEquity: number;
  horizon: number;      // сделок вперёд
  runs: number;
  samplePaths: number;  // сколько траекторий отдать для веера
  maxChartPoints: number; // даунсэмплинг шагов для графика
}

export interface McResult {
  stepIndices: number[];         // какие шаги записаны (для оси X)
  paths: number[][];             // [samplePaths][stepIndices.length]
  p5: number[]; p50: number[]; p95: number[];
  medianFinal: number;
  p5Final: number;
  p95Final: number;
  probLoss: number;              // P(итог < старта)
  probDd25: number;              // P(просадка от пика >= 25%)
  probDd50: number;
  expMaxLossStreak: number;      // медиана максимальной серии убытков по прогонам
}

/**
 * Уступить главному потоку между чанками. MessageChannel вместо setTimeout:
 * таймеры в фоновых вкладках дросселируются до ~1с, postMessage — нет.
 */
function yieldToMain(): Promise<void> {
  if (typeof MessageChannel !== "undefined") {
    return new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(null);
    });
  }
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Прогон симуляции чанками: не блокирует UI (требование 8 спеки),
 * отменяется через shouldCancel (крайний случай «смена периода во время расчёта»).
 * Депозит ниже нуля невозможен: прогон «ликвидируется» и остаётся на нуле.
 */
export async function runMonteCarlo(
  params: McParams,
  onProgress?: (done: number, total: number) => void,
  shouldCancel?: () => boolean,
  yieldFn: () => Promise<void> = yieldToMain,
): Promise<McResult | null> {
  const { pnls, startEquity, horizon, runs, samplePaths, maxChartPoints } = params;
  const n = pnls.length;

  // Шаги для графика: не больше maxChartPoints, равномерно, включая последний.
  const stepEvery = Math.max(1, Math.ceil(horizon / maxChartPoints));
  const stepIndices: number[] = [];
  for (let s = stepEvery; s <= horizon; s += stepEvery) stepIndices.push(s);
  if (stepIndices[stepIndices.length - 1] !== horizon) stepIndices.push(horizon);

  const nSteps = stepIndices.length;
  const stepValues: Float64Array[] = stepIndices.map(() => new Float64Array(runs));
  const paths: number[][] = [];
  const finals = new Float64Array(runs);
  const maxLossStreaks = new Int32Array(runs);
  let dd25 = 0, dd50 = 0, lossCount = 0;

  const chunk = Math.max(1, Math.ceil(runs / 25));
  for (let start = 0; start < runs; start += chunk) {
    if (shouldCancel?.()) return null;
    const end = Math.min(start + chunk, runs);
    for (let r = start; r < end; r++) {
      let eq = startEquity;
      let peak = startEquity;
      let maxDdPct = 0;
      let curStreak = 0, maxStreak = 0;
      let si = 0;
      const recordPath = r < samplePaths;
      const path: number[] | null = recordPath ? [] : null;

      for (let step = 1; step <= horizon; step++) {
        if (eq > 0) {
          const p = pnls[(Math.random() * n) | 0];
          eq += p;
          if (eq < 0) eq = 0; // ликвидация: ниже нуля счёт не уходит
          if (p < 0) { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; } else if (p > 0) curStreak = 0;
          if (eq > peak) peak = eq;
          else if (peak > 0) {
            const dd = ((peak - eq) / peak) * 100;
            if (dd > maxDdPct) maxDdPct = dd;
          }
        }
        if (si < nSteps && step === stepIndices[si]) {
          stepValues[si][r] = eq;
          path?.push(eq);
          si++;
        }
      }

      finals[r] = eq;
      maxLossStreaks[r] = maxStreak;
      if (eq < startEquity) lossCount++;
      if (maxDdPct >= 25) dd25++;
      if (maxDdPct >= 50) dd50++;
      if (path) paths.push(path);
    }
    onProgress?.(end, runs);
    await yieldFn();
  }

  const p5: number[] = [], p50: number[] = [], p95: number[] = [];
  for (const vals of stepValues) {
    const sorted = Array.from(vals).sort((a, b) => a - b);
    p5.push(percentileSorted(sorted, 5));
    p50.push(percentileSorted(sorted, 50));
    p95.push(percentileSorted(sorted, 95));
  }
  const sortedFinals = Array.from(finals).sort((a, b) => a - b);
  const sortedStreaks = Array.from(maxLossStreaks).sort((a, b) => a - b);

  return {
    stepIndices,
    paths,
    p5, p50, p95,
    medianFinal: percentileSorted(sortedFinals, 50),
    p5Final: percentileSorted(sortedFinals, 5),
    p95Final: percentileSorted(sortedFinals, 95),
    probLoss: (lossCount / runs) * 100,
    probDd25: (dd25 / runs) * 100,
    probDd50: (dd50 / runs) * 100,
    expMaxLossStreak: percentileSorted(sortedStreaks, 50),
  };
}
