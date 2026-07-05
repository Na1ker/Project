// Реконструкция сделок (round-trip) из исполнений (fills).
//
// Биржа отдаёт отдельные исполнения; «сделкой» считаем путь позиции от нуля
// до нуля: входы (наращивание), возможные усреднения и частичные закрытия,
// полный выход. Реверс одним ордером (long -> short) делим на закрытие старой
// сделки и открытие новой в один момент времени (допущение зафиксировано в спеке).

export interface FillRow {
  id: number;
  symbol: string;
  side: "BUY" | "SELL";
  position_side: string;
  price: number;
  qty: number;
  commission: number;
  ts: number;
}

export interface ReconstructedTrade {
  tradeKey: string;
  symbol: string;
  direction: "long" | "short";
  status: "open" | "closed";
  qty: number;
  avgEntry: number;
  avgExit: number | null;
  openedAt: number;
  closedAt: number | null;
  realizedPnl: number; // без комиссий и фандинга — чистая ценовая разница
  commission: number;
  fillIds: number[];
}

const EPS = 1e-9;

interface OpenState {
  direction: "long" | "short";
  position: number;      // текущий размер позиции, > 0
  entryQty: number;      // суммарно вошло
  entryCost: number;     // sum(price*qty) входов
  exitQty: number;
  exitCost: number;
  commission: number;
  realizedPnl: number;
  openedAt: number;
  fillIds: number[];
}

/**
 * Fills одной группы (symbol + position_side), отсортированные по ts,
 * превращаются в последовательность сделок.
 */
export function reconstructGroup(fills: FillRow[]): ReconstructedTrade[] {
  const trades: ReconstructedTrade[] = [];
  let st: OpenState | null = null;
  // Комиссия каждого исполнения должна попасть ровно в одну сделку, даже если
  // исполнение делится реверсом между двумя (сумма по сделкам = уплачено бирже).
  const commissionTaken = new Set<number>();

  const finish = (closedAt: number): void => {
    if (!st) return;
    trades.push({
      tradeKey: `${fills[0].symbol}|${fills[0].position_side}|${st.openedAt}`,
      symbol: fills[0].symbol,
      direction: st.direction,
      status: "closed",
      qty: st.entryQty,
      avgEntry: st.entryCost / st.entryQty,
      avgExit: st.exitQty > EPS ? st.exitCost / st.exitQty : null,
      openedAt: st.openedAt,
      closedAt,
      realizedPnl: st.realizedPnl,
      commission: st.commission,
      fillIds: st.fillIds,
    });
    st = null;
  };

  for (const f of fills) {
    // Работаем в знаковом пространстве: BUY = +qty, SELL = -qty.
    // Позиция long положительна, short отрицательна — это единообразно
    // покрывает hedge-режим (группы LONG/SHORT) и one-way (BOTH).
    const delta = f.side === "BUY" ? f.qty : -f.qty;
    const deltaSign = delta > 0 ? 1 : -1;
    let remaining = Math.abs(delta);

    while (remaining > EPS) {
      if (!st) {
        // Пустая позиция — любое исполнение открывает сделку в свою сторону.
        st = {
          direction: deltaSign > 0 ? "long" : "short",
          position: 0,
          entryQty: 0,
          entryCost: 0,
          exitQty: 0,
          exitCost: 0,
          commission: 0,
          realizedPnl: 0,
          openedAt: f.ts,
          fillIds: [],
        };
      }

      if (!st.fillIds.includes(f.id)) {
        st.fillIds.push(f.id);
      }
      if (!commissionTaken.has(f.id)) {
        // При сплите реверса комиссия целиком относится к сделке,
        // в которой участвует первая часть исполнения.
        commissionTaken.add(f.id);
        st.commission += f.commission;
      }

      const dirSign = st.direction === "long" ? 1 : -1;
      if (deltaSign === dirSign) {
        // Вход / усреднение.
        st.position += remaining;
        st.entryQty += remaining;
        st.entryCost += f.price * remaining;
        remaining = 0;
      } else {
        // Частичное или полное закрытие.
        const closeQty = Math.min(remaining, st.position);
        st.position -= closeQty;
        st.exitQty += closeQty;
        st.exitCost += f.price * closeQty;
        const avgEntry = st.entryCost / st.entryQty;
        st.realizedPnl += (f.price - avgEntry) * closeQty * dirSign;
        remaining -= closeQty;

        if (st.position <= EPS) {
          finish(f.ts);
          // Остаток исполнения — реверс: следующая итерация откроет
          // новую сделку в противоположную сторону.
        }
      }
    }
  }

  // Позиция не вернулась к нулю — сделка ещё открыта.
  if (st !== null) {
    const s = st as OpenState;
    trades.push({
      tradeKey: `${fills[0].symbol}|${fills[0].position_side}|${s.openedAt}`,
      symbol: fills[0].symbol,
      direction: s.direction,
      status: "open",
      qty: s.entryQty,
      avgEntry: s.entryCost / s.entryQty,
      avgExit: s.exitQty > EPS ? s.exitCost / s.exitQty : null,
      openedAt: s.openedAt,
      closedAt: null,
      realizedPnl: s.realizedPnl,
      commission: s.commission,
      fillIds: s.fillIds,
    });
  }

  return trades;
}

/** Автоподбор таймфрейма графика: вход и выход должны быть различимы. */
export function pickInterval(durationMs: number): string {
  const h = durationMs / 3_600_000;
  if (h <= 2) return "1m";
  if (h <= 8) return "5m";
  if (h <= 24) return "15m";
  if (h <= 72) return "1h";
  if (h <= 336) return "4h"; // до 14 дней
  return "1d";
}

export function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
  };
  return map[interval] ?? 60_000;
}
