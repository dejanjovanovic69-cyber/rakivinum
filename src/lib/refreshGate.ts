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
 * Returns true only when enough time has passed for the provided key.
 *
 * Note: do **not** treat a missing key as timestamp `0` — that made `now - last` huge so the
 * first `minIntervalMs > 0` check always "passed" and fired network even right after hydrating
 * from `readCache` (seen in Admin panel tab switches).
 */
export function shouldRunRefresh(key: string, minIntervalMs: number): boolean {
  const now = Date.now();
  if (minIntervalMs === 0) {
    lastRunByKey.set(key, now);
    return true;
  }
  const last = lastRunByKey.get(key);
  if (last !== undefined && now - last < minIntervalMs) return false;
  lastRunByKey.set(key, now);
  return true;
}

/** True if this key has been used with {@link shouldRunRefresh} or {@link seedRefreshGate}. */
export function hasRefreshGate(key: string): boolean {
  return lastRunByKey.has(key);
}

/** Mark a gate as "just satisfied" without a network round-trip (e.g. served fresh data from `readCache`). */
export function seedRefreshGate(key: string): void {
  lastRunByKey.set(key, Date.now());
}

