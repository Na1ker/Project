// Интерфейс коннектора биржи. BingX — первая реализация; другие биржи
// (Binance и т.д.) добавляются реализацией этого же интерфейса без переписывания ядра.

export interface AccountBalance {
  balance: number;        // баланс кошелька (USDT)
  equity: number;         // капитал = баланс + нереализованный PnL
  unrealizedPnl: number;
}

export interface OpenPosition {
  symbol: string;
  positionSide: "LONG" | "SHORT" | "BOTH";
  qty: number;            // размер позиции (в монетах), всегда > 0
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number | null;
  marginMode: "cross" | "isolated" | null;
  openedAt: number | null; // unix ms, если биржа отдаёт
}

export interface Fill {
  fillId: string;         // уникальный ID исполнения на бирже
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT" | "BOTH";
  price: number;
  qty: number;
  commission: number;     // в USDT, >= 0
  ts: number;             // unix ms
  raw?: unknown;
}

export interface IncomeRecord {
  incomeId: string;       // уникальный ID записи
  type: string;           // FUNDING_FEE и др.
  symbol: string;
  amount: number;         // знак как у биржи: отрицательный = списание
  ts: number;
}

// Закрытая позиция из истории позиций биржи — источник истины для сделок (v1.1).
export interface PositionHistoryRecord {
  positionId: string;
  symbol: string;
  direction: "long" | "short";
  qty: number;             // суммарно открыто (в монетах)
  avgEntry: number;
  avgExit: number;
  realizedPnl: number;     // ценовой PnL (Closed PnL биржи)
  netProfit: number | null; // итог с учётом комиссий/фандинга (Realized PnL биржи)
  commission: number;      // >= 0
  funding: number;         // со знаком биржи
  leverage: number | null;
  marginMode: "cross" | "isolated" | null;
  openedAt: number;
  closedAt: number;
  raw?: unknown;
}

export interface Candle {
  ts: number;             // открытие свечи, unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExchangeConnector {
  /** Проверка ключей: дешёвый приватный запрос. Бросает ExchangeAuthError при неверных ключах. */
  checkAuth(): Promise<void>;
  getBalance(): Promise<AccountBalance>;
  getOpenPositions(): Promise<OpenPosition[]>;
  /** Исполнения за интервал [startTs, endTs], оба unix ms. */
  getFills(startTs: number, endTs: number): Promise<Fill[]>;
  /** Записи income (фандинг и пр.) за интервал. */
  getIncome(startTs: number, endTs: number): Promise<IncomeRecord[]>;
  /** Публичные свечи. interval: 1m|5m|15m|1h|4h|1d */
  getCandles(symbol: string, interval: string, startTs: number, endTs: number): Promise<Candle[]>;
  /**
   * История закрытых позиций инструмента за интервал — источник истины для
   * сделок. BingX отдаёт историю только по конкретному символу.
   * Опциональный: биржи без такого API работают через реконструкцию из fills.
   */
  getPositionHistory?(symbol: string, startTs: number, endTs: number): Promise<PositionHistoryRecord[]>;
}

export class ExchangeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeAuthError";
  }
}

export class ExchangeRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeRateLimitError";
  }
}
