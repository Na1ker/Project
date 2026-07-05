import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
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
            <Link href="/" className="flex items-center gap-2.5">
              <span className="inline-block w-3 h-3 rounded-full bg-accent-bright" />
              <span className="font-semibold tracking-wide text-lg">
                Trade<span className="text-accent-bright">Tracker</span>
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted">
              <Link href="/" className="hover:text-white transition-colors">Дашборд</Link>
              <Link href="/trades" className="hover:text-white transition-colors">Сделки</Link>
              <Link href="/settings" className="hover:text-white transition-colors">Настройки</Link>
            </nav>
            <div className="ml-auto">
              <SyncIndicator />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
