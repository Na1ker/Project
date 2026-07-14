import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Сохранение фигуры разметки (v1.3, требование 7): линия сохраняется сразу
// после постановки второй точки, координаты — цена/время.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT trade_key FROM trades WHERE id = ?").get(Number(id)) as
    | { trade_key: string }
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }

  const body = (await req.json()) as {
    kind?: string;
    p1?: { ts: number; price: number };
    p2?: { ts: number; price: number };
    color?: string;
  };
  if (
    body.kind !== "trendline" ||
    !body.p1 || !body.p2 ||
    ![body.p1.ts, body.p1.price, body.p2.ts, body.p2.price].every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    return NextResponse.json({ error: "Некорректная фигура" }, { status: 400 });
  }

  const createdAt = Date.now();
  const color = typeof body.color === "string" ? body.color : "#c22b3f";
  const res = db
    .prepare(
      `INSERT INTO drawings (trade_key, kind, p1_ts, p1_price, p2_ts, p2_price, color, created_at)
       VALUES (?, 'trendline', ?, ?, ?, ?, ?, ?)`,
    )
    .run(trade.trade_key, body.p1.ts, body.p1.price, body.p2.ts, body.p2.price, color, createdAt);

  return NextResponse.json({
    drawing: {
      id: Number(res.lastInsertRowid),
      kind: "trendline",
      p1: body.p1,
      p2: body.p2,
      color,
      createdAt,
    },
  });
}
