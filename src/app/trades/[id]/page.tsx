"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { TradeChart } from "@/components/TradeChart";
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
  const [noteSaved, setNoteSaved] = useState<"idle" | "saving" | "saved">("idle");
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
        setNoteText(d.note?.text ?? "");
      })
      .catch(() => {});
    fetch(`/api/trades/${id}/candles`)
      .then((r) => r.json())
      .then(setCandleData)
      .catch(() => setCandleData({ interval: "", candles: [], unavailable: true }));
  }, [id]);

  async function saveNote() {
    setNoteSaved("saving");
    await fetch(`/api/trades/${id}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: noteText }),
    });
    setNoteSaved("saved");
    setTimeout(() => setNoteSaved("idle"), 2000);
  }

  if (notFound) {
    return (
      <div className="py-16 text-center text-muted">
        Сделка не найдена. <Link href="/trades" className="text-accent-bright hover:underline">К списку сделок</Link>
      </div>
    );
  }
  if (!trade) return <div className="py-16 text-center text-muted text-sm">Загрузка…</div>;

  const isOpen = trade.status === "open";
  // Для определения вход/выход: у long вход = BUY, у short вход = SELL.
  const isEntryFill = (f: Fill) =>
    trade.direction === "long" ? f.side === "BUY" : f.side === "SELL";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/trades" className="text-muted hover:text-white text-sm">← Сделки</Link>
        <h1 className="text-2xl font-semibold">{trade.symbol}</h1>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          trade.direction === "short" ? "bg-loss/15 text-loss" : "bg-profit/15 text-profit"
        }`}>
          {trade.direction === "short" ? "SHORT" : "LONG"}{trade.leverage ? ` ×${trade.leverage}` : ""}
        </span>
        {isOpen && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-accent/20 text-accent-bright">
            Открыта — PnL нереализованный
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* График: 2/3 ширины */}
        <div className="lg:col-span-2 card p-5">
          {candleData === null ? (
            <div className="h-[460px] flex items-center justify-center text-muted text-sm">Загружаю график…</div>
          ) : candleData.unavailable ? (
            <div className="h-[460px] flex flex-col items-center justify-center text-muted text-sm gap-2">
              <span className="text-2xl">📉</span>
              График недоступен — история свечей по этому инструменту не найдена
              <span className="text-xs">(инструмент делистнут или сделка старше доступной истории)</span>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted mb-2">Таймфрейм: {candleData.interval}</div>
              <TradeChart
                candles={candleData.candles}
                marks={fills.map((f) => ({
                  ts: f.ts,
                  side: f.side,
                  price: f.price,
                  isEntry: isEntryFill(f),
                }))}
              />
            </>
          )}
        </div>

        {/* Панель фактов справа (требование 15) */}
        <div className="space-y-5">
          <div className="card p-5 space-y-3 text-sm">
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

          {/* Заметка «почему зашёл» (требование 17) */}
          <div className="card p-5">
            <div className="text-xs text-muted uppercase tracking-wider mb-3">Почему зашёл</div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Причина входа, сетап, что видел на графике…"
              rows={4}
              className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm resize-y focus:outline-none focus:border-accent-bright"
            />
            <button
              onClick={saveNote}
              disabled={noteSaved === "saving"}
              className="mt-2 w-full bg-accent hover:bg-accent-bright transition-colors rounded-xl py-2 text-sm font-medium disabled:opacity-50"
            >
              {noteSaved === "saving" ? "Сохраняю…" : noteSaved === "saved" ? "Сохранено ✓" : "Сохранить заметку"}
            </button>
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
