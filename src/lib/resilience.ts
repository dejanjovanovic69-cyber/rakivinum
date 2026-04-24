type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

export function isQuotaError(err: unknown): boolean {
  const code = String((err as any)?.code || "").toLowerCase();
  const msg = String((err as any)?.message || "").toLowerCase();
  return code.includes("resource-exhausted") || msg.includes("quota") || msg.includes("resource exhausted");
}

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.expiresAt !== "number") return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T, ttlMs: number): void {
  try {
    const payload: CacheEnvelope<T> = {
      expiresAt: Date.now() + Math.max(1000, ttlMs),
      value,
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // best effort cache only
  }
}
