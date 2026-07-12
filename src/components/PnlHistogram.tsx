"use client";

import { HistogramBin } from "@/lib/mc";

// Гистограмма чистых PnL: убыточные бины красные, прибыльные зелёные,
// краевые (выбросы за P5/P95) — приглушённые с пометкой.
export function PnlHistogram({ bins }: { bins: HistogramBin[] }) {
  const W = 860, H = 220, PAD_B = 34, PAD_T = 10;
  if (bins.length === 0) return null;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const barW = W / bins.length;

  const fmt = (v: number) =>
    Number.isFinite(v) ? Math.round(v).toLocaleString("ru-RU") : v > 0 ? "+∞" : "−∞";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full fade-in" role="img" aria-label="Распределение результатов сделок">
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * (H - PAD_B - PAD_T);
        const mid = Number.isFinite(b.from) && Number.isFinite(b.to) ? (b.from + b.to) / 2 : (Number.isFinite(b.from) ? b.from : b.to);
        const isLoss = mid < 0;
        const color = b.isEdge ? "#8a8a93" : isLoss ? "#ef4444" : "#22c55e";
        return (
          <g key={i}>
            <rect
              x={i * barW + 3}
              y={H - PAD_B - h}
              width={barW - 6}
              height={Math.max(h, b.count > 0 ? 2 : 0)}
              rx="3"
              fill={color}
              fillOpacity={b.isEdge ? 0.5 : 0.75}
            />
            {b.count > 0 && (
              <text x={i * barW + barW / 2} y={H - PAD_B - h - 5} textAnchor="middle" fontSize="10" fill="#8a8a93">
                {b.count}
              </text>
            )}
            <text x={i * barW + barW / 2} y={H - PAD_B + 14} textAnchor="middle" fontSize="9.5" fill="#5a5a63">
              {b.isEdge ? (Number.isFinite(b.from) ? `≥${fmt(b.from)}` : `≤${fmt(b.to)}`) : fmt(b.from)}
            </text>
            {b.isEdge && b.count > 0 && (
              <text x={i * barW + barW / 2} y={H - PAD_B + 26} textAnchor="middle" fontSize="9" fill="#8a8a93">
                выброс
              </text>
            )}
          </g>
        );
      })}
      <line x1="0" y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="#232329" strokeWidth="1" />
    </svg>
  );
}
