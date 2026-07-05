"use client";

import { useEffect, useState } from "react";

interface Status {
  hasKeys: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  authOk: boolean;
}

// Индикатор «последняя синхронизация N минут назад» + точка состояния.
export function SyncIndicator() {
  const [status, setStatus] = useState<Status | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const load = () => fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
    load();
    const poll = setInterval(load, 15_000);
    const tick = setInterval(() => forceTick((x) => x + 1), 30_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  if (!status || !status.hasKeys) return null;

  const ageMin = status.lastSyncAt ? Math.floor((Date.now() - status.lastSyncAt) / 60_000) : null;
  const stale = ageMin !== null && ageMin >= 3;
  const bad = !status.authOk || Boolean(status.lastError);

  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          bad ? "bg-loss" : stale ? "bg-yellow-500" : "bg-profit"
        }`}
      />
      {status.lastSyncAt
        ? ageMin === 0
          ? "синхронизировано только что"
          : `синхронизация ${ageMin} мин назад`
        : "ожидание первой синхронизации…"}
    </div>
  );
}
