"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, IChartApi, ISeriesApi, SeriesMarker, Time,
} from "lightweight-charts";
import { Drawing } from "@/lib/dataset";

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

export type ActiveTool = "trendline" | null;

interface Point {
  ts: number;
  price: number;
}

// Свечной график сделки + слой разметки (v1.3): трендовые линии рисуются
// в координатах цена/время поверх lightweight-charts и едут вместе со свечами.
export function TradeChart({
  candles,
  marks,
  drawings = [],
  activeTool = null,
  onDrawingComplete,
  onDrawingDelete,
}: {
  candles: Candle[];
  marks: FillMark[];
  drawings?: Drawing[];
  activeTool?: ActiveTool;
  onDrawingComplete?: (p1: Point, p2: Point) => void;
  onDrawingDelete?: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Шкала растянута fitContent'ом — только после этого клики рисования
  // дают верные координаты (фикс из ревью: не путать «не устаканился»
  // с «пользователь панорамировал»).
  const settledRef = useRef(false);
  const [, setTick] = useState(0); // перерисовка оверлея при зуме/панораме
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Транзиентное сообщение вместо молчаливого игнора клика (клик не должен
  // пропадать без объяснения — иначе кажется, что «точки не ставятся»).
  const [uiMsg, setUiMsg] = useState<string | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redraw = useCallback(() => setTick((t) => t + 1), []);

  const flashMsg = useCallback((text: string) => {
    setUiMsg(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setUiMsg(null), 1800);
  }, []);

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
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e88",
      wickDownColor: "#ef444488",
    });
    seriesRef.current = candleSeries;
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

    // Растягиваем все свечи на всю ширину. autoSize меряет контейнер
    // асинхронно (ResizeObserver) и сбрасывает шкалу после первых вызовов
    // fitContent — поэтому повторяем с проверкой сходимости: первая свеча
    // должна оказаться у левого края.
    const t0 = Math.floor(candles[0].ts / 1000) as Time;
    settledRef.current = false;
    chart.timeScale().fitContent();

    // Быстрый путь стабилизации: следующий кадр анимации (в активной вкладке
    // это ~16мс — рисовать можно почти мгновенно).
    const trySettle = (): boolean => {
      const x0 = chart.timeScale().timeToCoordinate(t0);
      if (x0 != null && (x0 as number) < 60) {
        settledRef.current = true;
        return true;
      }
      chart.timeScale().fitContent();
      return false;
    };
    const raf1 = requestAnimationFrame(() => {
      if (!trySettle()) requestAnimationFrame(() => { trySettle(); redraw(); });
      redraw();
    });

    // Резервный путь для окружений без кадров (фоновые вкладки).
    let fitAttempts = 0;
    const fitTimer = setInterval(() => {
      fitAttempts++;
      if (settledRef.current || trySettle() || fitAttempts > 20) {
        if (fitAttempts > 20) settledRef.current = true;
        clearInterval(fitTimer);
      }
      redraw();
    }, 100);

    // Оверлей перерисовывается на зум/панораму и движение мыши над графиком.
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.subscribeCrosshairMove(redraw);

    return () => {
      cancelAnimationFrame(raf1);
      clearInterval(fitTimer);
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, marks]);

  // Escape отменяет незавершённую линию и снимает выделение (требование 10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPendingPoint(null);
        setSelectedId(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId != null) {
        onDrawingDelete?.(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onDrawingDelete]);

  // Смена инструмента сбрасывает незавершённое рисование.
  useEffect(() => {
    setPendingPoint(null);
    if (activeTool) setSelectedId(null);
  }, [activeTool]);

  // ---- Конвертация координат: цена/время <-> пиксели ----
  // Самокалибровка по двум видимым свечам: берём их фактические координаты у
  // графика и строим линейную карту время<->x. Никаких предположений о
  // внутренней логической шкале; за краями диапазона — линейная экстраполяция
  // (свечи равномерны), поэтому линия продолжается за край и ничего не падает.
  const calibrateX = (): { x0: number; ts0: number; pxPerMs: number } | null => {
    const chart = chartRef.current;
    if (!chart || candles.length < 2) return null;
    const vr = chart.timeScale().getVisibleRange();
    if (!vr) return null;
    const fromMs = (vr.from as number) * 1000;
    const toMs = (vr.to as number) * 1000;
    const visible = candles.filter((c) => c.ts >= fromMs && c.ts <= toMs);
    if (visible.length < 2) return null;
    const a = visible[0];
    const b = visible[visible.length - 1];
    const xa = chart.timeScale().timeToCoordinate(Math.floor(a.ts / 1000) as Time);
    const xb = chart.timeScale().timeToCoordinate(Math.floor(b.ts / 1000) as Time);
    if (xa == null || xb == null || a.ts === b.ts) return null;
    return { x0: xa as number, ts0: a.ts, pxPerMs: ((xb as number) - (xa as number)) / (b.ts - a.ts) };
  };

  const tsToX = (ts: number): number | null => {
    const cal = calibrateX();
    return cal ? cal.x0 + (ts - cal.ts0) * cal.pxPerMs : null;
  };
  const xToTs = (x: number): number | null => {
    const cal = calibrateX();
    return cal ? cal.ts0 + (x - cal.x0) / cal.pxPerMs : null;
  };
  const priceToY = (price: number): number | null => {
    const series = seriesRef.current;
    if (!series) return null;
    const direct = series.priceToCoordinate(price);
    if (direct != null) return direct as number;
    // Цена за пределами видимой шкалы: линейная экстраполяция по двум опорным
    // точкам видимого диапазона (шкала линейная) — линия продолжается за край,
    // ничего не падает (крайний случай спеки).
    const probeA = candles[Math.floor(candles.length / 2)].close;
    const probeB = probeA * 1.01 + 1;
    const ya = series.priceToCoordinate(probeA);
    const yb = series.priceToCoordinate(probeB);
    if (ya == null || yb == null || probeA === probeB) return null;
    const slope = ((yb as number) - (ya as number)) / (probeB - probeA);
    return (ya as number) + slope * (price - probeA);
  };
  const yToPrice = (y: number): number | null => {
    const series = seriesRef.current;
    if (!series) return null;
    const p = series.coordinateToPrice(y);
    return p == null ? null : (p as number);
  };

  const pointFromEvent = (e: React.MouseEvent<SVGSVGElement>): Point | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ts = xToTs(e.clientX - rect.left);
    const price = yToPrice(e.clientY - rect.top);
    if (ts == null || price == null) return null;
    return { ts, price };
  };

  const handleOverlayClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool !== "trendline") return;
    // До стабилизации шкалы координаты времени искажены — клик не глотаем
    // молча, а объясняем и форсируем стабилизацию.
    if (!settledRef.current) {
      chartRef.current?.timeScale().fitContent();
      flashMsg("График ещё готовится — кликни ещё раз");
      return;
    }
    const p = pointFromEvent(e);
    if (!p) {
      flashMsg("Не удалось определить точку — попробуй ближе к свечам");
      return;
    }
    if (!pendingPoint) {
      setPendingPoint(p);
    } else {
      onDrawingComplete?.(pendingPoint, p);
      setPendingPoint(null);
    }
  };

  const handleOverlayMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === "trendline" && pendingPoint) {
      setHoverPoint(pointFromEvent(e));
    }
  };

  // Клик по существующей линии выделяет её (без активного инструмента).
  const handleLineClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (activeTool) return;
    setSelectedId((cur) => (cur === id ? null : id));
  };

  const toXY = (p: Point): { x: number; y: number } | null => {
    const x = tsToX(p.ts);
    const y = priceToY(p.price);
    return x == null || y == null ? null : { x, y };
  };

  if (candles.length === 0) return null;

  const overlayActive = activeTool === "trendline";

  return (
    <div className="relative w-full fade-in">
      <div ref={ref} className="w-full" />
      {/* Слой разметки: при активном инструменте перехватывает клики,
          иначе прозрачен для событий (зум/панорама графика не ломаются). */}
      <svg
        className="absolute inset-0 w-full h-[460px]"
        style={{ pointerEvents: overlayActive ? "auto" : "none", cursor: overlayActive ? "crosshair" : "default" }}
        onClick={handleOverlayClick}
        onMouseMove={handleOverlayMove}
      >
        {drawings.map((d) => {
          const a = toXY(d.p1);
          const b = toXY(d.p2);
          if (!a || !b) return null;
          const selected = selectedId === d.id;
          return (
            <g key={d.id}>
              {/* Невидимая широкая зона клика */}
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth="10"
                style={{ pointerEvents: activeTool ? "none" : "stroke", cursor: "pointer" }}
                onClick={(e) => handleLineClick(e, d.id)}
              />
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={d.color} strokeWidth={selected ? 2.5 : 1.5}
                style={{ pointerEvents: "none" }}
              />
              {selected && (
                <>
                  <circle cx={a.x} cy={a.y} r="4" fill={d.color} />
                  <circle cx={b.x} cy={b.y} r="4" fill={d.color} />
                  <g
                    transform={`translate(${(a.x + b.x) / 2}, ${(a.y + b.y) / 2 - 14})`}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); onDrawingDelete?.(d.id); setSelectedId(null); }}
                  >
                    <rect x="-9" y="-9" width="18" height="18" rx="5" fill="#131316" stroke="#232329" />
                    <text x="0" y="4" textAnchor="middle" fontSize="11" fill="#ef4444">✕</text>
                  </g>
                </>
              )}
            </g>
          );
        })}

        {/* Предпросмотр рисуемой линии */}
        {pendingPoint && (() => {
          const a = toXY(pendingPoint);
          if (!a) return null;
          const b = hoverPoint ? toXY(hoverPoint) : null;
          return (
            <g style={{ pointerEvents: "none" }}>
              <circle cx={a.x} cy={a.y} r="3.5" fill="#c22b3f" />
              {b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c22b3f" strokeWidth="1.5" strokeDasharray="5 4" />}
            </g>
          );
        })()}
      </svg>

      {/* Подсказка режима рисования (требование 10) + транзиентные сообщения */}
      {(overlayActive || uiMsg) && (
        <div className={`absolute top-2 left-2 text-xs bg-card/90 border border-border rounded-lg px-2.5 py-1.5 pointer-events-none ${
          uiMsg ? "text-accent-bright" : "text-muted"
        }`}>
          {uiMsg ?? (pendingPoint ? "Кликни вторую точку · Esc — отмена" : "Кликни первую точку линии · Esc — отмена")}
        </div>
      )}
    </div>
  );
}
