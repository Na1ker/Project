"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, SeriesMarker, Time } from "lightweight-charts";

interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FillMark {
  ts: number;
  side: "BUY" | "SELL";
  price: number;
  isEntry: boolean;
}

// Свечной график сделки с маркерами всех входов и выходов (требование 14)
// + гистограмма объёма под свечами.
export function TradeChart({ candles, marks }: { candles: Candle[]; marks: FillMark[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a93",
      },
      grid: { vertLines: { color: "#1c1c22" }, horzLines: { color: "#1c1c22" } },
      rightPriceScale: { borderColor: "#232329" },
      timeScale: { borderColor: "#232329", timeVisible: true, secondsVisible: false },
      height: 460,
      autoSize: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e88",
      wickDownColor: "#ef444488",
    });
    candleSeries.setData(
      candles.map((c) => ({
        time: Math.floor(c.ts / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles.map((c) => ({
        time: Math.floor(c.ts / 1000) as Time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
      })),
    );

    // Маркеры привязываем к ближайшей свече (fill может попасть внутрь свечи).
    const candleTimes = candles.map((c) => Math.floor(c.ts / 1000));
    const snap = (ts: number) => {
      const t = Math.floor(ts / 1000);
      let best = candleTimes[0];
      for (const ct of candleTimes) if (Math.abs(ct - t) < Math.abs(best - t)) best = ct;
      return best as Time;
    };

    const markers: SeriesMarker<Time>[] = marks
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .map((m) => ({
        time: snap(m.ts),
        position: m.isEntry ? "belowBar" : "aboveBar",
        color: m.isEntry ? "#c22b3f" : "#ececf1",
        shape: m.isEntry ? "arrowUp" : "arrowDown",
        text: `${m.isEntry ? "Вход" : "Выход"} ${m.price}`,
      }));
    candleSeries.setMarkers(markers);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, marks]);

  return <div ref={ref} className="w-full fade-in" />;
}
