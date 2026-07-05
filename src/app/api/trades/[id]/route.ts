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

  const fillIds = JSON.parse(trade.fill_ids) as number[];
  const fills =
    fillIds.length > 0
      ? db
          .prepare(
            `SELECT id, side, position_side, price, qty, commission, ts FROM fills
             WHERE id IN (${fillIds.map(() => "?").join(",")}) ORDER BY ts`,
          )
          .all(...fillIds)
      : [];

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
