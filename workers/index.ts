type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

type WorkerExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

type Env = {
  FIREBASE_PROJECT_ID?: string;
  FIRESTORE_DATABASE_ID?: string;
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
  FIRESTORE_CACHE?: KVNamespace;
};

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } };

type FirestoreDoc = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=3600, s-maxage=21600",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

const GCP_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 360;
/** Browser/edge cache; public catalog hits should mostly avoid Firestore repeat reads. */
const EDGE_CACHE_TTL_SECONDS = 3600;
const KV_CACHE_TTL_SECONDS = 6 * 60 * 60;
/** Workers Cache API (POP); many concurrent clients share one cached body per normalized URL. */
const CF_CACHE_S_MAXAGE_SECONDS = 3600;
const EMERGENCY_CACHE_ONLY_MODE = false;

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
let rateLimitState = new Map<string, { count: number; resetAt: number }>();
let isolateCache = new Map<string, { data: string; expiresAt: number }>();
/** One Firestore round-trip per normalized URL per isolate while the promise is in flight. */
const publicInFlight = new Map<string, Promise<PublicFetchCoalesceResult>>();

type PublicFetchCoalesceResult =
  | { ok: true; status: number; bodyText: string }
  | { ok: false; status: number; bodyText: string };

function getClientIp(request: Request): string {
  const fromCf = String(request.headers.get("cf-connecting-ip") || "").trim();
  if (fromCf) return fromCf;
  const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwarded || "unknown";
}

function isRateLimited(request: Request, url: URL): boolean {
  const ip = getClientIp(request);
  const key = `${ip}:${url.pathname}`;
  const now = Date.now();
  const row = rateLimitState.get(key);
  if (!row || now >= row.resetAt) {
    rateLimitState.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  row.count += 1;
  if (row.count > RATE_LIMIT_MAX_REQUESTS) return true;

  // Best-effort cleanup so this in-memory map does not grow forever.
  if (rateLimitState.size > 8000) {
    const next = new Map<string, { count: number; resetAt: number }>();
    rateLimitState.forEach((value, entryKey) => {
      if (value.resetAt > now) next.set(entryKey, value);
    });
    rateLimitState = next;
  }
  return false;
}

function withDefaultHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=3600, s-maxage=21600");
  if (!headers.has("access-control-allow-origin")) headers.set("access-control-allow-origin", "*");
  if (!headers.has("access-control-allow-methods")) headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  if (!headers.has("access-control-allow-headers")) headers.set("access-control-allow-headers", "content-type,authorization");
  return new Response(response.body, { status: response.status, headers });
}

function isEmergencyCacheOnlyPath(pathname: string): boolean {
  if (
    pathname === "/api/public/products" ||
    pathname === "/api/public/distilleries" ||
    pathname === "/api/public/ratings-feed" ||
    pathname === "/api/public/club-actions" ||
    pathname === "/api/public/daily-recommendations" ||
    pathname === "/api/public/home-bundle"
  ) {
    return true;
  }
  return (
    pathname.startsWith("/api/public/label-view/") ||
    pathname.startsWith("/api/public/product-ratings/") ||
    pathname.startsWith("/api/public/products-by-ids") ||
    pathname.startsWith("/api/public/products-by-distillery/") ||
    pathname.startsWith("/api/public/scan-clusters/")
  );
}

function emergencyEmptyPayload(pathname: string): string {
  if (pathname === "/api/public/home-bundle") {
    return JSON.stringify({
      memberships: [],
      actions: [],
      daily: { rakija: null, vino: null },
      distilleryNames: {},
    });
  }
  if (pathname === "/api/public/daily-recommendations") {
    return JSON.stringify({ rakija: null, vino: null });
  }
  if (pathname.startsWith("/api/public/label-view/")) {
    return JSON.stringify({ product: null, distillery: null, reviews: [] });
  }
  if (pathname.startsWith("/api/public/product-ratings/") || pathname.startsWith("/api/public/scan-clusters/")) {
    return JSON.stringify({ items: [] });
  }
  return JSON.stringify({ items: [] });
}

type ServePublicCachedOpts = {
  /** In-memory isolate cache TTL after a Firestore miss (default 3m). */
  memTtlMs?: number;
};

async function servePublicCached(
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
  handler: () => Promise<Response>,
  opts?: ServePublicCachedOpts,
): Promise<Response> {
  const cacheUrl = new URL(request.url);
  // Keep only request-shaping params in cache key; drop noisy tracking params.
  const allowedParams = new URLSearchParams();
  if (cacheUrl.searchParams.has("limit")) {
    allowedParams.set("limit", String(cacheUrl.searchParams.get("limit") || ""));
  }
  if (
    cacheUrl.pathname === "/api/public/distilleries-by-ids" ||
    cacheUrl.pathname === "/api/public/products-by-ids"
  ) {
    if (cacheUrl.searchParams.has("ids")) allowedParams.set("ids", String(cacheUrl.searchParams.get("ids") || ""));
  }
  if (cacheUrl.pathname === "/api/public/product-lookup") {
    if (cacheUrl.searchParams.has("n")) allowedParams.set("n", String(cacheUrl.searchParams.get("n") || ""));
  }
  if (cacheUrl.pathname === "/api/public/home-bundle") {
    if (cacheUrl.searchParams.has("visitor")) {
      allowedParams.set("visitor", String(cacheUrl.searchParams.get("visitor") || ""));
    }
  }
  if (cacheUrl.pathname.startsWith("/api/public/products-by-distillery/")) {
    if (cacheUrl.searchParams.has("after")) {
      allowedParams.set("after", String(cacheUrl.searchParams.get("after") || ""));
    }
  }
  cacheUrl.search = allowedParams.toString();

  const normalizedUrl = cacheUrl.toString();
  const now = Date.now();
  if (isolateCache.size > 300) {
    const keysToDelete = Array.from(isolateCache.keys()).slice(0, 50);
    keysToDelete.forEach((k) => isolateCache.delete(k));
  }

  const memTtlAfterMiss = opts?.memTtlMs ?? 180_000;

  const memHit = isolateCache.get(normalizedUrl);
  if (memHit && now < memHit.expiresAt) {
    return new Response(memHit.data, {
      status: 200,
      headers: {
        ...jsonHeaders,
        "cache-control": "public, max-age=60, s-maxage=60",
        "x-cache-status": "mem-hit",
      },
    });
  }

  const kvKey = `public:${normalizedUrl}`;
  if (env.FIRESTORE_CACHE) {
    const kvHit = await env.FIRESTORE_CACHE.get(kvKey);
    if (kvHit) {
      isolateCache.set(normalizedUrl, { data: kvHit, expiresAt: now + 60_000 });
      return new Response(kvHit, {
        status: 200,
        headers: {
          ...jsonHeaders,
          "cache-control": "public, max-age=3600, s-maxage=21600",
          "x-cache-status": "kv-hit",
        },
      });
    }
  }

  const cfCacheReq = new Request(normalizedUrl, { method: "GET" });
  try {
    const cfHit = await caches.default.match(cfCacheReq);
    if (cfHit) {
      const bodyText = await cfHit.text();
      isolateCache.set(normalizedUrl, { data: bodyText, expiresAt: now + Math.min(memTtlAfterMiss, 120_000) });
      return new Response(bodyText, {
        status: cfHit.status,
        headers: {
          ...jsonHeaders,
          "cache-control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${CF_CACHE_S_MAXAGE_SECONDS}`,
          "x-cache-status": "cf-hit",
        },
      });
    }
  } catch (err) {
    console.warn("caches.default.match failed:", err);
  }

  if (EMERGENCY_CACHE_ONLY_MODE && isEmergencyCacheOnlyPath(cacheUrl.pathname)) {
    const staleMem = isolateCache.get(normalizedUrl);
    if (staleMem) {
      return new Response(staleMem.data, {
        status: 200,
        headers: {
          ...jsonHeaders,
          "cache-control": "public, max-age=30, s-maxage=30",
          "x-cache-status": "mem-stale",
        },
      });
    }
    return new Response(emergencyEmptyPayload(cacheUrl.pathname), {
      status: 200,
      headers: {
        ...jsonHeaders,
        "cache-control": "public, max-age=10, s-maxage=10",
        "x-cache-status": "emergency-empty",
      },
    });
  }

  let inFlight = publicInFlight.get(normalizedUrl);
  if (!inFlight) {
    let resolveCoalesce!: (value: PublicFetchCoalesceResult) => void;
    inFlight = new Promise<PublicFetchCoalesceResult>((res) => {
      resolveCoalesce = res;
    });
    publicInFlight.set(normalizedUrl, inFlight);
    void (async () => {
      try {
        const fresh = await handler();
        if (!fresh.ok) {
          const bodyText = await fresh.text();
          resolveCoalesce({ ok: false, status: fresh.status, bodyText });
          return;
        }
        const bodyText = await fresh.text();
        const t = Date.now();
        isolateCache.set(normalizedUrl, { data: bodyText, expiresAt: t + memTtlAfterMiss });
        if (env.FIRESTORE_CACHE) {
          ctx.waitUntil(
            env.FIRESTORE_CACHE.put(kvKey, bodyText, { expirationTtl: KV_CACHE_TTL_SECONDS }).catch((err) => {
              console.warn("KV cache put failed:", err);
            }),
          );
        }
        const cfStoreHeaders = new Headers({
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${CF_CACHE_S_MAXAGE_SECONDS}`,
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        });
        ctx.waitUntil(
          caches.default
            .put(cfCacheReq, new Response(bodyText, { status: 200, headers: cfStoreHeaders }))
            .catch((err) => {
              console.warn("caches.default.put failed:", err);
            }),
        );
        resolveCoalesce({ ok: true, status: fresh.status, bodyText });
      } catch (err) {
        console.warn("servePublicCached handler error:", err);
        resolveCoalesce({
          ok: false,
          status: 500,
          bodyText: JSON.stringify({ error: "internal", message: "Temporary failure fetching public data." }),
        });
      } finally {
        publicInFlight.delete(normalizedUrl);
      }
    })();
  }

  const coalesced = await inFlight;
  if (!coalesced.ok) {
    return new Response(coalesced.bodyText, {
      status: coalesced.status,
      headers: jsonHeaders,
    });
  }
  return new Response(coalesced.bodyText, {
    status: coalesced.status,
    headers: {
      ...jsonHeaders,
      "cache-control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=3600`,
      "x-cache-status": "miss-store",
    },
  });
}

function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("mapValue" in value) {
    const out: Record<string, unknown> = {};
    const fields = value.mapValue?.fields || {};
    Object.entries(fields).forEach(([k, v]) => {
      out[k] = decodeFirestoreValue(v);
    });
    return out;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue?.values || []).map((v) => decodeFirestoreValue(v));
  }
  return null;
}

function decodeDocument(doc: FirestoreDoc): Record<string, unknown> {
  const id = String(doc.name || "").split("/").pop() || "";
  const out: Record<string, unknown> = { id };
  const fields = doc.fields || {};
  Object.entries(fields).forEach(([k, v]) => {
    out[k] = decodeFirestoreValue(v);
  });
  return out;
}

function parseLimit(url: URL, fallback: number, max: number): number {
  const n = Number(url.searchParams.get("limit") || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

function asText(value: unknown): string | undefined {
  const v = String(value ?? "").trim();
  return v ? v : undefined;
}

function sanitizeImageUrl(value: unknown): string | undefined {
  const v = asText(value);
  if (!v) return undefined;
  // Inline base64 blows up JSON, edge cache, and bandwidth; public responses should use https/storage URLs.
  if (/^\s*data:/i.test(v)) return undefined;
  return v;
}

function sanitizeProductDocForPublicJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    bottleImageUrl: sanitizeImageUrl(row.bottleImageUrl),
    image: sanitizeImageUrl(row.image),
  };
}

function sanitizeDistilleryDocForPublicJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    logoUrl: sanitizeImageUrl(row.logoUrl),
  };
}

function toDistilleryListItem(row: Record<string, unknown>): Record<string, unknown> {
  const location = (row.location && typeof row.location === "object" ? row.location : {}) as Record<string, unknown>;
  const city = asText(location.city);
  const address = asText(location.address);
  return {
    id: asText(row.id) || "",
    name: asText(row.name) || "",
    region: asText(row.region),
    isVerified: row.isVerified === true,
    logoUrl: sanitizeImageUrl(row.logoUrl),
    location: city || address ? { city, address } : undefined,
  };
}

function toProductListItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    name: asText(row.name) || "",
    type: asText(row.type),
    distilleryId: asText(row.distilleryId),
    alcoholPercentage: typeof row.alcoholPercentage === "number" ? row.alcoholPercentage : row.alcoholPercentage,
    averageRating: typeof row.averageRating === "number" ? row.averageRating : row.averageRating,
    bottleImageUrl: sanitizeImageUrl(row.bottleImageUrl),
    image: sanitizeImageUrl(row.image),
    isApproved: row.isApproved !== false,
    isArchivedByDistillery: row.isArchivedByDistillery === true,
    publicLabelDisabled: row.publicLabelDisabled === true,
  };
}

function toProductScannerHit(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...toProductListItem(row),
    barcode: row.barcode,
    barcodeNormalized: row.barcodeNormalized,
  };
}

function hashByDate(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function isWineProductRow(row: Record<string, unknown>): boolean {
  const normalized = `${String(row.type || "").toLowerCase()} ${String(row.category || "").toLowerCase()} ${String(row.name || "").toLowerCase()}`;
  return normalized.includes("vino") || normalized.includes("wine");
}

function isPublicProductRow(row: Record<string, unknown>): boolean {
  return (
    row.isApproved !== false && row.isArchivedByDistillery !== true && row.publicLabelDisabled !== true
  );
}

function dailyRecommendationsFromRows(rows: Record<string, unknown>[]): {
  rakija: Record<string, unknown> | null;
  vino: Record<string, unknown> | null;
} {
  const eligible = rows.filter((p) => isPublicProductRow(p));
  const winePool = eligible.filter((row) => isWineProductRow(row));
  const rakijaPool = eligible.filter((row) => !isWineProductRow(row));
  const today = new Date().toISOString().slice(0, 10);
  const pick = (pool: Record<string, unknown>[], seed: string): Record<string, unknown> | null => {
    if (pool.length === 0) return null;
    return pool[hashByDate(`${today}:${seed}`) % pool.length];
  };
  const rakija = pick(rakijaPool, "rakija");
  const vino = pick(winePool, "vino");
  return {
    rakija: rakija ? toProductListItem(rakija) : null,
    vino: vino ? toProductListItem(vino) : null,
  };
}

/** Kada proizvod nema HTTP `image`/`bottleImageUrl` (npr. posle stripovanja data:), koristi logo destilerije za mali prikaz na Home. */
async function enrichDailyItemWithDistilleryLogoFallback(
  env: Env,
  item: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!item) return null;
  if (sanitizeImageUrl(item.image) || sanitizeImageUrl(item.bottleImageUrl)) return item;
  const did = asText(item.distilleryId);
  if (!did) return item;
  const d = await fetchDocumentById(env, "distilleries", did);
  if (!d || d.isArchived === true || d.isVerified !== true) return item;
  const logo = sanitizeImageUrl(d.logoUrl);
  if (!logo) return item;
  return { ...item, image: logo };
}

function toNumberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toProductRatingSummary(row: Record<string, unknown>): Record<string, unknown> {
  return {
    productId: asText(row.id) || "",
    averageRating: toNumberOrZero(row.averageRating),
    ratingCount: Math.max(0, Math.floor(toNumberOrZero(row.ratingCount))),
    scanCount: Math.max(0, Math.floor(toNumberOrZero(row.scanCount))),
    conversionRate:
      toNumberOrZero(row.scanCount) > 0
        ? Math.round((toNumberOrZero(row.ratingCount) / toNumberOrZero(row.scanCount)) * 10000) / 100
        : 0,
  };
}

function toCommunityRatingItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    productId: asText(row.productId) || "",
    productName: asText(row.productName),
    productImage: sanitizeImageUrl(row.productImage) || sanitizeImageUrl(row.productBottleImage) || sanitizeImageUrl(row.image),
    rating: toNumberOrZero(row.rating),
    reviewText: asText(row.reviewText) || asText(row.comment),
    comment: asText(row.comment),
    userLocation: asText(row.userLocation),
    createdAt: row.createdAt ?? null,
    isFlagged: row.isFlagged === true,
  };
}

function toCommunityLinkItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    label: asText(row.label) || "Link",
    url: asText(row.url) || "",
  };
}

function toProductRatingItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    rating: toNumberOrZero(row.rating),
    reviewText: asText(row.reviewText),
    comment: asText(row.comment),
    userLocation: asText(row.userLocation),
    createdAt: row.createdAt ?? null,
    sensoryScores: row.sensoryScores ?? null,
  };
}

function toClubActionItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    title: asText(row.title),
    distilleryId: asText(row.distilleryId),
    rewardType: asText(row.rewardType),
    rewardValue: asText(row.rewardValue),
    isActive: row.isActive === true,
    endsAt: row.endsAt ?? null,
    createdAt: row.createdAt ?? null,
    condition: asText(row.condition),
    conditionLabel: asText(row.conditionLabel),
    targetScans: toNumberOrZero(row.targetScans),
    targetRatings: toNumberOrZero(row.targetRatings),
    targetValue: toNumberOrZero(row.targetValue),
  };
}

function toClubMembershipItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    visitorId: asText(row.visitorId),
    distilleryId: asText(row.distilleryId),
    createdAt: row.createdAt ?? null,
  };
}


function toScanClusterItems(rows: Record<string, unknown>[], limitCount: number): Array<{ region: string; val: number }> {
  const clusters = new Map<string, number>();
  rows.forEach((row) => {
    const loc = (row.location && typeof row.location === "object") ? (row.location as Record<string, unknown>) : null;
    const lat = loc && typeof loc.lat === "number" ? loc.lat : null;
    const lng = loc && typeof loc.lng === "number" ? loc.lng : null;
    if (typeof lat === "number" && typeof lng === "number") {
      const key = `${lat.toFixed(1)}°, ${lng.toFixed(1)}°`;
      clusters.set(key, (clusters.get(key) || 0) + 1);
    }
  });
  return [...clusters.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitCount)
    .map(([region, val]) => ({ region, val }));
}function toLicenseItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: asText(row.id) || "",
    token: asText(row.token),
    expiresAt: row.expiresAt ?? null,
    status: asText(row.status),
    plan: asText(row.plan),
  };
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createSignedJwt(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: GCP_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncodeText(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const encodedSignature = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${unsigned}.${encodedSignature}`;
}

async function getAccessToken(env: Env): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAtMs - 60_000) {
    return cachedAccessToken.token;
  }

  const clientEmail = String(env.GCP_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.GCP_PRIVATE_KEY || "").trim();
  if (!clientEmail || !privateKey) {
    throw new Error("Missing GCP_CLIENT_EMAIL or GCP_PRIVATE_KEY");
  }

  const assertion = await createSignedJwt(clientEmail, normalizePrivateKey(privateKey));
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const tokenRes = await fetch(GCP_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`OAuth token error ${tokenRes.status}: ${txt.slice(0, 240)}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  const token = String(tokenJson.access_token || "");
  const expiresIn = Number(tokenJson.expires_in || 3600);
  if (!token) throw new Error("OAuth token missing access_token");

  cachedAccessToken = {
    token,
    expiresAtMs: Date.now() + Math.max(300, expiresIn) * 1000,
  };
  return token;
}

async function fetchCollection(env: Env, collectionName: string, pageSize: number): Promise<Record<string, unknown>[]> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = env.FIRESTORE_DATABASE_ID || "(default)";
  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID");
  }
  const accessToken = await getAccessToken(env);

  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collectionName)}?pageSize=${pageSize}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore REST error ${res.status}: ${body.slice(0, 240)}`);
  }
  const data = (await res.json()) as { documents?: FirestoreDoc[] };
  return (data.documents || []).map(decodeDocument);
}

async function fetchDocumentById(
  env: Env,
  collectionName: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = env.FIRESTORE_DATABASE_ID || "(default)";
  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID");
  }
  const accessToken = await getAccessToken(env);
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore REST error ${res.status}: ${body.slice(0, 240)}`);
  }
  const doc = (await res.json()) as FirestoreDoc;
  return decodeDocument(doc);
}

async function fetchCollectionWhereEquals(
  env: Env,
  collectionName: string,
  fieldName: string,
  fieldValue: string,
  pageSize: number,
): Promise<Record<string, unknown>[]> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = env.FIRESTORE_DATABASE_ID || "(default)";
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID");
  const accessToken = await getAccessToken(env);
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: collectionName }],
      where: {
        fieldFilter: {
          field: { fieldPath: fieldName },
          op: "EQUAL",
          value: { stringValue: fieldValue },
        },
      },
      limit: pageSize,
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore REST runQuery error ${res.status}: ${txt.slice(0, 240)}`);
  }
  const rows = (await res.json()) as Array<{ document?: FirestoreDoc }>;
  return rows
    .filter((r) => r.document)
    .map((r) => decodeDocument(r.document as FirestoreDoc));
}

/** `where` + `orderBy(__name__)` + optional `startAfter` — za katalog po destileriji bez duplog čitanja istih dokumenata. */
async function fetchProductsByDistilleryPaged(
  env: Env,
  distilleryId: string,
  pageSize: number,
  afterDocumentId?: string,
): Promise<Record<string, unknown>[]> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = env.FIRESTORE_DATABASE_ID || "(default)";
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID");
  const accessToken = await getAccessToken(env);
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: "products" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "distilleryId" },
        op: "EQUAL",
        value: { stringValue: distilleryId },
      },
    },
    orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
    limit: pageSize,
  };
  const after = String(afterDocumentId || "").trim();
  if (after) {
    const ref = `projects/${projectId}/databases/${databaseId}/documents/products/${after}`;
    structuredQuery.startAt = {
      values: [{ referenceValue: ref }],
      before: false,
    };
  }
  const body = { structuredQuery };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore REST runQuery error ${res.status}: ${txt.slice(0, 240)}`);
  }
  const rows = (await res.json()) as Array<{ document?: FirestoreDoc }>;
  return rows
    .filter((r) => r.document)
    .map((r) => decodeDocument(r.document as FirestoreDoc));
}

async function fetchCountWhereEquals(
  env: Env,
  collectionName: string,
  fieldName: string,
  fieldValue: string,
): Promise<number> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = env.FIRESTORE_DATABASE_ID || "(default)";
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID");
  const accessToken = await getAccessToken(env);
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runAggregationQuery`;
  const body = {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: {
          fieldFilter: {
            field: { fieldPath: fieldName },
            op: "EQUAL",
            value: { stringValue: fieldValue },
          },
        },
      },
      aggregations: [{ count: {}, alias: "total" }],
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore REST runAggregationQuery error ${res.status}: ${txt.slice(0, 240)}`);
  }
  const rows = (await res.json()) as Array<{ result?: { aggregateFields?: Record<string, FirestoreValue> } }>;
  const aggregate = rows.find((r) => r.result?.aggregateFields)?.result?.aggregateFields;
  const total = aggregate?.total;
  if (!total) return 0;
  if ("integerValue" in total) return Math.max(0, Number(total.integerValue || 0));
  if ("doubleValue" in total) return Math.max(0, Math.floor(Number(total.doubleValue || 0)));
  return 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: jsonHeaders,
        });
      }
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders,
        });
      }

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true, service: "rakivinum-api" }), {
          headers: jsonHeaders,
        });
      }

      if (url.pathname === "/" || url.pathname === "") {
        return new Response(
          JSON.stringify({
            service: "rakivinum-api",
            hint: "This host is the JSON API only (no HTML). Use the main site in a browser.",
            health: "/health",
            example: "/api/public/home-bundle",
          }),
          { status: 200, headers: jsonHeaders },
        );
      }

      if (url.pathname.startsWith("/api/public/")) {
        if (isRateLimited(request, url)) {
          return new Response(
            JSON.stringify({ error: "rate_limited", message: "Too many requests. Try again shortly." }),
            {
              status: 429,
              headers: {
                ...jsonHeaders,
                "retry-after": "60",
              },
            },
          );
        }
      }

      if (url.pathname === "/api/public/distilleries") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, 80, 120);
          const rows = await fetchCollection(env, "distilleries", limitCount);
          const filtered = rows.filter((d) => d.isArchived !== true && d.isVerified === true);
          const lightItems = filtered.map((row) => toDistilleryListItem(row));
          return new Response(JSON.stringify({ items: lightItems }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/distilleries-by-ids") {
        return servePublicCached(request, env, ctx, async () => {
          const raw = String(url.searchParams.get("ids") || "");
          const ids = Array.from(
            new Set(
              raw
                .split(",")
                .map((x) => String(x || "").trim())
                .filter((x) => x.length > 0),
            ),
          ).slice(0, 40);
          if (ids.length === 0) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });

          const rows = await Promise.all(ids.map((id) => fetchDocumentById(env, "distilleries", id)));
          const filtered = rows.filter((d) => d && d.isArchived !== true && d.isVerified === true);
          return new Response(JSON.stringify({ items: filtered }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/products") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, 100, 140);
          const rows = await fetchCollection(env, "products", limitCount);
          const filtered = rows.filter(
            (p) => p.isApproved !== false && p.isArchivedByDistillery !== true && p.publicLabelDisabled !== true,
          );
          const lightItems = filtered.map((row) => toProductListItem(row));
          return new Response(JSON.stringify({ items: lightItems }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/home-bundle") {
        return servePublicCached(
          request,
          env,
          ctx,
          async () => {
            const visitorRaw = String(url.searchParams.get("visitor") || "").trim();
            let membershipItems: Record<string, unknown>[] = [];
            if (visitorRaw) {
              const mRows = await fetchCollectionWhereEquals(env, "club_memberships", "visitorId", visitorRaw, 12);
              membershipItems = mRows.map((r) => toClubMembershipItem(r));
            }

            const clubRows = await fetchCollection(env, "club_actions", 14);
            const actions = clubRows
              .filter((r) => r.isActive === true)
              .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
              .slice(0, 12)
              .map((r) => toClubActionItem(r));

            const productRows = await fetchCollection(env, "products", 8);
            const dailyRaw = dailyRecommendationsFromRows(productRows);
            const daily = {
              rakija: await enrichDailyItemWithDistilleryLogoFallback(env, dailyRaw.rakija),
              vino: await enrichDailyItemWithDistilleryLogoFallback(env, dailyRaw.vino),
            };

            const distilleryIds = Array.from(
              new Set(
                actions
                  .map((a) => String((a as { distilleryId?: string }).distilleryId || "").trim())
                  .filter((id) => id.length > 0),
              ),
            ).slice(0, 6);
            const distilleryNames: Record<string, string> = {};
            if (distilleryIds.length > 0) {
              const dRows = await Promise.all(distilleryIds.map((id) => fetchDocumentById(env, "distilleries", id)));
              dRows.forEach((d) => {
                if (d && d.isArchived !== true && d.isVerified === true) {
                  const id = asText(d.id) || "";
                  if (id) distilleryNames[id] = asText(d.name) || "";
                }
              });
            }

            return new Response(
              JSON.stringify({
                memberships: membershipItems,
                actions,
                daily,
                distilleryNames,
              }),
              { headers: jsonHeaders },
            );
          },
          { memTtlMs: 900_000 },
        );
      }

      if (url.pathname === "/api/public/daily-recommendations") {
        return servePublicCached(
          request,
          env,
          ctx,
          async () => {
            const rows = await fetchCollection(env, "products", 8);
            const dailyRaw = dailyRecommendationsFromRows(rows);
            const daily = {
              rakija: await enrichDailyItemWithDistilleryLogoFallback(env, dailyRaw.rakija),
              vino: await enrichDailyItemWithDistilleryLogoFallback(env, dailyRaw.vino),
            };
            return new Response(JSON.stringify(daily), { headers: jsonHeaders });
          },
          { memTtlMs: 900_000 },
        );
      }

      if (url.pathname === "/api/public/products-by-ids") {
        return servePublicCached(request, env, ctx, async () => {
          const raw = String(url.searchParams.get("ids") || "");
          const ids = Array.from(
            new Set(
              raw
                .split(",")
                .map((x) => String(x || "").trim())
                .filter((x) => x.length > 0),
            ),
          ).slice(0, 40);
          if (ids.length === 0) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });

          const rows = await Promise.all(ids.map((id) => fetchDocumentById(env, "products", id)));
          const filtered = rows
            .filter((row): row is Record<string, unknown> => Boolean(row))
            .filter(
              (row) =>
                row.isApproved !== false && row.isArchivedByDistillery !== true && row.publicLabelDisabled !== true,
            );
          const byId = new Map<string, Record<string, unknown>>();
          filtered.forEach((row) => {
            const id = String(row.id || "").trim();
            if (id) byId.set(id, toProductListItem(row));
          });
          const items = ids.map((id) => byId.get(id)).filter((row): row is Record<string, unknown> => Boolean(row));
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/community-events") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, 30, 80);
          const rows = await fetchCollection(env, "community_events", limitCount);
          const sorted = rows.sort((a, b) => String(b.eventDate || "").localeCompare(String(a.eventDate || "")));
          return new Response(JSON.stringify({ items: sorted }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/community-links") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, 40, 100);
          const rows = await fetchCollection(env, "community_links", limitCount);
          const items = rows
            .filter((r) => String(asText(r.url) || "").trim().length > 0)
            .map((r) => toCommunityLinkItem(r))
            .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), "sr"));
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/ratings-feed") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, 12, 30);
          const fetchCap = Math.min(30, Math.max(limitCount, 12));
          const rows = await fetchCollection(env, "ratings", fetchCap);
          const filtered = rows
            .filter((r) => r.isFlagged !== true)
            .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
            .slice(0, limitCount)
            .map((row) => toCommunityRatingItem(row));
          return new Response(JSON.stringify({ items: filtered }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/club-actions") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, 12, 30);
          const fetchCap = Math.min(28, Math.max(limitCount, 12));
          const rows = await fetchCollection(env, "club_actions", fetchCap);
          const items = rows
            .filter((r) => r.isActive === true)
            .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
            .slice(0, limitCount)
            .map((r) => toClubActionItem(r));
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/club-memberships/")) {
        return servePublicCached(request, env, ctx, async () => {
          const visitorId = decodeURIComponent(url.pathname.replace("/api/public/club-memberships/", "").trim());
          if (!visitorId) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });
          const limitCount = parseLimit(url, 20, 60);
          const rows = await fetchCollectionWhereEquals(env, "club_memberships", "visitorId", visitorId, limitCount);
          const items = rows.map((r) => toClubMembershipItem(r)).filter((r) => String(r.distilleryId || "").trim() !== "");
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/license/")) {
        return servePublicCached(request, env, ctx, async () => {
          const token = decodeURIComponent(url.pathname.replace("/api/public/license/", "").trim());
          if (!token) return new Response(JSON.stringify({ item: null }), { headers: jsonHeaders });
          const rows = await fetchCollectionWhereEquals(env, "licenses", "token", token, 1);
          const item = rows.length > 0 ? toLicenseItem(rows[0]) : null;
          return new Response(JSON.stringify({ item }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/distillery/")) {
        return servePublicCached(request, env, ctx, async () => {
          const id = decodeURIComponent(url.pathname.replace("/api/public/distillery/", "").trim());
          if (!id) return new Response(JSON.stringify({ item: null }), { headers: jsonHeaders });
          const row = await fetchDocumentById(env, "distilleries", id);
          const item = row && row.isArchived !== true && row.isVerified === true ? row : null;
          return new Response(JSON.stringify({ item }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/products-by-distillery/")) {
        return servePublicCached(request, env, ctx, async () => {
          const distilleryId = decodeURIComponent(
            url.pathname.replace("/api/public/products-by-distillery/", "").trim(),
          );
          if (!distilleryId) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });
          const limitCount = parseLimit(url, 6, 60);
          const after = String(url.searchParams.get("after") || "").trim();
          const rows = await fetchProductsByDistilleryPaged(env, distilleryId, limitCount, after || undefined);
          const filtered = rows.filter(
            (p) => p.isApproved !== false && p.isArchivedByDistillery !== true && p.publicLabelDisabled !== true,
          );
          const lightItems = filtered.map((row) => toProductListItem(row));
          return new Response(JSON.stringify({ items: lightItems }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/club-actions-by-distillery/")) {
        return servePublicCached(request, env, ctx, async () => {
          const distilleryId = decodeURIComponent(
            url.pathname.replace("/api/public/club-actions-by-distillery/", "").trim(),
          );
          if (!distilleryId) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });
          const limitCount = parseLimit(url, 20, 60);
          const fetchCap = Math.min(60, Math.max(limitCount * 2, 24));
          const rows = await fetchCollectionWhereEquals(env, "club_actions", "distilleryId", distilleryId, fetchCap);
          const items = rows
            .filter((r) => r.isActive === true)
            .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
            .slice(0, limitCount)
            .map((r) => toClubActionItem(r));
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/club-membership-count/")) {
        return servePublicCached(request, env, ctx, async () => {
          const distilleryId = decodeURIComponent(
            url.pathname.replace("/api/public/club-membership-count/", "").trim(),
          );
          if (!distilleryId) return new Response(JSON.stringify({ count: 0 }), { headers: jsonHeaders });
          const count = await fetchCountWhereEquals(env, "club_memberships", "distilleryId", distilleryId);
          return new Response(JSON.stringify({ count, exact: true }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/product-lookup") {
        return servePublicCached(request, env, ctx, async () => {
          const n = String(url.searchParams.get("n") || "").trim();
          const r = String(url.searchParams.get("r") || "").trim();
          const tryField = async (field: string, val: string): Promise<Record<string, unknown> | null> => {
            if (!val) return null;
            const rows = await fetchCollectionWhereEquals(env, "products", field, val, 8);
            for (const row of rows) {
              if (isPublicProductRow(row)) return toProductScannerHit(row);
            }
            return null;
          };
          let item: Record<string, unknown> | null = null;
          if (n) {
            item = await tryField("barcodeNormalized", n);
            if (!item) item = await tryField("barcode", n);
          }
          if (!item && r) item = await tryField("barcode", r);
          return new Response(JSON.stringify({ item }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/product/")) {
        return servePublicCached(request, env, ctx, async () => {
          const id = decodeURIComponent(url.pathname.replace("/api/public/product/", "").trim());
          if (!id) return new Response(JSON.stringify({ item: null }), { headers: jsonHeaders });
          const row = await fetchDocumentById(env, "products", id);
          const item =
            row &&
            row.isApproved !== false &&
            row.isArchivedByDistillery !== true &&
            row.publicLabelDisabled !== true
              ? sanitizeProductDocForPublicJson(row)
              : null;
          return new Response(JSON.stringify({ item }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/label-view/")) {
        return servePublicCached(request, env, ctx, async () => {
          const id = decodeURIComponent(url.pathname.replace("/api/public/label-view/", "").trim());
          if (!id) return new Response(JSON.stringify({ product: null, distillery: null, reviews: [] }), { headers: jsonHeaders });
          const product = await fetchDocumentById(env, "products", id);
          const isPublic = product &&
            product.isApproved !== false &&
            product.isArchivedByDistillery !== true &&
            product.publicLabelDisabled !== true;
          if (!isPublic) {
            return new Response(JSON.stringify({ product: null, distillery: null, reviews: [] }), { headers: jsonHeaders });
          }
          const distilleryId = String(product.distilleryId || "").trim();
          const distilleryRaw = distilleryId ? await fetchDocumentById(env, "distilleries", distilleryId) : null;
          const distillery =
            distilleryRaw && distilleryRaw.isArchived !== true && distilleryRaw.isVerified === true
              ? sanitizeDistilleryDocForPublicJson(distilleryRaw)
              : null;
          const reviewRows = await fetchCollectionWhereEquals(env, "ratings", "productId", id, 8);
          const reviews = reviewRows
            .filter((r) => r.isFlagged !== true)
            .map((r) => toProductRatingItem(r));
          return new Response(
            JSON.stringify({
              product: sanitizeProductDocForPublicJson(product),
              distillery,
              reviews,
            }),
            { headers: jsonHeaders },
          );
        });
      }

      if (url.pathname.startsWith("/api/public/ratings-summary/")) {
        return servePublicCached(request, env, ctx, async () => {
          const productId = decodeURIComponent(url.pathname.replace("/api/public/ratings-summary/", "").trim());
          if (!productId) {
            return new Response(JSON.stringify({ item: null }), { headers: jsonHeaders });
          }
          const row = await fetchDocumentById(env, "products", productId);
          const isPublic = row &&
            row.isApproved !== false &&
            row.isArchivedByDistillery !== true &&
            row.publicLabelDisabled !== true;
          const item = isPublic ? toProductRatingSummary(row) : null;
          return new Response(JSON.stringify({ item }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/product-ratings/")) {
        return servePublicCached(request, env, ctx, async () => {
          const productId = decodeURIComponent(url.pathname.replace("/api/public/product-ratings/", "").trim());
          if (!productId) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });
          const limitCount = parseLimit(url, 40, 80);
          const rows = await fetchCollectionWhereEquals(env, "ratings", "productId", productId, limitCount);
          const items = rows
            .filter((r) => r.isFlagged !== true)
            .map((r) => toProductRatingItem(r));
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      if (url.pathname.startsWith("/api/public/scan-clusters/")) {
        return servePublicCached(request, env, ctx, async () => {
          const productId = decodeURIComponent(url.pathname.replace("/api/public/scan-clusters/", "").trim());
          if (!productId) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });
          const sampleSize = parseLimit(url, 40, 80);
          const clusterLimit = parseLimit(url, 3, 10);
          const rows = await fetchCollectionWhereEquals(env, "scans", "productId", productId, sampleSize);
          const items = toScanClusterItems(rows, clusterLimit);
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "edge_api_error",
          message: String((err as Error)?.message || err),
        }),
        { status: 500, headers: jsonHeaders },
      );
    }
  },
};



