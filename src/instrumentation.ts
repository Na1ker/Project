// Запускается один раз при старте сервера Next.js — здесь стартует
// фоновая синхронизация каждые 60 секунд (требование 2 спеки).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSyncLoop } = await import("./lib/sync");
    startSyncLoop();
  }
}
