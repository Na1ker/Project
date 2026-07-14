import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Журнал заметок сделки: добавление записи (v1.3, требования 1-2).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT trade_key FROM trades WHERE id = ?").get(Number(id)) as
    | { trade_key: string }
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }

  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: "Пустая запись не сохраняется" }, { status: 400 });
  }

  const createdAt = Date.now();
  const res = db
    .prepare("INSERT INTO note_entries (trade_key, text, created_at) VALUES (?, ?, ?)")
    .run(trade.trade_key, text.trim(), createdAt);

  return NextResponse.json({
    entry: { id: Number(res.lastInsertRowid), text: text.trim(), createdAt },
  });
}
