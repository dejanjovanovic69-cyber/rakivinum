import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CACHE_TTL, REFRESH_INTERVAL } from "../lib/cachePolicy";
import { stableQueryOptions } from "../lib/queryDefaults";
import { queryKeys } from "../lib/queryKeys";
import {
  fetchCommunityEvents,
  fetchCommunityRatings,
  fetchPublicDistilleries,
  fetchPublicProducts,
} from "../lib/dataService";
import { readCache } from "../lib/resilience";
import { shouldRunRefresh } from "../lib/refreshGate";
import {
  COMMUNITY_COMPARE_FILTER_OPTIONS,
  COMMUNITY_FILTER_OPTIONS,
  toCommunitySection,
} from "../components/community/constants";
import type {
  CommunityEventItem,
  CommunitySection,
  ComparePersistState,
  DistilleryItem,
  ProductItem,
  RatingItem,
} from "../components/community/types";

const COMMUNITY_RATINGS_CACHE_KEY = "rakivinum_cache_community_ratings_v1";
/** Postavi `VITE_COMMUNITY_READ_EMERGENCY=1` da Community čita samo iz lokalnog keša (bez mrežnih fetch-eva). */
const COMMUNITY_READ_EMERGENCY_MODE = import.meta.env.VITE_COMMUNITY_READ_EMERGENCY === "1";

function readCommunityRatingsCache(): RatingItem[] | null {
  const cached = readCache<RatingItem[]>(COMMUNITY_RATINGS_CACHE_KEY);
  if (cached === null || cached === undefined) return null;
  if (!Array.isArray(cached)) return null;
  return cached.filter((r) => !r?.isFlagged) as RatingItem[];
}

type UseCommunityDataResult = {
  activeSection: CommunitySection;
  ratings: RatingItem[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  products: ProductItem[];
  distilleries: DistilleryItem[];
  activeProductFilter: string;
  setActiveProductFilter: (value: string) => void;
  producerView: "regions" | "list";
  setProducerView: (value: "regions" | "list") => void;
  selectedRegion: string;
  setSelectedRegion: (value: string) => void;
  communityEvents: CommunityEventItem[];
  eventsView: "active" | "archive";
  setEventsView: (value: "active" | "archive") => void;
  isCatalogLoaded: boolean;
  producerSearch: string;
  setProducerSearch: (value: string) => void;
  compareFilter: string;
  setCompareFilter: (value: string) => void;
  compareLeftQuery: string;
  setCompareLeftQuery: (value: string) => void;
  compareRightQuery: string;
  setCompareRightQuery: (value: string) => void;
  compareLeftId: string;
  setCompareLeftId: (value: string) => void;
  compareRightId: string;
  setCompareRightId: (value: string) => void;
};

export function useCommunityData(locationSearch: string): UseCommunityDataResult {
  const PRODUCTS_FETCH_LIMIT = 350;
  const DISTILLERIES_FETCH_LIMIT = 220;
  const EVENTS_FETCH_LIMIT = 60;

  const [ratingsSeed] = useState<RatingItem[]>(() => readCommunityRatingsCache() ?? []);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeProductFilter, setActiveProductFilter] = useState("all");
  const [producerView, setProducerView] = useState<"regions" | "list">("regions");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [eventsView, setEventsView] = useState<"active" | "archive">("active");
  const [producerSearch, setProducerSearch] = useState("");
  const [compareFilter, setCompareFilter] = useState("all");
  const [compareLeftQuery, setCompareLeftQuery] = useState("");
  const [compareRightQuery, setCompareRightQuery] = useState("");
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");

  const lastLocationSearchRef = useRef<string>("");
  const activeSection = useMemo<CommunitySection>(() => toCommunitySection(locationSearch), [locationSearch]);

  const ratingsQuery = useQuery<RatingItem[]>({
    queryKey: queryKeys.community.ratings(),
    queryFn: async () => {
      if (COMMUNITY_READ_EMERGENCY_MODE) {
        return readCommunityRatingsCache() ?? [];
      }
      let shouldRefresh = true;
      try {
        shouldRefresh = shouldRunRefresh("community:ratings", REFRESH_INTERVAL.USER_LIGHT_1H);
      } catch (gateErr) {
        console.warn("Community refresh gate failed; continuing with safe refresh.", gateErr);
      }
      if (!shouldRefresh) {
        return readCommunityRatingsCache() ?? [];
      }
      const rows = await fetchCommunityRatings({
        limitCount: 20,
        cacheKey: COMMUNITY_RATINGS_CACHE_KEY,
        ttlMs: CACHE_TTL.COMMUNITY_EVENTS_6H,
      });
      return (Array.isArray(rows) ? rows : []).filter((r) => !r?.isFlagged) as RatingItem[];
    },
    initialData: ratingsSeed,
    ...stableQueryOptions(REFRESH_INTERVAL.USER_LIGHT_1H, CACHE_TTL.COMMUNITY_EVENTS_6H),
  });

  const catalogQuery = useQuery<{ products: ProductItem[]; distilleries: DistilleryItem[] }>({
    queryKey: queryKeys.community.catalog(PRODUCTS_FETCH_LIMIT, DISTILLERIES_FETCH_LIMIT),
    queryFn: async () => {
      if (COMMUNITY_READ_EMERGENCY_MODE) {
        const cachedProducts = readCache<ProductItem[]>("rakivinum_cache_community_products_v1");
        const cachedDistilleries = readCache<DistilleryItem[]>("rakivinum_cache_community_distilleries_v1");
        return {
          products: Array.isArray(cachedProducts) ? cachedProducts : [],
          distilleries: Array.isArray(cachedDistilleries) ? cachedDistilleries : [],
        };
      }
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
      const products = prodResult.status === "fulfilled"
        ? prodResult.value
        : (readCache<ProductItem[]>("rakivinum_cache_community_products_v1") || []);
      const distilleries = distResult.status === "fulfilled"
        ? distResult.value
        : (readCache<DistilleryItem[]>("rakivinum_cache_community_distilleries_v1") || []);
      return { products, distilleries };
    },
    initialData: {
      products: readCache<ProductItem[]>("rakivinum_cache_community_products_v1") || [],
      distilleries: readCache<DistilleryItem[]>("rakivinum_cache_community_distilleries_v1") || [],
    },
    ...stableQueryOptions(CACHE_TTL.PRODUCTS_6H),
  });

  const eventsQuery = useQuery<CommunityEventItem[]>({
    queryKey: queryKeys.community.events(EVENTS_FETCH_LIMIT),
    queryFn: async () => {
      if (COMMUNITY_READ_EMERGENCY_MODE) {
        const cachedEvents = readCache<CommunityEventItem[]>("rakivinum_cache_community_events_v1");
        return Array.isArray(cachedEvents) ? cachedEvents : [];
      }
      try {
        return await fetchCommunityEvents({
          limitCount: EVENTS_FETCH_LIMIT,
          cacheKey: "rakivinum_cache_community_events_v1",
          ttlMs: CACHE_TTL.COMMUNITY_EVENTS_6H,
        });
      } catch {
        const cachedEvents = readCache<CommunityEventItem[]>("rakivinum_cache_community_events_v1");
        return cachedEvents || [];
      }
    },
    initialData: readCache<CommunityEventItem[]>("rakivinum_cache_community_events_v1") || [],
    ...stableQueryOptions(CACHE_TTL.COMMUNITY_EVENTS_6H),
  });

  const ratings = ratingsQuery.data ?? ratingsSeed;
  const loading = ratingsQuery.isFetching && ratings.length === 0;
  const products = catalogQuery.data?.products ?? [];
  const distilleries = catalogQuery.data?.distilleries ?? [];
  const communityEvents = eventsQuery.data ?? [];
  const isCatalogLoaded = catalogQuery.isSuccess || catalogQuery.isError;

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
    if (lastLocationSearchRef.current === locationSearch) return;
    lastLocationSearchRef.current = locationSearch;
    const params = new URLSearchParams(locationSearch);
    const tab = params.get("tab");
    if (tab === "search") {
      const q = params.get("q");
      const pf = params.get("pf");
      const allowed = new Set(COMMUNITY_FILTER_OPTIONS.map((x) => x.id));
      if (typeof q === "string") setSearchQuery(q);
      if (pf && allowed.has(pf)) setActiveProductFilter(pf);
    }
    if (tab === "compare") {
      const cf = params.get("cf");
      const allowed = new Set(COMMUNITY_COMPARE_FILTER_OPTIONS.map((x) => x.id));
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
  }, [locationSearch]);

  useEffect(() => {
    const persistTimer = window.setTimeout(() => {
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
    }, 500);

    return () => {
      window.clearTimeout(persistTimer);
    };
  }, [compareFilter, compareLeftQuery, compareRightQuery, compareLeftId, compareRightId]);

  return {
    activeSection,
    ratings,
    loading,
    searchQuery,
    setSearchQuery,
    products,
    distilleries,
    activeProductFilter,
    setActiveProductFilter,
    producerView,
    setProducerView,
    selectedRegion,
    setSelectedRegion,
    communityEvents,
    eventsView,
    setEventsView,
    isCatalogLoaded,
    producerSearch,
    setProducerSearch,
    compareFilter,
    setCompareFilter,
    compareLeftQuery,
    setCompareLeftQuery,
    compareRightQuery,
    setCompareRightQuery,
    compareLeftId,
    setCompareLeftId,
    compareRightId,
    setCompareRightId,
  };
}
