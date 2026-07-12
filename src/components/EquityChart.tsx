"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi } from "lightweight-charts";

// Кривая капитала за выбранный период (требование 10).
export function EquityChart({
  data,
  height = 280,
}: {
  data: Array<{ ts: number; equity: number }>;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a93",
      },
      grid: {
        vertLines: { color: "#1c1c22" },
        horzLines: { color: "#1c1c22" },
      },
      rightPriceScale: { borderColor: "#232329" },
      timeScale: { borderColor: "#232329", timeVisible: true },
      height,
      autoSize: true,
    });
    chartRef.current = chart;

    const series = chart.addAreaSeries({
      lineColor: "#c22b3f",
      topColor: "rgba(139, 30, 45, 0.35)",
      bottomColor: "rgba(139, 30, 45, 0.02)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    series.setData(
      data.map((d) => ({ time: Math.floor(d.ts / 1000) as never, value: d.equity })),
    );
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [data, height]);

  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-muted text-sm">
        Пока нет снапшотов капитала — они начнут собираться после первой синхронизации
      </div>
    );
  }
  return <div ref={ref} className="w-full fade-in" />;
}
