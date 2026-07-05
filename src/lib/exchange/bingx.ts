import crypto from "crypto";
import {
  AccountBalance,
  Candle,
  ExchangeAuthError,
  ExchangeConnector,
  ExchangeRateLimitError,
  Fill,
  IncomeRecord,
  OpenPosition,
} from "./types";

const BASE_URL = "https://open-api.bingx.com";

// Коды BingX, означающие проблему с ключами/подписью.
const AUTH_ERROR_CODES = new Set([100001, 100413, 100419, 100202, 80014]);

interface BingxResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export class BingxConnector implements ExchangeConnector {
  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}

  private sign(query: string): string {
    return crypto.createHmac("sha256", this.apiSecret).update(query).digest("hex");
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number> = {},
    isPrivate = true,
  ): Promise<T> {
    const all: Record<string, string | number> = { ...params };
    if (isPrivate) all.timestamp = Date.now();
    const query = Object.keys(all)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(String(all[k]))}`)
      .join("&");
    const url = isPrivate
      ? `${BASE_URL}${path}?${query}&signature=${this.sign(query)}`
      : `${BASE_URL}${path}?${query}`;

    const res = await fetch(url, {
      headers: isPrivate ? { "X-BX-APIKEY": this.apiKey } : {},
      // Никогда не кэшируем биржевые ответы.
      cache: "no-store",
    });

    if (res.status === 429) {
      throw new ExchangeRateLimitError("BingX rate limit (HTTP 429)");
    }
    if (res.status === 401 || res.status === 403) {
      throw new ExchangeAuthError(`BingX auth failed (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`BingX HTTP ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as BingxResponse<T>;
    if (body.code !== 0) {
      if (AUTH_ERROR_CODES.has(body.code)) {
        throw new ExchangeAuthError(`BingX auth error ${body.code}: ${body.msg}`);
      }
      if (body.code === 100410) {
        throw new ExchangeRateLimitError(`BingX rate limit ${body.code}: ${body.msg}`);
      }
      throw new Error(`BingX error ${body.code}: ${body.msg}`);
    }
    return body.data;
  }

  async checkAuth(): Promise<void> {
    await this.getBalance();
  }

  async getBalance(): Promise<AccountBalance> {
    const data = await this.request<{
      balance: { balance: string; equity: string; unrealizedProfit: string };
    }>("/openApi/swap/v2/user/balance");
    const b = data.balance;
    return {
      balance: parseFloat(b.balance),
      equity: parseFloat(b.equity),
      unrealizedPnl: parseFloat(b.unrealizedProfit),
    };
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
    const data = await this.request<
      Array<{
        symbol: string;
        positionSide: string;
        positionAmt: string;
        avgPrice: string;
        markPrice: string;
        unrealizedProfit: string;
        leverage?: number | string;
        createTime?: number;
        updateTime?: number;
      }>
    >("/openApi/swap/v2/user/positions");
    return (data ?? [])
      .filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0)
      .map((p) => ({
        symbol: p.symbol,
        positionSide: (p.positionSide?.toUpperCase() ?? "BOTH") as OpenPosition["positionSide"],
        qty: Math.abs(parseFloat(p.positionAmt)),
        entryPrice: parseFloat(p.avgPrice),
        markPrice: parseFloat(p.markPrice),
        unrealizedPnl: parseFloat(p.unrealizedProfit),
        leverage: p.leverage != null ? Number(p.leverage) : null,
        openedAt: p.createTime ?? null,
      }));
  }

  async getFills(startTs: number, endTs: number): Promise<Fill[]> {
    const fills = await this.fetchFillsWindow(startTs, endTs);
    // Защита от молчаливой обрезки ответа биржей: если исполнений подозрительно
    // много, делим окно пополам и собираем половины (до окна в 1 час).
    if (fills.length < 500 || endTs - startTs <= 3_600_000) return fills;
    const mid = Math.floor((startTs + endTs) / 2);
    const [left, right] = [await this.getFills(startTs, mid), await this.getFills(mid + 1, endTs)];
    const seen = new Set(left.map((f) => f.fillId));
    return [...left, ...right.filter((f) => !seen.has(f.fillId))];
  }

  private async fetchFillsWindow(startTs: number, endTs: number): Promise<Fill[]> {
    // BingX ограничивает окно запроса — вызывающий код режет диапазон на окна <= 7 дней.
    const data = await this.request<{
      fill_orders: Array<{
        filledTm: string;      // ISO или ms — нормализуем
        volume: string;        // объём в монетах
        price: string;
        amount: string;
        commission: string;    // отрицательная у BingX
        currency: string;
        orderId: string;
        tradeId?: string;
        liquidatedPrice?: string;
        liquidatedMarginRatio?: string;
        filledTime?: string;
        symbol: string;
        side?: string;         // BUY | SELL (у части версий API — action)
        action?: string;
        positionSide?: string;
      }>;
    }>("/openApi/swap/v2/trade/allFillOrders", {
      startTs,
      endTs,
      tradingUnit: "COIN",
    });

    return (data?.fill_orders ?? []).map((f) => {
      const side = (f.side ?? f.action ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
      const ts = f.filledTm
        ? Date.parse(f.filledTm) || Number(f.filledTm)
        : Number(f.filledTime);
      return {
        // tradeId не всегда присутствует — собираем стабильный ключ.
        fillId: f.tradeId ?? `${f.orderId}-${ts}-${f.volume}-${f.price}`,
        orderId: f.orderId,
        symbol: f.symbol,
        side,
        positionSide: (f.positionSide?.toUpperCase() ?? "BOTH") as Fill["positionSide"],
        price: parseFloat(f.price),
        qty: Math.abs(parseFloat(f.volume)),
        commission: Math.abs(parseFloat(f.commission ?? "0")),
        ts,
        raw: f,
      };
    });
  }

  async getIncome(startTs: number, endTs: number): Promise<IncomeRecord[]> {
    // Лимит эндпоинта — 1000 записей: добираем страницами, сдвигая startTime
    // за последнюю полученную запись, пока страница не станет неполной.
    const out: IncomeRecord[] = [];
    let cursor = startTs;
    for (let page = 0; page < 30; page++) {
      const data = await this.request<
        Array<{
          symbol: string;
          incomeType: string;
          income: string;
          asset: string;
          time: number;
          tranId?: string;
          tradeId?: string;
        }>
      >("/openApi/swap/v2/user/income", {
        startTime: cursor,
        endTime: endTs,
        limit: 1000,
      });
      const records = (data ?? []).map((r) => ({
        incomeId: r.tranId ?? `${r.incomeType}-${r.symbol}-${r.time}-${r.income}`,
        type: r.incomeType,
        symbol: r.symbol,
        amount: parseFloat(r.income),
        ts: r.time,
      }));
      out.push(...records);
      if (records.length < 1000) break;
      cursor = Math.max(...records.map((r) => r.ts)) + 1;
    }
    return out;
  }

  async getCandles(symbol: string, interval: string, startTs: number, endTs: number): Promise<Candle[]> {
    const data = await this.request<
      Array<{ open: string; high: string; low: string; close: string; volume: string; time: number }>
    >(
      "/openApi/swap/v3/quote/klines",
      { symbol, interval, startTime: startTs, endTime: endTs, limit: 1440 },
      false,
    );
    return (data ?? [])
      .map((c) => ({
        ts: c.time,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume),
      }))
      .sort((a, b) => a.ts - b.ts);
  }
}
