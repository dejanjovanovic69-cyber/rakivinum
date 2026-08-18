import {
  addToRiznica,
  getRiznicaPrivacySettings,
  getPublicRiznica,
  getUserRiznica,
  getUserRiznicaWithDebug,
  getUserRiznicaEnriched,
  removeFromRiznica,
  updateRiznicaPrivacySettings,
  updateRiznicaItem,
  type RiznicaPrivacySettingsPayload,
  type RiznicaWritePayload,
} from "./helpers/riznicaHelpers";

type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete?: (key: string) => Promise<void>;
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
  /** Dodatni admin mejlovi za /api/admin/*, zarezom razdvojeni. */
  ADMIN_EMAILS?: string;
};
const FALLBACK_FIRESTORE_DATABASE_ID = "ai-studio-e4c0de88-b3b9-42ae-b6be-4bdfddca62ef";
const PRIVATE_RIZNICA_KV_TTL_SECONDS = 15 * 60;

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

/**
 * Browser/edge cache; public catalog hits should mostly avoid Firestore repeat reads.
 *
 * Firestore se cita SAMO kada promase sva tri sloja (isolate memorija, KV, Cache API).
 * Zato je KV TTL glavna poluga za potrosnju: na 6h je svaki kljuc isao u bazu ~4x
 * dnevno (`products` = 41 dokumenata po promasaju, `distilleries` = 7), na 24h ide
 * jednom. Katalog se ne menja svakih par sati, pa je to cist dobitak.
 *
 * Kada se katalog ipak promeni (nov proizvod, izmena u Adminu), podigni
 * `PUBLIC_CATALOG_CACHE_BUSTER` i deploy-uj Workera — kljucevi se odmah menjaju
 * i sledeci zahtev povlaci sveze podatke. Bez toga nova stavka ceka do 24h.
 */
const EDGE_CACHE_TTL_SECONDS = 3600;
const KV_CACHE_TTL_SECONDS = 24 * 60 * 60;
/** Workers Cache API (POP); many concurrent clients share one cached body per normalized URL. */
const CF_CACHE_S_MAXAGE_SECONDS = 24 * 60 * 60;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${CF_CACHE_S_MAXAGE_SECONDS}`,
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  /** Da `fetch()` na glavnom domenu vidi header (CORS); koristi `requestMeter` / DevTools. */
  "access-control-expose-headers": "x-cache-status,x-firestore-reads",
};

const privateJsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-expose-headers": "x-cache-status,x-firestore-reads",
};

const GCP_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 360;
/**
 * Injected into `servePublicCached` keys for `/api/public/distilleries` + `/api/public/products` only.
 * Bump when list semantics change so KV / Cache API / isolate do not serve stale truncated JSON forever.
 */
const PUBLIC_CATALOG_CACHE_BUSTER = "7";

/**
 * Rucno praznjenje javnog keša, bez deploy-a.
 *
 * `PUBLIC_CATALOG_CACHE_BUSTER` iznad se menja samo uz izmenu koda. Posto je KV TTL
 * podignut na 24h, trebalo je i nesto sto admin moze da pokrene sam kada doda ili
 * izmeni proizvod. Verzija stoji u KV-u i ulazi u SVAKI javni kljuc keša, pa jedno
 * podizanje broja obesmisli sve stare kljuceve odjednom — bez nabrajanja kljuceva
 * (KV binding ionako nema `list`).
 *
 * Vrednost se cita iz KV-a najvise jednom u minutu po izolatu; to je KV citanje,
 * ne Firestore, i ne ulazi u potrosnju baze.
 */
const CACHE_VERSION_KV_KEY = "meta:public-cache-version";
const CACHE_VERSION_MEM_TTL_MS = 60_000;
let cacheVersionMem: { value: string; expiresAt: number } | null = null;

async function readPublicCacheVersion(env: Env): Promise<string> {
  const now = Date.now();
  if (cacheVersionMem && now < cacheVersionMem.expiresAt) return cacheVersionMem.value;
  let value = "1";
  if (env.FIRESTORE_CACHE) {
    try {
      const raw = await env.FIRESTORE_CACHE.get(CACHE_VERSION_KV_KEY);
      if (raw && /^\d{1,12}$/.test(raw)) value = raw;
    } catch {
      // KV nedostupan — radi se sa podrazumevanom verzijom, keš i dalje funkcionise
    }
  }
  cacheVersionMem = { value, expiresAt: now + CACHE_VERSION_MEM_TTL_MS };
  return value;
}

async function bumpPublicCacheVersion(env: Env): Promise<string> {
  const current = Number(await readPublicCacheVersion(env)) || 1;
  const next = String(current + 1);
  if (env.FIRESTORE_CACHE) {
    // Bez expirationTtl — verzija mora da prezivi, inace bi se keš vratio na staru.
    await env.FIRESTORE_CACHE.put(CACHE_VERSION_KV_KEY, next);
  }
  cacheVersionMem = { value: next, expiresAt: Date.now() + CACHE_VERSION_MEM_TTL_MS };
  return next;
}
const EMERGENCY_CACHE_ONLY_MODE = false;
/** Temporary compatibility mode while legacy products still store images as base64 data URLs. */
const ALLOW_DATA_IMAGE_FALLBACK = true;
const DATA_IMAGE_MAX_CHARS = 2_500_000;

/**
 * `GET /api/public/home-bundle` (i usklađeni `daily-recommendations`) — Firestore read fan-out.
 * Svaka vrednost je max dokumenata po listi / get-u na hladnom miss-u (grubo: zbir cap-ova + do 2 destilerije za dnevni thumb).
 */
const HOME_BUNDLE_CLUB_ACTIONS_FETCH = 3;
const HOME_BUNDLE_PRODUCTS_SAMPLE = 2;
const HOME_BUNDLE_DISTILLERY_NAME_CAP = 4;

/**
 * `GET /api/public/ratings-feed` — lista `ratings` zatim `get` po `productId` (+ logo destilerije kad nema slike).
 * Gornje granice na hladnom miss-u; `parseLimit` i dalje ograničava klijentski `limit` query.
 */
const RATINGS_FEED_URL_LIMIT_DEFAULT = 12;
const RATINGS_FEED_URL_LIMIT_MAX = 24;
const RATINGS_FEED_LIST_FETCH_MAX = 24;
const RATINGS_FEED_LIST_FETCH_MIN = 10;
const RATINGS_FEED_PRODUCT_ENRICH_CAP = 5;
const RATINGS_FEED_DISTILLERY_LOGO_CAP = 3;

/**
 * Javni katalozi — `GET /api/public/distilleries` i `GET /api/public/products` (lista dokumenata po `pageSize`).
 * Klijent ne može preći `*_MAX` (parseLimit); niži default smanjuje read-ove kad nema `limit` u URL-u.
 */
const PUBLIC_DISTILLERIES_LIST_DEFAULT = 120;
const PUBLIC_DISTILLERIES_LIST_MAX = 400;
const PUBLIC_PRODUCTS_LIST_DEFAULT = 120;
const PUBLIC_PRODUCTS_LIST_MAX = 400;
const PUBLIC_DISTILLERIES_BY_IDS_MAX = 32;
const PUBLIC_PRODUCTS_BY_IDS_MAX = 32;

/**
 * Polja koja `toProductListItemWithDailyThumb` / `toDistilleryListItem` stvarno koriste,
 * PLUS polja iz predikata javne vidljivosti. `id` se izvodi iz `doc.name`, ne iz polja.
 * Ako dodaš polje u projekciju, dodaj ga i ovde — inače tiho nestane iz liste.
 */
const PRODUCT_LIST_FIELD_MASK = [
  "name",
  "type",
  "distilleryId",
  "alcoholPercentage",
  "averageRating",
  "bottleImageUrl",
  "image",
  "galleryImages",
  "isApproved",
  "isArchivedByDistillery",
  "publicLabelDisabled",
] as const;

const DISTILLERY_LIST_FIELD_MASK = [
  "name",
  "region",
  "isVerified",
  "logoUrl",
  "location",
  "isArchived",
] as const;

/**
 * Dijagnostika potrošnje: broji SVAKI dokument koji Worker stvarno pročita iz Firestore-a.
 *
 * Svrha je da se pik u Firebase konzoli može pripisati — ako konzola pokaže 2000 read-ova,
 * a zbir `x-firestore-reads` iz odgovora je 40, onda read-ovi NE dolaze iz aplikacije
 * (nego iz Firebase konzole, Admin panela, ili nekog ko gađa bazu direktno).
 *
 * Brojač je globalan po izolatu, pa paralelni zahtevi mogu malo da se preklope — dovoljno
 * tačno za atribuciju reda veličine, nije za naplatu.
 */
let firestoreDocsRead = 0;
function meterFirestoreReads(n: number): void {
  firestoreDocsRead += Math.max(0, n);
}

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
const verifiedUserTokenCache = new Map<string, { uid: string; email: string; expiresAtMs: number }>();
let rateLimitState = new Map<string, { count: number; resetAt: number }>();
let isolateCache = new Map<string, { data: string; expiresAt: number }>();
/** One Firestore round-trip per normalized URL per isolate while the promise is in flight. */
const publicInFlight = new Map<string, Promise<PublicFetchCoalesceResult>>();
const privateRiznicaInFlight = new Map<string, Promise<string>>();
const isolateRiznicaCache = new Map<string, { data: string; ts: number }>();
const PRIVATE_RIZNICA_MEM_TTL_MS = 3 * 60_000;

function resolveFirestoreDatabaseId(env: Env): string {
  return String(env.FIRESTORE_DATABASE_ID || FALLBACK_FIRESTORE_DATABASE_ID);
}

function privateRiznicaCacheKey(uid: string): string {
  return `private_riznica_${uid}`;
}

function privateHeadersWithCacheStatus(status: string): Record<string, string> {
  return {
    ...privateJsonHeaders,
    "x-cache-status": status,
  };
}

function invalidatePrivateRiznicaCache(env: Env, uid: string, ctx: WorkerExecutionContext): void {
  isolateRiznicaCache.delete(uid);
  privateRiznicaInFlight.delete(uid);
  if (!env.FIRESTORE_CACHE) return;
  const key = privateRiznicaCacheKey(uid);
  if (typeof env.FIRESTORE_CACHE.delete === "function") {
    ctx.waitUntil(env.FIRESTORE_CACHE.delete(key).catch(() => undefined));
    return;
  }
  // Fallback for bindings without delete(): quickly expire stale entry.
  ctx.waitUntil(env.FIRESTORE_CACHE.put(key, "", { expirationTtl: 1 }).catch(() => undefined));
}

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
  if (!headers.has("cache-control")) headers.set("cache-control", `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${CF_CACHE_S_MAXAGE_SECONDS}`);
  if (!headers.has("access-control-allow-origin")) headers.set("access-control-allow-origin", "*");
  if (!headers.has("access-control-allow-methods")) headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  if (!headers.has("access-control-allow-headers")) headers.set("access-control-allow-headers", "content-type,authorization");
  if (!headers.has("access-control-expose-headers")) headers.set("access-control-expose-headers", "x-cache-status,x-firestore-reads");
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
  if (cacheUrl.pathname === "/api/public/ratings-feed") {
    if (cacheUrl.searchParams.has("imgv")) {
      allowedParams.set("imgv", String(cacheUrl.searchParams.get("imgv") || ""));
    }
  }
  if (cacheUrl.pathname.startsWith("/api/public/products-by-distillery/")) {
    if (cacheUrl.searchParams.has("after")) {
      allowedParams.set("after", String(cacheUrl.searchParams.get("after") || ""));
    }
    if (cacheUrl.searchParams.has("imgv")) {
      allowedParams.set("imgv", String(cacheUrl.searchParams.get("imgv") || ""));
    }
  }
  if (cacheUrl.pathname === "/api/public/distilleries" || cacheUrl.pathname === "/api/public/products") {
    allowedParams.set("cv", PUBLIC_CATALOG_CACHE_BUSTER);
  }
  // Rucna verzija ide na SVE javne kljuceve, da praznjenje iz Admina obuhvati i
  // label-view, products-by-distillery, home-bundle i ostalo — a ne samo liste.
  allowedParams.set("pv", await readPublicCacheVersion(env));
  cacheUrl.search = allowedParams.toString();

  const normalizedUrl = cacheUrl.toString();
  const now = Date.now();
  if (isolateCache.size > 300) {
    const keysToDelete = Array.from(isolateCache.keys()).slice(0, 50);
    keysToDelete.forEach((k) => isolateCache.delete(k));
  }

  // Memorija izolata je najjeftiniji sloj (nema ni KV ni mreze) — drzi duze.
  const memTtlAfterMiss = opts?.memTtlMs ?? 1_800_000;

  const memHit = isolateCache.get(normalizedUrl);
  if (memHit && now < memHit.expiresAt) {
    console.log("!!! MEMORY HIT - 0 FIRESTORE READS !!!", normalizedUrl);
    return new Response(memHit.data, {
      status: 200,
      headers: {
        ...jsonHeaders,
        "cache-control": "public, max-age=60, s-maxage=60",
        "x-cache-status": "mem-hit",
          "x-firestore-reads": "0",
      },
    });
  }

  const kvKey = `public:${normalizedUrl}`;
  if (env.FIRESTORE_CACHE) {
    const kvHit = await env.FIRESTORE_CACHE.get(kvKey);
    if (kvHit) {
      isolateCache.set(normalizedUrl, { data: kvHit, expiresAt: now + 600_000 });
      return new Response(kvHit, {
        status: 200,
        headers: {
          ...jsonHeaders,
          "cache-control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${CF_CACHE_S_MAXAGE_SECONDS}`,
          "x-cache-status": "kv-hit",
          "x-firestore-reads": "0",
        },
      });
    }
  }

  const cfCacheReq = new Request(normalizedUrl, { method: "GET" });
  try {
    const cfHit = await caches.default.match(cfCacheReq);
    if (cfHit) {
      const bodyText = await cfHit.text();
      isolateCache.set(normalizedUrl, { data: bodyText, expiresAt: now + Math.min(memTtlAfterMiss, 600_000) });
      return new Response(bodyText, {
        status: cfHit.status,
        headers: {
          ...jsonHeaders,
          "cache-control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}, s-maxage=${CF_CACHE_S_MAXAGE_SECONDS}`,
          "x-cache-status": "cf-hit",
          "x-firestore-reads": "0",
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

  /** Koliko je dokumenata ovaj miss stvarno pročitao — ide u `x-firestore-reads`. */
  let coalescedReads = 0;
  let inFlight = publicInFlight.get(normalizedUrl);
  if (!inFlight) {
    let resolveCoalesce!: (value: PublicFetchCoalesceResult) => void;
    inFlight = new Promise<PublicFetchCoalesceResult>((res) => {
      resolveCoalesce = res;
    });
    publicInFlight.set(normalizedUrl, inFlight);
    void (async () => {
      const readsBefore = firestoreDocsRead;
      try {
        const fresh = await handler();
        if (!fresh.ok) {
          const bodyText = await fresh.text();
          resolveCoalesce({ ok: false, status: fresh.status, bodyText });
          return;
        }
        const bodyText = await fresh.text();
        coalescedReads = firestoreDocsRead - readsBefore;
        console.info(`[fsread] ${cacheUrl.pathname} docs=${coalescedReads} bytes=${bodyText.length}`);
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
          "access-control-expose-headers": "x-cache-status,x-firestore-reads",
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
      "x-firestore-reads": String(coalescedReads),
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
  if (/^\s*data:/i.test(v)) {
    if (!ALLOW_DATA_IMAGE_FALLBACK) return undefined;
    return v.length <= DATA_IMAGE_MAX_CHARS ? v : undefined;
  }
  return v;
}

/** Pun JSON etikete: bez base64 u poljima; HTTP iz galerije u `image`/`galleryImages` (isti princip kao listni thumb). */
function sanitizeProductDocForPublicJson(row: Record<string, unknown>): Record<string, unknown> {
  const light = toProductListItemWithDailyThumb(row);
  const galleryClean: string[] = [];
  if (Array.isArray(row.galleryImages)) {
    for (const x of row.galleryImages) {
      const u = galleryImageUrlFromUnknown(x);
      if (u) galleryClean.push(u);
    }
  }
  const { galleryImages: _omitGallery, ...rest } = row;
  const bottleOut = sanitizeImageUrl(light.bottleImageUrl);
  const imageOut =
    sanitizeImageUrl(light.image) || bottleOut || (galleryClean.length > 0 ? galleryClean[0] : undefined);
  return {
    ...rest,
    image: imageOut,
    bottleImageUrl: bottleOut,
    ...(galleryClean.length > 0 ? { galleryImages: galleryClean } : {}),
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

function galleryImageUrlFromUnknown(x: unknown): string | undefined {
  if (typeof x === "string") return sanitizeImageUrl(x);
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const o = x as Record<string, unknown>;
    for (const k of ["url", "src", "href", "image", "thumb", "thumbnail"] as const) {
      const u = sanitizeImageUrl(o[k]);
      if (u) return u;
    }
  }
  return undefined;
}

function firstSanitizedGalleryUrl(row: Record<string, unknown>): string | undefined {
  const g = row.galleryImages;
  if (!Array.isArray(g)) return undefined;
  for (const x of g) {
    const u = galleryImageUrlFromUnknown(x);
    if (u) return u;
  }
  return undefined;
}

/** Prvi N HTTPS URL-ova iz galerije (za listne odgovore — klijent može da izabere drugi ako prvi ne učita). */
function sanitizedGalleryHttpsList(row: Record<string, unknown>, max: number): string[] {
  const out: string[] = [];
  const g = row.galleryImages;
  if (!Array.isArray(g)) return out;
  for (const x of g) {
    const u = galleryImageUrlFromUnknown(x);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** Dnevna preporuka na Home: ako nema HTTP slike u glavnim poljima, uzmi prvi `galleryImages` (https). */
function toProductListItemWithDailyThumb(row: Record<string, unknown>): Record<string, unknown> {
  const base = toProductListItem(row);
  const extras = sanitizedGalleryHttpsList(row, 6);
  let merged: Record<string, unknown> = { ...base };
  if (sanitizeImageUrl(base.image) || sanitizeImageUrl(base.bottleImageUrl)) {
    // ostavi glavna polja
  } else {
    const gal = firstSanitizedGalleryUrl(row);
    if (gal) merged = { ...merged, image: gal };
  }
  if (extras.length > 0) merged = { ...merged, galleryImages: extras };
  return merged;
}

function toProductScannerHit(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...toProductListItemWithDailyThumb(row),
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
    rakija: rakija ? toProductListItemWithDailyThumb(rakija) : null,
    vino: vino ? toProductListItemWithDailyThumb(vino) : null,
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

/** Posle stripovanja `data:` na oceni, HTTP thumb iz live proizvoda (galerija) ili logo destilerije — bez base64 u JSON-u. */
async function enrichCommunityRatingItemsWithProductThumbs(
  env: Env,
  filtered: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const items = filtered.map((row) => toCommunityRatingItem(row) as Record<string, unknown>);

  const uniqueProductIds = Array.from(
    new Set(filtered.map((r) => String(asText(r.productId) || "").trim()).filter((id) => id.length > 0)),
  ).slice(0, RATINGS_FEED_PRODUCT_ENRICH_CAP);

  if (uniqueProductIds.length === 0) return items;

  const productRows = await Promise.all(uniqueProductIds.map((id) => fetchDocumentById(env, "products", id)));
  const productById = new Map<string, Record<string, unknown>>();
  uniqueProductIds.forEach((id, i) => {
    const p = productRows[i];
    // Thumbnail only: koristi postojeći proizvod čak i ako nije u „javnom“ filtru (ocene i dalje postoje u feed-u).
    if (p) productById.set(id, p);
  });

  const merged = items.map((item, idx) => {
    if (asText(item.productImage)) return item;
    const row = filtered[idx];
    const pid = String(asText(row?.productId) || "").trim();
    const p = productById.get(pid);
    if (!p) return item;
    const light = toProductListItemWithDailyThumb(p);
    const thumb = sanitizeImageUrl(light.image) || sanitizeImageUrl(light.bottleImageUrl);
    return thumb ? { ...item, productImage: thumb } : item;
  });

  const distilleryIds = new Set<string>();
  merged.forEach((item, idx) => {
    if (asText(item.productImage)) return;
    const pid = String(asText(filtered[idx]?.productId) || "").trim();
    const p = productById.get(pid);
    const did = p ? String(asText(p.distilleryId) || "").trim() : "";
    if (did) distilleryIds.add(did);
  });

  if (distilleryIds.size === 0) return merged;

  const distIdList = [...distilleryIds].slice(0, RATINGS_FEED_DISTILLERY_LOGO_CAP);
  const distRows = await Promise.all(distIdList.map((id) => fetchDocumentById(env, "distilleries", id)));
  const logoByDistillery = new Map<string, string>();
  distIdList.forEach((id, i) => {
    const d = distRows[i];
    if (!d || d.isArchived === true || d.isVerified !== true) return;
    const logo = sanitizeImageUrl(d.logoUrl);
    if (logo) logoByDistillery.set(id, logo);
  });

  return merged.map((item, idx) => {
    if (asText(item.productImage)) return item;
    const pid = String(asText(filtered[idx]?.productId) || "").trim();
    const p = productById.get(pid);
    const did = p ? String(asText(p.distilleryId) || "").trim() : "";
    const logo = did ? logoByDistillery.get(did) : undefined;
    return logo ? { ...item, productImage: logo } : item;
  });
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

function parseJwtExpMs(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return Date.now() + 5 * 60 * 1000;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4 || 4)) % 4);
    const payloadJson = atob(padded);
    const payload = JSON.parse(payloadJson) as { exp?: number };
    const exp = Number(payload?.exp || 0);
    if (!Number.isFinite(exp) || exp <= 0) return Date.now() + 5 * 60 * 1000;
    return exp * 1000;
  } catch {
    return Date.now() + 5 * 60 * 1000;
  }
}

function parseFirebaseJwtPayload(token: string): {
  aud?: string;
  iss?: string;
  sub?: string;
  user_id?: string;
  exp?: number;
} | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4 || 4)) % 4);
    return JSON.parse(atob(padded)) as {
      aud?: string;
      iss?: string;
      sub?: string;
      user_id?: string;
      exp?: number;
    };
  } catch {
    return null;
  }
}

async function verifyFirebaseUserFromRequest(request: Request, env: Env): Promise<{ uid: string; email: string } | null> {
  const authz = String(request.headers.get("authorization") || "").trim();
  if (!authz.toLowerCase().startsWith("bearer ")) return null;
  const token = authz.slice(7).trim();
  if (!token) return null;
  const now = Date.now();
  const cached = verifiedUserTokenCache.get(token);
  if (cached && cached.expiresAtMs > now + 10_000) return { uid: cached.uid, email: cached.email || "" };

  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, {
      method: "GET",
    });
    if (res.ok) {
      const payload = (await res.json()) as { aud?: string; iss?: string; sub?: string; user_id?: string; email?: string };
      const aud = String(payload.aud || "").trim();
      const iss = String(payload.iss || "").trim();
      const uid = String(payload.user_id || payload.sub || "").trim();
      if (uid && aud === projectId && (!iss || iss === `https://securetoken.google.com/${projectId}`)) {
        const expMs = parseJwtExpMs(token);
        const email = String(payload.email || "").trim().toLowerCase();
        verifiedUserTokenCache.set(token, { uid, email, expiresAtMs: expMs });
        if (verifiedUserTokenCache.size > 1000) {
          const stale = [...verifiedUserTokenCache.entries()].filter(([, v]) => v.expiresAtMs < now);
          stale.slice(0, 200).forEach(([k]) => verifiedUserTokenCache.delete(k));
        }
        return { uid, email };
      }
    }

    // Fallback path for environments where tokeninfo may reject Firebase ID tokens.
    const decoded = parseFirebaseJwtPayload(token);
    const decodedEmail = String((decoded as { email?: unknown } | null)?.email || "").trim().toLowerCase();
    const aud = String(decoded?.aud || "").trim();
    const iss = String(decoded?.iss || "").trim();
    const uid = String(decoded?.user_id || decoded?.sub || "").trim();
    const exp = Number(decoded?.exp || 0);
    const expMs = Number.isFinite(exp) ? exp * 1000 : 0;
    if (!uid || aud !== projectId || iss !== `https://securetoken.google.com/${projectId}` || expMs <= now) {
      return null;
    }
    verifiedUserTokenCache.set(token, { uid, email: decodedEmail, expiresAtMs: expMs });
    return { uid, email: decodedEmail };
  } catch {
    return null;
  }
}

/**
 * Ko sme da isprazni javni keš. Isti spisak kao `src/lib/authz.ts` na klijentu;
 * `ADMIN_EMAILS` u okruzenju Workera ga prosiruje bez izmene koda.
 */
function isWorkerSuperuser(email: string, env: Env): boolean {
  const configured = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(["ldjs1969@gmail.com", ...configured]);
  return !!email && allowed.has(email.toLowerCase());
}

/** Max documents returned from one `runQuery` / paged product query (keeps fan-out bounded). */
const WORKER_STRUCTURED_QUERY_MAX = 120;
/** Per-request page size for Firestore `listDocuments`; loop with `nextPageToken` until `pageSize` is satisfied. */
const WORKER_LIST_DOCUMENTS_PAGE = 100;
/** Hard ceiling for a single `fetchCollection` call (non-catalog paths). */
const WORKER_LIST_DOCUMENTS_TOTAL_MAX = 300;
/**
 * Max raw documents to scan when filling a filtered public catalog (products / distilleries).
 *
 * Svaki skenirani dokument je NAPLATIV read, i kad ga predikat odbaci. Ranije 4000, uz
 * množioce 20×/30× — jedan hladan miss je u najgorem slučaju mogao da naplati 4000 read-ova
 * da bi vratio nekoliko desetina redova. Skeniranje ionako staje na kraju kolekcije, pa je
 * ovo isključivo zaštita od odbeglog troška, ne ograničenje kataloga.
 */
const WORKER_CATALOG_MAX_SCAN = 600;
/** Koliko sirovih dokumenata sme da se skenira po jednom traženom redu (filter propušta većinu). */
const WORKER_CATALOG_SCAN_MULTIPLIER = 3;

/**
 * Paginate `listDocuments` until `predicate` accepts `targetCount` rows or collection ends / scan cap.
 * Firestore returns docs in `__name__` order; filtering shrinks the list — must scan forward to fill quota.
 */
async function listDocumentsMatching(
  env: Env,
  collectionName: string,
  targetCount: number,
  maxScan: number,
  predicate: (row: Record<string, unknown>) => boolean,
  fieldMask?: readonly string[],
): Promise<Record<string, unknown>[]> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = resolveFirestoreDatabaseId(env);
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID");
  const accessToken = await getAccessToken(env);
  const want = Math.max(1, targetCount);
  const basePath = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collectionName)}`;
  /**
   * `mask.fieldPaths` NE smanjuje broj naplaćenih read-ova (naplaćuje se po dokumentu),
   * ali smanjuje koliko bajtova Firestore stvarno pošalje. Kod proizvoda sa base64
   * slikama u dokumentu to je razlika između par KB i par MB po strani, što direktno
   * troši CPU/memoriju Workera. Maska MORA da sadrži i polja koja koristi `predicate`.
   */
  const maskQuery = (fieldMask || [])
    .map((f) => `&mask.fieldPaths=${encodeURIComponent(f)}`)
    .join("");

  const matched: Record<string, unknown>[] = [];
  let scanned = 0;
  let pageToken: string | undefined;
  while (matched.length < want && scanned < maxScan) {
    const batch = Math.min(WORKER_LIST_DOCUMENTS_PAGE, maxScan - scanned);
    let url = `${basePath}?pageSize=${batch}${maskQuery}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Firestore REST error ${res.status}: ${body.slice(0, 240)}`);
    }
    const data = (await res.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    const docs = data.documents || [];
    if (docs.length === 0) break;
    for (const d of docs) {
      scanned += 1;
      const row = decodeDocument(d);
      meterFirestoreReads(1);
      if (predicate(row)) {
        matched.push(row);
        if (matched.length >= want) break;
      }
      if (scanned >= maxScan) break;
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return matched;
}

async function fetchCollection(env: Env, collectionName: string, pageSize: number): Promise<Record<string, unknown>[]> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = resolveFirestoreDatabaseId(env);
  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID");
  }
  const accessToken = await getAccessToken(env);
  const maxWanted = Math.min(Math.max(1, pageSize), WORKER_LIST_DOCUMENTS_TOTAL_MAX);
  const basePath = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collectionName)}`;

  const out: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  while (out.length < maxWanted) {
    const batch = Math.min(WORKER_LIST_DOCUMENTS_PAGE, maxWanted - out.length);
    let url = `${basePath}?pageSize=${batch}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Firestore REST error ${res.status}: ${body.slice(0, 240)}`);
    }
    const data = (await res.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    const docs = data.documents || [];
    meterFirestoreReads(docs.length);
    for (const d of docs) {
      out.push(decodeDocument(d));
      if (out.length >= maxWanted) break;
    }
    pageToken = data.nextPageToken;
    if (!pageToken || docs.length === 0) break;
  }
  return out;
}

async function fetchDocumentById(
  env: Env,
  collectionName: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = resolveFirestoreDatabaseId(env);
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
  meterFirestoreReads(1);
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
  const databaseId = resolveFirestoreDatabaseId(env);
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
      limit: Math.min(Math.max(1, pageSize), WORKER_STRUCTURED_QUERY_MAX),
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
  const docs = rows.filter((r) => r.document);
  meterFirestoreReads(docs.length);
  return docs.map((r) => decodeDocument(r.document as FirestoreDoc));
}

async function fetchPublicDistilleriesList(
  env: Env,
  pageSize: number,
): Promise<Record<string, unknown>[]> {
  // Read a moderate page and filter only archived rows.
  // We intentionally do not hard-filter by `isVerified` because legacy docs may miss this field.
  const fetchSize = Math.min(Math.max(1, pageSize), PUBLIC_DISTILLERIES_LIST_MAX);
  const maxScan = Math.min(WORKER_CATALOG_MAX_SCAN, fetchSize * WORKER_CATALOG_SCAN_MULTIPLIER);
  return listDocumentsMatching(
    env,
    "distilleries",
    fetchSize,
    maxScan,
    (d) => d.isArchived !== true,
    DISTILLERY_LIST_FIELD_MASK,
  );
}

/** `where` + `orderBy(__name__)` + optional `startAfter` — za katalog po destileriji bez duplog čitanja istih dokumenata. */
async function fetchProductsByDistilleryPaged(
  env: Env,
  distilleryId: string,
  pageSize: number,
  afterDocumentId?: string,
): Promise<Record<string, unknown>[]> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = resolveFirestoreDatabaseId(env);
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
    limit: Math.min(Math.max(1, pageSize), WORKER_STRUCTURED_QUERY_MAX),
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
  const docs = rows.filter((r) => r.document);
  meterFirestoreReads(docs.length);
  return docs.map((r) => decodeDocument(r.document as FirestoreDoc));
}

async function fetchCountWhereEquals(
  env: Env,
  collectionName: string,
  fieldName: string,
  fieldValue: string,
): Promise<number> {
  const projectId = env.FIREBASE_PROJECT_ID || "";
  const databaseId = resolveFirestoreDatabaseId(env);
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
  meterFirestoreReads(1);
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
      const isPrivateRiznicaPath =
        url.pathname === "/api/private/riznica" ||
        url.pathname === "/api/private/riznica/settings" ||
        url.pathname === "/api/private/riznica/add" ||
        url.pathname === "/api/private/riznica/update" ||
        url.pathname === "/api/private/riznica/remove";
      // Bez ovoga bi globalna provera metode odbila POST na /api/admin/purge-cache
      // sa 405, jos pre nego sto ruta dobije priliku da proveri ko zove.
      const isAdminPostPath = url.pathname === "/api/admin/purge-cache";
      const privateAllowed =
        (isPrivateRiznicaPath || isAdminPostPath) && (request.method === "GET" || request.method === "POST");
      if (request.method !== "GET" && !privateAllowed) {
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

      if (url.pathname === "/api/admin/purge-cache") {
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405, headers: privateJsonHeaders });
        }
        const verified = await verifyFirebaseUserFromRequest(request, env);
        if (!verified) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: privateJsonHeaders });
        }
        if (!isWorkerSuperuser(verified.email, env)) {
          return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers: privateJsonHeaders });
        }
        const version = await bumpPublicCacheVersion(env);
        // Memorija izolata drzi stare odgovore pod starim kljucem; posto verzija
        // ulazi u kljuc, oni vise nikad nece biti pogodjeni — ali cistimo i nju.
        isolateCache = new Map();
        console.info(`[cache] javni keš ispraznjen, nova verzija ${version} (${verified.email})`);
        return new Response(JSON.stringify({ ok: true, version }), {
          status: 200,
          headers: privateJsonHeaders,
        });
      }

      if (url.pathname === "/api/private/riznica") {
        const verified = await verifyFirebaseUserFromRequest(request, env);
        if (!verified) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: privateJsonHeaders,
          });
        }
        if (request.method !== "GET") {
          return new Response(JSON.stringify({ success: false, error: "method_not_allowed" }), {
            status: 405,
            headers: privateJsonHeaders,
          });
        }
        const databaseId = resolveFirestoreDatabaseId(env);
        const cacheKey = privateRiznicaCacheKey(verified.uid);
        const now = Date.now();
        const memHit = isolateRiznicaCache.get(verified.uid);
        if (memHit && now - memHit.ts < PRIVATE_RIZNICA_MEM_TTL_MS) {
          return new Response(memHit.data, {
            headers: privateHeadersWithCacheStatus("mem-hit-private"),
          });
        }
        if (env.FIRESTORE_CACHE) {
          const cached = await env.FIRESTORE_CACHE.get(cacheKey);
          if (cached) {
            isolateRiznicaCache.set(verified.uid, { data: cached, ts: now });
            return new Response(cached, {
              headers: privateHeadersWithCacheStatus("kv-hit-private"),
            });
          }
        }
        const inFlightKey = verified.uid;
        const existingInFlight = privateRiznicaInFlight.get(inFlightKey);
        if (existingInFlight) {
          const responseBody = await existingInFlight;
          return new Response(responseBody, {
            headers: privateHeadersWithCacheStatus("inflight-hit-private"),
          });
        }
        const privateReadsBefore = firestoreDocsRead;
        const accessToken = await getAccessToken(env);
        const client = {
          projectId: String(env.FIREBASE_PROJECT_ID || ""),
          databaseId,
          accessToken,
        };
        const useEnriched =
          (url.searchParams.get("enriched") || "").trim() === "1" ||
          (url.searchParams.get("useEnrichedRiznica") || "").trim() === "1";
        const limitParam = Number(url.searchParams.get("limit")) || 20;
        const safeLimit = Math.min(20, Math.max(5, limitParam));
        const fetchPromise = (async () => {
          let items: Record<string, unknown>[];
          let debugMeta: Record<string, unknown>;
          if (useEnriched) {
            const enriched = await getUserRiznicaEnriched(client, verified.uid, safeLimit);
            items = enriched.items;
            debugMeta = { useEnriched: true, ...enriched.debug };
            console.info(
              `[fsread] /api/private/riznica(enriched) uid=${verified.uid} docs=${enriched.debug.firestoreOpsTotal}`,
            );
            meterFirestoreReads(enriched.debug.firestoreOpsTotal);
          } else {
            const listResult = await getUserRiznicaWithDebug(client, verified.uid, safeLimit);
            items = listResult.items;
            debugMeta = {
              useEnriched: false,
              riznicaDocsRead: items.length,
              productBatchQueries: 0,
              productDocsResolved: 0,
              firestoreOpsTotal: listResult.firestoreOpsTotal,
              endpoint: "getUserRiznica",
            };
            console.info(
              `[fsread] /api/private/riznica uid=${verified.uid} docs=${listResult.firestoreOpsTotal}`,
            );
            meterFirestoreReads(listResult.firestoreOpsTotal);
          }
          return JSON.stringify({
            success: true,
            data: items,
            meta: { source: "worker", uid: verified.uid, databaseId, ...debugMeta },
          });
        })();
        privateRiznicaInFlight.set(inFlightKey, fetchPromise);
        const responseBody = await fetchPromise.finally(() => privateRiznicaInFlight.delete(inFlightKey));
        isolateRiznicaCache.set(verified.uid, { data: responseBody, ts: now });
        if (env.FIRESTORE_CACHE) {
          ctx.waitUntil(
            env.FIRESTORE_CACHE.put(cacheKey, responseBody, {
              expirationTtl: PRIVATE_RIZNICA_KV_TTL_SECONDS,
            }).catch(() => undefined),
          );
        }
        return new Response(responseBody, {
          headers: {
            ...privateHeadersWithCacheStatus("kv-miss-private"),
            "x-firestore-reads": String(firestoreDocsRead - privateReadsBefore),
          },
        });
      }

      if (url.pathname === "/api/private/riznica/add") {
        const verified = await verifyFirebaseUserFromRequest(request, env);
        if (!verified) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: privateJsonHeaders,
          });
        }
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ success: false, error: "method_not_allowed" }), {
            status: 405,
            headers: privateJsonHeaders,
          });
        }
        const body = (await request.json().catch(() => null)) as Partial<RiznicaWritePayload> | null;
        const drinkId = String(body?.drinkId || "").trim();
        if (!drinkId) {
          return new Response(JSON.stringify({ success: false, error: "invalid_payload" }), {
            status: 400,
            headers: privateJsonHeaders,
          });
        }
        const databaseId = resolveFirestoreDatabaseId(env);
        const accessToken = await getAccessToken(env);
        const addDebug = await addToRiznica(
          {
            projectId: String(env.FIREBASE_PROJECT_ID || ""),
            databaseId,
            accessToken,
          },
          verified.uid,
          {
            drinkId,
            category: body?.category ?? null,
            userRating: typeof body?.userRating === "number" ? body.userRating : null,
            notes: typeof body?.notes === "string" ? body.notes : "",
            purchasePrice: typeof body?.purchasePrice === "number" ? body.purchasePrice : null,
            purchaseDate: typeof body?.purchaseDate === "string" ? body.purchaseDate : null,
            shelf: typeof body?.shelf === "string" ? body.shelf : "polica-1",
            position: typeof body?.position === "number" ? body.position : 0,
            product: body?.product && typeof body.product === "object" ? (body.product as Record<string, unknown>) : null,
          },
        );
        invalidatePrivateRiznicaCache(env, verified.uid, ctx);
        return new Response(
          JSON.stringify({
            success: true,
            data: { drinkId },
            meta: {
              source: "worker",
              endpoint: "addToRiznica",
              databaseId,
              totalFirestoreOps: addDebug.firestoreOpsTotal,
            },
          }),
          {
          headers: privateJsonHeaders,
          },
        );
      }
 
      if (url.pathname === "/api/private/riznica/settings") {
        const verified = await verifyFirebaseUserFromRequest(request, env);
        if (!verified) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: privateJsonHeaders,
          });
        }
        const accessToken = await getAccessToken(env);
        const client = {
          projectId: String(env.FIREBASE_PROJECT_ID || ""),
          databaseId: resolveFirestoreDatabaseId(env),
          accessToken,
        };
        if (request.method === "GET") {
          const settings = await getRiznicaPrivacySettings(client, verified.uid);
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                riznicaPublic: settings.riznicaPublic,
                riznicaPublicNotes: settings.riznicaPublicNotes,
                riznicaLastSharedAt: settings.riznicaLastSharedAt,
              },
              meta: { source: "worker", endpoint: "getRiznicaPrivacySettings", totalFirestoreOps: settings.firestoreOpsTotal },
            }),
            {
              headers: privateJsonHeaders,
            },
          );
        }
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ success: false, error: "method_not_allowed" }), {
            status: 405,
            headers: privateJsonHeaders,
          });
        }
        const body = (await request.json().catch(() => null)) as Partial<RiznicaPrivacySettingsPayload> | null;
        if (!body || typeof body !== "object") {
          return new Response(JSON.stringify({ success: false, error: "invalid_payload" }), {
            status: 400,
            headers: privateJsonHeaders,
          });
        }
        const normalized: RiznicaPrivacySettingsPayload = {
          riznicaPublic: body.riznicaPublic === true,
          riznicaPublicNotes: body.riznicaPublic === true && body.riznicaPublicNotes === true,
        };
        const settingsUpdateDebug = await updateRiznicaPrivacySettings(client, verified.uid, normalized);
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              ...normalized,
              riznicaLastSharedAt: normalized.riznicaPublic ? new Date().toISOString() : null,
            },
            meta: { source: "worker", endpoint: "updateRiznicaPrivacySettings", totalFirestoreOps: settingsUpdateDebug.firestoreOpsTotal },
          }),
          {
            headers: privateJsonHeaders,
          },
        );
      }

      if (url.pathname === "/api/private/riznica/update") {
        const verified = await verifyFirebaseUserFromRequest(request, env);
        if (!verified) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: privateJsonHeaders,
          });
        }
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ success: false, error: "method_not_allowed" }), {
            status: 405,
            headers: privateJsonHeaders,
          });
        }
        const body = (await request.json().catch(() => null)) as
          | { drinkId?: string; updates?: Partial<RiznicaWritePayload> }
          | null;
        const drinkId = String(body?.drinkId || "").trim();
        if (!drinkId || !body?.updates || typeof body.updates !== "object") {
          return new Response(JSON.stringify({ success: false, error: "invalid_payload" }), {
            status: 400,
            headers: privateJsonHeaders,
          });
        }
        const accessToken = await getAccessToken(env);
        await updateRiznicaItem(
          {
            projectId: String(env.FIREBASE_PROJECT_ID || ""),
            databaseId: resolveFirestoreDatabaseId(env),
            accessToken,
          },
          verified.uid,
          drinkId,
          body.updates,
        );
        invalidatePrivateRiznicaCache(env, verified.uid, ctx);
        return new Response(
          JSON.stringify({ success: true, data: { drinkId }, meta: { source: "worker", endpoint: "updateRiznicaItem", totalFirestoreOps: 1 } }),
          {
            headers: privateJsonHeaders,
          },
        );
      }

      if (url.pathname === "/api/private/riznica/remove") {
        const verified = await verifyFirebaseUserFromRequest(request, env);
        if (!verified) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: privateJsonHeaders,
          });
        }
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ success: false, error: "method_not_allowed" }), {
            status: 405,
            headers: privateJsonHeaders,
          });
        }
        const body = (await request.json().catch(() => null)) as { drinkId?: string } | null;
        const drinkId = String(body?.drinkId || "").trim();
        if (!drinkId) {
          return new Response(JSON.stringify({ success: false, error: "invalid_payload" }), {
            status: 400,
            headers: privateJsonHeaders,
          });
        }
        const accessToken = await getAccessToken(env);
        const removeDebug = await removeFromRiznica(
          {
            projectId: String(env.FIREBASE_PROJECT_ID || ""),
            databaseId: resolveFirestoreDatabaseId(env),
            accessToken,
          },
          verified.uid,
          drinkId,
        );
        invalidatePrivateRiznicaCache(env, verified.uid, ctx);
        return new Response(
          JSON.stringify({
            success: true,
            data: { drinkId },
            meta: { source: "worker", endpoint: "removeFromRiznica", totalFirestoreOps: removeDebug?.firestoreOpsTotal ?? 1 },
          }),
          {
            headers: privateJsonHeaders,
          },
        );
      }

      if (url.pathname.startsWith("/api/public/riznica/")) {
        return servePublicCached(request, env, ctx, async () => {
          const uid = decodeURIComponent(url.pathname.replace("/api/public/riznica/", "").trim());
          if (!uid) {
            return new Response(JSON.stringify({ success: false, error: "invalid_uid", data: null }), {
              status: 400,
              headers: jsonHeaders,
            });
          }
          const accessToken = await getAccessToken(env);
          const result = await getPublicRiznica(
            {
              projectId: String(env.FIREBASE_PROJECT_ID || ""),
              databaseId: resolveFirestoreDatabaseId(env),
              accessToken,
            },
            uid,
          );
          if (!result.isPublic) {
            return new Response(
              JSON.stringify({
                success: true,
                data: {
                  isPublic: false,
                  ownerName: result.ownerName,
                  ownerHandle: result.ownerHandle,
                  ownerAvatar: result.ownerAvatar,
                  items: [],
                },
                meta: { source: "worker-public" },
              }),
              { headers: jsonHeaders },
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              data: result,
              meta: { source: "worker-public" },
            }),
            { headers: jsonHeaders },
          );
        });
      }

      if (url.pathname === "/api/public/distilleries") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, PUBLIC_DISTILLERIES_LIST_DEFAULT, PUBLIC_DISTILLERIES_LIST_MAX);
          const rows = await fetchPublicDistilleriesList(env, limitCount);
          const lightItems = rows.map((row) => toDistilleryListItem(row));
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
          ).slice(0, PUBLIC_DISTILLERIES_BY_IDS_MAX);
          if (ids.length === 0) return new Response(JSON.stringify({ items: [] }), { headers: jsonHeaders });

          const rows = await Promise.all(ids.map((id) => fetchDocumentById(env, "distilleries", id)));
          const filtered = rows.filter((d) => d && d.isArchived !== true && d.isVerified === true);
          return new Response(JSON.stringify({ items: filtered }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/products") {
        return servePublicCached(request, env, ctx, async () => {
          const limitCount = parseLimit(url, PUBLIC_PRODUCTS_LIST_DEFAULT, PUBLIC_PRODUCTS_LIST_MAX);
          const maxScan = Math.min(WORKER_CATALOG_MAX_SCAN, limitCount * WORKER_CATALOG_SCAN_MULTIPLIER);
          const isPublicProduct = (p: Record<string, unknown>) =>
            p.isApproved !== false && p.isArchivedByDistillery !== true && p.publicLabelDisabled !== true;
          const rows = await listDocumentsMatching(
            env,
            "products",
            limitCount,
            maxScan,
            isPublicProduct,
            PRODUCT_LIST_FIELD_MASK,
          );
          const lightItems = rows.map((row) => toProductListItemWithDailyThumb(row));
          return new Response(JSON.stringify({ items: lightItems }), { headers: jsonHeaders });
        });
      }

      if (url.pathname === "/api/public/home-bundle") {
        return servePublicCached(
          request,
          env,
          ctx,
          async () => {
            const clubRows = await fetchCollection(env, "club_actions", HOME_BUNDLE_CLUB_ACTIONS_FETCH);
            const actions = clubRows
              .filter((r) => r.isActive === true)
              .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
              .slice(0, 12)
              .map((r) => toClubActionItem(r));

            const productRows = await fetchCollection(env, "products", HOME_BUNDLE_PRODUCTS_SAMPLE);
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
            ).slice(0, HOME_BUNDLE_DISTILLERY_NAME_CAP);
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
                memberships: [],
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
            const rows = await fetchCollection(env, "products", HOME_BUNDLE_PRODUCTS_SAMPLE);
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
          ).slice(0, PUBLIC_PRODUCTS_BY_IDS_MAX);
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
            if (id) byId.set(id, toProductListItemWithDailyThumb(row));
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
          const limitCount = parseLimit(url, RATINGS_FEED_URL_LIMIT_DEFAULT, RATINGS_FEED_URL_LIMIT_MAX);
          const fetchCap = Math.min(RATINGS_FEED_LIST_FETCH_MAX, Math.max(limitCount, RATINGS_FEED_LIST_FETCH_MIN));
          const rows = await fetchCollection(env, "ratings", fetchCap);
          const filtered = rows
            .filter((r) => r.isFlagged !== true)
            .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
            .slice(0, limitCount);
          const items = await enrichCommunityRatingItemsWithProductThumbs(env, filtered);
          return new Response(JSON.stringify({ items }), { headers: jsonHeaders });
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
          const lightItems = filtered.map((row) => toProductListItemWithDailyThumb(row));
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



