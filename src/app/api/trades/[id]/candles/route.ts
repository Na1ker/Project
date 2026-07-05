import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConnector } from "@/lib/sync";
import { intervalToMs, pickInterval } from "@/lib/trades";
import { TradeRow } from "@/lib/stats";

export const dynamic = "force-dynamic";

// Свечи для страницы сделки: таймфрейм подбирается по длительности сделки,
// диапазон — с запасом ~25% до входа и после выхода. Кэшируются в базе,
// чтобы страница открывалась и без сети (требование 16).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT * FROM trades WHERE id = ?").get(Number(id)) as unknown as
    | TradeRow
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }

  const closedAt = trade.closed_at ?? Date.now();
  const duration = Math.max(closedAt - trade.opened_at, 60_000);
  const interval = pickInterval(duration);
  const pad = Math.max(duration * 0.25, intervalToMs(interval) * 30);
  const from = trade.opened_at - pad;
  const to = Math.min(closedAt + pad, Date.now());

  // Сначала пробуем догрузить свежие свечи с биржи и закэшировать.
  let fetchError: string | null = null;
  const connector = getConnector();
  if (connector) {
    try {
      const candles = await connector.getCandles(trade.symbol, interval, from, to);
      const ins = db.prepare(
        `INSERT INTO candles (symbol, interval, ts, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, interval, ts) DO UPDATE SET
           open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`,
      );
      for (const c of candles) {
        ins.run(trade.symbol, interval, c.ts, c.open, c.high, c.low, c.close, c.volume);
      }
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
  }

  const cached = db
    .prepare(
      "SELECT ts, open, high, low, close, volume FROM candles WHERE symbol = ? AND interval = ? AND ts >= ? AND ts <= ? ORDER BY ts",
    )
    .all(trade.symbol, interval, from, to);

  // Свечей нет ни в сети, ни в кэше (делистнут / история глубже лимита биржи) —
  // страница покажет факты без графика с пометкой (крайний случай спеки).
  return NextResponse.json({
    interval,
    candles: cached,
    unavailable: cached.length === 0,
    fetchError,
  });
}
