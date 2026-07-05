import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hiddenFilter } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const hf = hiddenFilter();
  const positions = getDb()
    .prepare(`SELECT * FROM positions WHERE 1=1${hf.clause} ORDER BY symbol`)
    .all(...hf.params);
  return NextResponse.json({ positions });
}
