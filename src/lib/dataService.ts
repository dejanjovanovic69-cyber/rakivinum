import { collection, doc, documentId, getCountFromServer, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { isQuotaError, readCache, writeCache } from "./resilience";
import { CACHE_TTL } from "./cachePolicy";
import { meterDbRead } from "./requestMeter";

type DistilleryPublic = { id: string; isArchived?: boolean; isVerified?: boolean; [key: string]: unknown };
type ProductPublic = { id: string; isApproved?: boolean; isArchivedByDistillery?: boolean; publicLabelDisabled?: boolean; [key: string]: unknown };
type CommunityEventPublic = { id: string; eventDate?: string; [key: string]: unknown };
type CommunityLinkPublic = { id: string; label?: string; url: string };
type CommunityRatingPublic = { id: string; productId?: string; isFlagged?: boolean; createdAt?: unknown; [key: string]: unknown };
type ProductRatingPublic = { id: string; rating?: number; createdAt?: unknown; isFlagged?: boolean; [key: string]: unknown };
type ClubActionPublic = { id: string; isActive?: boolean; createdAt?: unknown; [key: string]: unknown };
type ClubMembershipPublic = { id: string; visitorId?: string; distilleryId?: string; createdAt?: unknown; [key: string]: unknown };
type LicensePublic = { id: string; token?: string; expiresAt?: unknown; status?: string; plan?: string; [key: string]: unknown };
type ScanClusterPublic = { region: string; val: number };
type ProductRatingSummaryPublic = {
  productId: string;
  averageRating: number;
  ratingCount: number;
  scanCount: number;
  conversionRate: number;
};

const inFlight = new Map<string, Promise<unknown>>();
const EDGE_API_BASE = String(import.meta.env.VITE_EDGE_API_BASE || "").trim();
/** Sprečava beskonačno čekanje na Worker (spor mreža / zaglavljen edge) — posle toga fallback na Firestore ili keš. */
/** Kraće čekanje na edge — spor fallback na Firestore/keš umesto 15s „vrtnje“. */
const EDGE_FETCH_TIMEOUT_MS = 6_000;

function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const created = factory().finally(() => inFlight.delete(key));
  inFlight.set(key, created);
  return created;
}

async function fetchEdgeItems<T>(path: string, limitCount: number): Promise<T[] | null> {
  if (!EDGE_API_BASE) return null;
  try {
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const res = await fetch(`${base}${path}?limit=${encodeURIComponent(String(limitCount))}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(EDGE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { items?: T[] };
    return Array.isArray(payload?.items) ? payload.items : null;
  } catch {
    return null;
  }
}

async function fetchEdgeItemWithAvailability<T>(path: string): Promise<{ available: boolean; item: T | null }> {
  if (!EDGE_API_BASE) return { available: false, item: null };
  try {
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(EDGE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { available: false, item: null };
    const payload = (await res.json()) as { item?: T | null };
    return { available: true, item: (payload?.item ?? null) as T | null };
  } catch {
    return { available: false, item: null };
  }
}

async function fetchEdgeRawJson(pathAndQuery: string): Promise<Record<string, unknown> | null> {
  if (!EDGE_API_BASE) return null;
  try {
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const res = await fetch(`${base}${pathAndQuery}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(EDGE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchPublicDistilleries(options?: {
  limitCount?: number;
  cacheKey?: string;
  ttlMs?: number;
}): Promise<DistilleryPublic[]> {
  const limitCount = options?.limitCount ?? 250;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_public_distilleries_v1";
  const ttlMs = options?.ttlMs ?? CACHE_TTL.DISTILLERY_LIST_6H;

  return dedupe(`distilleries:${limitCount}:${cacheKey}`, async () => {
    try {
      const edgeRows = await fetchEdgeItems<DistilleryPublic>("/api/public/distilleries", limitCount);
      if (Array.isArray(edgeRows)) {
        writeCache(cacheKey, edgeRows, ttlMs);
        return edgeRows;
      }
      const snap = await getDocs(query(collection(db, "distilleries"), limit(limitCount)));
      meterDbRead("dataService:distilleries", snap.size);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as DistilleryPublic))
        .filter((d) => !d.isArchived && d.isVerified === true);
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<DistilleryPublic[]>(cacheKey);
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
}): Promise<ProductPublic[]> {
  const limitCount = options?.limitCount ?? 350;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_public_products_v1";
  const ttlMs = options?.ttlMs ?? CACHE_TTL.PRODUCTS_6H;

  return dedupe(`products:${limitCount}:${cacheKey}`, async () => {
    try {
      const edgeRows = await fetchEdgeItems<ProductPublic>("/api/public/products", limitCount);
      if (Array.isArray(edgeRows)) {
        writeCache(cacheKey, edgeRows, ttlMs);
        return edgeRows;
      }
      const snap = await getDocs(query(collection(db, "products"), limit(limitCount)));
      meterDbRead("dataService:products", snap.size);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ProductPublic))
        .filter((p) => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true);
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<ProductPublic[]>(cacheKey);
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
}): Promise<CommunityEventPublic[]> {
  const limitCount = options?.limitCount ?? 60;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_community_events_v1";
  const ttlMs = options?.ttlMs ?? CACHE_TTL.COMMUNITY_EVENTS_6H;

  return dedupe(`events:${limitCount}:${cacheKey}`, async () => {
    try {
      const edgeRows = await fetchEdgeItems<CommunityEventPublic>("/api/public/community-events", limitCount);
      if (Array.isArray(edgeRows)) {
        writeCache(cacheKey, edgeRows, ttlMs);
        return edgeRows;
      }
      const snap = await getDocs(query(collection(db, "community_events"), limit(limitCount)));
      meterDbRead("dataService:community_events", snap.size);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as CommunityEventPublic) }))
        .sort((a, b) => String(b.eventDate || "").localeCompare(String(a.eventDate || "")));
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<CommunityEventPublic[]>(cacheKey);
        if (cached) return cached;
      }
      throw err;
    }
  });
}

export async function fetchCommunityLinks(options?: {
  limitCount?: number;
  cacheKey?: string;
  ttlMs?: number;
}): Promise<CommunityLinkPublic[]> {
  const limitCount = options?.limitCount ?? 80;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_community_links_v1";
  const ttlMs = options?.ttlMs ?? CACHE_TTL.COMMUNITY_EVENTS_6H;

  return dedupe(`communityLinks:${limitCount}:${cacheKey}`, async () => {
    try {
      const edgeRows = await fetchEdgeItems<CommunityLinkPublic>("/api/public/community-links", limitCount);
      if (Array.isArray(edgeRows)) {
        writeCache(cacheKey, edgeRows, ttlMs);
        return edgeRows;
      }
      const snap = await getDocs(query(collection(db, "community_links"), limit(limitCount)));
      meterDbRead("dataService:community_links", snap.size);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as CommunityLinkPublic) }))
        .filter((x) => typeof x?.url === "string" && x.url.trim().length > 0)
        .map((x) => ({
          id: String(x.id),
          label: String(x.label || "Link"),
          url: String(x.url),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "sr"));
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<CommunityLinkPublic[]>(cacheKey);
        if (cached) return cached;
      }
      throw err;
    }
  });
}

export async function fetchCommunityRatings(options?: {
  limitCount?: number;
  cacheKey?: string;
  ttlMs?: number;
}): Promise<CommunityRatingPublic[]> {
  const limitCount = options?.limitCount ?? 20;
  const cacheKey = options?.cacheKey ?? "rakivinum_cache_community_ratings_v1";
  const ttlMs = options?.ttlMs ?? CACHE_TTL.COMMUNITY_EVENTS_6H;

  return dedupe(`ratingsFeed:${limitCount}:${cacheKey}`, async () => {
    try {
      const edgeRows = await fetchEdgeItems<CommunityRatingPublic>("/api/public/ratings-feed", limitCount);
      if (Array.isArray(edgeRows)) {
        writeCache(cacheKey, edgeRows, ttlMs);
        return edgeRows;
      }
      const snap = await getDocs(query(collection(db, "ratings"), limit(Math.max(limitCount, 40))));
      meterDbRead("dataService:community_ratings", snap.size);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as CommunityRatingPublic))
        .filter((r) => r.isFlagged !== true)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, limitCount);
      writeCache(cacheKey, rows, ttlMs);
      return rows;
    } catch (err) {
      if (isQuotaError(err)) {
        const cached = readCache<CommunityRatingPublic[]>(cacheKey);
        if (cached) return cached;
      }
      throw err;
    }
  });
}

export async function fetchPublicDistilleryById(id: string): Promise<DistilleryPublic | null> {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return dedupe(`distilleryById:${safeId}`, async () => {
    const cacheKey = `rakivinum_cache_distillery_by_id_${safeId}_v1`;
    const cached = readCache<{ found: boolean; item: DistilleryPublic | null }>(cacheKey);
    if (cached) return cached.found ? cached.item : null;

    const edge = await fetchEdgeItemWithAvailability<DistilleryPublic>(`/api/public/distillery/${encodeURIComponent(safeId)}`);
    if (edge.available) {
      if (edge.item) {
        writeCache(cacheKey, { found: true, item: edge.item }, CACHE_TTL.PUBLIC_BY_ID_1H);
        return edge.item;
      }
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    const snap = await getDoc(doc(db, "distilleries", safeId));
    meterDbRead("dataService:distillery_by_id", 1);
    if (!snap.exists()) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    const row = { id: snap.id, ...snap.data() } as DistilleryPublic;
    if (row.isArchived || row.isVerified !== true) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    writeCache(cacheKey, { found: true, item: row }, CACHE_TTL.PUBLIC_BY_ID_1H);
    return row;
  });
}

export async function fetchPublicDistilleriesByIds(ids: string[]): Promise<DistilleryPublic[]> {
  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter((id) => id.length > 0),
    ),
  ).slice(0, 40);
  const safeIds = [...uniqueIds].sort((a, b) => a.localeCompare(b));
  if (safeIds.length === 0) return [];
  return dedupe(`distilleryByIds:${safeIds.join(",")}`, async () => {
    const cacheKey = `rakivinum_cache_distilleries_by_ids_${safeIds.join("_")}_v1`;
    const cached = readCache<DistilleryPublic[]>(cacheKey);
    if (cached) return cached;

    const qs = new URLSearchParams();
    qs.set("ids", safeIds.join(","));
    const json = await fetchEdgeRawJson(`/api/public/distilleries-by-ids?${qs.toString()}`);
    const edgeItemsRaw = json?.items;
    if (Array.isArray(edgeItemsRaw)) {
      const rows = edgeItemsRaw
        .filter((row): row is DistilleryPublic => !!row && typeof row === "object")
        .filter((row) => row.isArchived !== true && row.isVerified === true);
      writeCache(cacheKey, rows, CACHE_TTL.DISTILLERIES_BY_IDS_1H);
      return rows;
    }

    const byId = new Map<string, DistilleryPublic>();
    for (let i = 0; i < safeIds.length; i += 10) {
      const chunk = safeIds.slice(i, i + 10);
      const snap = await getDocs(query(collection(db, "distilleries"), where(documentId(), "in", chunk)));
      meterDbRead("dataService:distillery_by_ids", snap.size);
      snap.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DistilleryPublic;
        if (row.isArchived !== true && row.isVerified === true) byId.set(d.id, row);
      });
    }

    const rows = safeIds.map((id) => byId.get(id)).filter((row): row is DistilleryPublic => Boolean(row));
    writeCache(cacheKey, rows, CACHE_TTL.DISTILLERIES_BY_IDS_1H);
    return rows;
  });
}

export async function fetchPublicProductsByDistilleryId(distilleryId: string, limitCount = 300): Promise<ProductPublic[]> {
  const safeId = String(distilleryId || "").trim();
  if (!safeId) return [];
  return dedupe(`productsByDistillery:${safeId}:${limitCount}`, async () => {
    const cacheKey = `rakivinum_cache_products_by_distillery_${safeId}_${limitCount}_v1`;
    const cached = readCache<ProductPublic[]>(cacheKey);
    if (cached) return cached;

    const edgeRows = await fetchEdgeItems<ProductPublic>(
      `/api/public/products-by-distillery/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (Array.isArray(edgeRows)) {
      const rows = edgeRows.filter(
        (p) => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true,
      );
      writeCache(cacheKey, rows, CACHE_TTL.PRODUCTS_BY_DISTILLERY_1H);
      return rows;
    }
    const snap = await getDocs(query(collection(db, "products"), where("distilleryId", "==", safeId), limit(limitCount)));
    meterDbRead("dataService:products_by_distillery", snap.size);
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ProductPublic))
      .filter((p) => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true);
    writeCache(cacheKey, rows, CACHE_TTL.PRODUCTS_BY_DISTILLERY_1H);
    return rows;
  });
}

export async function fetchPublicProductById(id: string): Promise<ProductPublic | null> {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return dedupe(`productById:${safeId}`, async () => {
    const cacheKey = `rakivinum_cache_product_by_id_${safeId}_v1`;
    const cached = readCache<{ found: boolean; item: ProductPublic | null }>(cacheKey);
    if (cached) return cached.found ? cached.item : null;

    const edge = await fetchEdgeItemWithAvailability<ProductPublic>(`/api/public/product/${encodeURIComponent(safeId)}`);
    if (edge.available) {
      if (edge.item) {
        writeCache(cacheKey, { found: true, item: edge.item }, CACHE_TTL.PUBLIC_BY_ID_1H);
        return edge.item;
      }
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    const snap = await getDoc(doc(db, "products", safeId));
    meterDbRead("dataService:product_by_id", 1);
    if (!snap.exists()) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    const row = { id: snap.id, ...snap.data() } as ProductPublic;
    if (row.isApproved === false || row.isArchivedByDistillery || row.publicLabelDisabled === true) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    writeCache(cacheKey, { found: true, item: row }, CACHE_TTL.PUBLIC_BY_ID_1H);
    return row;
  });
}

/** Barkod / QR tekst: Worker `product-lookup` (n=normalizovano, r=sirovi tekst), pa null â†’ klijent nastavlja sa Firestore upitima. */
export async function fetchPublicProductByBarcodeLookup(normalized: string, rawScan: string): Promise<ProductPublic | null> {
  const n = String(normalized || "").trim();
  const r = String(rawScan || "").trim();
  if (!n && !r) return null;
  return dedupe(`barcodeLookup:${n}:${r}`, async () => {
    const cacheKey = `rakivinum_cache_barcode_lookup_${encodeURIComponent(n)}_${encodeURIComponent(r)}_v1`;
    const cached = readCache<{ found: boolean; item: ProductPublic | null }>(cacheKey);
    if (cached) return cached.found ? cached.item : null;

    const qs = new URLSearchParams();
    if (n) qs.set("n", n);
    if (r) qs.set("r", r);
    const edge = await fetchEdgeItemWithAvailability<ProductPublic>(`/api/public/product-lookup?${qs.toString()}`);
    if (edge.available) {
      if (edge.item && typeof edge.item === "object") {
        const row = edge.item as ProductPublic;
        writeCache(cacheKey, { found: true, item: row }, CACHE_TTL.PUBLIC_BY_ID_1H);
        return row;
      }
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.BARCODE_LOOKUP_NEGATIVE_2M);
      return null;
    }
    return null;
  });
}

export async function fetchPublicClubMembershipCount(distilleryId: string): Promise<number> {
  const safeId = String(distilleryId || "").trim();
  if (!safeId) return 0;
  return dedupe(`clubMemberCount:${safeId}`, async () => {
    const cacheKey = `rakivinum_cache_club_membership_count_${safeId}_v1`;
    const cached = readCache<number>(cacheKey);
    if (typeof cached === "number" && Number.isFinite(cached)) return Math.max(0, Math.floor(cached));

    const json = await fetchEdgeRawJson(`/api/public/club-membership-count/${encodeURIComponent(safeId)}`);
    const cRaw = json?.count;
    const parsedCount =
      typeof cRaw === "number" ? cRaw : typeof cRaw === "string" && cRaw.trim().length > 0 ? Number(cRaw) : NaN;
    if (Number.isFinite(parsedCount)) {
      const count = Math.max(0, Math.floor(parsedCount));
      writeCache(cacheKey, count, CACHE_TTL.CLUB_MEMBERSHIP_COUNT_2M);
      return count;
    }

    const q = query(collection(db, "club_memberships"), where("distilleryId", "==", safeId));
    const countSnap = await getCountFromServer(q);
    meterDbRead("dataService:club_membership_count", 1);
    const count = Math.max(0, Number(countSnap.data().count) || 0);
    writeCache(cacheKey, count, CACHE_TTL.CLUB_MEMBERSHIP_COUNT_2M);
    return count;
  });
}

/** Skener: prvo javni proizvod preko edge-a (0 Firestore), inaÄe taÄno jedan `getDoc` bez javnog filtera â€” UI i dalje odbija arhivu / iskljuÄen etiketu. */
export async function fetchScannerProductById(id: string): Promise<ProductPublic | null> {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return dedupe(`scannerProductById:${safeId}`, async () => {
    const cacheKey = `rakivinum_cache_scanner_product_by_id_${safeId}_v1`;
    const cached = readCache<{ found: boolean; item: ProductPublic | null }>(cacheKey);
    if (cached) return cached.found ? cached.item : null;

    const edge = await fetchEdgeItemWithAvailability<ProductPublic>(`/api/public/product/${encodeURIComponent(safeId)}`);
    if (edge.available) {
      if (edge.item) {
        writeCache(cacheKey, { found: true, item: edge.item }, CACHE_TTL.PUBLIC_BY_ID_1H);
        return edge.item;
      }
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    const snap = await getDoc(doc(db, "products", safeId));
    meterDbRead("dataService:scanner_product_by_id", 1);
    if (!snap.exists()) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PUBLIC_BY_ID_NEGATIVE_2M);
      return null;
    }
    const row = { id: snap.id, ...snap.data() } as ProductPublic;
    writeCache(cacheKey, { found: true, item: row }, CACHE_TTL.PUBLIC_BY_ID_1H);
    return row;
  });
}

export async function fetchPublicProductRatingSummary(productId: string): Promise<ProductRatingSummaryPublic | null> {
  const safeId = String(productId || "").trim();
  if (!safeId) return null;
  return dedupe(`ratingSummary:${safeId}`, async () => {
    const cacheKey = `rakivinum_cache_product_rating_summary_${safeId}_v1`;
    const cached = readCache<{ found: boolean; item: ProductRatingSummaryPublic | null }>(cacheKey);
    if (cached) return cached.found ? cached.item : null;

    const edge = await fetchEdgeItemWithAvailability<ProductRatingSummaryPublic>(
      `/api/public/ratings-summary/${encodeURIComponent(safeId)}`,
    );
    if (edge.available) {
      if (edge.item) {
        writeCache(cacheKey, { found: true, item: edge.item }, CACHE_TTL.PRODUCT_RATING_SUMMARY_10M);
        return edge.item;
      }
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PRODUCT_RATING_SUMMARY_NEGATIVE_2M);
      return null;
    }
    const snap = await getDoc(doc(db, "products", safeId));
    meterDbRead("dataService:product_rating_summary_fallback", 1);
    if (!snap.exists()) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.PRODUCT_RATING_SUMMARY_NEGATIVE_2M);
      return null;
    }
    const row = snap.data() as Record<string, unknown>;
    const scanCount = Number(row.scanCount) || 0;
    const ratingCount = Number(row.ratingCount) || 0;
    const averageRating = Number(row.averageRating) || 0;
    const summary = {
      productId: safeId,
      averageRating,
      ratingCount,
      scanCount,
      conversionRate: scanCount > 0 ? Math.round((ratingCount / scanCount) * 10000) / 100 : 0,
    };
    writeCache(cacheKey, { found: true, item: summary }, CACHE_TTL.PRODUCT_RATING_SUMMARY_10M);
    return summary;
  });
}

export async function fetchPublicProductRatings(productId: string, limitCount = 200): Promise<ProductRatingPublic[]> {
  const safeId = String(productId || "").trim();
  if (!safeId) return [];
  return dedupe(`productRatings:${safeId}:${limitCount}`, async () => {
    const cacheKey = `rakivinum_cache_product_ratings_${safeId}_${limitCount}_v1`;
    const cached = readCache<ProductRatingPublic[]>(cacheKey);
    if (cached) return cached;

    const edgeRows = await fetchEdgeItems<ProductRatingPublic>(
      `/api/public/product-ratings/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (Array.isArray(edgeRows)) {
      const rows = edgeRows.filter((r) => r.isFlagged !== true);
      writeCache(cacheKey, rows, CACHE_TTL.PRODUCT_RATINGS_1H);
      return rows;
    }

    const snap = await getDocs(query(collection(db, "ratings"), where("productId", "==", safeId), limit(limitCount)));
    meterDbRead("dataService:product_ratings_fallback", snap.size);
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ProductRatingPublic))
      .filter((r) => r.isFlagged !== true);
    writeCache(cacheKey, rows, CACHE_TTL.PRODUCT_RATINGS_1H);
    return rows;
  });
}

export async function fetchPublicScanClustersByProductId(productId: string, clusterLimit = 5): Promise<ScanClusterPublic[]> {
  const safeId = String(productId || "").trim();
  if (!safeId) return [];
  return dedupe(`scanClusters:${safeId}:${clusterLimit}`, async () => {
    const cacheKey = `rakivinum_cache_scan_clusters_${safeId}_${clusterLimit}_v1`;
    const cached = readCache<ScanClusterPublic[]>(cacheKey);
    if (cached) return cached;

    const edgeRows = await fetchEdgeItems<ScanClusterPublic>(
      `/api/public/scan-clusters/${encodeURIComponent(safeId)}`,
      clusterLimit,
    );
    if (Array.isArray(edgeRows)) {
      writeCache(cacheKey, edgeRows, CACHE_TTL.SCAN_CLUSTERS_1H);
      return edgeRows;
    }

    const clusters = new Map<string, number>();
    try {
      const snap = await getDocs(query(collection(db, "scans"), where("productId", "==", safeId), limit(300)));
      meterDbRead("dataService:scan_clusters_fallback", snap.size);
      snap.docs.forEach((d) => {
        const loc = (d.data() as { location?: { lat?: number; lng?: number } }).location;
        if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
          const key = `${loc.lat.toFixed(1)}°, ${loc.lng.toFixed(1)}°`;
          clusters.set(key, (clusters.get(key) || 0) + 1);
        }
      });
    } catch {
      return [];
    }
    const rows = [...clusters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, clusterLimit)
      .map(([region, val]) => ({ region, val }));
    writeCache(cacheKey, rows, CACHE_TTL.SCAN_CLUSTERS_1H);
    return rows;
  });
}

export async function fetchPublicClubActions(limitCount = 20): Promise<ClubActionPublic[]> {
  return dedupe(`clubActions:${limitCount}`, async () => {
    const cacheKey = `rakivinum_cache_club_actions_${limitCount}_v1`;
    const cached = readCache<ClubActionPublic[]>(cacheKey);
    if (cached) return cached;

    const edgeRows = await fetchEdgeItems<ClubActionPublic>("/api/public/club-actions", limitCount);
    if (Array.isArray(edgeRows)) {
      const rows = edgeRows.filter((a) => a.isActive === true);
      writeCache(cacheKey, rows, CACHE_TTL.CLUB_ACTIONS_1H);
      return rows;
    }

    const snap = await getDocs(query(collection(db, "club_actions"), where("isActive", "==", true), limit(limitCount)));
    meterDbRead("dataService:club_actions_fallback", snap.size);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClubActionPublic));
    writeCache(cacheKey, rows, CACHE_TTL.CLUB_ACTIONS_1H);
    return rows;
  });
}

export async function fetchPublicClubActionsForDistillery(distilleryId: string, limitCount = 40): Promise<ClubActionPublic[]> {
  const safeId = String(distilleryId || "").trim();
  if (!safeId) return [];
  return dedupe(`clubActionsForDistillery:${safeId}:${limitCount}`, async () => {
    const cacheKey = `rakivinum_cache_club_actions_distillery_${safeId}_${limitCount}_v1`;
    const cached = readCache<ClubActionPublic[]>(cacheKey);
    if (cached) return cached;

    const edgeRows = await fetchEdgeItems<ClubActionPublic>(
      `/api/public/club-actions-by-distillery/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (Array.isArray(edgeRows)) {
      const rows = edgeRows.filter((a) => a.isActive !== false);
      writeCache(cacheKey, rows, CACHE_TTL.CLUB_ACTIONS_BY_DISTILLERY_1H);
      return rows;
    }

    const snap = await getDocs(
      query(
        collection(db, "club_actions"),
        where("distilleryId", "==", safeId),
        where("isActive", "==", true),
        limit(limitCount),
      ),
    );
    meterDbRead("dataService:club_actions_by_distillery", snap.size);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClubActionPublic));
    writeCache(cacheKey, rows, CACHE_TTL.CLUB_ACTIONS_BY_DISTILLERY_1H);
    return rows;
  });
}

export async function fetchPublicClubMembershipsByVisitorId(visitorId: string, limitCount = 30): Promise<ClubMembershipPublic[]> {
  const safeId = String(visitorId || "").trim();
  if (!safeId) return [];
  return dedupe(`clubMemberships:${safeId}:${limitCount}`, async () => {
    const cacheKey = `rakivinum_cache_club_memberships_${safeId}_${limitCount}_v1`;
    const cached = readCache<ClubMembershipPublic[]>(cacheKey);
    if (cached) return cached;

    const edgeRows = await fetchEdgeItems<ClubMembershipPublic>(
      `/api/public/club-memberships/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (Array.isArray(edgeRows)) {
      writeCache(cacheKey, edgeRows, CACHE_TTL.CLUB_MEMBERSHIPS_1H);
      return edgeRows;
    }

    const snap = await getDocs(query(collection(db, "club_memberships"), where("visitorId", "==", safeId), limit(limitCount)));
    meterDbRead("dataService:club_memberships_fallback", snap.size);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClubMembershipPublic));
    writeCache(cacheKey, rows, CACHE_TTL.CLUB_MEMBERSHIPS_1H);
    return rows;
  });
}

export async function fetchPublicLicenseByToken(token: string): Promise<LicensePublic | null> {
  const safeToken = String(token || "").trim();
  if (!safeToken) return null;
  return dedupe(`licenseByToken:${safeToken}`, async () => {
    const cacheKey = `rakivinum_cache_license_by_token_${safeToken}_v1`;
    const cached = readCache<{ found: boolean; item: LicensePublic | null }>(cacheKey);
    if (cached) return cached.found ? cached.item : null;

    const edge = await fetchEdgeItemWithAvailability<LicensePublic>(`/api/public/license/${encodeURIComponent(safeToken)}`);
    if (edge.available) {
      if (edge.item) {
        writeCache(cacheKey, { found: true, item: edge.item }, CACHE_TTL.LICENSE_BY_TOKEN_10M);
        return edge.item;
      }
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.LICENSE_BY_TOKEN_NEGATIVE_2M);
      return null;
    }

    const snap = await getDocs(query(collection(db, "licenses"), where("token", "==", safeToken), limit(1)));
    meterDbRead("dataService:license_by_token_fallback", snap.size);
    if (snap.empty) {
      writeCache(cacheKey, { found: false, item: null }, CACHE_TTL.LICENSE_BY_TOKEN_NEGATIVE_2M);
      return null;
    }
    const row = { id: snap.docs[0].id, ...snap.docs[0].data() } as LicensePublic;
    writeCache(cacheKey, { found: true, item: row }, CACHE_TTL.LICENSE_BY_TOKEN_10M);
    return row;
  });
}

