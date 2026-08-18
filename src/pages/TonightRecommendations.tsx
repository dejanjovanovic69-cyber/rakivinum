import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Camera, Save, Share2, Sparkles, Trash2 } from "lucide-react";
import { auth, db } from "../lib/firebase";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { getOrCreateVisitorId } from "../lib/visitorIdentity";
import { readCache, writeCache } from "../lib/resilience";
import { PUBLIC_CATALOG_LIMIT, REFRESH_INTERVAL } from "../lib/cachePolicy";
import { shouldRunRefresh } from "../lib/refreshGate";
import { fetchPublicDistilleriesByIds, fetchPublicProducts, fetchPublicProductsByIds } from "../lib/dataService";
import { isQuotaSaverActive } from "../lib/quotaSaver";
import DrinkCard, { type TonightDrink } from "../components/tonight/DrinkCard";
import MoodSelector, { MOOD_OPTIONS, type MoodId } from "../components/tonight/MoodSelector";
import FoodSelector, { FOOD_OPTIONS, type FoodId } from "../components/tonight/FoodSelector";

type Strength = "lagano" | "srednje" | "jako";
type ProductRow = {
  id: string;
  name?: string;
  type?: string;
  category?: string;
  distilleryId?: string;
  image?: string;
  bottleImageUrl?: string;
  averageRating?: number;
  alcoholPercentage?: number;
};
type RatingLite = {
  productId?: string;
  rating?: number;
  sensoryScores?: TonightDrink["sensoryScores"];
  createdAt?: { toDate?: () => Date; seconds?: number } | string | Date | null;
};
type SavedMenu = { id: string; name: string; items: TonightDrink[]; createdAt: string };

const TONIGHT_MENU_LS_KEY = "rakivinum_tonight_menu_v1";
const TONIGHT_FAVORITE_MENUS_LS_KEY = "rakivinum_tonight_favorite_menus_v1";
const TONIGHT_COLLECTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TONIGHT_RATINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function strengthMatch(product: ProductRow, strength: Strength): boolean {
  const alc = Number(product.alcoholPercentage || 0);
  if (!Number.isFinite(alc) || alc <= 0) return true;
  if (strength === "lagano") return alc < 40;
  if (strength === "srednje") return alc >= 40 && alc <= 46;
  return alc > 46;
}

function scoreProduct(
  product: ProductRow,
  mood: MoodId | null,
  food: FoodId | null,
  strength: Strength,
  opts?: { userRating?: number | null; consumedRecently?: boolean; surprise?: boolean },
): number {
  let score = 0;
  const text = `${product.type || ""} ${product.category || ""} ${product.name || ""}`.toLowerCase();

  if (strengthMatch(product, strength)) score += 3;
  else score -= 2;

  if (mood) {
    if (["slavlje", "proslava", "drustvo"].includes(mood) && /rakija|sljiv|dunj|kajs/.test(text)) score += 4;
    if (["romantika", "opustanje", "refleksija"].includes(mood) && /vino|roze|belo|crveno/.test(text)) score += 4;
    if (mood === "posle_posla" && /vinjak|rakija|biter/.test(text)) score += 3;
  }

  if (food) {
    if (food === "rostilj" && /sljiv|dunj|vinjak|crven/.test(text)) score += 4;
    if (food === "pecenje" && /sljiv|dunj|loza|vinjak|crven/.test(text)) score += 4;
    if (food === "riba" && /belo|vino|tramin|sauvignon/.test(text)) score += 4;
    if (food === "dezert" && /krusk|liker|muskat|desert/.test(text)) score += 4;
    if (food === "pikantno" && /rose|roze|aromatic|tamjanika/.test(text)) score += 3;
    if (food === "kafana" && /sljiv|dunj|loza/.test(text)) score += 4;
  }

  if (mood && food) {
    // Mood + food coupling has stronger impact for tonight recommendations.
    if (/rakija|vino|sljiv|dunj|roze|crven|belo/.test(text)) score += 5;
  }
  if (typeof opts?.userRating === "number" && opts.userRating >= 4.6) score += 4;
  else if (typeof opts?.userRating === "number" && opts.userRating >= 4.2) score += 2;
  if (opts?.consumedRecently) score -= 4;
  if (opts?.surprise) score += Math.random() * 8 - 1.5;
  if (typeof product.averageRating === "number") score += Math.min(2.5, product.averageRating / 2);
  return score;
}

function buildReason(
  mood: MoodId | null,
  food: FoodId | null,
  fromCollection: boolean,
  opts?: {
    userRating?: number | null;
    lastWeekRating?: number | null;
    surprise?: boolean;
    consumedRecently?: boolean;
    productName?: string;
  },
): string {
  const moodLabel = MOOD_OPTIONS.find((m) => m.id === mood)?.label || "trenutno raspoloženje";
  const foodLabel = FOOD_OPTIONS.find((f) => f.id === food)?.label || "trenutni zalogaj";
  if (opts?.surprise) return `Večerašnje iznenađenje: neočekivani spoj za ${foodLabel.toLowerCase()} i ${moodLabel.toLowerCase()} 🍶`;
  if (opts?.consumedRecently) return `Pio si je skoro, ali i dalje je jaka opcija za ${foodLabel.toLowerCase()}.`;
  if (typeof opts?.lastWeekRating === "number") {
    return `Odlično ide uz ${foodLabel.toLowerCase()}, a prošle nedelje si dao ${opts.lastWeekRating.toFixed(1)}.`;
  }
  if (typeof opts?.userRating === "number" && opts.userRating >= 4.5) {
    return `Ovo ti je omiljena ${opts?.productName?.toLowerCase() || "etiketa"} sa ocenom ${opts.userRating.toFixed(1)}.`;
  }
  const who = fromCollection ? "već imaš u kolekciji" : "sjajno se uklapa u tvoj izbor";
  return `${moodLabel} + ${foodLabel}: ${who}.`;
}

function pickDiverseTop<T extends { score: number; product: { type?: string; category?: string } }>(rows: T[], max = 3): T[] {
  const picked: T[] = [];
  const usedTypes = new Set<string>();
  for (const row of rows) {
    const typeKey = String(row.product.type || row.product.category || "unknown").toLowerCase().trim();
    if (!usedTypes.has(typeKey)) {
      picked.push(row);
      usedTypes.add(typeKey);
    }
    if (picked.length >= max) break;
  }
  if (picked.length < max) {
    for (const row of rows) {
      if (picked.includes(row)) continue;
      picked.push(row);
      if (picked.length >= max) break;
    }
  }
  return picked;
}

function toDateFromUnknown(value: RatingLite["createdAt"]): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      const d = value.toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof value.seconds === "number") {
      const d = new Date(value.seconds * 1000);
      return Number.isFinite(d.getTime()) ? d : null;
    }
  }
  return null;
}

export default function TonightRecommendations() {
  const quotaSaver = isQuotaSaverActive();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const [mood, setMood] = useState<MoodId | null>(null);
  const [food, setFood] = useState<FoodId | null>(null);
  const [strength, setStrength] = useState<Strength>("srednje");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const [filtersAnimating, setFiltersAnimating] = useState(false);
  const [collectionPicks, setCollectionPicks] = useState<TonightDrink[]>([]);
  const [catalogPicks, setCatalogPicks] = useState<TonightDrink[]>([]);
  const sessionResultsRef = useRef<Map<string, { collection: TonightDrink[]; catalog: TonightDrink[] }>>(new Map());
  const [tonightMenu, setTonightMenu] = useState<TonightDrink[]>(() => {
    try {
      const raw = localStorage.getItem(TONIGHT_MENU_LS_KEY) || "[]";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TonightDrink[]) : [];
    } catch {
      return [];
    }
  });
  const [savedMenus, setSavedMenus] = useState<SavedMenu[]>(() => {
    try {
      const raw = localStorage.getItem(TONIGHT_FAVORITE_MENUS_LS_KEY) || "[]";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedMenu[]) : [];
    } catch {
      return [];
    }
  });

  const runRecommendations = async (surprise = false) => {
    setLoading(true);
    const user = auth.currentUser;
    const visitorId = getOrCreateVisitorId();
    const identity = user?.uid || `guest:${visitorId}`;
    // v3: invalidate stale cached reasons containing older wording.
    const cacheKey = `rakivinum_cache_tonight_${identity}_${mood || "any"}_${food || "any"}_${strength}_${surprise ? "rand" : "std"}_v3`;
    const sessionKey = `${identity}:${mood || "any"}:${food || "any"}:${strength}:${surprise ? "rand" : "std"}:v3`;
    const fromSession = sessionResultsRef.current.get(sessionKey);
    if (fromSession) {
      setCollectionPicks(fromSession.collection);
      setCatalogPicks(fromSession.catalog);
      setLoading(false);
      return;
    }
    const refreshGateKey = `tonight:${identity}:${mood || "any"}:${food || "any"}:${strength}`;
    const refreshMs = quotaSaver ? 30 * 60 * 1000 : REFRESH_INTERVAL.USER_LIGHT_1H;

    const cached = readCache<{ collection: TonightDrink[]; catalog: TonightDrink[] }>(cacheKey);
    if (cached && !shouldRunRefresh(refreshGateKey, refreshMs)) {
      setCollectionPicks(cached.collection);
      setCatalogPicks(cached.catalog);
      setLoading(false);
      return;
    }

    const collectionCacheKey = `rakivinum_cache_collection_items_${identity}_v1`;
    const collectionRefreshGateKey = `tonight:collection:${identity}`;
    const cachedCollectionRows = readCache<Array<{ product?: ProductRow }>>(collectionCacheKey);
    const hasCollectionCache = cachedCollectionRows !== null;
    let collectionRows = cachedCollectionRows || [];

    const shouldFetchCollectionNetwork =
      !hasCollectionCache || shouldRunRefresh(collectionRefreshGateKey, TONIGHT_COLLECTION_CACHE_TTL_MS);
    if (shouldFetchCollectionNetwork && user && !quotaSaver) {
      try {
        const savedSnap = await getDocs(
          query(collection(db, "users", user.uid, "riznica"), orderBy("addedAt", "desc"), limit(30)),
        );
        const ids = savedSnap.docs.map((d) => String(d.id || d.data().drinkId || "")).filter((x) => x.length > 0);
        const rows = (await fetchPublicProductsByIds(ids)) as ProductRow[];
        collectionRows = rows.map((r) => ({ product: r }));
        writeCache(collectionCacheKey, collectionRows, TONIGHT_COLLECTION_CACHE_TTL_MS);
        shouldRunRefresh(collectionRefreshGateKey, 0);
      } catch {
        // best effort only
      }
    } else if (hasCollectionCache) {
      // Seed gate on cached payload (including empty cache) to avoid repeated network for "no data" states.
      shouldRunRefresh(collectionRefreshGateKey, 0);
    }

    let userRatingsByProduct = new Map<string, RatingLite>();
    const ratingsCacheKey = `rakivinum_cache_tonight_ratings_${identity}_v1`;
    const ratingsRefreshGateKey = `tonight:ratings:${identity}`;
    const cachedRatings = readCache<Array<[string, RatingLite]>>(ratingsCacheKey);
    const hasRatingsCache = cachedRatings !== null;
    if (cachedRatings && Array.isArray(cachedRatings)) {
      userRatingsByProduct = new Map(cachedRatings);
    }
    const lastWeekRatingsByProduct = new Map<string, number>();
    const recentById = new Set<string>();
    try {
      const historyRaw = localStorage.getItem("rakivinum_scan_history") || "[]";
      const parsed = JSON.parse(historyRaw) as Array<{ id?: string; timestamp?: number }>;
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (Array.isArray(parsed)) {
        parsed.forEach((row) => {
          const id = String(row?.id || "").trim();
          const ts = Number(row?.timestamp || 0);
          if (id && Number.isFinite(ts) && ts >= cutoff) recentById.add(id);
        });
      }
    } catch {
      // best effort
    }
    const shouldFetchRatingsNetwork =
      !hasRatingsCache || shouldRunRefresh(ratingsRefreshGateKey, TONIGHT_RATINGS_CACHE_TTL_MS);
    if (!quotaSaver && shouldFetchRatingsNetwork) {
      try {
        const ratingSnap = await getDocs(
          query(collection(db, "ratings"), where(user ? "userId" : "visitorId", "==", user ? user.uid : visitorId), limit(120)),
        );
        userRatingsByProduct = new Map(
          ratingSnap.docs.map((d) => {
            const r = d.data() as RatingLite;
            return [String(r.productId || ""), r];
          }),
        );
        writeCache(ratingsCacheKey, Array.from(userRatingsByProduct.entries()), TONIGHT_RATINGS_CACHE_TTL_MS);
        shouldRunRefresh(ratingsRefreshGateKey, 0);
        const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        userRatingsByProduct.forEach((r, pid) => {
          const dt = toDateFromUnknown(r.createdAt);
          if (dt && dt.getTime() >= weekCutoff && typeof r.rating === "number") {
            lastWeekRatingsByProduct.set(pid, r.rating);
          }
        });
      } catch {
        // optional layer
      }
    } else {
      if (hasRatingsCache) {
        // Same as collection: keep gate warm for empty cache payload too.
        shouldRunRefresh(ratingsRefreshGateKey, 0);
      }
      const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      userRatingsByProduct.forEach((r, pid) => {
        const dt = toDateFromUnknown(r.createdAt);
        if (dt && dt.getTime() >= weekCutoff && typeof r.rating === "number") {
          lastWeekRatingsByProduct.set(pid, r.rating);
        }
      });
    }

    const collectionProducts = collectionRows
      .map((x) => x.product)
      .filter((p): p is ProductRow => Boolean(p && p.id));
    const collectionScores = collectionProducts.map((p) => {
      const userRatingValue = userRatingsByProduct.get(p.id)?.rating ?? null;
      const consumedRecently = recentById.has(p.id);
      const base = scoreProduct(p, mood, food, strength, {
        userRating: userRatingValue,
        consumedRecently,
        surprise,
      });
      const userRatingRow = userRatingsByProduct.get(p.id);
      return {
        product: p,
        score: base,
        userRating: userRatingRow?.rating ?? null,
        lastWeekRating: lastWeekRatingsByProduct.get(p.id) ?? null,
        sensoryScores: userRatingRow?.sensoryScores ?? null,
        consumedRecently,
      };
    });

    const publicRows = (await fetchPublicProducts({
      limitCount: PUBLIC_CATALOG_LIMIT.PRODUCTS,
      cacheKey: "rakivinum_tonight_public_products_v1",
      ttlMs: quotaSaver ? 30 * 60 * 1000 : REFRESH_INTERVAL.USER_LIGHT_1H,
    })) as ProductRow[];
    const usedIds = new Set(collectionScores.map((x) => x.product.id));
    const catalogScores = publicRows
      .filter((p) => !usedIds.has(p.id))
      .map((p) => ({
        product: p,
        score: scoreProduct(p, mood, food, strength, { surprise, consumedRecently: recentById.has(p.id) }),
      }))
      .sort((a, b) => b.score - a.score);

    const allDistilleryIds = Array.from(
      new Set(
        [...collectionScores.map((x) => x.product.distilleryId), ...catalogScores.map((x) => x.product.distilleryId)]
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    );
    const distRows = await fetchPublicDistilleriesByIds(allDistilleryIds);
    const distMap = new Map(distRows.map((d) => [String(d.id), String((d as { name?: string }).name || "Proizvođač")]));

    const collectionPicksNext = pickDiverseTop(
      collectionScores.sort((a, b) => b.score - a.score),
      3,
    )
      .map((x) => ({
        id: x.product.id,
        name: x.product.name || "Piće",
        type: x.product.type,
        distilleryName: distMap.get(String(x.product.distilleryId || "")) || "Proizvođač",
        image: x.product.image,
        bottleImageUrl: x.product.bottleImageUrl,
        reason: buildReason(mood, food, true, {
          userRating: x.userRating,
          lastWeekRating: x.lastWeekRating,
          surprise,
          consumedRecently: x.consumedRecently,
          productName: x.product.type || x.product.name,
        }),
        userRating: x.userRating,
        lastWeekRating: x.lastWeekRating,
        sensoryScores: x.sensoryScores,
        alcoholPercentage: x.product.alcoholPercentage,
        isFavorite: typeof x.userRating === "number" && x.userRating >= 4.7,
      }));

    const catalog = pickDiverseTop(catalogScores, 3).map((x) => ({
      id: x.product.id,
      name: x.product.name || "Piće",
      type: x.product.type,
      distilleryName: distMap.get(String(x.product.distilleryId || "")) || "Proizvođač",
      image: x.product.image,
      bottleImageUrl: x.product.bottleImageUrl,
      reason: buildReason(mood, food, false, { surprise, consumedRecently: recentById.has(x.product.id) }),
      userRating: null,
      sensoryScores: null,
      alcoholPercentage: x.product.alcoholPercentage,
    }));

    setCollectionPicks(collectionPicksNext);
    setCatalogPicks(catalog);
    writeCache(cacheKey, { collection: collectionPicksNext, catalog }, refreshMs);
    sessionResultsRef.current.set(sessionKey, { collection: collectionPicksNext, catalog });
    setLoading(false);
  };

  useEffect(() => {
    void runRecommendations(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, food, strength]);

  const addToTonightMenu = (item: TonightDrink) => {
    const wasEmpty = tonightMenu.length === 0;
    setTonightMenu((prev) => {
      const next = prev.some((x) => x.id === item.id) ? prev : [...prev, item];
      localStorage.setItem(TONIGHT_MENU_LS_KEY, JSON.stringify(next));
      return next;
    });
    setToast(`Dodato u večerašnji meni: ${item.name}`);
    if (wasEmpty) {
      setConfetti(true);
      window.setTimeout(() => setConfetti(false), 1200);
    }
  };
  const removeFromTonightMenu = (id: string) => {
    setTonightMenu((prev) => {
      const next = prev.filter((x) => x.id !== id);
      localStorage.setItem(TONIGHT_MENU_LS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const saveTonightMenu = async () => {
    localStorage.setItem(TONIGHT_MENU_LS_KEY, JSON.stringify(tonightMenu));
    const menuName = window.prompt("Naziv omiljenog menija", `Meni ${new Date().toLocaleDateString("sr-RS")}`)?.trim() || "Moj meni";
    const favoritesKey = TONIGHT_FAVORITE_MENUS_LS_KEY;
    try {
      const existing = JSON.parse(localStorage.getItem(favoritesKey) || "[]") as SavedMenu[];
      const next = [
        { id: `menu_${Date.now()}`, name: menuName, items: tonightMenu, createdAt: new Date().toISOString() },
        ...existing,
      ].slice(0, 12);
      localStorage.setItem(favoritesKey, JSON.stringify(next));
      setSavedMenus(next);
    } catch {
      // no-op
    }
    const names = tonightMenu.map((x) => x.name).slice(0, 5).join(", ");
    const url = `${window.location.origin}/tonight`;
    const text = `Večeras pijem: ${names || "prazan meni"} — preporučuje mi Rakivinum! 🍶`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Večerašnji meni", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setToast("Večerašnji meni je sačuvan i kopiran za deljenje.");
      }
    } catch {
      setToast("Večerašnji meni je sačuvan lokalno.");
    }
  };
  const removeSavedMenu = (id: string) => {
    setSavedMenus((prev) => {
      const next = prev.filter((x) => x.id !== id);
      localStorage.setItem(TONIGHT_FAVORITE_MENUS_LS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const moveTonightMenuItem = (id: string, direction: "up" | "down") => {
    setTonightMenu((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      localStorage.setItem(TONIGHT_MENU_LS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const shareMenuScreenshot = async () => {
    const el = document.getElementById("tonight-menu-card");
    if (!el) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
      if (!blob) throw new Error("no blob");
      const file = new File([blob], "vecerasnji-meni.png", { type: "image/png" });
      if (navigator.share && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: "Večerašnji meni",
          text: "Moj večerašnji izbor iz Rakivinuma 🍶",
          files: [file],
        });
      } else {
        setToast("Screenshot menija je spreman (share fajlova nije podržan na uređaju).");
      }
    } catch {
      setToast("Nije uspelo generisanje screenshot-a.");
    }
  };

  const shareRecommendations = async () => {
    const ids = [...collectionPicks, ...catalogPicks].map((x) => x.id).slice(0, 3).join(",");
    const url = `${window.location.origin}/tonight?m=${mood || "any"}&f=${food || "any"}&s=${strength}&p=${ids}`;
    const headline = [...collectionPicks, ...catalogPicks]
      .slice(0, 2)
      .map((x) => `Večeras pijem: ${x.name} iz ${x.distilleryName} — preporučuje mi Rakivinum! 🍶`)
      .join("\n");
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Večernji izbor",
          text: headline || `Moj Rakivinum večerašnji izbor (${mood || "mood"}, ${food || "food"})`,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(`${headline}\n${url}`.trim());
      alert("Preporuka i link su kopirani.");
    } catch {
      alert("Deljenje trenutno nije dostupno.");
    }
  };

  const sections = useMemo(
    () => [
      { title: "Iz moje Riznice", rows: collectionPicks },
      { title: "Iz kataloga", rows: catalogPicks },
    ],
    [collectionPicks, catalogPicks],
  );
  const tonightMenuAverage = useMemo(() => {
    const nums = tonightMenu
      .map((x) => x.userRating)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }, [tonightMenu]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setFiltersAnimating(true);
    const id = window.setTimeout(() => setFiltersAnimating(false), 260);
    return () => window.clearTimeout(id);
  }, [mood, food, strength]);

  return (
    <div className="min-h-screen bg-bg-base p-4 pb-28 space-y-5">
      <div className="flex items-center justify-between">
        <Link
          to="/"
          state={{ returnTo }}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Nazad
        </Link>
        <button
          type="button"
          onClick={() => void shareRecommendations()}
          className="inline-flex items-center gap-2 rounded-xl border border-gold-500/35 bg-gold-500/10 px-3 py-2 text-xs text-gold-300"
        >
          <Share2 className="h-4 w-4" /> Podeli
        </button>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-black italic text-white">Večernji izbor</h1>
        <p className="text-xs text-text-secondary">Brza preporuka po raspoloženju, jelu i tvojoj kolekciji.</p>
      </header>

      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-gold-300">Raspoloženje</p>
        <div className={filtersAnimating ? "animate-in fade-in zoom-in-95 duration-200" : ""}>
          <MoodSelector value={mood} onChange={setMood} />
        </div>
      </section>
      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-gold-300">Uz šta</p>
        <div className={filtersAnimating ? "animate-in fade-in zoom-in-95 duration-200" : ""}>
          <FoodSelector value={food} onChange={setFood} />
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-gold-300">Jačina</p>
        <div className={filtersAnimating ? "flex gap-2 animate-in fade-in zoom-in-95 duration-200" : "flex gap-2"}>
          {(["lagano", "srednje", "jako"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStrength(s)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${
                strength === s
                  ? "border-gold-500/55 bg-gold-500/15 text-gold-300"
                  : "border-white/15 bg-white/5 text-text-secondary"
              }`}
            >
              {s === "lagano" ? "Lagano (<40%)" : s === "srednje" ? "Srednje" : "Jako"}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => void runRecommendations(true)}
        className="w-full rounded-2xl border border-gold-500/65 bg-gradient-to-r from-gold-500/20 to-gold-400/10 py-3 text-xs font-black uppercase tracking-wider text-gold-200 shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
      >
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Iznenadi me
        </span>
      </button>

      {!loading && collectionPicks.length === 0 && catalogPicks.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-bg-card p-5 text-center">
          <p className="text-sm font-black text-white">Večera čeka pravi izbor</p>
          <p className="mt-1 text-xs text-text-secondary">Za ovaj filter nemamo dovoljno jak signal. Probaj drugi mood, hranu ili klikni „Iznenadi me“.</p>
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-white/10 bg-bg-card p-4 text-xs text-text-secondary animate-pulse space-y-2">
          <div className="h-3 w-1/2 rounded bg-white/10" />
          <div className="h-3 w-2/3 rounded bg-white/10" />
          <div className="text-[11px]">Računam preporuke i proveravam kolekciju...</div>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.title} className="space-y-3 animate-in fade-in duration-300">
            <h2 className="text-sm font-black uppercase tracking-wide text-white">{section.title}</h2>
            {section.rows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-bg-card p-4 text-xs text-text-secondary">
                {section.title === "Iz moje kolekcije"
                  ? "Nema dovoljno boca u kolekciji za ovaj izbor. Probaj drugi mood ili dodaj nove etikete."
                  : "Nema dovoljno stavki u katalogu za ovaj filter."}
              </div>
            ) : (
              <div className="space-y-3">
                {section.rows.map((item) => (
                  <DrinkCard
                    key={`${section.title}:${item.id}`}
                    item={item}
                    onDrinkNow={addToTonightMenu}
                    onAddToMenu={addToTonightMenu}
                    labelHref={`/label/${item.id}?rt=${encodeURIComponent(returnTo)}`}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Večerašnji meni</h3>
        <div id="tonight-menu-card" className="space-y-2 rounded-xl border border-white/10 bg-bg-card p-3">
          <p className="text-[11px] text-text-secondary">
            Prosek menija:{" "}
            <strong className="text-gold-300">{typeof tonightMenuAverage === "number" ? tonightMenuAverage.toFixed(2) : "n/a"}</strong>
          </p>
          {tonightMenu.length === 0 ? (
            <p className="text-xs text-text-secondary">Još nema dodatih boca.</p>
          ) : (
            <ul className="space-y-1 text-xs text-white">
              {tonightMenu.map((x) => (
                <li key={`menu:${x.id}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between gap-2">
                  <span>
                    {x.name} <span className="text-text-secondary">• {x.distilleryName}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveTonightMenuItem(x.id, "up")}
                      className="rounded-md border border-white/15 bg-black/20 p-1 text-white/75"
                      title="Pomeri gore"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTonightMenuItem(x.id, "down")}
                      className="rounded-md border border-white/15 bg-black/20 p-1 text-white/75"
                      title="Pomeri dole"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromTonightMenu(x.id)}
                      className="rounded-md border border-white/15 bg-black/20 p-1 text-white/75"
                      title="Ukloni iz menija"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => void saveTonightMenu()}
          className="inline-flex items-center gap-2 rounded-xl border border-gold-500/45 bg-gold-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-gold-300"
        >
          <Save className="h-4 w-4" /> Sačuvaj kao omiljeni meni
        </button>
        <button
          type="button"
          onClick={() => void shareMenuScreenshot()}
          className="ml-2 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white"
        >
          <Camera className="h-4 w-4" /> Screenshot share
        </button>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-white">Istorija sačuvanih menija</h3>
        {savedMenus.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-bg-card p-3 text-xs text-text-secondary">
            Još nema sačuvanih menija.
          </div>
        ) : (
          <ul className="space-y-2">
            {savedMenus.map((menu) => (
              <li key={menu.id} className="rounded-xl border border-white/10 bg-bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{menu.name}</p>
                    <p className="text-[10px] text-text-secondary">
                      {new Date(menu.createdAt).toLocaleDateString("sr-RS")} • {menu.items.length} stavki
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSavedMenu(menu.id)}
                    className="rounded-md border border-white/15 bg-black/20 p-1 text-white/75"
                    title="Obriši sačuvani meni"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {confetti && (
        <div className="pointer-events-none fixed inset-0 z-[120]">
          <div className="absolute left-1/2 top-1/3 h-3 w-3 animate-ping rounded-full bg-gold-400" />
          <div className="absolute left-[46%] top-[34%] h-2 w-2 animate-ping rounded-full bg-emerald-300 [animation-delay:120ms]" />
          <div className="absolute left-[54%] top-[36%] h-2 w-2 animate-ping rounded-full bg-purple-300 [animation-delay:220ms]" />
        </div>
      )}
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-[110] -translate-x-1/2 rounded-full border border-gold-500/40 bg-black/80 px-4 py-2 text-[11px] font-bold text-gold-300">
          {toast}
        </div>
      )}
    </div>
  );
}

