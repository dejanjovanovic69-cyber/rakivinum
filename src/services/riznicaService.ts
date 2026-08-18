import {
  Timestamp,
  doc,
  deleteDoc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { CACHE_TTL, REFRESH_INTERVAL } from "../lib/cachePolicy";
import { shouldRunRefresh } from "../lib/refreshGate";
import { readCache, writeCache } from "../lib/resilience";
import { meterEdgeRequest } from "../lib/requestMeter";
import { isQuotaSaverActive } from "../lib/quotaSaver";
import { resolveEdgeApiBase } from "../lib/edgeApiBase";
import type { RiznicaItem, RiznicaPrivacySettings, RiznicaStats } from "../types/riznica";

export type RiznicaItemWithProduct = RiznicaItem & {
  id: string;
  product: Record<string, unknown> | null;
};

type EdgeRiznicaPayload = { success?: boolean; data?: RiznicaItemWithProduct[] };
type EdgeMutationPayload = { success?: boolean; error?: string; message?: string };
type EdgePublicRiznicaPayload = {
  success?: boolean;
  data?: {
    isPublic?: boolean;
    ownerName?: string | null;
    ownerHandle?: string | null;
    ownerAvatar?: string | null;
    items?: Array<Record<string, unknown>>;
  };
};
type EdgePrivacySettingsPayload = {
  success?: boolean;
  data?: {
    riznicaPublic?: boolean;
    riznicaPublicNotes?: boolean;
    riznicaLastSharedAt?: string | null;
  };
};
type RiznicaAddOptions = {
  product?: Record<string, unknown> | null;
};

const EDGE_API_BASE = resolveEdgeApiBase();
const RIZNICA_CACHE_TTL_MS = 25 * 60 * 1000;
const RIZNICA_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
const inFlight = new Map<string, Promise<unknown>>();
const riznicaDebugCounters = {
  fetchEdgeRiznicaCalls: 0,
  drinkHydrationCalls: 0,
  effectDataLoads: 0,
  effectPrivacyLoads: 0,
  effectQrLoads: 0,
  effectAuthLoads: 0,
};

function isRiznicaRouteActive(): boolean {
  if (typeof window === "undefined") return false;
  const path = String(window.location.pathname || "").toLowerCase();
  return path === "/moja-riznica" || path.startsWith("/moja-riznica/");
}

async function resolveUid(uidOverride?: string): Promise<string | null> {
  if (uidOverride) return uidOverride;
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  const maybeReady = auth as unknown as { authStateReady?: () => Promise<void> };
  if (typeof maybeReady.authStateReady === "function") {
    try {
      await maybeReady.authStateReady();
    } catch {
      // ignore and continue with current value
    }
  }
  return auth.currentUser?.uid || null;
}

function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const created = factory().finally(() => inFlight.delete(key));
  inFlight.set(key, created);
  return created;
}

function getCacheKey(uid: string): string {
  return `rakivinum_cache_riznica_items_${uid}_v2`;
}

function getRefreshKey(uid: string): string {
  return `riznica:${uid}`;
}

function getPublicCacheKey(uid: string): string {
  return `rakivinum_cache_public_riznica_${uid}_v1`;
}

function getLocalShadowKey(uid: string): string {
  return `rakivinum_local_riznica_shadow_${uid}_v1`;
}

function getMetaKey(uid: string): string {
  return `rakivinum_cache_riznica_meta_${uid}_v1`;
}

function readLocalShadow(uid: string): RiznicaItemWithProduct[] {
  try {
    const raw = localStorage.getItem(getLocalShadowKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RiznicaItemWithProduct[]) : [];
  } catch {
    return [];
  }
}

function writeLocalShadow(uid: string, rows: RiznicaItemWithProduct[]): void {
  try {
    localStorage.setItem(getLocalShadowKey(uid), JSON.stringify(rows.slice(0, 300)));
  } catch {
    // ignore local storage write errors
  }
}

function readLastSyncAt(uid: string): number {
  try {
    const raw = localStorage.getItem(getMetaKey(uid));
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeLastSyncAt(uid: string): void {
  try {
    localStorage.setItem(getMetaKey(uid), String(Date.now()));
  } catch {
    // best effort only
  }
}

function getSnapshot(uid: string): RiznicaItemWithProduct[] {
  const cached = readCache<RiznicaItemWithProduct[]>(getCacheKey(uid));
  if (Array.isArray(cached)) return cached;
  const shadow = readLocalShadow(uid);
  return Array.isArray(shadow) ? shadow : [];
}

async function fetchEdgeRiznica(uid: string): Promise<RiznicaItemWithProduct[] | null> {
  riznicaDebugCounters.fetchEdgeRiznicaCalls += 1;
  if (!isRiznicaRouteActive()) {
    // Hard guard: never allow Riznica read traffic outside the Riznica route.
    return null;
  }
  if (!EDGE_API_BASE || !auth.currentUser?.uid) return null;
  try {
    console.count("RIZNICA_FETCH");
    console.groupCollapsed(`[RIZNICA] FETCH uid=${uid}`);
    const token = await auth.currentUser.getIdToken();
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const limit = isQuotaSaverActive() ? 8 : 20;
    const res = await fetch(`${base}/api/private/riznica?useEnrichedRiznica=1&limit=${limit}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
    meterEdgeRequest("/api/private/riznica", res.status, res.headers.get("x-cache-status"));
    if (!res.ok) return null;
    const payload = (await res.json()) as EdgeRiznicaPayload;
    const items = Array.isArray(payload?.data) ? payload.data : [];
    console.info(`[RIZNICA] FETCH SUCCESS uid=${uid} items=${items.length}`);
    console.groupEnd();
    return items.map((item) => ({
      ...item,
      drinkId: String(item.drinkId || item.id || ""),
      product: item.product || null,
    }));
  } catch (e) {
    console.error("[RIZNICA] fetchEdgeRiznica failed", e);
    console.groupEnd();
    return null;
  }
}

async function fetchProductsByIdsFromEdge(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  riznicaDebugCounters.drinkHydrationCalls += 1;
  const byId = new Map<string, Record<string, unknown>>();
  if (!EDGE_API_BASE) return byId;
  const safeIds = Array.from(new Set(ids.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 120);
  if (safeIds.length === 0) return byId;
  const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
  const query = encodeURIComponent(safeIds.join(","));
  const res = await fetch(`${base}/api/public/products-by-ids?ids=${query}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) return byId;
  const payload = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.items) ? payload.items : [];
  rows.forEach((row) => {
    const id = String(row.id || "").trim();
    if (id) byId.set(id, row);
  });
  return byId;
}

export function getRiznicaDebugCounters(): {
  fetchEdgeRiznicaCalls: number;
  drinkHydrationCalls: number;
  effectDataLoads: number;
  effectPrivacyLoads: number;
  effectQrLoads: number;
  effectAuthLoads: number;
} {
  return { ...riznicaDebugCounters };
}

export function bumpRiznicaDebugCounter(
  key: "effectDataLoads" | "effectPrivacyLoads" | "effectQrLoads" | "effectAuthLoads",
): void {
  riznicaDebugCounters[key] += 1;
}

async function postPrivateEdge<TBody extends object>(
  path: "/api/private/riznica/add" | "/api/private/riznica/update" | "/api/private/riznica/remove" | "/api/private/riznica/settings",
  body: TBody,
): Promise<EdgeMutationPayload> {
  if (!EDGE_API_BASE || !auth.currentUser) {
    return { success: false, error: "edge_unavailable", message: "Edge API is unavailable." };
  }
  try {
    const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
    const doRequest = async (forceRefreshToken: boolean) => {
      const token = await auth.currentUser!.getIdToken(forceRefreshToken);
      return fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    };
    let res = await doRequest(false);
    if (res.status === 401) {
      res = await doRequest(true);
    }
    meterEdgeRequest(path, res.status, res.headers.get("x-cache-status"));
    let payload: EdgeMutationPayload = { success: res.ok };
    try {
      payload = (await res.json()) as EdgeMutationPayload;
    } catch {
      // ignore json parse fallback
    }
    if (!res.ok) {
      const limitReached = String(payload.message || "").includes("riznica_limit_reached");
      return {
        success: false,
        error: limitReached ? "riznica_limit_reached" : payload.error || `http_${res.status}`,
        message: limitReached ? "Maksimalan broj stavki u Riznici je dostignut (300)." : payload.message || "Worker mutation failed.",
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: "network_error", message: "Network error contacting worker." };
  }
}

function upsertCachedRiznica(uid: string, next: (prev: RiznicaItemWithProduct[]) => RiznicaItemWithProduct[]): void {
  const cacheKey = getCacheKey(uid);
  const prev = readCache<RiznicaItemWithProduct[]>(cacheKey) || [];
  const updated = next(prev);
  writeCache(cacheKey, updated, RIZNICA_CACHE_TTL_MS);
  writeLocalShadow(uid, updated);
  writeLastSyncAt(uid);
}

function writeRiznicaSnapshot(uid: string, rows: RiznicaItemWithProduct[]): void {
  writeCache(getCacheKey(uid), rows, RIZNICA_CACHE_TTL_MS);
  writeLocalShadow(uid, rows);
  writeLastSyncAt(uid);
}

async function fetchFreshRiznica(uid: string): Promise<RiznicaItemWithProduct[] | null> {
  const edgeRows = await fetchEdgeRiznica(uid);
  if (!Array.isArray(edgeRows)) return null;
  const missingIds = edgeRows
    .filter((row) => {
      const p = row.product as Record<string, unknown> | null;
      if (!p) return true;
      const image = String(p.image || p.bottleImageUrl || "").trim();
      return image.length === 0;
    })
    .map((row) => String(row.drinkId || row.id || "").trim())
    .filter(Boolean);
  const idsToHydrate = Array.from(new Set(missingIds)).slice(0, 12);
  const needHydration = idsToHydrate.length > 0;
  if (!needHydration) return edgeRows;
  const byId = await fetchProductsByIdsFromEdge(idsToHydrate);
  return edgeRows.map((row) => ({
    ...row,
    product: row.product || byId.get(String(row.drinkId || row.id || "").trim()) || null,
  }));
}

export const riznicaService = {
  getMyRiznicaSnapshot(uidOverride?: string): RiznicaItemWithProduct[] {
    const uid = uidOverride || auth.currentUser?.uid;
    if (!uid) return [];
    return getSnapshot(uid);
  },

  async revalidateMyRiznica(uidOverride?: string, force = false): Promise<RiznicaItemWithProduct[]> {
    const uid = uidOverride || auth.currentUser?.uid;
    if (!uid) return [];
    const snapshot = getSnapshot(uid);
    const refreshAllowed = force || shouldRunRefresh(getRefreshKey(uid), RIZNICA_REFRESH_COOLDOWN_MS);
    if (!refreshAllowed && snapshot.length > 0) {
      console.info(`[Riznica] Serving from cache only to save quota. uid=${uid}`);
      return snapshot;
    }
    return dedupe(`riznica:revalidate:${uid}`, async () => {
      console.info(`[Riznica] revalidate start uid=${uid} force=${force} snapshot=${snapshot.length}`);
      const fresh = await fetchFreshRiznica(uid);
      if (Array.isArray(fresh)) {
        if (fresh.length === 0 && snapshot.length > 0) return snapshot;
        writeRiznicaSnapshot(uid, fresh);
        console.info(`[Riznica] revalidate success uid=${uid} fresh=${fresh.length}`);
        return fresh;
      }
      console.warn(`[Riznica] revalidate failed uid=${uid}, serving snapshot=${snapshot.length}`);
      return snapshot;
    });
  },

  async getPrivacySettings(): Promise<RiznicaPrivacySettings> {
    if (!auth.currentUser) {
      return { riznicaPublic: false, riznicaPublicNotes: false, riznicaLastSharedAt: null };
    }
    if (!EDGE_API_BASE) {
      try {
        const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const row = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        return {
          riznicaPublic: row.riznicaPublic === true,
          riznicaPublicNotes: row.riznicaPublicNotes === true,
          riznicaLastSharedAt:
            row.riznicaLastSharedAt && typeof (row.riznicaLastSharedAt as { toDate?: () => Date }).toDate === "function"
              ? Timestamp.fromDate((row.riznicaLastSharedAt as { toDate: () => Date }).toDate())
              : null,
        };
      } catch {
        return { riznicaPublic: false, riznicaPublicNotes: false, riznicaLastSharedAt: null };
      }
    }
    try {
      const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
      const doRequest = async (forceRefreshToken: boolean) => {
        const token = await auth.currentUser!.getIdToken(forceRefreshToken);
        return fetch(`${base}/api/private/riznica/settings`, {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
        });
      };
      let res = await doRequest(false);
      if (res.status === 401) {
        res = await doRequest(true);
      }
      meterEdgeRequest("/api/private/riznica/settings", res.status, res.headers.get("x-cache-status"));
      if (!res.ok) {
        const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const row = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        return {
          riznicaPublic: row.riznicaPublic === true,
          riznicaPublicNotes: row.riznicaPublicNotes === true,
          riznicaLastSharedAt:
            row.riznicaLastSharedAt && typeof (row.riznicaLastSharedAt as { toDate?: () => Date }).toDate === "function"
              ? Timestamp.fromDate((row.riznicaLastSharedAt as { toDate: () => Date }).toDate())
              : null,
        };
      }
      const payload = (await res.json()) as EdgePrivacySettingsPayload;
      const settings = payload.data || {};
      return {
        riznicaPublic: settings.riznicaPublic === true,
        riznicaPublicNotes: settings.riznicaPublicNotes === true,
        riznicaLastSharedAt: settings.riznicaLastSharedAt
          ? Timestamp.fromDate(new Date(String(settings.riznicaLastSharedAt)))
          : null,
      };
    } catch {
      return { riznicaPublic: false, riznicaPublicNotes: false, riznicaLastSharedAt: null };
    }
  },

  async updatePrivacySettings(updates: Pick<RiznicaPrivacySettings, "riznicaPublic" | "riznicaPublicNotes">): Promise<RiznicaPrivacySettings> {
    const normalized = {
      riznicaPublic: updates.riznicaPublic === true,
      riznicaPublicNotes: updates.riznicaPublic === true && updates.riznicaPublicNotes === true,
    };
    const result = await postPrivateEdge("/api/private/riznica/settings", normalized);
    if (!result.success) {
      // Fallback for auth edge glitches: persist directly to users/{uid}.
      if (!auth.currentUser) throw new Error(result.error || "riznica_settings_update_failed");
      await setDoc(
        doc(db, "users", auth.currentUser.uid),
        {
          riznicaPublic: normalized.riznicaPublic,
          riznicaPublicNotes: normalized.riznicaPublicNotes,
          riznicaLastSharedAt: normalized.riznicaPublic ? serverTimestamp() : null,
        },
        { merge: true },
      );
    }
    const nextLastSharedAt = updates.riznicaPublic ? Timestamp.fromDate(new Date()) : null;
    return {
      riznicaPublic: normalized.riznicaPublic,
      riznicaPublicNotes: normalized.riznicaPublicNotes,
      riznicaLastSharedAt: nextLastSharedAt,
    };
  },

  async getMyRiznica(forceRefresh = false, uidOverride?: string): Promise<RiznicaItemWithProduct[]> {
    const uid = uidOverride || auth.currentUser?.uid;
    if (!uid) return [];
    const snapshot = getSnapshot(uid);

    if (!forceRefresh) {
      console.info(`[RIZNICA] CACHE-FIRST uid=${uid} items=${snapshot.length}`);
      return snapshot;
    }

    const refreshKey = `riznica:${uid}`;
    if (!shouldRunRefresh(refreshKey, RIZNICA_REFRESH_COOLDOWN_MS)) {
      console.info(`[RIZNICA] GATE BLOCKED uid=${uid}`);
      return snapshot;
    }

    return dedupe(`riznica:revalidate:${uid}`, async () => {
      console.info(`[RIZNICA] REVALIDATE START uid=${uid}`);
      const fresh = await fetchEdgeRiznica(uid);

      if (Array.isArray(fresh) && fresh.length > 0) {
        writeCache(getCacheKey(uid), fresh, RIZNICA_CACHE_TTL_MS);
        console.info(`[RIZNICA] REVALIDATE SUCCESS uid=${uid} items=${fresh.length}`);
        return fresh;
      }

      console.warn(`[RIZNICA] REVALIDATE FAILED/EMPTY -> keeping old cache uid=${uid}`);
      return snapshot;
    });
  },

  async addToRiznica(drinkId: string, data: Partial<RiznicaItem>, options?: RiznicaAddOptions): Promise<void> {
    const uid = await resolveUid();
    if (!uid || !drinkId) {
      throw new Error("Niste prijavljeni. Prijavite se i pokušajte ponovo.");
    }
    const previousSnapshot = getSnapshot(uid);
    const purchaseDateValue =
      data.purchaseDate && typeof (data.purchaseDate as { toDate?: () => Date }).toDate === "function"
        ? (data.purchaseDate as { toDate: () => Date }).toDate().toISOString()
        : (data.purchaseDate as unknown as string | null) ?? null;
    upsertCachedRiznica(uid, (prev) => {
      const existing = prev.find((x) => x.drinkId === drinkId);
      if (existing) return prev;
      const nowIso = new Date().toISOString();
      return [
        {
          id: drinkId,
          drinkId,
          addedAt: Timestamp.fromDate(new Date(nowIso)),
          category: data.category ?? null,
          userRating: data.userRating ?? null,
          notes: data.notes ?? "",
          purchasePrice: data.purchasePrice ?? null,
          purchaseDate: null,
          shelf: data.shelf ?? "polica-1",
          position: typeof data.position === "number" ? data.position : 0,
          product: options?.product || null,
        },
        ...prev,
      ].slice(0, 300);
    });
    const result = await postPrivateEdge("/api/private/riznica/add", {
      drinkId,
      category: data.category ?? null,
      userRating: data.userRating ?? null,
      notes: data.notes ?? "",
      purchasePrice: data.purchasePrice ?? null,
      purchaseDate: purchaseDateValue,
      shelf: data.shelf ?? "polica-1",
      position: typeof data.position === "number" ? data.position : 0,
      product: options?.product || null,
    });
    if (!result.success) {
      try {
        // Safety fallback: persist directly if edge is temporarily unavailable.
        await setDoc(
          doc(db, "users", uid, "riznica", drinkId),
          {
            drinkId,
            addedAt: serverTimestamp(),
            category: data.category ?? null,
            userRating: data.userRating ?? null,
            notes: data.notes ?? "",
            purchasePrice: data.purchasePrice ?? null,
            purchaseDate: purchaseDateValue ?? null,
            shelf: data.shelf ?? "polica-1",
            position: typeof data.position === "number" ? data.position : 0,
          },
          { merge: true },
        );
      } catch {
        writeRiznicaSnapshot(uid, previousSnapshot);
        throw new Error(result.error || "riznica_add_failed");
      }
    }
    void this.revalidateMyRiznica(uid, false);
  },

  async removeFromRiznica(drinkId: string): Promise<void> {
    const uid = await resolveUid();
    if (!uid || !drinkId) {
      throw new Error("Niste prijavljeni. Prijavite se i pokušajte ponovo.");
    }
    const previousSnapshot = getSnapshot(uid);
    upsertCachedRiznica(uid, (prev) => prev.filter((x) => x.drinkId !== drinkId));
    const result = await postPrivateEdge("/api/private/riznica/remove", { drinkId });
    if (!result.success) {
      try {
        await deleteDoc(doc(db, "users", uid, "riznica", drinkId));
      } catch {
        writeRiznicaSnapshot(uid, previousSnapshot);
        throw new Error(result.error || "riznica_remove_failed");
      }
    }
  },

  async updateRiznicaItem(drinkId: string, updates: Partial<RiznicaItem>): Promise<void> {
    const uid = await resolveUid();
    if (!uid || !drinkId) {
      throw new Error("Niste prijavljeni. Prijavite se i pokušajte ponovo.");
    }
    const previousSnapshot = getSnapshot(uid);
    const payload: Record<string, unknown> = { ...updates };
    if (updates.purchaseDate instanceof Date) {
      payload.purchaseDate = Timestamp.fromDate(updates.purchaseDate);
    }
    const pd = payload.purchaseDate as { toDate?: () => Date } | string | null | undefined;
    if (pd && typeof pd === "object" && typeof pd.toDate === "function") {
      payload.purchaseDate = pd.toDate().toISOString();
    }
    upsertCachedRiznica(uid, (prev) =>
      prev.map((row) => (row.drinkId === drinkId ? { ...row, ...(updates as Partial<RiznicaItemWithProduct>) } : row)),
    );
    const result = await postPrivateEdge("/api/private/riznica/update", { drinkId, updates: payload });
    if (!result.success) {
      try {
        await setDoc(
          doc(db, "users", uid, "riznica", drinkId),
          {
            ...payload,
            drinkId,
          },
          { merge: true },
        );
      } catch {
        writeRiznicaSnapshot(uid, previousSnapshot);
        throw new Error(result.error || "riznica_update_failed");
      }
    }
  },

  getRiznicaStats(items: RiznicaItemWithProduct[]): RiznicaStats {
    const totalDrinks = items.length;
    const ratings = items.map((i) => Number(i.userRating)).filter((n) => Number.isFinite(n) && n > 0);
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null;

    const types = new Map<string, number>();
    let oldestYear: number | null = null;
    let totalValue = 0;
    for (const item of items) {
      const t = String(item.product?.type || "").trim();
      if (t) types.set(t, (types.get(t) || 0) + 1);
      const year = Number(item.product?.year || item.product?.distilledYear);
      if (Number.isFinite(year) && year > 1800) {
        oldestYear = oldestYear === null ? year : Math.min(oldestYear, year);
      }
      const price = Number(item.purchasePrice);
      if (Number.isFinite(price) && price > 0) totalValue += price;
    }
    const topType =
      [...types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { totalDrinks, avgRating, topType, oldestYear, totalValue: Math.round(totalValue * 100) / 100 };
  },

  async getPublicRiznicaByUid(uid: string): Promise<{
    isPublic: boolean;
    ownerName: string | null;
    ownerHandle: string | null;
    ownerAvatar: string | null;
    items: RiznicaItemWithProduct[];
  }> {
    const safeUid = String(uid || "").trim();
    if (!safeUid || !EDGE_API_BASE) {
      return { isPublic: false, ownerName: null, ownerHandle: null, ownerAvatar: null, items: [] };
    }
    const cacheKey = getPublicCacheKey(safeUid);
    const refreshAllowed = shouldRunRefresh(`riznica:public:${safeUid}`, REFRESH_INTERVAL.USER_LIGHT_1H);
    if (!refreshAllowed) {
      const cached = readCache<{
        isPublic: boolean;
        ownerName: string | null;
        ownerHandle: string | null;
        ownerAvatar: string | null;
        items: RiznicaItemWithProduct[];
      }>(cacheKey);
      if (cached) return cached;
    }
    const cached = readCache<{
      isPublic: boolean;
      ownerName: string | null;
      ownerHandle: string | null;
        ownerAvatar: string | null;
      items: RiznicaItemWithProduct[];
    }>(cacheKey);
    if (cached && !refreshAllowed) return cached;
    try {
      const base = EDGE_API_BASE.endsWith("/") ? EDGE_API_BASE.slice(0, -1) : EDGE_API_BASE;
      const res = await fetch(`${base}/api/public/riznica/${encodeURIComponent(safeUid)}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      meterEdgeRequest(`/api/public/riznica/${safeUid}`, res.status, res.headers.get("x-cache-status"));
      if (!res.ok) return cached || { isPublic: false, ownerName: null, ownerHandle: null, ownerAvatar: null, items: [] };
      const payload = (await res.json()) as EdgePublicRiznicaPayload;
      const data = payload.data || {};
      const rows = Array.isArray(data.items) ? data.items : [];
      const items = rows.map((row) => ({
        id: String(row.drinkId || ""),
        drinkId: String(row.drinkId || ""),
        addedAt: Timestamp.fromDate(new Date(String(row.addedAt || new Date().toISOString()))),
        category: (row.category as RiznicaItem["category"]) ?? null,
        userRating: typeof row.userRating === "number" ? row.userRating : null,
        notes: typeof row.notes === "string" ? row.notes : "",
        purchasePrice: null,
        purchaseDate: null,
        shelf: typeof row.shelf === "string" ? row.shelf : "polica-1",
        position: typeof row.position === "number" ? row.position : 0,
        product: {
          id: String(row.drinkId || ""),
          name: row.name,
          type: row.type,
          image: row.image,
          bottleImageUrl: row.bottleImageUrl,
          year: row.year,
          distilledYear: row.year,
        },
      })) as RiznicaItemWithProduct[];
      const result = {
        isPublic: data.isPublic === true,
        ownerName: typeof data.ownerName === "string" ? data.ownerName : null,
        ownerHandle: typeof data.ownerHandle === "string" ? data.ownerHandle : null,
        ownerAvatar: typeof data.ownerAvatar === "string" ? data.ownerAvatar : null,
        items,
      };
      writeCache(cacheKey, result, CACHE_TTL.PRODUCTS_BY_IDS_1H);
      return result;
    } catch {
      return cached || { isPublic: false, ownerName: null, ownerHandle: null, ownerAvatar: null, items: [] };
    }
  },
};
