import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ProfileMenu } from "@/components/ProfileMenu";
import { SyncIndicator } from "@/components/SyncIndicator";

export const metadata: Metadata = {
  title: "Trade Tracker — BingX",
  description: "Статистика и история фьючерсных сделок BingX",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <header className="border-b border-border sticky top-0 z-10 bg-bg/90 backdrop-blur">
          <div className="mx-auto max-w-7xl px-6 h-16 flex items-center gap-8">
            <Link href="/" aria-label="На главную" className="flex items-center">
              {/* Простой знак-заглушка вместо названия (спека v1.1, требование 8) */}
              <svg viewBox="0 0 64 64" className="w-9 h-9" aria-hidden="true">
                <rect width="64" height="64" rx="14" fill="#131316" stroke="#232329" />
                <rect x="14" y="22" width="8" height="20" rx="2" fill="#8b1e2d" />
                <rect x="17" y="14" width="2" height="36" fill="#8b1e2d" />
                <rect x="28" y="12" width="8" height="24" rx="2" fill="#c22b3f" />
                <rect x="31" y="6" width="2" height="38" fill="#c22b3f" />
                <rect x="42" y="28" width="8" height="18" rx="2" fill="#22c55e" />
                <rect x="45" y="20" width="2" height="34" fill="#22c55e" />
              </svg>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted">
              <Link href="/" className="hover:text-white transition-colors">Дашборд</Link>
              <Link href="/trades" className="hover:text-white transition-colors">Сделки</Link>
              <Link href="/analysis" className="hover:text-white transition-colors">Анализ</Link>
            </nav>
            <div className="ml-auto flex items-center gap-4">
              <SyncIndicator />
              <ProfileMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
