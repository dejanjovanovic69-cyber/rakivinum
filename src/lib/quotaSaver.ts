import { getSavedReadsByReason, getSavedReadsToday } from "./requestMeter";

/**
 * Global quota saver switch for development/test sessions.
 * Keep this as the single source of truth for aggressive read reductions.
 */
/** Nuclear quota mode — keep `true` in production until Firestore budget is stable. */
export const QUOTA_SAVER_MODE = true;
export type QuotaMode = "saver" | "normal";
/** Hard lock threshold for saved-read counter. */
export const HARD_LOCK_SAVED_READS_THRESHOLD = 25_000;

/**
 * When active, prefer edge/cache paths and avoid direct Firestore fallbacks where possible.
 */
/** Block direct Firestore list fallbacks in the client bundle when saver is on. */
export const FORCE_EDGE_ONLY = true;

const QUOTA_SAVER_OVERRIDE_KEY = "rakivinum_quota_saver_override";
const HARD_LOCK_OVERRIDE_KEY = "rakivinum_hard_lock_override";

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(QUOTA_SAVER_OVERRIDE_KEY);
    if (raw == null) return null;
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export const isQuotaSaverActive = (): boolean => {
  const override = readOverride();
  if (override !== null) return override;
  return import.meta.env.DEV || QUOTA_SAVER_MODE;
};

export function getCurrentMode(): QuotaMode {
  return isQuotaSaverActive() ? "saver" : "normal";
}

/**
 * Conservative estimate for dashboard-level communication (not billing-accurate).
 */
export function getReadSavingEstimate(context: "admin" | "community" | "distillery" | "global" = "global"): number {
  if (!isQuotaSaverActive()) return 0;
  const base =
    context === "admin" ? 720 :
    context === "community" ? 220 :
    context === "distillery" ? 130 :
    1100;
  const devBonus = import.meta.env.DEV ? Math.round(base * 0.08) : 0;
  return base + devBonus;
}

export function isHardLockActive(): boolean {
  if (!isQuotaSaverActive()) return false;
  if (typeof window === "undefined") return false;
  try {
    const override = localStorage.getItem(HARD_LOCK_OVERRIDE_KEY);
    if (override === "1") return true;
    if (override === "0") return false;
    const raw = localStorage.getItem("rakivinum_saved_reads_count");
    const saved = Number(raw || "0");
    return Number.isFinite(saved) && saved >= HARD_LOCK_SAVED_READS_THRESHOLD;
  } catch {
    return false;
  }
}

export function setHardLockOverride(next: boolean | null): void {
  if (typeof window === "undefined") return;
  try {
    if (next === null) localStorage.removeItem(HARD_LOCK_OVERRIDE_KEY);
    else localStorage.setItem(HARD_LOCK_OVERRIDE_KEY, next ? "1" : "0");
    if (next === true) {
      console.warn("[QuotaSaver] HARD LOCK forced ON. Network reads are restricted to cache-only behavior.");
    }
  } catch {
    // ignore storage failures
  }
}

type Diagnostics = {
  mode: QuotaMode;
  hardLockActive: boolean;
  savedReadsToday: number;
  estimatedMonthlyCost: number;
  topSkippedSections: Array<{ section: string; savedReads: number }>;
};

export function getDiagnostics(): Diagnostics {
  const mode = getCurrentMode();
  const hardLockActive = isHardLockActive();
  const savedReadsToday = getSavedReadsToday();
  const topSkippedSections = getSavedReadsByReason().slice(0, 5);
  // Firestore reads pricing approximation: $0.03 per 100k reads.
  const estimatedMonthlyCost = Number((((savedReadsToday * 30) / 100_000) * 0.03).toFixed(2));
  return {
    mode,
    hardLockActive,
    savedReadsToday,
    estimatedMonthlyCost,
    topSkippedSections,
  };
}

export function setQuotaSaverOverride(next: boolean | null): void {
  if (typeof window === "undefined") return;
  try {
    if (next === null) localStorage.removeItem(QUOTA_SAVER_OVERRIDE_KEY);
    else localStorage.setItem(QUOTA_SAVER_OVERRIDE_KEY, next ? "1" : "0");
  } catch {
    // ignore storage failures
  }
}

