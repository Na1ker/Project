import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { netPnl, TradeRow } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT * FROM trades WHERE id = ?").get(Number(id)) as unknown as
    | TradeRow
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }

  const note = db.prepare("SELECT text, updated_at FROM notes WHERE trade_key = ?").get(trade.trade_key) as
    | { text: string; updated_at: number }
    | undefined;

  // Сделки из истории позиций не хранят fill_ids — исполнения привязываются
  // по инструменту и интервалу времени позиции (требование 4 спеки v1.1).
  const fillIds = JSON.parse(trade.fill_ids) as number[];
  let fills;
  if (fillIds.length > 0) {
    fills = db
      .prepare(
        `SELECT id, side, position_side, price, qty, commission, ts FROM fills
         WHERE id IN (${fillIds.map(() => "?").join(",")}) ORDER BY ts`,
      )
      .all(...fillIds);
  } else {
    const from = trade.opened_at - 60_000;
    const to = (trade.closed_at ?? Date.now()) + 60_000;
    const side = trade.direction === "long" ? "LONG" : "SHORT";
    fills = db
      .prepare(
        `SELECT id, side, position_side, price, qty, commission, ts FROM fills
         WHERE symbol = ? AND ts >= ? AND ts <= ? AND position_side IN (?, 'BOTH')
         ORDER BY ts`,
      )
      .all(trade.symbol, from, to, side);
  }

  // Для открытой сделки — текущий нереализованный PnL из снапшота позиций
  // (крайний случай спеки «позиция ещё открыта»).
  let position: { unrealized_pnl: number; mark_price: number } | null = null;
  if (trade.status === "open") {
    const wantedSide = trade.direction === "long" ? "LONG" : "SHORT";
    position = (db
      .prepare(
        "SELECT unrealized_pnl, mark_price FROM positions WHERE symbol = ? AND position_side IN (?, 'BOTH') LIMIT 1",
      )
      .get(trade.symbol, wantedSide) ?? null) as { unrealized_pnl: number; mark_price: number } | null;
  }

  return NextResponse.json({
    trade: { ...trade, net_pnl: netPnl(trade) },
    note: note ?? null,
    fills,
    position,
  });
}
