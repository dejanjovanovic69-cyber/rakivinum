const counters = new Map<string, number>();
let lastFlushAt = Date.now();

function isDevEnv(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } })?.env?.DEV);
  } catch {
    return false;
  }
}

export function meterDbRead(label: string, amount = 1): void {
  if (!isDevEnv()) return;
  const safeLabel = String(label || "unknown");
  const prev = counters.get(safeLabel) ?? 0;
  counters.set(safeLabel, prev + Math.max(1, amount));

  const now = Date.now();
  if (now - lastFlushAt < 30_000) return;
  lastFlushAt = now;

  const rows = Array.from(counters.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `${k}:${v}`)
    .join(" | ");
  if (rows) console.info(`[dev-db-reads] ${rows}`);
}

