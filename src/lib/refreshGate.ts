/**
 * Evidencija zadataka i „gde smo stali“: `docs/STATUS-ZADATAKA.md`
 *
 * **Pravilo (Firestore / edge):** za isti mrežni paket (npr. `home-bundle`, članstva na Meniju)
 * koristi **isti `key`** i na prvom učitavanju i u `focus` / `visibilitychange` handleru.
 * Dva različita ključa za „initial“ vs „focus“ dovode do duplog poziva odmah posle navigacije.
 */
const lastRunByKey = new Map<string, number>();

/**
 * Prevents frequent duplicate refresh calls (focus/visibility bursts).
 * Quota Saver mode relies on this gate to keep repeated tab/page re-opens on cache-only paths.
 * Returns true only when enough time has passed for the provided key.
 */
export function shouldRunRefresh(key: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const last = lastRunByKey.get(key) ?? 0;
  if (now - last < Math.max(0, minIntervalMs)) return false;
  lastRunByKey.set(key, now);
  return true;
}

export function peekRefreshLastRun(key: string): number {
  return lastRunByKey.get(key) ?? 0;
}

export function markRefreshRun(key: string): void {
  lastRunByKey.set(key, Date.now());
}

