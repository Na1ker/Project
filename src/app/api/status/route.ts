import { NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { getSyncStatus } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const hasKeys = Boolean(getSetting("bingx_api_key") && getSetting("bingx_api_secret"));
  return NextResponse.json({ hasKeys, ...getSyncStatus() });
}
