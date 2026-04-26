const counters = new Map<string, number>();
let lastFlushAt = Date.now();

function isDevEnv(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } })?.env?.DEV);
  } catch {
    return false;
  }
}

/** Dev-only: estimated client-side Firestore document reads (fallback paths + direct queries). */
export function getDbReadSnapshot(): { total: number; byLabel: Record<string, number> } | null {
  if (!isDevEnv()) return null;
  const byLabel = Object.fromEntries(
    Array.from(counters.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const total = Array.from(counters.values()).reduce((a, b) => a + b, 0);
  return { total, byLabel };
}

/** Dev-only: clear counters before a manual navigation test. */
export function resetDbReadMeter(): void {
  if (!isDevEnv()) return;
  counters.clear();
  lastFlushAt = Date.now();
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

if (typeof window !== "undefined" && isDevEnv()) {
  const w = window as unknown as {
    __rakivinumDbReads?: () => void;
    __rakivinumDbReadsReset?: () => void;
  };
  w.__rakivinumDbReads = () => {
    const snap = getDbReadSnapshot();
    if (!snap) return;
    console.info("[dev-db-reads] total (client-estimated)", snap.total);
    console.table(snap.byLabel);
  };
  w.__rakivinumDbReadsReset = () => {
    resetDbReadMeter();
    console.info("[dev-db-reads] meter cleared");
  };
}

