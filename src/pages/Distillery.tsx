import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";
import { auth, db } from "../lib/firebase";
import { doc, collection, addDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { ArrowLeft, MapPin, Globe, Loader2, Star, Hexagon, CheckCircle, Phone, Mail, Award, History, Info, Users, ImageIcon, Share2, X } from "lucide-react";
import { cn } from "../lib/utils";
import { recordClubMembershipAchievement } from "../lib/achievements";
import { shouldRunRefresh } from "../lib/refreshGate";
import { REFRESH_INTERVAL } from "../lib/cachePolicy";
import { readCache, writeCache } from "../lib/resilience";
import {
  fetchPublicClubMembershipCount,
  fetchPublicClubMembershipsByVisitorId,
  fetchPublicDistilleryById,
  fetchPublicProductsByDistilleryId,
  stripHttpProductImgUrl,
} from "../lib/dataService";
import { RAKIVINUM_MARK_FALLBACK, isImgFallbackUrl } from "../lib/imageFallback";

type DistilleryProfile = {
  id: string;
  name?: string;
  logoUrl?: string;
  mapsUrl?: string;
  website?: string;
  phone?: string;
  email?: string;
  isArchived?: boolean;
  isVerified?: boolean;
  region?: string;
  story?: string;
  description?: string;
  specificNotes?: string;
  galleryImages?: string[];
  location?: {
    city?: string;
    address?: string;
  };
  contact?: {
    website?: string;
    phone?: string;
    email?: string;
  };
};

type ProductCard = {
  id: string;
  name?: string;
  type?: string;
  image?: string;
  bottleImageUrl?: string;
  galleryImages?: unknown[];
  alcoholPercentage?: number;
  averageRating?: number;
  isApproved?: boolean;
  isArchivedByDistillery?: boolean;
  publicLabelDisabled?: boolean;
};

function pickDistilleryProductThumb(p: ProductCard): string {
  const a = stripHttpProductImgUrl(p.bottleImageUrl);
  const b = stripHttpProductImgUrl(p.image);
  if (a) return a;
  if (b) return b;
  const g = p.galleryImages;
  if (Array.isArray(g)) {
    for (const x of g) {
      if (typeof x === "string") {
        const s = stripHttpProductImgUrl(x);
        if (s) return s;
      }
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const o = x as Record<string, unknown>;
        for (const k of ["url", "src", "href", "image"] as const) {
          const s = stripHttpProductImgUrl(o[k]);
          if (s) return s;
        }
      }
    }
  }
  return RAKIVINUM_MARK_FALLBACK;
}

function mergeDistilleryProductPages(prev: ProductCard[], more: ProductCard[]): ProductCard[] {
  const seen = new Set(prev.map((p) => p.id));
  const out = [...prev];
  for (const p of more) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

const DISTILLERY_PRODUCTS_PAGE_SIZE = 6;

function tabFromSearch(search: string): "products" | "about" {
  const t = new URLSearchParams(search).get("tab");
  return t === "about" ? "about" : "products";
}

export default function Distillery() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const buildReturnTo = (tab: "products" | "about") => `/distillery/${id}?tab=${tab}`;
  const openLabelWithReturn = (productId: string) => {
    const returnTo = buildReturnTo(activeTab);
    try {
      sessionStorage.setItem("rakivinum_last_label_return_v1", returnTo);
    } catch {
      // ignore storage errors
    }
    navigate(`/label/${productId}?rt=${encodeURIComponent(returnTo)}`, {
      state: { returnTo },
    });
  };
  const goBackSafe = () => {
    const navState = location.state as { returnTo?: string } | null;
    if (navState?.returnTo) {
      navigate(navState.returnTo);
      return;
    }
    const returnToFromQuery = new URLSearchParams(location.search).get("rt");
    if (returnToFromQuery) {
      navigate(returnToFromQuery);
      return;
    }
    navigate("/distilleries", { replace: true });
  };
  
  const [distillery, setDistillery] = useState<DistilleryProfile | null>(null);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"products" | "about">(() => tabFromSearch(location.search));
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    if (tab === "about" || tab === "products") {
      setActiveTab(tab);
    }
  }, [location.search]);

  const [isMember, setIsMember] = useState(false);
  const [membershipDocId, setMembershipDocId] = useState<string | null>(null);
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [activeGalleryImage, setActiveGalleryImage] = useState<string | null>(null);
  const productsRef = useRef<ProductCard[]>([]);
  productsRef.current = products;

  const loadMoreLock = useRef(false);
  const loadMoreProducts = useCallback(async () => {
    if (!id || activeTab !== "products" || !hasMoreProducts || loadMoreLock.current) return;
    const lastId = productsRef.current.at(-1)?.id;
    if (!lastId) return;
    loadMoreLock.current = true;
    setIsLoadingMore(true);
    try {
      const more = (await fetchPublicProductsByDistilleryId(
        id,
        DISTILLERY_PRODUCTS_PAGE_SIZE,
        lastId,
      )) as ProductCard[];
      const cacheKey = `rakivinum_cache_distillery_products_${id}_v2`;
      setProducts((prev) => {
        const merged = mergeDistilleryProductPages(prev, more);
        writeCache(cacheKey, merged, REFRESH_INTERVAL.USER_LIGHT_1H);
        return merged;
      });
      setHasMoreProducts(more.length >= DISTILLERY_PRODUCTS_PAGE_SIZE);
    } catch (e) {
      console.error("Load more distillery products failed", e);
    } finally {
      loadMoreLock.current = false;
      setIsLoadingMore(false);
    }
  }, [id, activeTab, hasMoreProducts]);

  useEffect(() => {
    if (activeTab !== "products" || !hasMoreProducts || !id) return;
    const el = loadMoreSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        void loadMoreProducts();
      },
      { root: null, rootMargin: "200px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeTab, hasMoreProducts, id, loadMoreProducts]);

  const resolvedMapsUrl =
    String(distillery?.mapsUrl || "").trim() ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      (distillery?.location?.city ? `${distillery.location.city} ` : "") + (distillery?.location?.address || distillery?.name || "Srbija")
    )}`;
  const handleShareDistillery = async () => {
    const shareUrl = window.location.href;
    const shareTitle = `${distillery?.name || "Destilerija"} • Rakivinum`;
    const shareText = `Pogledaj profil proizvođača ${distillery?.name || ""} u Rakivinum aplikaciji.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      }
    } catch (err: unknown) {
      const e = err as { name?: string } | null;
      if (String(e?.name || "").toLowerCase().includes("abort")) return;
      console.warn("Native share failed, fallback to clipboard", err);
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link destilerije je kopiran.");
    } catch (err) {
      console.error("Copy share link failed", err);
      alert("Deljenje trenutno nije dostupno na ovom uređaju.");
    }
  };

  useEffect(() => {
    const visitorId = localStorage.getItem('rakivinum_visitor_id');
    const profileCacheKey = id ? `rakivinum_cache_distillery_profile_${id}_v1` : null;
    const productsCacheKey = id ? `rakivinum_cache_distillery_products_${id}_v2` : null;
    const memberCountCacheKey = id ? `rakivinum_cache_distillery_member_count_${id}_v1` : null;
    const membershipCacheKey = id && visitorId ? `rakivinum_cache_distillery_membership_${id}_${visitorId}_v1` : null;
    
    async function fetchData(background = false) {
      if (!id) return;
      if (!background) setIsLoading(true);
      try {
        // Fetch Distillery Profile
        const dData = await fetchPublicDistilleryById(id) as DistilleryProfile | null;
        if (dData) {
          if (dData.isArchived) {
            setDistillery(null);
            setProducts([]);
            setHasMoreProducts(false);
            return;
          }
          if (!dData.isVerified) {
            setDistillery(null);
            setProducts([]);
            setHasMoreProducts(false);
            return;
          }
          setDistillery(dData);
          if (profileCacheKey) writeCache(profileCacheKey, dData, REFRESH_INTERVAL.USER_LIGHT_1H);
        } else {
          setDistillery(null);
          setProducts([]);
          setHasMoreProducts(false);
          return;
        }

        // Katalog: samo na tabu „Proizvodi“ (tab „O nama“ ne treba do 100 read-ova za listu proizvoda).
        if (activeTab === "products") {
          const filteredProducts = (await fetchPublicProductsByDistilleryId(id, DISTILLERY_PRODUCTS_PAGE_SIZE)) as ProductCard[];
          setProducts(filteredProducts);
          setHasMoreProducts(filteredProducts.length >= DISTILLERY_PRODUCTS_PAGE_SIZE);
          if (productsCacheKey) writeCache(productsCacheKey, filteredProducts, REFRESH_INTERVAL.USER_LIGHT_1H);
        } else {
          setHasMoreProducts(false);
        }
      } catch (err) {
        console.error("Error fetching distillery data", err);
        const cachedProfile = profileCacheKey ? readCache<DistilleryProfile>(profileCacheKey) : null;
        const cachedProducts = productsCacheKey ? readCache<ProductCard[]>(productsCacheKey) : null;
        if (cachedProfile) setDistillery(cachedProfile);
        if (cachedProducts) setProducts(cachedProducts);
      } finally {
        if (!background) setIsLoading(false);
      }
    }
    
    // Controlled refresh for membership & count (lower read pressure than live listener).
    if (!id) return;
    const refreshMembership = async () => {
      try {
        if (!visitorId || !id) {
          setIsMember(false);
          setMembershipDocId(null);
          return;
        }
        const memberships = await fetchPublicClubMembershipsByVisitorId(visitorId, 30);
        const membershipRow = memberships.find((m) => m.distilleryId === id);
        const joined = Boolean(membershipRow);
        setIsMember(joined);
        setMembershipDocId(typeof membershipRow?.id === "string" ? membershipRow.id : null);
        if (membershipCacheKey) writeCache(membershipCacheKey, joined, REFRESH_INTERVAL.USER_LIGHT_1H);

        const storageKey = `clubs_${visitorId}`;
        let clubs = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (joined) {
          if (!clubs.includes(id)) {
            clubs.push(id);
            localStorage.setItem(storageKey, JSON.stringify(clubs));
          }
        } else if (clubs.includes(id)) {
          clubs = clubs.filter((c: string) => c !== id);
          localStorage.setItem(storageKey, JSON.stringify(clubs));
        }
      } catch (err) {
        console.error("Error refreshing membership", err);
        const cachedMembership = membershipCacheKey ? readCache<boolean>(membershipCacheKey) : null;
        if (typeof cachedMembership === "boolean") setIsMember(cachedMembership);
        if (cachedMembership === false) setMembershipDocId(null);
      }
    };

    const refreshTotalMembers = async () => {
      try {
        const count = await fetchPublicClubMembershipCount(id);
        setTotalMembers(count);
        if (memberCountCacheKey) writeCache(memberCountCacheKey, count, REFRESH_INTERVAL.USER_LIGHT_1H);
      } catch (err) {
        console.error("Error counting members", err);
        const cachedCount = memberCountCacheKey ? readCache<number>(memberCountCacheKey) : null;
        if (typeof cachedCount === "number") setTotalMembers(cachedCount);
      }
    };
    const cachedProfile = profileCacheKey ? readCache<DistilleryProfile>(profileCacheKey) : null;
    const cachedProducts = productsCacheKey ? readCache<ProductCard[]>(productsCacheKey) : null;
    const cachedMembership = membershipCacheKey ? readCache<boolean>(membershipCacheKey) : null;
    const cachedCount = memberCountCacheKey ? readCache<number>(memberCountCacheKey) : null;
    if (cachedProfile) setDistillery(cachedProfile);
    if (cachedProducts) setProducts(cachedProducts);
    else setProducts([]);
    if (cachedProfile) setIsLoading(false);
    if (typeof cachedMembership === "boolean") setIsMember(cachedMembership);
    if (typeof cachedCount === "number") setTotalMembers(cachedCount);

    const shouldWarmNow = shouldRunRefresh(`distillery:${id || "unknown"}:initial`, REFRESH_INTERVAL.USER_LIGHT_1H);
    const needProfileWarm = !cachedProfile || shouldWarmNow;
    const needProductsWarm = activeTab === "products" && (!cachedProducts || shouldWarmNow);
    if (needProfileWarm || needProductsWarm) {
      void fetchData(Boolean(cachedProfile && (activeTab === "about" || !!cachedProducts)));
    }
    if (typeof cachedMembership !== "boolean" || shouldWarmNow) void refreshMembership();
    if (typeof cachedCount !== "number" || shouldWarmNow) void refreshTotalMembers();
    const onFocusRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (!shouldRunRefresh(`distillery:${id || "unknown"}:members-focus`, REFRESH_INTERVAL.USER_LIGHT_1H)) return;
      void refreshMembership();
      void refreshTotalMembers();
    };
    const onVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      onFocusRefresh();
    };
    window.addEventListener("focus", onFocusRefresh);
    document.addEventListener("visibilitychange", onVisibilityRefresh);

    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      document.removeEventListener("visibilitychange", onVisibilityRefresh);
    };
  }, [id, activeTab]);

  const [isJoining, setIsJoining] = useState(false);

  const toggleClubMembership = async () => {
    if (isJoining) return;
    const visitorId = localStorage.getItem("rakivinum_visitor_id");
    if (!visitorId) {
      alert("Potreban je identifikator uređaja za članstvo u klubu.");
      return;
    }
    const storageKey = `clubs_${visitorId}`;
    let clubs = JSON.parse(localStorage.getItem(storageKey) || "[]");

    setIsJoining(true);
    try {
      if (isMember) {
        // LEAVE CLUB
        let removedAny = false;
        if (membershipDocId) {
          await deleteDoc(doc(db, "club_memberships", membershipDocId));
          removedAny = true;
        } else {
          const memberships = await fetchPublicClubMembershipsByVisitorId(visitorId, 80);
          const toRemove = memberships.filter((m) => m.distilleryId === id && m.id);
          await Promise.all(toRemove.map((m) => deleteDoc(doc(db, "club_memberships", String(m.id)))));
          removedAny = toRemove.length > 0;
        }

        clubs = clubs.filter((cid: string) => cid !== id);
        setIsMember(false);
        setMembershipDocId(null);
        if (removedAny) {
          setTotalMembers((prev) => (typeof prev === "number" ? Math.max(0, prev - 1) : prev));
        }
      } else {
        // JOIN CLUB
        if (clubs.length >= 5) {
          alert("Možete biti član najviše 5 klubova istovremeno. Odjavite se iz nekog kluba kako biste se učlanili u novi.");
          setIsJoining(false);
          return;
        }

        const existing = await fetchPublicClubMembershipsByVisitorId(visitorId, 80);
        const existingMatch = existing.find((m) => m.distilleryId === id);
        const already = Boolean(existingMatch);
        if (!already) {
          const newRef = await addDoc(collection(db, "club_memberships"), {
            visitorId,
            distilleryId: id,
            createdAt: serverTimestamp(),
          });
          setMembershipDocId(newRef.id);
        } else {
          setMembershipDocId(typeof existingMatch?.id === "string" ? existingMatch.id : null);
        }

        if (id && !clubs.includes(id)) {
          clubs.push(id);
        }
        setIsMember(true);
        if (!already) {
          setTotalMembers((prev) => (typeof prev === "number" ? prev + 1 : prev));
        }
        recordClubMembershipAchievement(clubs.length);
        alert(`Dobrodošli u ${distillery?.name} klub! Od sada ćete dobijati ekskluzivne pogodnosti ovog proizvođača.`);
      }
      localStorage.setItem(storageKey, JSON.stringify(clubs));
    } catch (e) {
      console.error("Error toggling membership", e);
      alert("Došlo je do greške. Molimo pokušajte ponovo.");
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-bg-base flex flex-col items-center justify-center p-4">
         <Loader2 className="w-12 h-12 text-gold-500 animate-spin mb-4" />
         <p className="text-gold-500 font-medium">Učitavanje proizvođača...</p>
      </div>
    );
  }

  if (!distillery) {
    return (
      <div className="min-h-[100dvh] bg-bg-base flex flex-col items-center justify-center p-6 text-center">
        <div className="empty-state card-elevated max-w-md w-full space-y-5 rounded-[28px] p-10">
          <p className="text-white text-xl font-bold">Proizvođač nije dostupan</p>
          <p className="text-text-secondary text-sm leading-relaxed">
            Profil nije u javnom katalogu (arhiviran proizvođač ili još uvek bez javnog sertifikata u Rakivinum mreži).
          </p>
          <button type="button" onClick={goBackSafe} className="w-full py-3 btn-primary text-xs">
            Nazad
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-bg-base pb-20">
      {/* Header Overlay */}
      <div className="relative h-64 w-full bg-bg-card-elevated border-b border-border-gold overflow-hidden">
        {distillery.logoUrl && (
           <img 
             src={distillery.logoUrl} 
             alt={distillery.name} 
             className="absolute inset-0 w-full h-full object-cover media-crisp opacity-20 blur-sm" 
           />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-base to-transparent" />
        
        <button
          type="button"
          onClick={goBackSafe}
          className="absolute top-6 left-4 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-black/50 border border-border-subtle text-white backdrop-blur-md transition-colors hover:text-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={handleShareDistillery}
          className="absolute top-6 right-4 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-black/50 border border-border-subtle text-white backdrop-blur-md transition-colors hover:text-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
          title="Podeli destileriju"
        >
          <Share2 className="w-5 h-5" />
        </button>

        <div className="absolute bottom-6 left-6 right-6 z-20 flex gap-4 items-end">
          <div className="w-24 h-24 bg-bg-card border-2 border-gold-500 rounded-full flex items-center justify-center shadow-2xl overflow-hidden shrink-0 relative group p-2 card-elevated">
             {distillery.logoUrl ? (
               <img src={distillery.logoUrl} alt={distillery.name} className="w-full h-full object-contain media-crisp" />
             ) : (
               <span className="text-gold-500 text-3xl font-serif">{distillery.name?.charAt(0) || "D"}</span>
             )}
          </div>
          <div className="pb-1">
            <h1 className="text-2xl font-serif font-bold text-white leading-tight flex flex-wrap items-center gap-2">
              {distillery.name}
              {distillery.isVerified && (
                <div className="inline-flex items-center gap-1.5 bg-green-500/10 backdrop-blur-md px-2.5 py-1 rounded-full border border-green-500/20 text-green-500">
                  <CheckCircle className="w-3.5 h-3.5 fill-current" />
                  <span className="text-[10px] font-semibold uppercase tracking-tighter">Sertifikovan Proizvođač</span>
                </div>
              )}
            </h1>
            <p className="text-sm text-gold-500 flex items-center gap-1 mt-1 font-medium">
              <MapPin className="w-3.5 h-3.5" /> 
              {distillery.location?.city ? `${distillery.location.city}, ` : ''}
              {distillery.location?.address || distillery.region || "Srbija"}
            </p>
            {totalMembers !== null && (
              <p className="text-[10px] text-text-secondary mt-1 font-bold uppercase tracking-wider flex items-center gap-1.5 opacity-80">
                <Users className="w-3 h-3 text-gold-500/50" /> {totalMembers} {totalMembers === 1 ? 'član' : totalMembers < 5 ? 'člana' : 'članova'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={toggleClubMembership}
            disabled={isJoining}
            className={cn(
              "ml-auto mb-1 shrink-0 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated disabled:opacity-50 disabled:pointer-events-none",
              isMember ? "btn-secondary" : "btn-primary shadow-lg shadow-gold-500/25",
            )}
          >
            {isJoining ? (
              <Loader2 className="w-3 h-3 animate-spin mx-auto" />
            ) : isMember ? (
               <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-3 h-3" /> Član Kluba
               </span>
            ) : "Postani Član Kluba"}
          </button>
        </div>
      </div>

      <div className="p-4 flex gap-2 border-b border-white/10 bg-bg-card-elevated/85 sticky top-0 z-30 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => {
            setActiveTab("products");
            navigate(buildReturnTo("products"), { replace: true });
          }}
          className={`flex-1 py-3 px-4 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated ${
            activeTab === "products"
              ? "bg-gold-500 text-black shadow-lg shadow-gold-500/20"
              : "bg-white/5 text-text-secondary hover:text-white border border-white/10"
          }`}
        >
          Proizvodi
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("about");
            navigate(buildReturnTo("about"), { replace: true });
          }}
          className={`flex-1 py-3 px-4 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated ${
            activeTab === "about"
              ? "bg-gold-500 text-black shadow-lg shadow-gold-500/20"
              : "bg-white/5 text-text-secondary hover:text-white border border-white/10"
          }`}
        >
          O nama
        </button>
      </div>

      <div className="p-6 space-y-7 max-w-lg mx-auto">
        {activeTab === 'products' ? (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
               <Hexagon className="w-5 h-5 text-gold-500" /> Katalog Pića ({products.length})
            </h2>
            
            {products.length > 0 ? (
              <div className="space-y-8">
                {/* RAKIJE */}
                {products.filter(p => !p.type?.toLowerCase().includes('vino') && !p.type?.toLowerCase().includes('wine')).length > 0 && (
                  <div className="space-y-4">
                     <h3 className="text-sm font-black text-text-secondary uppercase tracking-widest border-b border-white/5 pb-2">Destilati i Rakije</h3>
                     <div className="grid grid-cols-2 gap-4">
                       {products.filter(p => !p.type?.toLowerCase().includes('vino') && !p.type?.toLowerCase().includes('wine')).map(prod => (
                         <div 
                           key={prod.id}
                          onClick={() => openLabelWithReturn(prod.id)}
                           className="card-soft card-elevated card-interactive rounded-3xl p-4 flex flex-col items-center gap-3 cursor-pointer hover:border-gold-500/60 hover:scale-[1.02] text-center group shadow-md"
                         >
                           <div className="h-32 w-20 relative rounded-lg overflow-hidden bg-black group-hover:drop-shadow-[0_10px_15px_rgba(212,175,55,0.2)] transition-all">
                             <img
                               src={pickDistilleryProductThumb(prod)}
                               className="h-full w-full object-contain object-center p-1 media-crisp"
                               onError={(e) => {
                                 const el = e.target as HTMLImageElement;
                                 if (isImgFallbackUrl(el.src)) return;
                                 el.src = RAKIVINUM_MARK_FALLBACK;
                               }}
                               alt={prod.name}
                             />
                           </div>
                           <div className="w-full">
                             <p className="text-sm font-black text-white line-clamp-1">{prod.name}</p>
                             <p className="text-[12px] text-text-secondary uppercase font-bold mt-1 tracking-tight">{prod.type} • {prod.alcoholPercentage}% vol</p>
                             {prod.averageRating > 0 && (
                                <div className="inline-flex items-center gap-1 mt-2 bg-gold-500/10 px-2 py-0.5 rounded-full border border-gold-500/20">
                                  <Star className="w-3 h-3 text-gold-500 fill-current" />
                                  <span className="text-[10px] font-black text-gold-500">{prod.averageRating.toFixed(1)}</span>
                                </div>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}

                {/* VINA */}
                {products.filter(p => p.type?.toLowerCase().includes('vino') || p.type?.toLowerCase().includes('wine')).length > 0 && (
                  <div className="space-y-4">
                     <h3 className="text-sm font-black text-text-secondary uppercase tracking-widest border-b border-white/5 pb-2">Vina</h3>
                     <div className="grid grid-cols-2 gap-4">
                       {products.filter(p => p.type?.toLowerCase().includes('vino') || p.type?.toLowerCase().includes('wine')).map(prod => (
                         <div 
                           key={prod.id}
                          onClick={() => openLabelWithReturn(prod.id)}
                           className="card-soft card-elevated card-interactive rounded-3xl p-4 flex flex-col items-center gap-3 cursor-pointer hover:border-gold-500/60 hover:scale-[1.02] text-center group shadow-md"
                         >
                           <div className="h-32 w-20 relative rounded-lg overflow-hidden bg-black group-hover:drop-shadow-[0_10px_15px_rgba(212,175,55,0.2)] transition-all">
                             <img
                               src={pickDistilleryProductThumb(prod)}
                               className="h-full w-full object-contain object-center p-1 media-crisp"
                               onError={(e) => {
                                 const el = e.target as HTMLImageElement;
                                 if (isImgFallbackUrl(el.src)) return;
                                 el.src = RAKIVINUM_MARK_FALLBACK;
                               }}
                               alt={prod.name}
                             />
                           </div>
                           <div className="w-full">
                             <p className="text-sm font-black text-white line-clamp-1">{prod.name}</p>
                             <p className="text-[12px] text-text-secondary uppercase font-bold mt-1 tracking-tight">{prod.type} • {prod.alcoholPercentage}% vol</p>
                             {prod.averageRating > 0 && (
                                <div className="inline-flex items-center gap-1 mt-2 bg-gold-500/10 px-2 py-0.5 rounded-full border border-gold-500/20">
                                  <Star className="w-3 h-3 text-gold-500 fill-current" />
                                  <span className="text-[10px] font-black text-gold-500">{prod.averageRating.toFixed(1)}</span>
                                </div>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}
              </div>
            ) : (
               <div className="empty-state card-elevated border border-border-subtle p-10 rounded-[32px] text-center max-w-md mx-auto space-y-2">
                 <Hexagon className="w-8 h-8 text-gold-500/30 mx-auto" aria-hidden />
                 <p className="text-text-secondary text-sm leading-relaxed">Trenutno nema unetih pića u katalogu.</p>
               </div>
            )}
            {products.length > 0 && hasMoreProducts && (
              <div className="flex flex-col items-center gap-2 pt-2">
                <div ref={loadMoreSentinelRef} className="h-2 w-full shrink-0" aria-hidden />
                {isLoadingMore ? (
                  <Loader2 className="w-5 h-5 animate-spin text-gold-500" aria-label="Učitavanje" />
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             {/* Extended Story */}
             <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                   <History className="w-4 h-4" /> Istorija i Vizija
                </h3>
                <p className="text-white text-base leading-relaxed whitespace-pre-wrap font-medium opacity-90">
                   {distillery.story || distillery.description || "Ovaj proizvođač još uvek nije uneo svoju zvaničnu priču."}
                </p>
             </div>

             {distillery.specificNotes && (
               <>
                 <div className="h-px bg-white/5" />
                 <div className="space-y-4">
                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                     <Info className="w-4 h-4" /> Specifičnosti
                   </h3>
                  <div className="card-soft card-elevated p-4 rounded-[24px] border border-white/10">
                    <p className="text-white text-[15px] leading-relaxed whitespace-pre-wrap">{distillery.specificNotes}</p>
                   </div>
                 </div>
               </>
             )}

             {Array.isArray(distillery.galleryImages) && distillery.galleryImages.length > 0 && (
               <>
                 <div className="h-px bg-white/5" />
                 <div className="space-y-4">
                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                     <Award className="w-4 h-4" /> Foto galerija
                   </h3>
                   <div className="grid grid-cols-2 gap-3">
                    {distillery.galleryImages.map((img: string, idx: number) => (
                      <button
                        key={`${img}-${idx}`}
                        type="button"
                        onClick={() => setActiveGalleryImage(img)}
                        className="block w-full rounded-2xl overflow-hidden border border-white/10 bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                      >
                         <img
                           src={img}
                           alt={`${distillery.name} galerija ${idx + 1}`}
                          className="w-full h-32 object-cover object-center media-crisp hover:scale-[1.03] transition-transform"
                           referrerPolicy="no-referrer"
                         />
                      </button>
                     ))}
                   </div>
                 </div>
               </>
             )}

            {(!Array.isArray(distillery.galleryImages) || distillery.galleryImages.length === 0) && (
              <>
                <div className="h-px bg-white/5" />
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                    <Award className="w-4 h-4" /> Foto galerija
                  </h3>
                  <div className="empty-state card-elevated p-5 rounded-[24px] flex items-center gap-3 border border-white/10">
                    <div className="w-9 h-9 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center text-gold-500/70 shrink-0">
                      <ImageIcon className="w-4 h-4" aria-hidden />
                    </div>
                    <p className="text-sm text-text-secondary leading-snug">Galerija još nije dodata od strane proizvođača.</p>
                  </div>
                </div>
              </>
            )}

             <div className="h-px bg-white/5" />

             {/* Connection Info */}
             <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                   <Phone className="w-4 h-4" /> Kontakt podaci
                </h3>
                <div className="grid gap-3">
                   {distillery.phone && (
                    <a
                      href={`tel:${distillery.phone}`}
                      className="card-soft card-elevated card-interactive flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-500">
                           <Phone className="w-5 h-5" />
                        </div>
                        <div>
                           <p className="text-[12px] uppercase font-bold text-text-secondary">Telefon</p>
                           <p className="text-white font-bold">{distillery.phone}</p>
                        </div>
                     </a>
                   )}
                   {distillery.email && (
                    <a
                      href={`mailto:${distillery.email}`}
                      className="card-soft card-elevated card-interactive flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-500">
                           <Mail className="w-5 h-5" />
                        </div>
                        <div>
                           <p className="text-[12px] uppercase font-bold text-text-secondary">Email adresa</p>
                           <p className="text-white font-bold">{distillery.email}</p>
                        </div>
                     </a>
                   )}
                   {distillery.website && (
                    <a
                      href={distillery.website}
                      target="_blank"
                      rel="noreferrer"
                      className="card-soft card-elevated card-interactive flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-500">
                           <Globe className="w-5 h-5" />
                        </div>
                        <div>
                           <p className="text-[12px] uppercase font-bold text-text-secondary">Veb sajt</p>
                           <p className="text-white font-bold">{distillery.website.replace('https://', '')}</p>
                        </div>
                     </a>
                   )}
                </div>
             </div>

             <div className="h-px bg-white/5" />

             {/* Location Details */}
             <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                   <MapPin className="w-4 h-4" /> Gde se nalazimo
                </h3>
                <div className="card-soft card-elevated p-4 rounded-[24px] border border-white/10 space-y-4">
                   <div className="space-y-1">
                     {distillery.location?.city && <p className="text-white font-medium">{distillery.location?.city}</p>}
                     <p className="text-white font-medium">{distillery.location?.address || distillery.region || "Adresa nije navedena"}</p>
                   </div>
                  {(distillery.location?.address || distillery.name || distillery.mapsUrl) && (
                     <a
                      href={resolvedMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-4 btn-primary text-xs flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/90 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                       <MapPin className="w-4 h-4" /> Otvori u Google Mapama
                     </a>
                   )}
                </div>
             </div>

          </div>
        )}
      </div>

      {activeGalleryImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setActiveGalleryImage(null)}
          role="presentation"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveGalleryImage(null);
            }}
            className="absolute top-4 right-4 z-[121] w-10 h-10 rounded-xl bg-black/60 border border-white/20 text-white flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-black/80"
            aria-label="Zatvori uvećanu sliku"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Klik na samu sliku ne sme da zatvori modal (inače deluje kao „pukao“ lightbox). */}
          <div
            className="flex max-h-[90vh] max-w-[min(100vw-2rem,56rem)] items-center justify-center"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <img
              src={activeGalleryImage}
              alt="Uvećana slika destilerije"
              className="max-h-[88vh] max-w-full object-contain rounded-2xl border border-white/15 shadow-2xl"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

    </div>
  );
}
