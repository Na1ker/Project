import { NextRequest, NextResponse } from "next/server";
import { getCurrentEquity, getEquityCurve, getPeriodStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

const ALLOWED_PERIODS = [7, 30, 90, 180];

export async function GET(req: NextRequest) {
  const period = Number(req.nextUrl.searchParams.get("period") ?? 30);
  if (!ALLOWED_PERIODS.includes(period)) {
    return NextResponse.json({ error: "period должен быть 7, 30, 90 или 180" }, { status: 400 });
  }
  return NextResponse.json({
    stats: getPeriodStats(period),
    equityCurve: getEquityCurve(period),
    currentEquity: getCurrentEquity(),
  });
}
