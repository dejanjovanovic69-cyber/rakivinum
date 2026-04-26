import { Users as UsersIcon, ChevronRight, MapPin, Star, Loader2, MessageCircle, Search, SearchSlash, Compass, CheckCircle, Flag, Sparkles, Info, CalendarDays, X, Scale } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import React, { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { cn } from "../lib/utils";
import { isQuotaError, readCache } from "../lib/resilience";
import { fetchCommunityEvents, fetchCommunityRatings, fetchPublicDistilleries, fetchPublicProducts } from "../lib/dataService";
import { shouldRunRefresh } from "../lib/refreshGate";
import { CACHE_TTL, REFRESH_INTERVAL } from "../lib/cachePolicy";

type RatingItem = {
  id: string;
  productId: string;
  productName?: string;
  productImage?: string;
  rating: number;
  reviewText?: string;
  comment?: string;
  userLocation?: string;
  createdAt?: { seconds?: number; toDate?: () => Date } | string | Date | null;
  isFlagged?: boolean;
};

type ProductItem = {
  id: string;
  name?: string;
  type?: string;
  category?: string;
  distillery?: string;
  distilleryId?: string;
  image?: string;
  bottleImageUrl?: string;
  averageRating?: number;
  alcoholPercentage?: number;
  _sum?: number;
  _count?: number;
};

type DistilleryItem = {
  id: string;
  name?: string;
  region?: string;
  logoUrl?: string;
  isVerified?: boolean;
  location?: { city?: string; address?: string } | string;
};

type CommunityEventItem = {
  id: string;
  eventDate?: string;
  title?: string;
  location?: string;
  description?: string;
  websiteUrl?: string;
  link?: string;
  mapsUrl?: string;
  [key: string]: unknown;
};

type ComparePersistState = {
  filter?: string;
  leftQuery?: string;
  rightQuery?: string;
  leftId?: string;
  rightId?: string;
};

function safeStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return [o.city, o.address].filter((x): x is string => typeof x === "string" && x.trim() !== "").join(", ");
  }
  return "";
}

function formatRatingDate(value: RatingItem["createdAt"]): string {
  if (!value) return "Sada";
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Sada" : d.toLocaleDateString("sr-RS");
  }
  if (value instanceof Date) return value.toLocaleDateString("sr-RS");
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString("sr-RS");
  }
  return "Sada";
}

const COMMUNITY_RATINGS_CACHE_KEY = "rakivinum_cache_community_ratings_v1";

/** Null = nema važećeg keša (prvi ulazak); niz (može prazan) = odmah prikaži bez „buradi“ pri povratku na stranicu. */
function readCommunityRatingsCache(): RatingItem[] | null {
  const cached = readCache<RatingItem[]>(COMMUNITY_RATINGS_CACHE_KEY);
  if (cached === null || cached === undefined) return null;
  if (!Array.isArray(cached)) return null;
  return cached.filter((r) => !r?.isFlagged) as RatingItem[];
}

export default function Community() {
  const PRODUCTS_FETCH_LIMIT = 350;
  const DISTILLERIES_FETCH_LIMIT = 220;
  const EVENTS_FETCH_LIMIT = 60;
  const [ratings, setRatings] = useState<RatingItem[]>(() => readCommunityRatingsCache() ?? []);
  const [loading, setLoading] = useState(() => readCommunityRatingsCache() === null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState<"reviews" | "tops" | "compare" | "producers" | "search" | "events">("reviews");
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [distilleries, setDistilleries] = useState<DistilleryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeProductFilter, setActiveProductFilter] = useState("all");
  const [producerView, setProducerView] = useState<"regions" | "list">("regions");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>([]);
  const [eventsView, setEventsView] = useState<"active" | "archive">("active");
  const [isCatalogLoaded, setIsCatalogLoaded] = useState(false);
  const catalogFetchLock = useRef(false);
  const [producerSearch, setProducerSearch] = useState("");
  const [compareFilter, setCompareFilter] = useState("all");
  const [compareLeftQuery, setCompareLeftQuery] = useState("");
  const [compareRightQuery, setCompareRightQuery] = useState("");
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const filterOptions = [
    { id: "all", label: "Sve" },
    { id: "sve-rakije", label: "Sve rakije" },
    { id: "sva-vina", label: "Sva vina" },
    { id: "sljivovica", label: "Šljivovica" },
    { id: "dunjevaca", label: "Dunjevača" },
    { id: "kruskovaca", label: "Kruškovaca" },
    { id: "bela-vina", label: "Bela vina" },
    { id: "crvena-vina", label: "Crvena vina" },
    { id: "roze", label: "Roze" },
  ];

  const compareFilterOptions = [
    { id: "all", label: "Sve" },
    { id: "sve-rakije", label: "Sve rakije" },
    { id: "sljivovica", label: "Šljivovice" },
    { id: "dunjevaca", label: "Dunjevače" },
    { id: "kruskovaca", label: "Kruškovače" },
    { id: "sva-vina", label: "Sva vina" },
    { id: "bela-vina", label: "Bela vina" },
    { id: "crvena-vina", label: "Crvena vina" },
    { id: "roze", label: "Roze" },
  ];

  useEffect(() => {
    let cancelled = false;

    const refreshRatings = async () => {
      if (!shouldRunRefresh("community:ratings", REFRESH_INTERVAL.USER_LIGHT_1H)) {
        const fromCache = readCommunityRatingsCache();
        if (fromCache !== null && !cancelled) setRatings(fromCache);
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const rows = await fetchCommunityRatings({
          limitCount: 20,
          cacheKey: COMMUNITY_RATINGS_CACHE_KEY,
          ttlMs: CACHE_TTL.COMMUNITY_EVENTS_6H,
        });
        if (!cancelled) {
          setRatings(rows.filter((r) => !r.isFlagged) as RatingItem[]);
          setLoading(false);
        }
      } catch (error) {
        console.error("Community ratings refresh error:", error);
        if (isQuotaError(error)) setQuotaExceeded(true);
        if (!cancelled) setLoading(false);
      }
    };

    void refreshRatings();
    const onFocusRefresh = () => {
      if (document.visibilityState !== "visible") return;
      void refreshRatings();
    };
    const onVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      onFocusRefresh();
    };
    window.addEventListener("focus", onFocusRefresh);
    document.addEventListener("visibilitychange", onVisibilityRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocusRefresh);
      document.removeEventListener("visibilitychange", onVisibilityRefresh);
    };
  }, []);

  /** Heavy product/distillery lists — only tabs that need them (not default „Utisci“). Saves ~400+ Firestore reads per visit. */
  useEffect(() => {
    const needsCatalog = ["tops", "compare", "producers", "search"].includes(activeSection);
    if (!needsCatalog || isCatalogLoaded) return;

    let cancelled = false;

    const run = async () => {
      if (catalogFetchLock.current) return;
      catalogFetchLock.current = true;
      try {
        const [prodResult, distResult] = await Promise.allSettled([
          fetchPublicProducts({
            limitCount: PRODUCTS_FETCH_LIMIT,
            cacheKey: "rakivinum_cache_community_products_v1",
            ttlMs: CACHE_TTL.PRODUCTS_6H,
          }),
          fetchPublicDistilleries({
            limitCount: DISTILLERIES_FETCH_LIMIT,
            cacheKey: "rakivinum_cache_community_distilleries_v1",
            ttlMs: CACHE_TTL.DISTILLERY_LIST_6H,
          }),
        ]);

        if (cancelled) return;

        if (prodResult.status === "fulfilled") {
          setProducts(prodResult.value);
        } else {
          console.error("Error fetching products:", prodResult.reason);
          if (isQuotaError(prodResult.reason)) setQuotaExceeded(true);
          const cachedProducts = readCache<ProductItem[]>("rakivinum_cache_community_products_v1");
          if (cachedProducts && cachedProducts.length > 0) setProducts(cachedProducts);
        }

        if (distResult.status === "fulfilled") {
          setDistilleries(distResult.value);
        } else {
          console.error("Error fetching distilleries:", distResult.reason);
          if (isQuotaError(distResult.reason)) setQuotaExceeded(true);
          const cachedDistilleries = readCache<DistilleryItem[]>("rakivinum_cache_community_distilleries_v1");
          setDistilleries(cachedDistilleries || []);
        }
      } catch (error) {
        console.error("Error fetching community catalog:", error);
        if (isQuotaError(error)) setQuotaExceeded(true);
      } finally {
        if (!cancelled) setIsCatalogLoaded(true);
        catalogFetchLock.current = false;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeSection, isCatalogLoaded]);

  useEffect(() => {
    if (activeSection !== "events") return;
    let cancelled = false;

    const run = async () => {
      try {
        const events = await fetchCommunityEvents({
          limitCount: EVENTS_FETCH_LIMIT,
          cacheKey: "rakivinum_cache_community_events_v1",
          ttlMs: CACHE_TTL.COMMUNITY_EVENTS_6H,
        });
        if (!cancelled) setCommunityEvents(events);
      } catch (err) {
        if (isQuotaError(err)) setQuotaExceeded(true);
        const cachedEvents = readCache<CommunityEventItem[]>("rakivinum_cache_community_events_v1");
        if (!cancelled && cachedEvents) setCommunityEvents(cachedEvents);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeSection]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("rakivinum_community_compare_v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as ComparePersistState;
      if (typeof parsed?.filter === "string") setCompareFilter(parsed.filter);
      if (typeof parsed?.leftQuery === "string") setCompareLeftQuery(parsed.leftQuery);
      if (typeof parsed?.rightQuery === "string") setCompareRightQuery(parsed.rightQuery);
      if (typeof parsed?.leftId === "string") setCompareLeftId(parsed.leftId);
      if (typeof parsed?.rightId === "string") setCompareRightId(parsed.rightId);
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "reviews" || tab === "tops" || tab === "compare" || tab === "producers" || tab === "search" || tab === "events") {
      setActiveSection(tab);
    }
    if (tab === "search") {
      const q = params.get("q");
      const pf = params.get("pf");
      const allowed = new Set(filterOptions.map((x) => x.id));
      if (typeof q === "string") setSearchQuery(q);
      if (pf && allowed.has(pf)) setActiveProductFilter(pf);
    }
    if (tab === "compare") {
      const cf = params.get("cf");
      const allowed = new Set(compareFilterOptions.map((x) => x.id));
      if (cf && allowed.has(cf)) setCompareFilter(cf);
      const l = params.get("l");
      const r = params.get("r");
      const lq = params.get("lq");
      const rq = params.get("rq");
      if (typeof l === "string") setCompareLeftId(l);
      if (typeof r === "string") setCompareRightId(r);
      if (typeof lq === "string") setCompareLeftQuery(lq);
      if (typeof rq === "string") setCompareRightQuery(rq);
    }
  }, [location.search]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "rakivinum_community_compare_v1",
        JSON.stringify({
          filter: compareFilter,
          leftQuery: compareLeftQuery,
          rightQuery: compareRightQuery,
          leftId: compareLeftId,
          rightId: compareRightId,
        }),
      );
    } catch {
      // best effort persistence
    }
  }, [compareFilter, compareLeftQuery, compareRightQuery, compareLeftId, compareRightId]);

  useEffect(() => {
    try {
      sessionStorage.setItem("rakivinum_last_community_tab_v1", activeSection);
    } catch {
      // best effort persistence
    }
    if (activeSection !== "search" && searchQuery) {
      setSearchQuery("");
      setIsSearching(false);
    }
  }, [activeSection, searchQuery]);

  const normalizeText = (value: unknown) =>
    String(value || "").toLowerCase()
      .replace(/š/g, "s").replace(/č/g, "c").replace(/ć/g, "c")
      .replace(/ž/g, "z").replace(/đ/g, "dj");

  const isWineProduct = (p: ProductItem) => {
    const t = `${normalizeText(p?.name)} ${normalizeText(p?.type)} ${normalizeText(p?.category)}`;
    return t.includes("vino") || t.includes("wine");
  };

  const matchesProductFilter = (p: ProductItem) => {
    if (activeProductFilter === "all") return true;
    const t = `${normalizeText(p?.name)} ${normalizeText(p?.type)} ${normalizeText(p?.category)}`;
    if (activeProductFilter === "sve-rakije") return !isWineProduct(p);
    if (activeProductFilter === "sva-vina") return isWineProduct(p);
    if (activeProductFilter === "sljivovica") return t.includes("sljiv");
    if (activeProductFilter === "dunjevaca") return t.includes("dunjev");
    if (activeProductFilter === "kruskovaca") return t.includes("krusk") || t.includes("krus");
    if (activeProductFilter === "bela-vina") return (t.includes("vino") || t.includes("vina")) && (t.includes("belo") || t.includes("white"));
    if (activeProductFilter === "crvena-vina") return (t.includes("vino") || t.includes("vina")) && (t.includes("crveno") || t.includes("red"));
    if (activeProductFilter === "roze") return (t.includes("vino") || t.includes("vina")) && (t.includes("roze") || t.includes("rose"));
    return true;
  };

  const ratedProductsFallback = React.useMemo(() => {
    const grouped = new Map<string, ProductItem>();
    ratings.forEach((r) => {
      const id = String(r?.productId || "");
      if (!id) return;
      const prev = grouped.get(id) || {
        id,
        name: safeStr(r?.productName) || "Piće",
        type: "",
        averageRating: 0,
        _sum: 0,
        _count: 0,
        image: safeStr(r?.productImage) || "",
      };
      const ratingVal = typeof r?.rating === "number" && Number.isFinite(r.rating) ? r.rating : 0;
      prev._sum = (prev._sum || 0) + ratingVal;
      prev._count = (prev._count || 0) + (ratingVal > 0 ? 1 : 0);
      prev.averageRating = (prev._count || 0) > 0 ? (prev._sum || 0) / (prev._count || 0) : 0;
      grouped.set(id, prev);
    });
    return Array.from(grouped.values());
  }, [ratings]);

  const catalogProducts = products.length > 0 ? products : ratedProductsFallback;

  const nq = normalizeText(searchQuery);
  const filteredProducts = catalogProducts.filter((p) => {
    const matchesSearch = normalizeText(p.name).includes(nq) || normalizeText(p.type).includes(nq) || normalizeText(p.category).includes(nq);
    return matchesSearch && matchesProductFilter(p);
  });
  const filteredDistilleries = distilleries.filter((d) =>
    {
      const loc = typeof d.location === "object" && d.location !== null ? d.location : null;
      return (
    normalizeText(d.name).includes(nq) ||
    normalizeText(loc?.address).includes(nq) ||
    normalizeText(loc?.city).includes(nq) ||
    normalizeText(d.region).includes(nq)
      );
    }
  );
  const filteredMapDistilleries = distilleries
    .filter((d) => {
      if (!selectedRegion) return true;
      const dr = normalizeText(d.region);
      const wr = normalizeText(selectedRegion);
      if (wr === "ostalo") return !dr || dr.includes("ostalo");
      return dr.includes(wr);
    })
    .filter((d) => {
      const q = normalizeText(producerSearch.trim());
      if (!q) return true;
      const loc = typeof d.location === "object" && d.location !== null ? d.location : null;
      return normalizeText(d.name).includes(q) || normalizeText(d.region).includes(q) ||
        normalizeText(loc?.city).includes(q) || normalizeText(loc?.address).includes(q);
    });

  const todayIso = new Date().toISOString().slice(0, 10);
  const visibleEvents = (eventsView === "active"
    ? communityEvents.filter((ev) => !ev.eventDate || String(ev.eventDate) >= todayIso)
    : communityEvents.filter((ev) => ev.eventDate && String(ev.eventDate) < todayIso));
  const hasSearchQuery = searchQuery.trim() !== "";
  const isResultsMode = activeSection === "search";
  const activeProductIds = new Set(catalogProducts.map((p) => p.id));
  // If catalog is unavailable/empty, never hide existing ratings.
  const visibleRatings = activeProductIds.size > 0 ? ratings.filter((r) => activeProductIds.has(r.productId)) : ratings;

  const handleReport = async (e: React.MouseEvent, ratingId: string) => {
    e.stopPropagation();
    if (!window.confirm("Da li želite da prijavite ovaj komentar kao neprimeren?")) return;
    try {
      await updateDoc(doc(db, "ratings", ratingId), { isFlagged: true, flaggedBy: "community_report", flaggedAt: new Date().toISOString() });
      alert("Hvala na prijavi. Administratori će pregledati ovaj sadržaj.");
    } catch (err) {
      console.error("Greška pri prijavi:", err);
    }
  };

  /* ── shared helpers ── */
  const tabCls = (active: boolean) =>
    cn(
      "flex-1 py-2.5 text-[11px] font-black uppercase tracking-wide rounded-xl transition-all duration-200 active:scale-[0.98]",
      active ? "bg-gold-500 text-black shadow-[0_4px_12px_rgba(212,175,55,0.22)]" : "text-text-secondary hover:text-white",
    );

  const distLocation = (d: DistilleryItem) =>
    typeof d.location === "string" ? d.location :
    (d.location?.city || d.location?.address)
      ? [d.location.city, d.location.address].filter(Boolean).join(", ")
      : d.region || "Srbija";

  const topRakija = catalogProducts
    .filter((p) => !isWineProduct(p) && (p.averageRating || 0) > 0)
    .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
    .slice(0, 10);

  const topVina = catalogProducts
    .filter((p) => isWineProduct(p) && (p.averageRating || 0) > 0)
    .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
    .slice(0, 10);

  const comparePool = catalogProducts
    .filter((p) => {
      if (compareFilter === "all") return true;
      const t = `${normalizeText(p?.name)} ${normalizeText(p?.type)} ${normalizeText(p?.category)}`;
      if (compareFilter === "sve-rakije") return !isWineProduct(p);
      if (compareFilter === "sva-vina") return isWineProduct(p);
      if (compareFilter === "sljivovica") return t.includes("sljiv");
      if (compareFilter === "dunjevaca") return t.includes("dunjev");
      if (compareFilter === "kruskovaca") return t.includes("krusk") || t.includes("krus");
      if (compareFilter === "bela-vina") return (t.includes("vino") || t.includes("vina")) && (t.includes("belo") || t.includes("white"));
      if (compareFilter === "crvena-vina") return (t.includes("vino") || t.includes("vina")) && (t.includes("crveno") || t.includes("red"));
      if (compareFilter === "roze") return (t.includes("vino") || t.includes("vina")) && (t.includes("roze") || t.includes("rose"));
      return true;
    })
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "sr"));

  const findCompareMatches = (queryText: string, excludeId?: string) => {
    const q = normalizeText(queryText.trim());
    if (!q) return [];
    return comparePool
      .filter((p) => p.id !== excludeId)
      .filter((p) =>
        normalizeText(p.name).includes(q) ||
        normalizeText(p.type).includes(q) ||
        normalizeText(p.category).includes(q) ||
        normalizeText(p.distillery).includes(q),
      )
      .slice(0, 10);
  };

  const compareLeft = comparePool.find((p) => p.id === compareLeftId) || null;
  const compareRight = comparePool.find((p) => p.id === compareRightId) || null;
  const compareLeftMatches = findCompareMatches(compareLeftQuery, compareRightId);
  const compareRightMatches = findCompareMatches(compareRightQuery, compareLeftId);
  const leftCandidateList = (compareLeftQuery.trim() ? compareLeftMatches : comparePool.filter((p) => p.id !== compareRightId)).slice(0, 8);
  const rightCandidateList = (compareRightQuery.trim() ? compareRightMatches : comparePool.filter((p) => p.id !== compareLeftId)).slice(0, 8);

  const metricVal = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const resetCompareSelection = () => {
    setCompareLeftId("");
    setCompareRightId("");
    setCompareLeftQuery("");
    setCompareRightQuery("");
  };
  const searchReturnTo = `/community?tab=search&q=${encodeURIComponent(searchQuery)}&pf=${encodeURIComponent(activeProductFilter)}`;
  const reviewsReturnTo = `/community?tab=reviews`;
  const topsReturnTo = `/community?tab=tops`;
  const labelHref = (productId: string, returnTo: string) =>
    `/label/${productId}?rt=${encodeURIComponent(returnTo)}`;
  const openLabelWithReturn = (productId: string, returnTo: string) => {
    try {
      sessionStorage.setItem("rakivinum_last_label_return_v1", returnTo);
      sessionStorage.setItem("rakivinum_last_community_return_v1", returnTo);
      const tab = returnTo.includes("tab=") ? returnTo.split("tab=")[1]?.split("&")[0] : activeSection;
      if (tab) sessionStorage.setItem("rakivinum_last_community_tab_v1", tab);
    } catch {
      // best effort
    }
    navigate(labelHref(productId, returnTo), { state: { returnTo } });
  };

  return (
      <div className="p-4 space-y-5 animate-in fade-in duration-300 pb-24">

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="page-title">Zajednica</h2>
        </div>
        <p className="page-subtitle">Utisci, top liste i sertifikovani proizvođači.</p>
      </div>

      {/* Filter pills — only shown on Search tab */}
      {activeSection === "search" && (
        <div className="overflow-x-auto grab-scrollbar -mx-4 px-4 pb-1">
          <div className="flex gap-2 min-w-max">
            {filterOptions.map((opt) => (
              <button key={opt.id} type="button" onClick={() => setActiveProductFilter(opt.id)}
                className={cn(
                  "px-3.5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-200 active:scale-95 whitespace-nowrap",
                  activeProductFilter === opt.id
                    ? "bg-gold-500 text-black border-gold-500 shadow-[0_4px_14px_rgba(212,175,55,0.28)]"
                    : "bg-bg-card border-white/10 text-text-secondary hover:border-white/25 hover:text-white")}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ RESULTS MODE ══ */}
      {isResultsMode ? (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-widest font-bold text-text-secondary">Pretraga</p>
            <button
              type="button"
              onClick={() => {
                setActiveSection("reviews");
                navigate("/community?tab=reviews", { replace: true });
              }}
              className="px-3 py-1.5 rounded-full border border-white/15 text-[10px] font-black uppercase tracking-wide text-text-secondary hover:text-white hover:border-white/35 transition-colors"
            >
              Nazad u Zajednicu
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearching(true)}
              placeholder="Pretraži proizvode, destilerije, vinarije…"
              className="w-full card-elevated border border-white/25 rounded-2xl py-4 pl-12 pr-12 text-white text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/35 focus-visible:border-gold-500/35"
              autoComplete="off"
            />
            {searchQuery && (
              <button type="button" onClick={() => { setSearchQuery(""); setIsSearching(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Obriši">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {filteredProducts.length > 0 && (
            <div className="space-y-3">
              <h3 className="section-title px-1">Proizvodi ({filteredProducts.length})</h3>
              <div className="grid grid-cols-2 gap-3">
                {filteredProducts.map((prod) => (
                  <button key={prod.id} type="button" onClick={() => openLabelWithReturn(prod.id, searchReturnTo)}
                    className="card-elevated border border-white/8 rounded-[20px] p-3.5 flex flex-col items-center gap-2.5 text-center hover:border-gold-500/30 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base">
                    <div className="w-16 h-20 rounded-xl bg-black/60 border border-gold-500/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] flex items-center justify-center overflow-hidden">
                      <img src={prod.bottleImageUrl || prod.image || `https://picsum.photos/seed/${prod.id}/200/300`}
                        className="h-full w-full object-contain object-center media-crisp p-0.5"
                        onError={(e) => { (e.target as HTMLImageElement).src = "https://picsum.photos/seed/rakivinum/200/200"; }}
                        alt={prod.name} />
                    </div>
                    <div className="min-w-0 w-full">
                      <p className="text-sm font-bold text-white line-clamp-1 leading-snug">{prod.name}</p>
                      <p className="eyebrow-label text-text-secondary/90 mt-0.5">{prod.type}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasSearchQuery && filteredDistilleries.length > 0 && (
            <div className="space-y-2">
              <h3 className="section-title px-1">Destilerije/Vinarije ({filteredDistilleries.length})</h3>
              {filteredDistilleries.map((dist) => (
                <button key={dist.id} type="button" onClick={() => navigate(`/distillery/${dist.id}`)}
                  className="w-full card-elevated border border-white/8 rounded-[20px] p-4 flex items-center justify-between gap-3 hover:border-gold-500/30 transition-all active:scale-[0.98] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base">
                  <div className="min-w-0">
                    <p className="font-bold text-white text-sm truncate">{dist.name}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-gold-500 shrink-0" />{distLocation(dist)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {hasSearchQuery && filteredProducts.length === 0 && filteredDistilleries.length === 0 && (
            <div className="empty-state card-elevated max-w-md mx-auto py-10 px-6 text-center space-y-4 rounded-[28px]">
              <SearchSlash className="w-10 h-10 text-gold-500/35 mx-auto" aria-hidden />
              <p className="text-sm text-text-secondary leading-relaxed">
                {`Nema rezultata za „${searchQuery}"`}
              </p>
              <button type="button" onClick={() => { setActiveProductFilter("all"); setSearchQuery(""); setSelectedRegion(""); setProducerView("regions"); }}
                className="w-full max-w-xs mx-auto py-2.5 btn-tertiary text-[11px]">
                Resetuj filter
              </button>
            </div>
          )}
        </div>

      ) : (
      /* ══ MAIN TABS ══ */
        <div className="space-y-5">

          {/* ── Single flat tab bar ── */}
          <div className="card-elevated border border-white/10 rounded-2xl p-1 overflow-x-auto grab-scrollbar -mx-1 px-1 pb-1">
            <div className="flex gap-1 min-w-max snap-x snap-mandatory">
              {([
                { id: "reviews", label: "Utisci" },
                { id: "tops",    label: "Top 10" },
                { id: "compare", label: "Uporedi", icon: <Scale className="w-3 h-3" /> },
                { id: "producers", label: "Destilerije", icon: <Compass className="w-3 h-3" /> },
                  { id: "search", label: "Pretraga", icon: <Search className="w-3 h-3" /> },
                { id: "events", label: "Događaji", icon: <CalendarDays className="w-3 h-3" /> },
              ] as ReadonlyArray<{ id: "reviews" | "tops" | "compare" | "producers" | "search" | "events"; label: string; icon?: React.ReactNode }>).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(tab.id);
                    navigate(`/community?tab=${tab.id}`, { replace: true });
                  }}
                  className={cn(
                    "min-h-[42px] min-w-[116px] px-3 py-2 text-[10px] font-black uppercase tracking-wide whitespace-nowrap leading-none rounded-xl transition-all duration-200 active:scale-[0.98] inline-flex items-center justify-center gap-1 snap-start",
                    activeSection === tab.id
                      ? "bg-gold-500 text-black shadow-[0_4px_12px_rgba(212,175,55,0.22)]"
                      : "text-text-secondary hover:text-white"
                  )}
                >
                  {tab.icon ?? null}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ─── UTISCI TAB ─── */}
          {activeSection === "reviews" && (
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* Utisci */}
              <div className="card-elevated border border-white/8 rounded-[28px] overflow-hidden">
                  <div className="px-5 pt-5 pb-3 border-b border-white/5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                      <MessageCircle className="w-4 h-4 text-gold-500" />
                    </div>
                    <h3 className="text-sm font-black text-white uppercase tracking-widest italic">Utisci zajednice</h3>
                  </div>
                  <div className="p-4">
                    {loading ? (
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Loader2 className="w-8 h-8 text-gold-500 animate-spin motion-reduce:animate-none" />
                        <p className="text-sm text-text-secondary italic">Osluškujemo tajne buradi…</p>
                      </div>
                    ) : quotaExceeded ? (
                      <div className="empty-state py-12 text-center space-y-3">
                        <Info className="w-10 h-10 text-amber-400/70 mx-auto" />
                        <p className="text-sm text-text-secondary leading-relaxed max-w-md mx-auto">
                          Privremeno nedostupno: dnevna Firestore kvota je potrošena. Podaci će se automatski vratiti nakon resetovanja kvote.
                        </p>
                      </div>
                    ) : visibleRatings.length === 0 ? (
                      <div className="empty-state py-12 text-center space-y-3">
                        <MessageCircle className="w-10 h-10 text-gold-500/20 mx-auto" />
                        <p className="text-text-secondary italic text-sm">Još nema ocena. Budi prvi!</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {visibleRatings.slice(0, 15).map((rating) => (
                          <div
                            key={rating.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openLabelWithReturn(rating.productId, reviewsReturnTo)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openLabelWithReturn(rating.productId, reviewsReturnTo);
                              }
                            }}
                            className="py-5 first:pt-0 last:pb-0 cursor-pointer group hover:bg-white/[0.02] -mx-4 px-4 rounded-2xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                          >
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                                  <UsersIcon className="w-4 h-4 text-gold-500" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-white">Gost</p>
                                  {rating.userLocation ? (
                                    <p className="text-[11px] text-text-secondary/80 font-normal leading-snug mt-0.5 truncate"
                                      title={safeStr(rating.userLocation)}>
                                      {safeStr(rating.userLocation)}
                                    </p>
                                  ) : null}
                                  <p className="text-[10px] text-text-secondary/60 tabular-nums mt-0.5">
                                    {formatRatingDate(rating.createdAt)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 bg-gold-500/10 px-2.5 py-1 rounded-lg border border-gold-500/20 shrink-0">
                                <Star className="w-3 h-3 text-gold-500 fill-current" />
                                <span className="text-xs font-black text-gold-500">{rating.rating.toFixed(1)}</span>
                              </div>
                            </div>
                            <div className="flex gap-3 items-start">
                              <div className="w-14 h-[72px] rounded-xl bg-black/60 border border-gold-500/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] overflow-hidden shrink-0">
                                <img src={rating.productImage || `https://picsum.photos/seed/rakivinum_${rating.productId}/200/300`}
                                  alt="Piće" referrerPolicy="no-referrer"
                                  className="h-full w-full object-contain object-center p-0.5 media-crisp group-hover:scale-[1.03] transition-transform duration-500" />
                              </div>
                              <div className="flex-1 space-y-1.5 pt-0.5 min-w-0">
                                <h4 className="eyebrow-label text-gold-500/80 tracking-[0.12em] truncate">
                                  {rating.productName || "Ekskluzivni Destilat"}
                                </h4>
                                <p className="text-text-primary text-[13px] leading-relaxed line-clamp-3 italic opacity-90">
                                  „{rating.reviewText || rating.comment || "Vrhunski užitak i preporuka!"}"
                                </p>
                                <button type="button" onClick={(e) => handleReport(e, rating.id)}
                                  className="ui-caption uppercase font-bold tracking-widest text-text-secondary/45 hover:text-red-400 transition-colors flex items-center gap-1 pt-1">
                                  Prijavi <Flag className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

            </div>
          )}

          {/* ─── TOP LISTE TAB ─── */}
          {activeSection === "tops" && (
            <div className="card-elevated border border-white/8 rounded-[28px] overflow-hidden animate-in fade-in duration-300">
              <div className="p-4 space-y-6">
                {/* Top rakije */}
                <div className="space-y-0.5">
                  <p className="eyebrow-label text-gold-500 flex items-center gap-1.5 px-1 mb-2">
                    <Star className="w-3 h-3" /> Top 10 Rakija
                  </p>
                  {topRakija.map((p, i) => (
                    <button key={p.id} type="button" onClick={() => openLabelWithReturn(p.id, topsReturnTo)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gold-500/5 transition-all group active:scale-[0.99]">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn("text-xs font-black italic w-5 text-center shrink-0", i < 3 ? "text-gold-500" : "text-white/20")}>{i + 1}</span>
                        <span className="text-[13px] font-semibold text-white/80 truncate group-hover:text-gold-500 transition-colors">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] font-black text-gold-500">{(p.averageRating || 0).toFixed(1)}</span>
                        <ChevronRight className="w-3 h-3 text-gold-500" />
                      </div>
                    </button>
                  ))}
                  {topRakija.length === 0 && (
                    <p className="text-[11px] text-text-secondary/60 italic px-3 py-2">Nema ocenjenih rakija.</p>
                  )}
                </div>

                <div className="border-t border-white/5" />

                {/* Top vina */}
                <div className="space-y-0.5">
                  <p className="eyebrow-label text-purple-400 flex items-center gap-1.5 px-1 mb-2">
                    <Sparkles className="w-3 h-3" /> Top 10 Vina
                  </p>
                  {topVina.map((p, i) => (
                    <button key={p.id} type="button" onClick={() => openLabelWithReturn(p.id, topsReturnTo)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-purple-500/5 transition-all group active:scale-[0.99]">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn("text-xs font-black italic w-5 text-center shrink-0", i < 3 ? "text-purple-400" : "text-white/20")}>{i + 1}</span>
                        <span className="text-[13px] font-semibold text-white/80 truncate group-hover:text-purple-400 transition-colors">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] font-black text-purple-400">{(p.averageRating || 0).toFixed(1)}</span>
                        <ChevronRight className="w-3 h-3 text-purple-400" />
                      </div>
                    </button>
                  ))}
                  {topVina.length === 0 && (
                    <p className="text-[11px] text-text-secondary/60 italic px-3 py-2">Nema ocenjenih vina.</p>
                  )}
                </div>

                <div className="flex items-start gap-2 p-3 bg-white/[0.03] border border-white/6 rounded-xl">
                  <Info className="w-3 h-3 text-gold-500/70 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-text-secondary leading-relaxed italic">
                    Top 10 se računa po prosečnoj oceni (`averageRating`) iz javnih utisaka. Rakije i vina se rangiraju odvojeno,
                    prikazuju se samo artikli sa ocenom većom od 0, a lista se automatski osvežava kako pristižu nove ocene.
                  </p>
                </div>

              </div>
            </div>
          )}

          {/* ─── UPOREDI TAB ─── */}
          {activeSection === "compare" && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="card-elevated border border-white/8 rounded-[28px] p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="section-title">Uporedi 2 artikla</h3>
                  <button
                    type="button"
                    onClick={resetCompareSelection}
                    className="px-2.5 py-1.5 rounded-lg border border-white/15 text-[10px] font-black uppercase tracking-wider text-text-secondary hover:text-white hover:border-gold-500/35 transition-colors"
                  >
                    Reset
                  </button>
                </div>

                <div className="overflow-x-auto grab-scrollbar -mx-1 px-1 pb-1">
                  <div className="flex gap-2 min-w-max">
                    {compareFilterOptions.map((opt) => (
                      <button
                        key={`cmp-filter-${opt.id}`}
                        type="button"
                        onClick={() => {
                          if (opt.id !== compareFilter) {
                            setCompareFilter(opt.id);
                            setCompareLeftId("");
                            setCompareRightId("");
                            setCompareLeftQuery("");
                            setCompareRightQuery("");
                          }
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors",
                          compareFilter === opt.id
                            ? "bg-gold-500 text-black border-gold-500"
                            : "bg-bg-card border-white/10 text-text-secondary hover:text-white hover:border-white/25"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-bold">Prvi artikal</label>
                    <input
                      type="search"
                      value={compareLeftQuery}
                      onChange={(e) => {
                        setCompareLeftQuery(e.target.value);
                        setCompareLeftId("");
                      }}
                      placeholder="Pretraži naziv..."
                      className="w-full bg-bg-card-elevated border border-white/10 rounded-xl py-2.5 px-3 text-[12px] text-white"
                    />
                    {!compareLeft && (
                      <div className="max-h-44 overflow-y-auto rounded-xl border border-white/8 bg-black/20">
                        {leftCandidateList.length > 0 ? leftCandidateList.map((p) => (
                          <button
                            key={`left-match-${p.id}`}
                            type="button"
                            onClick={() => {
                              setCompareLeftId(p.id);
                              setCompareLeftQuery(p.name || "");
                            }}
                            className="w-full px-3 py-2 text-left border-b border-white/5 last:border-b-0 hover:bg-white/5"
                          >
                            <p className="text-[12px] font-semibold text-white truncate">{p.name}</p>
                            <p className="text-[10px] text-text-secondary">Ocena {(p.averageRating || 0).toFixed(1)}</p>
                          </button>
                        )) : (
                          <p className="px-3 py-2 text-[11px] text-text-secondary italic">Nema rezultata.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-bold">Drugi artikal</label>
                    <input
                      type="search"
                      value={compareRightQuery}
                      onChange={(e) => {
                        setCompareRightQuery(e.target.value);
                        setCompareRightId("");
                      }}
                      placeholder="Pretraži naziv..."
                      className="w-full bg-bg-card-elevated border border-white/10 rounded-xl py-2.5 px-3 text-[12px] text-white"
                    />
                    {!compareRight && (
                      <div className="max-h-44 overflow-y-auto rounded-xl border border-white/8 bg-black/20">
                        {rightCandidateList.length > 0 ? rightCandidateList.map((p) => (
                          <button
                            key={`right-match-${p.id}`}
                            type="button"
                            onClick={() => {
                              setCompareRightId(p.id);
                              setCompareRightQuery(p.name || "");
                            }}
                            className="w-full px-3 py-2 text-left border-b border-white/5 last:border-b-0 hover:bg-white/5"
                          >
                            <p className="text-[12px] font-semibold text-white truncate">{p.name}</p>
                            <p className="text-[10px] text-text-secondary">Ocena {(p.averageRating || 0).toFixed(1)}</p>
                          </button>
                        )) : (
                          <p className="px-3 py-2 text-[11px] text-text-secondary italic">Nema rezultata.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {compareLeft && compareRight ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {[compareLeft, compareRight].map((p) => (
                        <div key={`cmp-card-${p.id}`} className="rounded-xl border border-white/10 bg-bg-card p-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              const rt = `/community?tab=compare&cf=${encodeURIComponent(compareFilter)}&l=${encodeURIComponent(compareLeftId)}&r=${encodeURIComponent(compareRightId)}&lq=${encodeURIComponent(compareLeftQuery)}&rq=${encodeURIComponent(compareRightQuery)}`;
                              openLabelWithReturn(p.id, rt);
                            }}
                            className="w-full rounded-xl overflow-hidden border border-gold-500/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] bg-black/60"
                            title="Otvori etiketu"
                          >
                            <img
                              src={p.bottleImageUrl || p.image || `https://picsum.photos/seed/${p.id}/220/320`}
                              alt={p.name || "Piće"}
                              className="w-full h-36 object-contain object-center p-2 media-crisp"
                            />
                          </button>
                          <p className="text-[11px] font-black text-white line-clamp-2">{p.name || "Piće"}</p>
                          <p className="text-[10px] text-text-secondary">Tip: {p.type || "—"}</p>
                          <p className="text-[10px] text-gold-500 font-bold">Ocena: {(p.averageRating || 0).toFixed(1)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Sažetak poređenja</p>
                      <div className="space-y-1 text-[11px]">
                        <p className="text-white/90">
                          Prosečna ocena:{" "}
                          <span className={cn(metricVal(compareLeft.averageRating) >= metricVal(compareRight.averageRating) ? "text-gold-500 font-bold" : "text-white")}>
                            {compareLeft.name}
                          </span>{" "}
                          {metricVal(compareLeft.averageRating) === metricVal(compareRight.averageRating) ? "je izjednačena sa" : metricVal(compareLeft.averageRating) > metricVal(compareRight.averageRating) ? "ima višu ocenu od" : "ima nižu ocenu od"}{" "}
                          <span className={cn(metricVal(compareRight.averageRating) >= metricVal(compareLeft.averageRating) ? "text-gold-500 font-bold" : "text-white")}>
                            {compareRight.name}
                          </span>.
                        </p>
                        <p className="text-white/80">
                          Alkohol: {typeof compareLeft.alcoholPercentage === "number" ? `${compareLeft.alcoholPercentage}%` : "—"} vs{" "}
                          {typeof compareRight.alcoholPercentage === "number" ? `${compareRight.alcoholPercentage}%` : "—"}.
                        </p>
                        <p className="text-white/70 italic">
                          Napomena: rang i poređenje su bazirani na trenutno dostupnim javnim ocenama zajednice.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-text-secondary italic">
                    Pronađi i izaberi 2 artikla da vidiš ozbiljno poređenje (slike, ocene i sažetak).
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ─── PROIZVOĐAČI TAB ─── */}
          {activeSection === "producers" && (
            <div className="space-y-4 animate-in fade-in duration-300">
              {/* Info header */}
              <div className="relative overflow-hidden card-elevated border border-white/8 rounded-[28px] p-4">
                <div className="absolute -right-8 -top-8 w-36 h-36 bg-gold-500/8 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                    <Compass className="w-5 h-5 text-gold-500 animate-[spin_12s_linear_infinite] motion-reduce:animate-none" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white italic leading-tight">Rakijski i vinski putevi</h3>
                    <p className="text-[11px] text-text-secondary mt-0.5">{distilleries.length} sertifikovanih proizvođača</p>
                  </div>
                </div>
              </div>

              {/* Regije / Lista toggle */}
              <div className="flex gap-1 p-1 card-elevated border border-white/10 rounded-2xl">
                <button type="button" onClick={() => setProducerView("regions")} className={tabCls(producerView === "regions")}>Po regiji</button>
                <button type="button" onClick={() => setProducerView("list")} className={tabCls(producerView === "list")}>Lista</button>
              </div>

              {/* Regije */}
              {producerView === "regions" && (
                <div className="card-elevated border border-white/8 rounded-[28px] p-4 space-y-3">
                  <p className="eyebrow-label text-text-secondary px-1">Izaberi regiju</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["Sve", "Beograd", "Vojvodina", "Šumadija", "Zapadna Srbija", "Istočna Srbija", "Južna Srbija", "Ostalo"].map((reg) => {
                      const active = reg === "Sve" ? selectedRegion === "" : selectedRegion === reg;
                      return (
                        <button key={reg} type="button"
                          onClick={() => { setSelectedRegion(reg === "Sve" ? "" : reg); setProducerView("list"); }}
                          className={cn("py-3 px-3 rounded-2xl border text-[11px] font-black uppercase tracking-wide transition-all duration-200 active:scale-95 text-center",
                            active ? "bg-gold-500 border-gold-500 text-black shadow-[0_4px_12px_rgba(212,175,55,0.22)]"
                                   : "bg-bg-card border-white/8 text-text-secondary hover:border-gold-500/40 hover:text-white")}>
                          {reg}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Lista */}
              {producerView === "list" && (
                <div className="card-elevated border border-white/8 rounded-[28px] p-4 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" aria-hidden />
                    <input type="search" value={producerSearch} onChange={(e) => setProducerSearch(e.target.value)}
                      placeholder="Pretraži po imenu, regiji…"
                      className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-[13px] text-white transition-all outline-none"
                      autoComplete="off" />
                  </div>
                  {selectedRegion && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-secondary">Regija:</span>
                      <button type="button" onClick={() => setSelectedRegion("")}
                        className="flex items-center gap-1 px-2.5 py-1 bg-gold-500/10 border border-gold-500/25 rounded-full text-[10px] font-bold text-gold-500 hover:bg-gold-500/20 transition-colors">
                        {selectedRegion} <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  {filteredMapDistilleries.length > 0 ? (
                    <div className="space-y-2">
                      {filteredMapDistilleries.map((dist) => (
                        <button key={dist.id} type="button" onClick={() => navigate(`/distillery/${dist.id}`)}
                          className="w-full card-soft border border-white/8 rounded-2xl p-4 flex items-center justify-between gap-3 hover:border-gold-500/30 transition-all active:scale-[0.98] group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-12 bg-black border-2 border-white/10 group-hover:border-gold-500/50 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-[0_0_0_1px_rgba(212,175,55,0.06)] transition-all duration-300">
                              {dist.logoUrl
                                ? <img src={dist.logoUrl} alt={dist.name} className="w-full h-full object-contain p-1 media-crisp" />
                                : <span className="text-gold-500 font-black font-serif text-lg">{String(dist.name || "D").charAt(0)}</span>}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-black text-white text-sm truncate leading-snug">{dist.name}</p>
                                {dist.isVerified && (
                                  <span className="inline-flex items-center gap-0.5 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-green-400 uppercase shrink-0">
                                    <CheckCircle className="w-2.5 h-2.5 fill-current" /> Sertif.
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 text-gold-500 shrink-0" />
                                <span className="text-[10px] text-text-secondary uppercase tracking-wide truncate">{dist.region || "Srbija"}</span>
                              </div>
                            </div>
                          </div>
                          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-gold-500 group-hover:text-black transition-all shrink-0">
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : isCatalogLoaded ? (
                    <div className="empty-state py-10 text-center space-y-2">
                      <SearchSlash className="w-8 h-8 text-white/15 mx-auto" />
                      <p className="text-text-secondary text-sm">Nema proizvođača za izabrane kriterijume.</p>
                    </div>
                  ) : (
                    <div className="py-14 text-center">
                      <Loader2 className="w-8 h-8 text-gold-500/30 animate-spin motion-reduce:animate-none mx-auto mb-3" />
                      <p className="text-text-secondary text-sm">Učitavanje…</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── DOGAĐAJI TAB ─── */}
          {activeSection === "events" && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="card-elevated border border-white/8 rounded-[28px] overflow-hidden">
                <div className="px-5 pt-5 pb-3 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="section-title">Manifestacije i događaji</h3>
                  <div className="flex gap-1 p-0.5 bg-black/30 border border-white/8 rounded-xl shrink-0">
                    {(["active", "archive"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setEventsView(v)}
                        className={cn("px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all",
                          eventsView === v ? "bg-gold-500 text-black" : "text-text-secondary hover:text-white")}>
                        {v === "active" ? "Aktuelno" : "Arhiva"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {visibleEvents.length > 0 ? visibleEvents.map((ev) => (
                    <div key={ev.id} className="card-soft border border-white/8 rounded-2xl p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-sm truncate">{ev.title || "Događaj"}</p>
                        <p className="text-[11px] text-gold-500 mt-0.5 flex items-center gap-1">
                          <CalendarDays className="w-3 h-3 shrink-0" /> {ev.eventDate || "Datum uskoro"}
                        </p>
                        {ev.location && typeof ev.location === "string" && (
                          <p className="text-[11px] text-text-secondary truncate mt-0.5">{ev.location}</p>
                        )}
                        {ev.description && (
                          <p className="text-[11px] text-text-secondary mt-1 line-clamp-2 leading-relaxed">{ev.description}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {(ev.websiteUrl || ev.link) && (
                          <a href={ev.websiteUrl || ev.link} target="_blank" rel="noreferrer"
                            className="inline-flex items-center justify-center px-3 py-2 btn-tertiary text-[10px] font-bold no-underline">
                            Sajt
                          </a>
                        )}
                        {ev.mapsUrl && (
                          <a href={ev.mapsUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center justify-center px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-300 hover:bg-blue-500/15 transition-colors">
                            Mapa
                          </a>
                        )}
                      </div>
                    </div>
                  )) : (
                    <p className="text-[12px] text-text-secondary italic py-6 text-center">
                      {eventsView === "active" ? "Nema aktuelnih događaja." : "Arhiva je prazna."}
                    </p>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
