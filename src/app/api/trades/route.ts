import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hiddenFilter, netPnl, TradeRow } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "closed";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 200), 1000);

  const hf = hiddenFilter();
  const rows = getDb()
    .prepare(
      `SELECT t.*, (n.trade_key IS NOT NULL) AS has_note
       FROM trades t LEFT JOIN notes n ON n.trade_key = t.trade_key
       WHERE t.status = ?${hf.clause.replaceAll("symbol", "t.symbol")}
       ORDER BY COALESCE(t.closed_at, t.opened_at) DESC
       LIMIT ?`,
    )
    .all(status, ...hf.params, limit) as unknown as TradeRow[];

  return NextResponse.json({
    trades: rows.map((t) => ({ ...t, net_pnl: netPnl(t) })),
  });
}
