import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentEquity } from "@/lib/stats";
import { hiddenFilter } from "@/lib/stats";
import { netPnl, TradeRow } from "@/lib/stats";

export const dynamic = "force-dynamic";

const PERIODS = new Set(["7", "30", "90", "180", "all"]);

// Данные для страницы «Анализ»: закрытые сделки выборки (скрытые инструменты
// исключены) в порядке закрытия + текущий капитал. Все расчёты — на клиенте.
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? "all";
  if (!PERIODS.has(period)) {
    return NextResponse.json({ error: "period должен быть 7, 30, 90, 180 или all" }, { status: 400 });
  }
  const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;

  const hf = hiddenFilter();
  const rows = getDb()
    .prepare(
      `SELECT * FROM trades WHERE status = 'closed' AND closed_at >= ?${hf.clause} ORDER BY closed_at ASC`,
    )
    .all(since, ...hf.params) as unknown as TradeRow[];

  return NextResponse.json({
    trades: rows.map((t) => ({ pnl: netPnl(t), openedAt: t.opened_at, closedAt: t.closed_at })),
    currentEquity: getCurrentEquity()?.equity ?? null,
  });
}
