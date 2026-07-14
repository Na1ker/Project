// Контракт «датасета сделки» (требование 11 спеки v1.3): единый JSON по сделке —
// параметры и результат + журнал мыслей + разметка графика. На этом формате
// будущая версия запустит LLM-анализ сетапов; менять поля — только расширяя.

export interface JournalEntry {
  id: number;
  text: string;
  createdAt: number; // unix ms
}

export interface TrendlineDrawing {
  id: number;
  kind: "trendline";
  p1: { ts: number; price: number };
  p2: { ts: number; price: number };
  color: string;
  createdAt: number;
}

export type Drawing = TrendlineDrawing;

export interface TradeDataset {
  trade: {
    id: number;
    symbol: string;
    direction: "long" | "short";
    status: "open" | "closed";
    qty: number;
    avgEntry: number;
    avgExit: number | null;
    openedAt: number;
    closedAt: number | null;
    leverage: number | null;
    marginMode: string | null;
    realizedPnl: number;
    commission: number;
    funding: number;
    netPnl: number;
  };
  journal: JournalEntry[];
  drawings: Drawing[];
}
