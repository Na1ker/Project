"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SettingsForm() {
  const router = useRouter();
  const isOnboarding = useSearchParams().get("onboarding") === "1";
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [current, setCurrent] = useState<{ apiKeyMasked: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setCurrent).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Не удалось сохранить");
        return;
      }
      router.push("/");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {isOnboarding && (
        <div className="text-center space-y-2 pt-8">
          <h1 className="text-3xl font-semibold">
            Добро пожаловать в Trade<span className="text-accent-bright">Tracker</span>
          </h1>
          <p className="text-muted">
            Подключи BingX, чтобы видеть свои фьючерсные сделки, статистику и капитал.
            Ключи хранятся только на этом компьютере.
          </p>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <h2 className="font-medium text-lg">API-ключи BingX</h2>
        <p className="text-sm text-muted">
          Создай ключ в BingX: Профиль → API-менеджмент. Достаточно прав «чтение»
          (Read). Права на торговлю и вывод средств не нужны.
        </p>
        {current?.apiKeyMasked && (
          <div className="text-sm text-muted">
            Сейчас подключён ключ: <span className="num">{current.apiKeyMasked}</span>
          </div>
        )}
        <div className="space-y-3">
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API Key"
            autoComplete="off"
            className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-bright"
          />
          <input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="API Secret"
            autoComplete="off"
            className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-bright"
          />
        </div>
        {error && (
          <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-xl px-4 py-3">{error}</div>
        )}
        <button
          onClick={save}
          disabled={saving || !apiKey.trim() || !apiSecret.trim()}
          className="w-full bg-accent hover:bg-accent-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-xl py-2.5 font-medium"
        >
          {saving ? "Проверяю ключи…" : "Подключить BingX"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsForm />
    </Suspense>
  );
}
