import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const positions = getDb()
    .prepare("SELECT * FROM positions ORDER BY symbol")
    .all();
  return NextResponse.json({ positions });
}
