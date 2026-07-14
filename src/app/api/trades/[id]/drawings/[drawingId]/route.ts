import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Удаление фигуры разметки (v1.3, требование 8).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; drawingId: string }> },
) {
  const { id, drawingId } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT trade_key FROM trades WHERE id = ?").get(Number(id)) as
    | { trade_key: string }
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }
  db.prepare("DELETE FROM drawings WHERE id = ? AND trade_key = ?").run(Number(drawingId), trade.trade_key);
  return NextResponse.json({ ok: true });
}
