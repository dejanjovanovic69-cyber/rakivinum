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
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { items?: T[] };
    return Array.isArray(payload?.items) ? payload.items : null;
  } catch {
    return null;
  }
}

async function fetchEdgeItem<T>(path: string): Promise<T | null> {
  if (!EDGE_API_BASE) return null;
  try {
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { item?: T | null };
    return (payload?.item ?? null) as T | null;
  } catch {
    return null;
  }
}

async function fetchEdgeRawJson(pathAndQuery: string): Promise<Record<string, unknown> | null> {
  if (!EDGE_API_BASE) return null;
  try {
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const res = await fetch(`${base}${pathAndQuery}`, {
      method: "GET",
      headers: { accept: "application/json" },
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
      if (edgeRows && edgeRows.length > 0) {
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
      if (edgeRows && edgeRows.length > 0) {
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
      if (edgeRows && edgeRows.length > 0) {
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
      if (edgeRows && edgeRows.length > 0) {
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
      if (edgeRows && edgeRows.length > 0) {
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
    const edge = await fetchEdgeItem<DistilleryPublic>(`/api/public/distillery/${encodeURIComponent(safeId)}`);
    if (edge) return edge;
    const snap = await getDoc(doc(db, "distilleries", safeId));
    meterDbRead("dataService:distillery_by_id", 1);
    if (!snap.exists()) return null;
    const row = { id: snap.id, ...snap.data() } as DistilleryPublic;
    if (row.isArchived || row.isVerified !== true) return null;
    return row;
  });
}

export async function fetchPublicDistilleriesByIds(ids: string[]): Promise<DistilleryPublic[]> {
  const safeIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter((id) => id.length > 0),
    ),
  ).slice(0, 40);
  if (safeIds.length === 0) return [];
  return dedupe(`distilleryByIds:${safeIds.join(",")}`, async () => {
    const qs = new URLSearchParams();
    qs.set("ids", safeIds.join(","));
    const json = await fetchEdgeRawJson(`/api/public/distilleries-by-ids?${qs.toString()}`);
    const edgeItemsRaw = json?.items;
    if (Array.isArray(edgeItemsRaw) && edgeItemsRaw.length > 0) {
      return edgeItemsRaw
        .filter((row): row is DistilleryPublic => !!row && typeof row === "object")
        .filter((row) => row.isArchived !== true && row.isVerified === true);
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

    return safeIds.map((id) => byId.get(id)).filter((row): row is DistilleryPublic => Boolean(row));
  });
}

export async function fetchPublicProductsByDistilleryId(distilleryId: string, limitCount = 300): Promise<ProductPublic[]> {
  const safeId = String(distilleryId || "").trim();
  if (!safeId) return [];
  return dedupe(`productsByDistillery:${safeId}:${limitCount}`, async () => {
    const edgeRows = await fetchEdgeItems<ProductPublic>(
      `/api/public/products-by-distillery/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (edgeRows && edgeRows.length > 0) {
      return edgeRows.filter(
        (p) => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true,
      );
    }
    const snap = await getDocs(query(collection(db, "products"), where("distilleryId", "==", safeId), limit(limitCount)));
    meterDbRead("dataService:products_by_distillery", snap.size);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ProductPublic))
      .filter((p) => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true);
  });
}

export async function fetchPublicProductById(id: string): Promise<ProductPublic | null> {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return dedupe(`productById:${safeId}`, async () => {
    const edge = await fetchEdgeItem<ProductPublic>(`/api/public/product/${encodeURIComponent(safeId)}`);
    if (edge) return edge;
    const snap = await getDoc(doc(db, "products", safeId));
    meterDbRead("dataService:product_by_id", 1);
    if (!snap.exists()) return null;
    const row = { id: snap.id, ...snap.data() } as ProductPublic;
    if (row.isApproved === false || row.isArchivedByDistillery || row.publicLabelDisabled === true) return null;
    return row;
  });
}

/** Barkod / QR tekst: Worker `product-lookup` (n=normalizovano, r=sirovi tekst), pa null â†’ klijent nastavlja sa Firestore upitima. */
export async function fetchPublicProductByBarcodeLookup(normalized: string, rawScan: string): Promise<ProductPublic | null> {
  const n = String(normalized || "").trim();
  const r = String(rawScan || "").trim();
  if (!n && !r) return null;
  return dedupe(`barcodeLookup:${n}:${r}`, async () => {
    const qs = new URLSearchParams();
    if (n) qs.set("n", n);
    if (r) qs.set("r", r);
    const json = await fetchEdgeRawJson(`/api/public/product-lookup?${qs.toString()}`);
    const item = json?.item;
    if (item && typeof item === "object") return item as ProductPublic;
    return null;
  });
}

export async function fetchPublicClubMembershipCount(distilleryId: string): Promise<number> {
  const safeId = String(distilleryId || "").trim();
  if (!safeId) return 0;
  return dedupe(`clubMemberCount:${safeId}`, async () => {
    const json = await fetchEdgeRawJson(`/api/public/club-membership-count/${encodeURIComponent(safeId)}`);
    const c = json?.count;
    if (typeof c === "number" && Number.isFinite(c)) return Math.max(0, Math.floor(c));

    const q = query(collection(db, "club_memberships"), where("distilleryId", "==", safeId));
    const countSnap = await getCountFromServer(q);
    meterDbRead("dataService:club_membership_count", 1);
    return countSnap.data().count;
  });
}

/** Skener: prvo javni proizvod preko edge-a (0 Firestore), inaÄe taÄno jedan `getDoc` bez javnog filtera â€” UI i dalje odbija arhivu / iskljuÄen etiketu. */
export async function fetchScannerProductById(id: string): Promise<ProductPublic | null> {
  const safeId = String(id || "").trim();
  if (!safeId) return null;
  return dedupe(`scannerProductById:${safeId}`, async () => {
    const edge = await fetchEdgeItem<ProductPublic>(`/api/public/product/${encodeURIComponent(safeId)}`);
    if (edge) return edge;
    const snap = await getDoc(doc(db, "products", safeId));
    meterDbRead("dataService:scanner_product_by_id", 1);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as ProductPublic;
  });
}

export async function fetchPublicProductRatingSummary(productId: string): Promise<ProductRatingSummaryPublic | null> {
  const safeId = String(productId || "").trim();
  if (!safeId) return null;
  return dedupe(`ratingSummary:${safeId}`, async () => {
    const edge = await fetchEdgeItem<ProductRatingSummaryPublic>(
      `/api/public/ratings-summary/${encodeURIComponent(safeId)}`,
    );
    if (edge) return edge;
    const snap = await getDoc(doc(db, "products", safeId));
    meterDbRead("dataService:product_rating_summary_fallback", 1);
    if (!snap.exists()) return null;
    const row = snap.data() as Record<string, unknown>;
    const scanCount = Number(row.scanCount) || 0;
    const ratingCount = Number(row.ratingCount) || 0;
    const averageRating = Number(row.averageRating) || 0;
    return {
      productId: safeId,
      averageRating,
      ratingCount,
      scanCount,
      conversionRate: scanCount > 0 ? Math.round((ratingCount / scanCount) * 10000) / 100 : 0,
    };
  });
}

export async function fetchPublicProductRatings(productId: string, limitCount = 200): Promise<ProductRatingPublic[]> {
  const safeId = String(productId || "").trim();
  if (!safeId) return [];
  return dedupe(`productRatings:${safeId}:${limitCount}`, async () => {
    const edgeRows = await fetchEdgeItems<ProductRatingPublic>(
      `/api/public/product-ratings/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (edgeRows && edgeRows.length > 0) return edgeRows.filter((r) => r.isFlagged !== true);

    const snap = await getDocs(query(collection(db, "ratings"), where("productId", "==", safeId), limit(limitCount)));
    meterDbRead("dataService:product_ratings_fallback", snap.size);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ProductRatingPublic))
      .filter((r) => r.isFlagged !== true);
  });
}

export async function fetchPublicScanClustersByProductId(productId: string, clusterLimit = 5): Promise<ScanClusterPublic[]> {
  const safeId = String(productId || "").trim();
  if (!safeId) return [];
  return dedupe(`scanClusters:${safeId}:${clusterLimit}`, async () => {
    const edgeRows = await fetchEdgeItems<ScanClusterPublic>(
      `/api/public/scan-clusters/${encodeURIComponent(safeId)}`,
      clusterLimit,
    );
    if (edgeRows && edgeRows.length > 0) return edgeRows;

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
    return [...clusters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, clusterLimit)
      .map(([region, val]) => ({ region, val }));
  });
}

export async function fetchPublicClubActions(limitCount = 20): Promise<ClubActionPublic[]> {
  return dedupe(`clubActions:${limitCount}`, async () => {
    const edgeRows = await fetchEdgeItems<ClubActionPublic>("/api/public/club-actions", limitCount);
    if (edgeRows && edgeRows.length > 0) return edgeRows.filter((a) => a.isActive === true);

    const snap = await getDocs(query(collection(db, "club_actions"), where("isActive", "==", true), limit(limitCount)));
    meterDbRead("dataService:club_actions_fallback", snap.size);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClubActionPublic));
  });
}

export async function fetchPublicClubActionsForDistillery(distilleryId: string, limitCount = 40): Promise<ClubActionPublic[]> {
  const safeId = String(distilleryId || "").trim();
  if (!safeId) return [];
  return dedupe(`clubActionsForDistillery:${safeId}:${limitCount}`, async () => {
    const edgeRows = await fetchEdgeItems<ClubActionPublic>(
      `/api/public/club-actions-by-distillery/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (edgeRows && edgeRows.length > 0) return edgeRows.filter((a) => a.isActive !== false);

    const snap = await getDocs(
      query(
        collection(db, "club_actions"),
        where("distilleryId", "==", safeId),
        where("isActive", "==", true),
        limit(limitCount),
      ),
    );
    meterDbRead("dataService:club_actions_by_distillery", snap.size);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClubActionPublic));
  });
}

export async function fetchPublicClubMembershipsByVisitorId(visitorId: string, limitCount = 30): Promise<ClubMembershipPublic[]> {
  const safeId = String(visitorId || "").trim();
  if (!safeId) return [];
  return dedupe(`clubMemberships:${safeId}:${limitCount}`, async () => {
    const edgeRows = await fetchEdgeItems<ClubMembershipPublic>(
      `/api/public/club-memberships/${encodeURIComponent(safeId)}`,
      limitCount,
    );
    if (edgeRows && edgeRows.length > 0) return edgeRows;

    const snap = await getDocs(query(collection(db, "club_memberships"), where("visitorId", "==", safeId), limit(limitCount)));
    meterDbRead("dataService:club_memberships_fallback", snap.size);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClubMembershipPublic));
  });
}

export async function fetchPublicLicenseByToken(token: string): Promise<LicensePublic | null> {
  const safeToken = String(token || "").trim();
  if (!safeToken) return null;
  return dedupe(`licenseByToken:${safeToken}`, async () => {
    const edge = await fetchEdgeItem<LicensePublic>(`/api/public/license/${encodeURIComponent(safeToken)}`);
    if (edge) return edge;

    const snap = await getDocs(query(collection(db, "licenses"), where("token", "==", safeToken), limit(1)));
    meterDbRead("dataService:license_by_token_fallback", snap.size);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as LicensePublic;
  });
}

