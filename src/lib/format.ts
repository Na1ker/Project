// Все даты в UI — в локальной таймзоне пользователя (в базе — UTC ms).

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const digits = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}

// Объём собирается суммированием дробных исполнений — обрезаем шум
// floating point (0.010400000000000003 -> 0.0104).
export function fmtQty(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return parseFloat(v.toPrecision(10)).toString();
}

export function fmtPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ч ${m % 60} мин`;
  const d = Math.floor(h / 24);
  return `${d} дн ${h % 24} ч`;
}

export function pnlColor(v: number | null | undefined): string {
  if (v == null) return "";
  return v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-muted";
}
