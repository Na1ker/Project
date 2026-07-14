import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { netPnl, TradeRow } from "@/lib/stats";
import { TradeDataset } from "@/lib/dataset";

export const dynamic = "force-dynamic";

// Датасет сделки (требование 11 спеки v1.3): единый JSON — сделка + журнал +
// разметка. Контракт для будущего LLM-анализа, формат — src/lib/dataset.ts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const t = db.prepare("SELECT * FROM trades WHERE id = ?").get(Number(id)) as unknown as
    | TradeRow
    | undefined;
  if (!t) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }

  const journal = (db
    .prepare("SELECT id, text, created_at FROM note_entries WHERE trade_key = ? ORDER BY created_at DESC")
    .all(t.trade_key) as Array<{ id: number; text: string; created_at: number }>)
    .map((e) => ({ id: e.id, text: e.text, createdAt: e.created_at }));

  const drawings = (db
    .prepare("SELECT * FROM drawings WHERE trade_key = ? ORDER BY created_at")
    .all(t.trade_key) as Array<{
      id: number; kind: string; p1_ts: number; p1_price: number; p2_ts: number; p2_price: number;
      color: string; created_at: number;
    }>)
    .map((d) => ({
      id: d.id,
      kind: "trendline" as const,
      p1: { ts: d.p1_ts, price: d.p1_price },
      p2: { ts: d.p2_ts, price: d.p2_price },
      color: d.color,
      createdAt: d.created_at,
    }));

  const dataset: TradeDataset = {
    trade: {
      id: t.id,
      symbol: t.symbol,
      direction: t.direction as "long" | "short",
      status: t.status as "open" | "closed",
      qty: t.qty,
      avgEntry: t.avg_entry,
      avgExit: t.avg_exit,
      openedAt: t.opened_at,
      closedAt: t.closed_at,
      leverage: t.leverage,
      marginMode: t.margin_mode ?? null,
      realizedPnl: t.realized_pnl,
      commission: t.commission,
      funding: t.funding,
      netPnl: netPnl(t),
    },
    journal,
    drawings,
  };

  return NextResponse.json(dataset);
}
