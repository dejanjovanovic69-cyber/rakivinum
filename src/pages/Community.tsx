import { useNavigate, useLocation } from "react-router-dom";
import React, { useCallback, useMemo } from "react";
import { db } from "../lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { cn } from "../lib/utils";
import ReviewsTab from "../components/community/ReviewsTab";
import EventsTab from "../components/community/EventsTab";
import CompareTab from "../components/community/CompareTab";
import ProducersTab from "../components/community/ProducersTab";
import TopsTab from "../components/community/TopsTab";
import SearchResultsTab from "../components/community/SearchResultsTab";
import CommunityTabBar from "../components/community/CommunityTabBar";
import {
  COMMUNITY_COMPARE_FILTER_OPTIONS,
  COMMUNITY_FILTER_OPTIONS,
} from "../components/community/constants";
import type { CommunitySection, ProductItem } from "../components/community/types";
import { useCommunityData } from "../hooks/useCommunityData";
import {
  buildCompareCandidateList,
  findCompareMatches,
  distLocation,
  formatRatingDate,
  isWineProduct,
  matchesProductFilter,
  metricVal,
  normalizeText,
  safeStr,
} from "../components/community/utils";

const COMMUNITY_RETURN_REVIEWS = "/community?tab=reviews";
const COMMUNITY_RETURN_TOPS = "/community?tab=tops";

export default function Community() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
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
  } = useCommunityData(location.search);

  const ratedProductsFallback = useMemo(() => {
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

  const catalogProducts = useMemo(
    () => (products.length > 0 ? products : ratedProductsFallback),
    [products, ratedProductsFallback],
  );

  const nq = useMemo(() => normalizeText(searchQuery), [searchQuery]);
  const filteredProducts = useMemo(
    () =>
      catalogProducts.filter((p) => {
        const matchesSearch =
          normalizeText(p.name).includes(nq) ||
          normalizeText(p.type).includes(nq) ||
          normalizeText(p.category).includes(nq);
        return matchesSearch && matchesProductFilter(p, activeProductFilter);
      }),
    [catalogProducts, nq, activeProductFilter],
  );
  const filteredDistilleries = useMemo(
    () =>
      distilleries.filter((d) => {
        const loc = typeof d.location === "object" && d.location !== null ? d.location : null;
        return (
          normalizeText(d.name).includes(nq) ||
          normalizeText(loc?.address).includes(nq) ||
          normalizeText(loc?.city).includes(nq) ||
          normalizeText(d.region).includes(nq)
        );
      }),
    [distilleries, nq],
  );
  const filteredMapDistilleries = useMemo(
    () =>
      distilleries
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
          return (
            normalizeText(d.name).includes(q) ||
            normalizeText(d.region).includes(q) ||
            normalizeText(loc?.city).includes(q) ||
            normalizeText(loc?.address).includes(q)
          );
        }),
    [distilleries, selectedRegion, producerSearch],
  );

  const visibleEvents = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return eventsView === "active"
      ? communityEvents.filter((ev) => !ev.eventDate || String(ev.eventDate) >= todayIso)
      : communityEvents.filter((ev) => ev.eventDate && String(ev.eventDate) < todayIso);
  }, [communityEvents, eventsView]);

  const hasSearchQuery = useMemo(() => searchQuery.trim() !== "", [searchQuery]);
  const isResultsMode = activeSection === "search";
  const activeProductIds = useMemo(() => new Set(catalogProducts.map((p) => p.id)), [catalogProducts]);
  // If catalog is unavailable/empty, never hide existing ratings.
  const visibleRatings = useMemo(
    () => (activeProductIds.size > 0 ? ratings.filter((r) => activeProductIds.has(r.productId)) : ratings),
    [activeProductIds, ratings],
  );

  const handleReport = useCallback(async (e: React.MouseEvent, ratingId: string) => {
    e.stopPropagation();
    if (!window.confirm("Da li želite da prijavite ovaj komentar kao neprimeren?")) return;
    try {
      await updateDoc(doc(db, "ratings", ratingId), { isFlagged: true, flaggedBy: "community_report", flaggedAt: new Date().toISOString() });
      alert("Hvala na prijavi. Administratori će pregledati ovaj sadržaj.");
    } catch (err) {
      console.error("Greška pri prijavi:", err);
    }
  }, []);

  /* ── shared helpers ── */
  const tabCls = useCallback(
    (active: boolean) =>
      cn(
        "flex-1 py-2.5 text-[11px] font-black uppercase tracking-wide rounded-xl transition-all duration-200 active:scale-[0.98]",
        active ? "bg-gold-500 text-black shadow-[0_4px_12px_rgba(212,175,55,0.22)]" : "text-text-secondary hover:text-white",
      ),
    [],
  );

  const topRakija = useMemo(
    () =>
      catalogProducts
        .filter((p) => !isWineProduct(p) && (p.averageRating || 0) > 0)
        .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
        .slice(0, 10),
    [catalogProducts],
  );

  const topVina = useMemo(
    () =>
      catalogProducts
        .filter((p) => isWineProduct(p) && (p.averageRating || 0) > 0)
        .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
        .slice(0, 10),
    [catalogProducts],
  );

  const comparePool = useMemo(
    () =>
      catalogProducts
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
        .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "sr")),
    [catalogProducts, compareFilter],
  );

  const compareLeft = useMemo(
    () => comparePool.find((p) => p.id === compareLeftId) || null,
    [comparePool, compareLeftId],
  );
  const compareRight = useMemo(
    () => comparePool.find((p) => p.id === compareRightId) || null,
    [comparePool, compareRightId],
  );
  const compareLeftMatches = useMemo(
    () => findCompareMatches(comparePool, compareLeftQuery, compareRightId),
    [comparePool, compareLeftQuery, compareRightId],
  );
  const compareRightMatches = useMemo(
    () => findCompareMatches(comparePool, compareRightQuery, compareLeftId),
    [comparePool, compareRightQuery, compareLeftId],
  );
  const leftCandidateList = useMemo(
    () => buildCompareCandidateList(comparePool, compareLeftQuery, compareLeftMatches, compareRightId),
    [comparePool, compareLeftQuery, compareLeftMatches, compareRightId],
  );
  const rightCandidateList = useMemo(
    () => buildCompareCandidateList(comparePool, compareRightQuery, compareRightMatches, compareLeftId),
    [comparePool, compareRightQuery, compareRightMatches, compareLeftId],
  );

  const resetCompareSelection = useCallback(() => {
    setCompareLeftId("");
    setCompareRightId("");
    setCompareLeftQuery("");
    setCompareRightQuery("");
  }, [setCompareLeftId, setCompareRightId, setCompareLeftQuery, setCompareRightQuery]);

  const searchReturnTo = useMemo(
    () =>
      `/community?tab=search&q=${encodeURIComponent(searchQuery)}&pf=${encodeURIComponent(activeProductFilter)}`,
    [searchQuery, activeProductFilter],
  );

  const openLabelWithReturn = useCallback(
    (productId: string, returnTo: string) => {
      const href = `/label/${productId}?rt=${encodeURIComponent(returnTo)}`;
      try {
        sessionStorage.setItem("rakivinum_last_label_return_v1", returnTo);
        sessionStorage.setItem("rakivinum_last_community_return_v1", returnTo);
        const tab = returnTo.includes("tab=") ? returnTo.split("tab=")[1]?.split("&")[0] : activeSection;
        if (tab) sessionStorage.setItem("rakivinum_last_community_tab_v1", tab);
      } catch {
        // best effort
      }
      navigate(href, { state: { returnTo } });
    },
    [navigate, activeSection],
  );

  const navigateToReviews = useCallback(() => {
    navigate("/community?tab=reviews", { replace: true });
  }, [navigate]);

  const handleTabSelect = useCallback(
    (section: CommunitySection) => {
      navigate(`/community?tab=${section}`, { replace: true });
    },
    [navigate],
  );

  const openDistillery = useCallback(
    (distilleryId: string) => {
      navigate(`/distillery/${distilleryId}`);
    },
    [navigate],
  );

  const resetSearchFilters = useCallback(() => {
    setActiveProductFilter("all");
    setSearchQuery("");
    setSelectedRegion("");
    setProducerView("regions");
  }, [setActiveProductFilter, setSearchQuery, setSelectedRegion, setProducerView]);

  return (
      <div className="p-4 space-y-5 animate-in fade-in duration-300 pb-24">

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="page-title">Zajednica</h2>
        </div>
        <p className="page-subtitle">Utisci, top liste i sertifikovani proizvođači.</p>
      </div>

      {isResultsMode ? (
        <SearchResultsTab
          filterOptions={COMMUNITY_FILTER_OPTIONS}
          activeProductFilter={activeProductFilter}
          setActiveProductFilter={setActiveProductFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filteredProducts={filteredProducts}
          filteredDistilleries={filteredDistilleries}
          hasSearchQuery={hasSearchQuery}
          navigateToReviews={navigateToReviews}
          openLabelWithReturn={openLabelWithReturn}
          searchReturnTo={searchReturnTo}
          openDistillery={openDistillery}
          distLocation={distLocation}
          onResetFilters={resetSearchFilters}
        />

      ) : (
      /* ══ MAIN TABS ══ */
        <div className="space-y-5">

          {/* ── Single flat tab bar ── */}
          <CommunityTabBar activeSection={activeSection} onTabSelect={handleTabSelect} />

          {/* ─── UTISCI TAB ─── */}
          {activeSection === "reviews" && (
            <ReviewsTab
              loading={loading}
              visibleRatings={visibleRatings}
              reviewsReturnTo={COMMUNITY_RETURN_REVIEWS}
              openLabelWithReturn={openLabelWithReturn}
              handleReport={handleReport}
              safeStr={safeStr}
              formatRatingDate={formatRatingDate}
            />
          )}

          {/* ─── TOP LISTE TAB ─── */}
          {activeSection === "tops" && (
            <TopsTab
              topRakija={topRakija}
              topVina={topVina}
              topsReturnTo={COMMUNITY_RETURN_TOPS}
              openLabelWithReturn={openLabelWithReturn}
            />
          )}

          {/* ─── UPOREDI TAB ─── */}
          {activeSection === "compare" && (
            <CompareTab
              compareFilter={compareFilter}
              compareFilterOptions={COMMUNITY_COMPARE_FILTER_OPTIONS}
              setCompareFilter={setCompareFilter}
              resetCompareSelection={resetCompareSelection}
              compareLeftQuery={compareLeftQuery}
              setCompareLeftQuery={setCompareLeftQuery}
              compareRightQuery={compareRightQuery}
              setCompareRightQuery={setCompareRightQuery}
              compareLeftId={compareLeftId}
              setCompareLeftId={setCompareLeftId}
              compareRightId={compareRightId}
              setCompareRightId={setCompareRightId}
              leftCandidateList={leftCandidateList}
              rightCandidateList={rightCandidateList}
              compareLeft={compareLeft}
              compareRight={compareRight}
              metricVal={metricVal}
              openLabelWithReturn={openLabelWithReturn}
            />
          )}

          {/* ─── PROIZVOĐAČI TAB ─── */}
          {activeSection === "producers" && (
            <ProducersTab
              distilleries={distilleries}
              producerView={producerView}
              setProducerView={setProducerView}
              selectedRegion={selectedRegion}
              setSelectedRegion={setSelectedRegion}
              producerSearch={producerSearch}
              setProducerSearch={setProducerSearch}
              filteredMapDistilleries={filteredMapDistilleries}
              isCatalogLoaded={isCatalogLoaded}
              tabCls={tabCls}
              onOpenDistillery={openDistillery}
            />
          )}

          {/* ─── DOGAĐAJI TAB ─── */}
          {activeSection === "events" && (
            <EventsTab eventsView={eventsView} setEventsView={setEventsView} visibleEvents={visibleEvents} />
          )}

        </div>
      )}

    </div>
  );
}
