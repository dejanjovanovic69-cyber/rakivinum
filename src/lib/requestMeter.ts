const counters = new Map<string, number>();
let lastFlushAt = Date.now();

/** Opt-in prod metering: set to "1" then reload (or use `__rakivinumDbReadsEnable()`). */
export const RAKIVINUM_DEBUG_DB_READS_LS_KEY = "rakivinum_debug_db_reads";

const LOG_PREFIX = "[rakivinum-db-reads]";

function isDevEnv(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } })?.env?.DEV);
  } catch {
    return false;
  }
}

/** True in Vite dev, or on any build when localStorage flag is set (after reload). */
export function isDbReadMeteringEnabled(): boolean {
  if (isDevEnv()) return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(RAKIVINUM_DEBUG_DB_READS_LS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Estimated client-side Firestore document reads (fallback paths + direct queries). Worker-side reads are not included. */
export function getDbReadSnapshot(): { total: number; byLabel: Record<string, number> } | null {
  if (!isDbReadMeteringEnabled()) return null;
  const byLabel = Object.fromEntries(
    Array.from(counters.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const total = Array.from(counters.values()).reduce((a, b) => a + b, 0);
  return { total, byLabel };
}

export function resetDbReadMeter(): void {
  if (!isDbReadMeteringEnabled()) return;
  counters.clear();
  lastFlushAt = Date.now();
}

export function meterDbRead(label: string, amount = 1): void {
  if (!isDbReadMeteringEnabled()) return;
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
  if (rows) console.info(`${LOG_PREFIX} ${rows}`);
}

if (typeof window !== "undefined") {
  const w = window as unknown as {
    __rakivinumDbReads?: () => void;
    __rakivinumDbReadsReset?: () => void;
    __rakivinumDbReadsEnable?: () => void;
    __rakivinumDbReadsDisable?: () => void;
  };

  w.__rakivinumDbReadsEnable = () => {
    try {
      localStorage.setItem(RAKIVINUM_DEBUG_DB_READS_LS_KEY, "1");
      console.info(`${LOG_PREFIX} flag set; reloading…`);
      location.reload();
    } catch (e) {
      console.warn(`${LOG_PREFIX} could not enable (storage blocked?)`, e);
    }
  };

  w.__rakivinumDbReadsDisable = () => {
    try {
      localStorage.removeItem(RAKIVINUM_DEBUG_DB_READS_LS_KEY);
      console.info(`${LOG_PREFIX} flag cleared; reloading…`);
      location.reload();
    } catch (e) {
      console.warn(`${LOG_PREFIX} could not disable`, e);
    }
  };

  w.__rakivinumDbReads = () => {
    if (!isDbReadMeteringEnabled()) {
      console.info(
        `${LOG_PREFIX} metering off. Run __rakivinumDbReadsEnable() once, then after reload use Reset / snapshot. Worker Firestore reads are never counted here.`,
      );
      return;
    }
    const snap = getDbReadSnapshot();
    if (!snap) return;
    console.info(`${LOG_PREFIX} total (client-estimated, no Worker)`, snap.total);
    console.table(snap.byLabel);
  };

  w.__rakivinumDbReadsReset = () => {
    if (!isDbReadMeteringEnabled()) {
      console.info(`${LOG_PREFIX} metering off — run __rakivinumDbReadsEnable() first.`);
      return;
    }
    resetDbReadMeter();
    console.info(`${LOG_PREFIX} meter cleared`);
  };

  if (isDbReadMeteringEnabled() && !isDevEnv()) {
    console.info(
      `${LOG_PREFIX} prod metering ON (localStorage). Firestore usage in Firebase console includes Worker; this counter is browser SDK + fallbacks only.`,
    );
  }
}
