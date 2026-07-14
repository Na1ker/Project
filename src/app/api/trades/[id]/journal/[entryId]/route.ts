import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Удаление записи журнала (v1.3, требование 3). Запись должна принадлежать сделке.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const db = getDb();
  const trade = db.prepare("SELECT trade_key FROM trades WHERE id = ?").get(Number(id)) as
    | { trade_key: string }
    | undefined;
  if (!trade) {
    return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  }
  db.prepare("DELETE FROM note_entries WHERE id = ? AND trade_key = ?").run(Number(entryId), trade.trade_key);
  return NextResponse.json({ ok: true });
}
