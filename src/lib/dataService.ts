import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "./firebase";
import { isQuotaError, readCache, writeCache } from "./resilience";

const inFlight = new Map<string, Promise<any>>();

function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const created = factory().finally(() => inFlight.delete(key));
  inFlight.set(key, created);
  return created;
}

export async function fetchPublicDistilleries(options?: {
  limitCount?: number;
  cacheKey?: string;
  ttlMs?: number;
}): Promise<any[]> {
  const limitCount = options?.limitCount ?? 250;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_public_distilleries_v1";
  const ttlMs = options?.ttlMs ?? 30 * 60 * 1000;

  return dedupe(`distilleries:${limitCount}:${cacheKey}`, async () => {
    try {
      const snap = await getDocs(query(collection(db, "distilleries"), limit(limitCount)));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .filter((d) => !d.isArchived && d.isVerified === true);
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<any[]>(cacheKey);
        if (cached) return cached;
      }
      throw err;
    }
  });
}

export async function fetchPublicProducts(options?: {
  limitCount?: number;
  cacheKey?: string;
  ttlMs?: number;
}): Promise<any[]> {
  const limitCount = options?.limitCount ?? 350;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_public_products_v1";
  const ttlMs = options?.ttlMs ?? 15 * 60 * 1000;

  return dedupe(`products:${limitCount}:${cacheKey}`, async () => {
    try {
      const snap = await getDocs(query(collection(db, "products"), limit(limitCount)));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .filter((p) => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true);
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<any[]>(cacheKey);
        if (cached) return cached;
      }
      throw err;
    }
  });
}

export async function fetchCommunityEvents(options?: {
  limitCount?: number;
  cacheKey?: string;
  ttlMs?: number;
}): Promise<any[]> {
  const limitCount = options?.limitCount ?? 60;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_community_events_v1";
  const ttlMs = options?.ttlMs ?? 15 * 60 * 1000;

  return dedupe(`events:${limitCount}:${cacheKey}`, async () => {
    try {
      const snap = await getDocs(query(collection(db, "community_events"), limit(limitCount)));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() as any }))
        .sort((a: any, b: any) => String(b.eventDate || "").localeCompare(String(a.eventDate || "")));
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<any[]>(cacheKey);
        if (cached) return cached;
      }
      throw err;
    }
  });
}
