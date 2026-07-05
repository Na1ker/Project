import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, setSyncState } from "@/lib/db";
import { BingxConnector } from "@/lib/exchange/bingx";
import { ExchangeAuthError } from "@/lib/exchange/types";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

// Ключ в UI после сохранения показываем только маской (спека: секреты).
function mask(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function GET() {
  return NextResponse.json({
    apiKeyMasked: mask(getSetting("bingx_api_key")),
    hasSecret: Boolean(getSetting("bingx_api_secret")),
  });
}

export async function POST(req: NextRequest) {
  const { apiKey, apiSecret } = (await req.json()) as { apiKey?: string; apiSecret?: string };
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    return NextResponse.json({ error: "Укажи API-ключ и секрет" }, { status: 400 });
  }

  // Проверяем ключи до сохранения — неверный ключ виден сразу, а не через минуту.
  const connector = new BingxConnector(apiKey.trim(), apiSecret.trim());
  try {
    await connector.checkAuth();
  } catch (e) {
    if (e instanceof ExchangeAuthError) {
      return NextResponse.json({ error: "BingX отклонил ключи: проверь ключ, секрет и права доступа" }, { status: 401 });
    }
    return NextResponse.json(
      { error: `Не удалось связаться с BingX: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }

  setSetting("bingx_api_key", apiKey.trim());
  setSetting("bingx_api_secret", apiSecret.trim());
  setSyncState("auth_ok", "true");
  setSyncState("last_error", "");

  // Первый синк запускаем сразу, не дожидаясь минутного таймера.
  void runSync();

  return NextResponse.json({ ok: true });
}
