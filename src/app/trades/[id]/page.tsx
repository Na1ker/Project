"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ActiveTool, TradeChart } from "@/components/TradeChart";
import { Drawing, JournalEntry } from "@/lib/dataset";
import { fmtDateTime, fmtDuration, fmtMoney, fmtPrice, fmtQty, pnlColor } from "@/lib/format";

interface Trade {
  id: number;
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
  margin_mode: string | null;
  net_pnl: number;
}

interface Fill {
  id: number;
  side: "BUY" | "SELL";
  position_side: string;
  price: number;
  qty: number;
  ts: number;
}

interface CandleData {
  interval: string;
  candles: Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>;
  unavailable: boolean;
}

// Страница истории сделки (требования 14–15): график слева, факты справа.
export default function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [position, setPosition] = useState<{ unrealized_pnl: number; mark_price: number } | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState<"idle" | "saving">("idle");
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [candleData, setCandleData] = useState<CandleData | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/trades/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        setTrade(d.trade);
        setPosition(d.position ?? null);
        setFills(d.fills ?? []);
        setJournal(d.journal ?? []);
        setDrawings(d.drawings ?? []);
      })
      .catch(() => {});
    fetch(`/api/trades/${id}/candles`)
      .then((r) => r.json())
      .then(setCandleData)
      .catch(() => setCandleData({ interval: "", candles: [], unavailable: true }));
  }, [id]);

  // Журнал: запись добавляется в список, поле очищается (требования 1-2 спеки v1.3).
  async function addJournalEntry() {
    const text = noteText.trim();
    if (!text) return;
    setNoteSaved("saving");
    try {
      const res = await fetch(`/api/trades/${id}/journal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const { entry } = await res.json();
        setJournal((j) => [entry, ...j]);
        setNoteText("");
      }
    } finally {
      setNoteSaved("idle");
    }
  }

  async function deleteJournalEntry(entryId: number) {
    setJournal((j) => j.filter((e) => e.id !== entryId));
    await fetch(`/api/trades/${id}/journal/${entryId}`, { method: "DELETE" });
  }

  // Линия сохраняется сразу после второй точки (требование 7 спеки v1.3).
  async function addDrawing(p1: { ts: number; price: number }, p2: { ts: number; price: number }) {
    setActiveTool(null);
    const res = await fetch(`/api/trades/${id}/drawings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "trendline", p1, p2, color: "#c22b3f" }),
    });
    if (res.ok) {
      const { drawing } = await res.json();
      setDrawings((ds) => [...ds, drawing]);
    }
  }

  async function deleteDrawing(drawingId: number) {
    setDrawings((ds) => ds.filter((d) => d.id !== drawingId));
    await fetch(`/api/trades/${id}/drawings/${drawingId}`, { method: "DELETE" });
  }

  const isOpen = trade?.status === "open";
  // Для определения вход/выход: у long вход = BUY, у short вход = SELL.
  const isEntryFill = (f: Fill) =>
    trade?.direction === "long" ? f.side === "BUY" : f.side === "SELL";

  // Стабильная ссылка на маркеры: иначе каждый рендер страницы пересоздаёт
  // график (сброс зума при добавлении линии/записи журнала).
  const chartMarks = useMemo(() => {
    if (!trade) return [];
    return fills.length > 0
      ? fills.map((f) => ({
          ts: f.ts,
          side: f.side,
          price: f.price,
          isEntry: trade.direction === "long" ? f.side === "BUY" : f.side === "SELL",
        }))
      : [
          { ts: trade.opened_at, side: "BUY" as const, price: trade.avg_entry, isEntry: true },
          ...(trade.closed_at && trade.avg_exit != null
            ? [{ ts: trade.closed_at, side: "SELL" as const, price: trade.avg_exit, isEntry: false }]
            : []),
        ];
  }, [fills, trade]);

  if (notFound) {
    return (
      <div className="py-16 text-center text-muted">
        Сделка не найдена. <Link href="/trades" className="text-accent-bright hover:underline">К списку сделок</Link>
      </div>
    );
  }
  if (!trade) return <div className="py-16 text-center text-muted text-sm loading-pulse">Загрузка…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/trades" className="text-muted hover:text-white text-sm">← Сделки</Link>
        <h1 className="text-2xl font-semibold">{trade.symbol}</h1>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          trade.direction === "short" ? "bg-loss/15 text-loss" : "bg-profit/15 text-profit"
        }`}>
          {trade.direction === "short" ? "SHORT" : "LONG"}{trade.leverage ? ` ×${trade.leverage}` : ""}
          {trade.margin_mode ? ` · ${trade.margin_mode === "isolated" ? "Isolated" : "Cross"}` : ""}
        </span>
        {isOpen && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-accent/20 text-accent-bright">
            Открыта — PnL нереализованный
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* График: 2/3 ширины */}
        <div className="lg:col-span-2 card p-5 rise-in">
          {candleData === null ? (
            <div className="h-[460px] flex items-center justify-center text-muted text-sm loading-pulse">Загружаю график…</div>
          ) : candleData.unavailable ? (
            <div className="h-[460px] flex flex-col items-center justify-center text-muted text-sm gap-2">
              <span className="text-2xl">📉</span>
              График недоступен — история свечей по этому инструменту не найдена
              <span className="text-xs">(инструмент делистнут или сделка старше доступной истории)</span>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted mb-2">
                Таймфрейм: {candleData.interval}
                {fills.length === 0 && " · детальных исполнений нет — маркеры по средним ценам позиции"}
              </div>
              <TradeChart
                candles={candleData.candles}
                marks={chartMarks}
                drawings={drawings}
                activeTool={activeTool}
                onDrawingComplete={addDrawing}
                onDrawingDelete={deleteDrawing}
              />
              {/* Кнопка инструментов под графиком (требование 5 спеки v1.3) */}
              <div className="relative mt-3 flex items-center gap-2">
                <button
                  onClick={() => setToolMenuOpen((o) => !o)}
                  aria-label="Инструменты рисования"
                  className={`pressable w-8 h-8 rounded-lg border flex items-center justify-center ${
                    activeTool || toolMenuOpen
                      ? "border-accent-bright text-accent-bright bg-accent/10"
                      : "border-border text-muted hover:text-white"
                  }`}
                >
                  {/* Иконка «инструмент»: диагональная линия с точками */}
                  <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" aria-hidden="true">
                    <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="3.5" cy="12.5" r="1.8" fill="currentColor" />
                    <circle cx="12.5" cy="3.5" r="1.8" fill="currentColor" />
                  </svg>
                </button>
                {activeTool === "trendline" && (
                  <span className="text-xs text-accent-bright">Трендовая линия — кликни две точки на графике</span>
                )}
                {toolMenuOpen && (
                  <div className="absolute bottom-10 left-0 card p-1 z-10 rise-in min-w-44">
                    <button
                      onClick={() => { setActiveTool("trendline"); setToolMenuOpen(false); }}
                      className="pressable w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-card-hover flex items-center gap-2"
                    >
                      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
                        <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      Трендовая линия
                    </button>
                    {activeTool && (
                      <button
                        onClick={() => { setActiveTool(null); setToolMenuOpen(false); }}
                        className="pressable w-full text-left px-3 py-2 rounded-lg text-sm text-muted hover:bg-card-hover"
                      >
                        Выключить инструмент
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Панель фактов справа (требование 15) */}
        <div className="space-y-5">
          <div className="card p-5 space-y-3 text-sm rise-in" style={{ "--rise-delay": "60ms" } as React.CSSProperties}>
            <div className="text-xs text-muted uppercase tracking-wider">Детали сделки</div>
            <FactRow label="Вход" value={fmtDateTime(trade.opened_at)} />
            <FactRow label="Выход" value={isOpen ? "ещё открыта" : fmtDateTime(trade.closed_at)} />
            <FactRow
              label="В сделке"
              value={fmtDuration((trade.closed_at ?? Date.now()) - trade.opened_at)}
            />
            <div className="border-t border-border my-1" />
            <FactRow label="Объём" value={`${fmtQty(trade.qty)} (${trade.symbol.split("-")[0]})`} />
            <FactRow label="Средний вход" value={fmtPrice(trade.avg_entry)} />
            <FactRow label="Средний выход" value={isOpen ? "—" : fmtPrice(trade.avg_exit)} />
            <div className="border-t border-border my-1" />
            {isOpen && position && (
              <FactRow
                label="Нереализованный PnL"
                value={<span className={pnlColor(position.unrealized_pnl)}>{fmtMoney(position.unrealized_pnl)} USDT</span>}
              />
            )}
            <FactRow
              label={isOpen ? "PnL частичных закрытий" : "Реализованный PnL"}
              value={<span className={pnlColor(trade.realized_pnl)}>{fmtMoney(trade.realized_pnl)} USDT</span>}
            />
            <FactRow
              label="Комиссия за сделку"
              value={<span className="text-loss">−{Math.abs(trade.commission).toFixed(4)} USDT</span>}
            />
            <FactRow
              label={isOpen ? "Фандинг (накопл.)" : "Фандинг за сделку"}
              value={<span className={pnlColor(trade.funding)}>{fmtMoney(trade.funding, 4)} USDT</span>}
            />
            <div className="border-t border-border my-1" />
            <FactRow
              label="Чистый результат"
              value={
                <span className={`text-base font-semibold ${pnlColor(trade.net_pnl)}`}>
                  {fmtMoney(trade.net_pnl)} USDT
                </span>
              }
            />
          </div>

          {/* Все входы/выходы — видно усреднения и частичные закрытия */}
          {fills.length > 1 && (
            <div className="card p-5 text-sm">
              <div className="text-xs text-muted uppercase tracking-wider mb-3">
                Исполнения ({fills.length})
              </div>
              <div className="space-y-1.5">
                {fills.map((f) => (
                  <div key={f.id} className="flex justify-between text-xs num">
                    <span className={isEntryFill(f) ? "text-accent-bright" : "text-muted"}>
                      {isEntryFill(f) ? "вход" : "выход"} · {fmtDateTime(f.ts)}
                    </span>
                    <span>{fmtQty(f.qty)} @ {fmtPrice(f.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Журнал «почему зашёл» (спека v1.3: записи копятся, поле очищается) */}
          <div className="card p-5">
            <div className="text-xs text-muted uppercase tracking-wider mb-3">
              Журнал сделки{journal.length > 0 ? ` (${journal.length})` : ""}
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Причина входа, сетап, что видел на графике…"
              rows={3}
              className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm resize-y focus:outline-none focus:border-accent-bright"
            />
            <button
              onClick={addJournalEntry}
              disabled={noteSaved === "saving" || noteText.trim() === ""}
              className="mt-2 w-full bg-accent hover:bg-accent-bright pressable rounded-xl py-2 text-sm font-medium disabled:opacity-50"
            >
              {noteSaved === "saving" ? "Сохраняю…" : "Сохранить заметку"}
            </button>

            {journal.length > 0 && (
              <div className="mt-4 space-y-3">
                {journal.map((e) => (
                  <div key={e.id} className="group bg-bg border border-border rounded-xl px-3 py-2.5 rise-in">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] text-muted num">{fmtDateTime(e.createdAt)}</span>
                      <button
                        onClick={() => deleteJournalEntry(e.id)}
                        aria-label="Удалить запись"
                        className="pressable text-muted hover:text-loss text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{e.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="num text-right">{value}</span>
    </div>
  );
}
