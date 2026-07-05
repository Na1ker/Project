import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Заметка «почему зашёл» — привязана к trade_key, переживает пересборку сделок.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT trade_key FROM trades WHERE id = ?").get(Number(id)) as
    | { trade_key: string }
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }

  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== "string") {
    return NextResponse.json({ error: "text обязателен" }, { status: 400 });
  }

  if (text.trim() === "") {
    db.prepare("DELETE FROM notes WHERE trade_key = ?").run(trade.trade_key);
  } else {
    db.prepare(
      `INSERT INTO notes (trade_key, text, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(trade_key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
    ).run(trade.trade_key, text, Date.now());
  }
  return NextResponse.json({ ok: true });
}
