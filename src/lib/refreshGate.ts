/**
 * Evidencija zadataka i „gde smo stali“: `docs/STATUS-ZADATAKA.md`
 */
const lastRunByKey = new Map<string, number>();

/**
 * Prevents frequent duplicate refresh calls (focus/visibility bursts).
 * Returns true only when enough time has passed for the provided key.
 */
export function shouldRunRefresh(key: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const last = lastRunByKey.get(key) ?? 0;
  if (now - last < Math.max(0, minIntervalMs)) return false;
  lastRunByKey.set(key, now);
  return true;
}

