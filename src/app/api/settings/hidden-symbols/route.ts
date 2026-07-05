import { NextRequest, NextResponse } from "next/server";
import { getDb, getHiddenSymbols, setHiddenSymbols } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  // Все инструменты из истории — чтобы в настройках было из чего выбирать.
  const allSymbols = (getDb()
    .prepare("SELECT DISTINCT symbol FROM trades ORDER BY symbol")
    .all() as Array<{ symbol: string }>).map((r) => r.symbol);
  return NextResponse.json({ hidden: getHiddenSymbols(), allSymbols });
}

export async function PUT(req: NextRequest) {
  const { hidden } = (await req.json()) as { hidden?: string[] };
  if (!Array.isArray(hidden) || hidden.some((s) => typeof s !== "string")) {
    return NextResponse.json({ error: "hidden должен быть массивом строк" }, { status: 400 });
  }
  setHiddenSymbols(hidden);
  return NextResponse.json({ ok: true, hidden: getHiddenSymbols() });
}
