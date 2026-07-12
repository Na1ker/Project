"use client";

import { McResult } from "@/lib/mc";

// Веер Монте-Карло: полупрозрачные траектории + перцентили P5/P50/P95.
// Лёгкий SVG в палитре проекта — без новых chart-зависимостей.
export function FanChart({ result, startEquity }: { result: McResult; startEquity: number }) {
  const W = 860, H = 380, PAD_L = 64, PAD_R = 16, PAD_T = 16, PAD_B = 28;

  const allValues = [startEquity, ...result.p5, ...result.p95, ...result.paths.flat()];
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const ySpan = yMax - yMin || 1;

  const xs = (i: number) => PAD_L + ((i + 1) / result.stepIndices.length) * (W - PAD_L - PAD_R);
  const ys = (v: number) => PAD_T + (1 - (v - yMin) / ySpan) * (H - PAD_T - PAD_B);

  const line = (values: number[]) =>
    `M ${PAD_L} ${ys(startEquity)} ` + values.map((v, i) => `L ${xs(i)} ${ys(v)}`).join(" ");

  // Коридор P5–P95 заливкой.
  const band =
    `M ${PAD_L} ${ys(startEquity)} ` +
    result.p95.map((v, i) => `L ${xs(i)} ${ys(v)}`).join(" ") +
    ` L ${xs(result.p5.length - 1)} ${ys(result.p5[result.p5.length - 1])} ` +
    [...result.p5].reverse().map((v, i) => `L ${xs(result.p5.length - 1 - i)} ${ys(v)}`).join(" ") +
    ` Z`;

  // Сетка по Y: 5 меток.
  const gridLines = Array.from({ length: 5 }, (_, i) => yMin + (ySpan * i) / 4);

  const xLabelEvery = Math.ceil(result.stepIndices.length / 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full fade-in" role="img" aria-label="Веер симуляции Монте-Карло">
      {gridLines.map((v) => (
        <g key={v}>
          <line x1={PAD_L} y1={ys(v)} x2={W - PAD_R} y2={ys(v)} stroke="#1c1c22" strokeWidth="1" />
          <text x={PAD_L - 8} y={ys(v) + 4} textAnchor="end" fontSize="11" fill="#8a8a93">
            {Math.round(v).toLocaleString("ru-RU")}
          </text>
        </g>
      ))}

      {/* Траектории */}
      {result.paths.map((p, i) => (
        <path key={i} d={line(p)} fill="none" stroke="#8b1e2d" strokeOpacity="0.16" strokeWidth="1" />
      ))}

      {/* Коридор и перцентили */}
      <path d={band} fill="rgba(139,30,45,0.10)" />
      <path d={line(result.p5)} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={line(result.p95)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={line(result.p50)} fill="none" stroke="#ececf1" strokeWidth="2" />

      {/* Стартовый уровень */}
      <line x1={PAD_L} y1={ys(startEquity)} x2={W - PAD_R} y2={ys(startEquity)} stroke="#8a8a93" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="2 4" />

      {/* Ось X: номер сделки */}
      {result.stepIndices.map((s, i) =>
        i % xLabelEvery === 0 || i === result.stepIndices.length - 1 ? (
          <text key={s} x={xs(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#8a8a93">
            {s}
          </text>
        ) : null,
      )}
      <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize="11" fill="#5a5a63" />
    </svg>
  );
}
