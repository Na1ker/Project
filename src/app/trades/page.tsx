"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtDateTime, fmtMoney, fmtQty, pnlColor } from "@/lib/format";

interface Trade {
  id: number;
  symbol: string;
  direction: string;
  qty: number;
  opened_at: number;
  closed_at: number | null;
  net_pnl: number;
  has_note: number;
}

// Список закрытых сделок (требование 13). Открытые показываются на дашборде,
// но и сюда можно попасть по вкладке — удобно смотреть текущие с их страницей.
export default function TradesPage() {
  const [tab, setTab] = useState<"closed" | "open">("closed");
  const [trades, setTrades] = useState<Trade[] | null>(null);

  useEffect(() => {
    setTrades(null);
    fetch(`/api/trades?status=${tab}`)
      .then((r) => r.json())
      .then((d) => setTrades(d.trades ?? []))
      .catch(() => setTrades([]));
  }, [tab]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Сделки</h1>
        <div className="flex gap-1 card p-1">
          {(["closed", "open"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-xl text-sm transition-colors ${
                tab === t ? "bg-accent text-white" : "text-muted hover:text-white"
              }`}
            >
              {t === "closed" ? "Закрытые" : "Открытые"}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {trades === null ? (
          <div className="py-16 text-center text-muted text-sm">Загрузка…</div>
        ) : trades.length === 0 ? (
          <div className="py-16 text-center text-muted text-sm">
            {tab === "closed" ? "Закрытых сделок пока нет" : "Открытых сделок нет"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-left border-b border-border bg-bg/40">
                <th className="px-5 py-3 font-normal">Инструмент</th>
                <th className="px-3 py-3 font-normal">Сторона</th>
                <th className="px-3 py-3 font-normal text-right">Объём</th>
                <th className="px-3 py-3 font-normal">Вход</th>
                <th className="px-3 py-3 font-normal">Выход</th>
                <th className="px-3 py-3 font-normal text-right">PnL (чистый)</th>
                <th className="px-5 py-3 font-normal text-center">Заметка</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-b border-border/50 last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-0 py-0" colSpan={7}>
                    <Link href={`/trades/${t.id}`} className="flex items-center w-full">
                      <span className="px-5 py-3 font-medium w-[16%]">{t.symbol}</span>
                      <span className={`px-3 py-3 w-[10%] ${t.direction === "short" ? "text-loss" : "text-profit"}`}>
                        {t.direction === "short" ? "Short" : "Long"}
                      </span>
                      <span className="px-3 py-3 w-[12%] text-right num">{fmtQty(t.qty)}</span>
                      <span className="px-3 py-3 w-[18%] text-muted num">{fmtDateTime(t.opened_at)}</span>
                      <span className="px-3 py-3 w-[18%] text-muted num">{fmtDateTime(t.closed_at)}</span>
                      <span className={`px-3 py-3 w-[16%] text-right num font-medium ${pnlColor(t.net_pnl)}`}>
                        {fmtMoney(t.net_pnl)}
                      </span>
                      <span className="px-5 py-3 w-[10%] text-center text-muted">{t.has_note ? "📝" : ""}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
