const counters = new Map<string, number>();
let lastFlushAt = Date.now();
const edgeCounters = new Map<string, number>();
let lastEdgeFlushAt = Date.now();
const SAVED_READS_DAY_KEY = "rakivinum_saved_reads_day";
const SAVED_READS_COUNT_KEY = "rakivinum_saved_reads_count";
const SAVED_READS_REASON_PREFIX = "rakivinum_saved_reads_reason_";
let savedReadsTodayMem = 0;
let hardLockAnnounced = false;

/** Opt-in prod metering: set to "1" then reload (or use `__rakivinumDbReadsEnable()`). */
export const RAKIVINUM_DEBUG_DB_READS_LS_KEY = "rakivinum_debug_db_reads";
export const RAKIVINUM_DEBUG_EDGE_METER_LS_KEY = "rakivinum_debug_edge_meter";

const LOG_PREFIX = "[rakivinum-db-reads]";
const SAVED_LOG_PREFIX = "[rakivinum-saved-reads]";

function dayKeyNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function ensureSavedReadsDayLoaded(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const today = dayKeyNow();
    const day = localStorage.getItem(SAVED_READS_DAY_KEY);
    const raw = localStorage.getItem(SAVED_READS_COUNT_KEY);
    if (day !== today) {
      savedReadsTodayMem = 0;
      localStorage.setItem(SAVED_READS_DAY_KEY, today);
      localStorage.setItem(SAVED_READS_COUNT_KEY, "0");
      return;
    }
    const parsed = Number(raw || "0");
    savedReadsTodayMem = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    // ignore storage failures
  }
}

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

/** Edge endpoint metering for Worker-first flows (status + cache source). */
export function isEdgeMeteringEnabled(): boolean {
  if (isDevEnv()) return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(RAKIVINUM_DEBUG_EDGE_METER_LS_KEY) === "1";
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

export function getEdgeMeterSnapshot(): { total: number; byLabel: Record<string, number> } | null {
  if (!isEdgeMeteringEnabled()) return null;
  const byLabel = Object.fromEntries(
    Array.from(edgeCounters.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const total = Array.from(edgeCounters.values()).reduce((a, b) => a + b, 0);
  return { total, byLabel };
}

export function resetEdgeMeter(): void {
  if (!isEdgeMeteringEnabled()) return;
  edgeCounters.clear();
  lastEdgeFlushAt = Date.now();
}

export function meterEdgeRequest(path: string, status: number, cacheStatus: string | null): void {
  if (!isEdgeMeteringEnabled()) return;
  const endpoint = String(path || "unknown").split("?")[0];
  const safeStatus = Number.isFinite(status) ? status : 0;
  const cache = String(cacheStatus || "none").trim().toLowerCase() || "none";
  const key = `${endpoint} | status:${safeStatus} | cache:${cache}`;
  const prev = edgeCounters.get(key) ?? 0;
  edgeCounters.set(key, prev + 1);

  const now = Date.now();
  if (now - lastEdgeFlushAt < 30_000) return;
  lastEdgeFlushAt = now;
  const rows = Array.from(edgeCounters.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([k, v]) => `${k}:${v}`)
    .join(" | ");
  if (rows) console.info(`[rakivinum-edge-meter] ${rows}`);
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

/** Records estimated reads avoided due to quota-saver cache-only skip. */
export function meterSavedReads(amount = 1, reason = "unknown"): void {
  const inc = Math.max(1, Math.floor(Number(amount) || 1));
  if (typeof localStorage !== "undefined") ensureSavedReadsDayLoaded();
  savedReadsTodayMem += inc;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SAVED_READS_DAY_KEY, dayKeyNow());
      localStorage.setItem(SAVED_READS_COUNT_KEY, String(savedReadsTodayMem));
      const reasonKey = `${SAVED_READS_REASON_PREFIX}${reason}`;
      const prevReason = Number(localStorage.getItem(reasonKey) || "0");
      localStorage.setItem(reasonKey, String((Number.isFinite(prevReason) ? prevReason : 0) + inc));
    } catch {
      // ignore storage errors
    }
  }
  if (!hardLockAnnounced && savedReadsTodayMem >= 10_000) {
    hardLockAnnounced = true;
    console.warn("[QuotaSaver] HARD LOCK threshold reached. App is now strongly cache-only.");
  }
  if (savedReadsTodayMem % 250 === 0) {
    console.info(`${SAVED_LOG_PREFIX} today=${savedReadsTodayMem} (last reason: ${reason})`);
  }
}

export function getSavedReadsToday(): number {
  if (typeof localStorage !== "undefined") ensureSavedReadsDayLoaded();
  return Math.max(0, Math.floor(savedReadsTodayMem));
}

export function resetSavedReadsToday(): void {
  savedReadsTodayMem = 0;
  hardLockAnnounced = false;
  if (typeof localStorage === "undefined") return;
  try {
    const today = dayKeyNow();
    localStorage.setItem(SAVED_READS_DAY_KEY, today);
    localStorage.setItem(SAVED_READS_COUNT_KEY, "0");
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SAVED_READS_REASON_PREFIX)) keysToDelete.push(k);
    }
    keysToDelete.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

export function getSavedReadsByReason(): Array<{ section: string; savedReads: number }> {
  if (typeof localStorage === "undefined") return [];
  ensureSavedReadsDayLoaded();
  const rows: Array<{ section: string; savedReads: number }> = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SAVED_READS_REASON_PREFIX)) continue;
      const section = key.slice(SAVED_READS_REASON_PREFIX.length);
      const value = Number(localStorage.getItem(key) || "0");
      if (section && Number.isFinite(value) && value > 0) rows.push({ section, savedReads: Math.floor(value) });
    }
  } catch {
    return [];
  }
  rows.sort((a, b) => b.savedReads - a.savedReads);
  return rows;
}

if (typeof window !== "undefined") {
  const w = window as unknown as {
    __rakivinumDbReads?: () => void;
    __rakivinumDbReadsReset?: () => void;
    __rakivinumDbReadsEnable?: () => void;
    __rakivinumDbReadsDisable?: () => void;
    __rakivinumEdgeMeter?: () => void;
    __rakivinumEdgeMeterReset?: () => void;
    __rakivinumEdgeMeterEnable?: () => void;
    __rakivinumEdgeMeterDisable?: () => void;
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

  w.__rakivinumEdgeMeterEnable = () => {
    try {
      localStorage.setItem(RAKIVINUM_DEBUG_EDGE_METER_LS_KEY, "1");
      console.info("[rakivinum-edge-meter] flag set; reloading…");
      location.reload();
    } catch (e) {
      console.warn("[rakivinum-edge-meter] could not enable", e);
    }
  };

  w.__rakivinumEdgeMeterDisable = () => {
    try {
      localStorage.removeItem(RAKIVINUM_DEBUG_EDGE_METER_LS_KEY);
      console.info("[rakivinum-edge-meter] flag cleared; reloading…");
      location.reload();
    } catch (e) {
      console.warn("[rakivinum-edge-meter] could not disable", e);
    }
  };

  w.__rakivinumEdgeMeter = () => {
    if (!isEdgeMeteringEnabled()) {
      console.info("[rakivinum-edge-meter] metering off. Run __rakivinumEdgeMeterEnable() then use Reset/snapshot.");
      return;
    }
    const snap = getEdgeMeterSnapshot();
    if (!snap) return;
    console.info("[rakivinum-edge-meter] total requests", snap.total);
    console.table(snap.byLabel);
  };

  w.__rakivinumEdgeMeterReset = () => {
    if (!isEdgeMeteringEnabled()) {
      console.info("[rakivinum-edge-meter] metering off — run __rakivinumEdgeMeterEnable() first.");
      return;
    }
    resetEdgeMeter();
    console.info("[rakivinum-edge-meter] meter cleared");
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
  if (isEdgeMeteringEnabled() && !isDevEnv()) {
    console.info("[rakivinum-edge-meter] prod metering ON (localStorage).");
  }
}
