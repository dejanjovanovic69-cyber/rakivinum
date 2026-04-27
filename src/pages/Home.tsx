import { ArrowRight, Trophy, Droplet, Flame, ArrowUpRight, Sparkles, Star, Clock, Download, ShieldAlert, X, Gift, Ticket, CheckCircle2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, getDoc, doc, getCountFromServer, orderBy, limit } from "firebase/firestore";
import { cn } from "../lib/utils";
import { isQuotaError, readCache, writeCache } from "../lib/resilience";
import {
  fetchPublicClubActions,
  fetchPublicClubMembershipsByVisitorId,
  fetchPublicDistilleries,
  fetchPublicLicenseByToken,
  fetchPublicProductById,
  fetchPublicProducts,
} from "../lib/dataService";
import { CACHE_TTL, REFRESH_INTERVAL } from "../lib/cachePolicy";
import { meterDbRead } from "../lib/requestMeter";
import { stableQueryOptions } from "../lib/queryDefaults";
import { queryKeys } from "../lib/queryKeys";

type ProductLite = {
  id: string;
  name?: string;
  type?: string;
  category?: string;
  image?: string;
  bottleImageUrl?: string;
  distilleryId?: string;
  averageRating?: number;
};

type DistilleryLite = {
  id: string;
  name?: string;
};

type RecentScanItem = {
  id: string;
  name?: string;
  type?: string;
  image?: string;
};

type ClubActionLite = {
  id: string;
  title?: string;
  distilleryId?: string;
  rewardType?: string;
  isActive?: boolean;
  endsAt?: { toDate?: () => Date } | string | number | Date;
  createdAt?: { toDate?: () => Date } | string | number | Date;
  condition?: string;
  conditionLabel?: string;
  targetScans?: number;
  targetRatings?: number;
  targetValue?: number;
};

function pickFromPool(pool: ProductLite[], historyKey: string): ProductLite | null {
  if (pool.length === 0) return null;
  const today = new Date().toISOString().split("T")[0];
  const raw = localStorage.getItem(historyKey) || "[]";
  const history = (() => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })() as string[];

  const historySet = new Set(history);
  const freshPool = pool.filter((product) => !historySet.has(product.id));
  const candidatePool = freshPool.length > 0 ? freshPool : pool;

  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    hash = today.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash += history.length * 37;
  const picked = candidatePool[Math.abs(hash) % candidatePool.length];

  const nextHistory = [picked.id, ...history.filter((id) => id !== picked.id)].slice(0, 7);
  localStorage.setItem(historyKey, JSON.stringify(nextHistory));
  return picked;
}

export default function Home() {
  const HOME_PUBLIC_DISTILLERIES_LIMIT = 120;
  const HOME_PUBLIC_PRODUCTS_LIMIT = 120;
  const location = useLocation();
  const homeReturnTo = `${location.pathname}${location.search}`;
  const labelHref = (productId: string) => `/label/${productId}?rt=${encodeURIComponent(homeReturnTo)}`;
  const persistLabelReturn = () => {
    try {
      sessionStorage.setItem("rakivinum_last_label_return_v1", homeReturnTo);
    } catch {
      // ignore storage errors
    }
  };
  const [dismissedLicenseWarning, setDismissedLicenseWarning] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>([]);
  const [distilleryMap, setDistilleryMap] = useState<Record<string, string>>({});
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const visitorId = useMemo(() => localStorage.getItem("rakivinum_visitor_id"), []);
  const clubsCacheKey = visitorId ? `rakivinum_cache_home_clubs_${visitorId}_v1` : null;
  const actionsCacheKey = "rakivinum_cache_home_actions_v1";
  const toDateSafe = (value: unknown): Date => {
    if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
      const d = (value as { toDate?: () => Date }).toDate?.();
      return d instanceof Date ? d : new Date(0);
    }
    if (value instanceof Date) return value;
    const d = new Date((value || 0) as string | number | Date);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  };

  const membershipsQuery = useQuery<string[]>({
    queryKey: queryKeys.home.clubs(visitorId),
    enabled: Boolean(visitorId),
    queryFn: async () => {
      if (!visitorId) return [];
      const rows = await fetchPublicClubMembershipsByVisitorId(visitorId, 30);
      const clubs = rows.map((d) => d.distilleryId).filter((x): x is string => typeof x === "string" && x.trim() !== "");
      localStorage.setItem(`clubs_${visitorId}`, JSON.stringify(clubs));
      if (clubsCacheKey) writeCache(clubsCacheKey, clubs, REFRESH_INTERVAL.USER_LIGHT_1H);
      return clubs;
    },
    initialData: clubsCacheKey ? (readCache<string[]>(clubsCacheKey) || []) : [],
    ...stableQueryOptions(REFRESH_INTERVAL.USER_LIGHT_1H),
  });

  const actionsQuery = useQuery<ClubActionLite[]>({
    queryKey: queryKeys.home.actions(),
    queryFn: async () => {
      const actions = await fetchPublicClubActions(20) as ClubActionLite[];
      const filteredActions = actions
        .filter((action) => {
          if (!action.endsAt) return true;
          const end = toDateSafe(action.endsAt);
          return end > new Date();
        })
        .sort((a, b) => toDateSafe(b.createdAt).getTime() - toDateSafe(a.createdAt).getTime());
      writeCache(actionsCacheKey, filteredActions, REFRESH_INTERVAL.USER_LIGHT_1H);
      return filteredActions;
    },
    initialData: readCache<ClubActionLite[]>(actionsCacheKey) || [],
    ...stableQueryOptions(REFRESH_INTERVAL.USER_LIGHT_1H),
  });

  const distilleryMapQuery = useQuery<Record<string, string>>({
    queryKey: queryKeys.home.distilleryMap(HOME_PUBLIC_DISTILLERIES_LIMIT),
    queryFn: async () => {
      const distilleries = await fetchPublicDistilleries({
        limitCount: HOME_PUBLIC_DISTILLERIES_LIMIT,
        cacheKey: "rakivinum_cache_home_distillery_list_v1",
        ttlMs: CACHE_TTL.DISTILLERY_LIST_6H,
      });
      const map: Record<string, string> = {};
      distilleries.forEach((d: DistilleryLite) => {
        map[d.id] = String(d.name || "");
      });
      writeCache("rakivinum_cache_home_distillery_map_v1", map, CACHE_TTL.HOME_DISTILLERY_MAP_6H);
      return map;
    },
    initialData: readCache<Record<string, string>>("rakivinum_cache_home_distillery_map_v1") || {},
    ...stableQueryOptions(CACHE_TTL.HOME_DISTILLERY_MAP_6H),
  });

  useEffect(() => {
    if (membershipsQuery.error && isQuotaError(membershipsQuery.error)) setQuotaExceeded(true);
  }, [membershipsQuery.error]);

  useEffect(() => {
    if (actionsQuery.error && isQuotaError(actionsQuery.error)) setQuotaExceeded(true);
  }, [actionsQuery.error]);

  useEffect(() => {
    if (distilleryMapQuery.error && isQuotaError(distilleryMapQuery.error)) setQuotaExceeded(true);
  }, [distilleryMapQuery.error]);

  useEffect(() => {
    setDistilleryMap(distilleryMapQuery.data || {});
  }, [distilleryMapQuery.data]);

  const joinedClubs = membershipsQuery.data || [];
  const activeActions = actionsQuery.data || [];

  const recommendationQuery = useQuery<{ rakija: ProductLite | null; vino: ProductLite | null }>({
    queryKey: queryKeys.home.recommendations(HOME_PUBLIC_PRODUCTS_LIMIT, HOME_PUBLIC_DISTILLERIES_LIMIT),
    queryFn: async () => {
      const [products, distilleries] = await Promise.all([
        fetchPublicProducts({
          limitCount: HOME_PUBLIC_PRODUCTS_LIMIT,
          cacheKey: "rakivinum_cache_home_products_v1",
          ttlMs: CACHE_TTL.HOME_RECOMMENDATIONS_6H,
        }),
        fetchPublicDistilleries({
          limitCount: HOME_PUBLIC_DISTILLERIES_LIMIT,
          cacheKey: "rakivinum_cache_home_distillery_list_v1",
          ttlMs: CACHE_TTL.DISTILLERY_LIST_6H,
        }),
      ]);

      const topDistilleries = (distilleries as DistilleryLite[]).slice(0, 5);
      writeCache("rakivinum_cache_home_distilleries_v1", topDistilleries, CACHE_TTL.DISTILLERY_LIST_6H);

      const publicDistilleryIds = new Set(distilleries.map((d: DistilleryLite) => d.id));
      const eligibleProducts = (products as ProductLite[]).filter((p) => p.distilleryId && publicDistilleryIds.has(p.distilleryId));
      const normalize = (v: unknown) => String(v || "").toLowerCase();
      const isWine = (p: ProductLite) => {
        const text = `${normalize(p.type)} ${normalize(p.category)} ${normalize(p.name)}`;
        return text.includes("vino") || text.includes("wine");
      };
      const winePool = eligibleProducts.filter(isWine);
      const rakijaPool = eligibleProducts.filter((p) => !isWine(p));
      const pickedRakija = pickFromPool(rakijaPool, "rakivinum_rec_history_rakija");
      const pickedVino = pickFromPool(winePool, "rakivinum_rec_history_vino");
      const payload = { rakija: pickedRakija, vino: pickedVino };
      writeCache("rakivinum_cache_home_recommendation_v1", payload, CACHE_TTL.HOME_RECOMMENDATIONS_6H);
      return payload;
    },
    initialData: readCache<{ rakija: ProductLite | null; vino: ProductLite | null }>("rakivinum_cache_home_recommendation_v1") || {
      rakija: null,
      vino: null,
    },
    ...stableQueryOptions(CACHE_TTL.HOME_RECOMMENDATIONS_6H),
  });

  useEffect(() => {
    if (recommendationQuery.error && isQuotaError(recommendationQuery.error)) setQuotaExceeded(true);
  }, [recommendationQuery.error]);

  const recommendedRakija = recommendationQuery.data?.rakija ?? null;
  const recommendedVino = recommendationQuery.data?.vino ?? null;
  const isLoadingRec = recommendationQuery.isFetching && !recommendationQuery.data;

  const licenseWarningQuery = useQuery<string | null>({
    queryKey: queryKeys.home.licenseWarning(),
    queryFn: async () => {
      const token = localStorage.getItem("rakivinum_license_token");
      if (!token) return null;
      const lic = await fetchPublicLicenseByToken(token);
      if (!lic?.expiresAt) return null;
      const expiry = toDateSafe(lic.expiresAt);
      const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 0) {
        return "Vaša licenca je istekla. Obratite se administratoru za produženje.";
      }
      if (daysLeft <= 30) {
        return `Vaša licenca ističe za ${daysLeft} dana (${expiry.toLocaleDateString("sr-RS")}). Kontaktirajte administratora za produženje.`;
      }
      return null;
    },
    ...stableQueryOptions(REFRESH_INTERVAL.USER_LIGHT_1H),
  });

  useEffect(() => {
    if (licenseWarningQuery.error && isQuotaError(licenseWarningQuery.error)) setQuotaExceeded(true);
  }, [licenseWarningQuery.error]);

  const userStatsQuery = useQuery<{ savedCount: number | "-"; topRating: number | null; lastSavedProduct: ProductLite | null }>({
    queryKey: queryKeys.home.userStats(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return { savedCount: "-", topRating: null, lastSavedProduct: null };
      const userStatsCacheKey = `rakivinum_cache_home_user_stats_${userId}_v1`;
      let nextSavedCount: number | "-" = "-";
      let nextTopRating: number | null = null;
      let nextLastSavedProduct: ProductLite | null = null;

      const savedCol = collection(db, "users", userId, "savedItems");
      const countSnap = await getCountFromServer(savedCol);
      meterDbRead("home:user_saved_count", 1);
      nextSavedCount = countSnap.data().count;

      const recentSnap = await getDocs(query(savedCol, orderBy("createdAt", "desc"), limit(1)));
      meterDbRead("home:user_saved_recent", recentSnap.size);
      if (!recentSnap.empty) {
        const row = recentSnap.docs[0].data() as { productId?: string };
        const lastId = row?.productId;
        if (lastId) {
          const pub = await fetchPublicProductById(lastId);
          if (pub) {
            nextLastSavedProduct = { id: pub.id, ...pub } as ProductLite;
          } else {
            const prodSnap = await getDoc(doc(db, "products", lastId));
            meterDbRead("home:user_saved_product", prodSnap.exists() ? 1 : 0);
            if (prodSnap.exists()) {
              nextLastSavedProduct = { id: prodSnap.id, ...prodSnap.data() } as ProductLite;
            }
          }
        }
      }

      try {
        const topQuery = query(
          collection(db, "ratings"),
          where("userId", "==", userId),
          orderBy("rating", "desc"),
          limit(1),
        );
        const topSnap = await getDocs(topQuery);
        meterDbRead("home:user_ratings_top1", topSnap.size);
        if (!topSnap.empty) {
          const best = Number(topSnap.docs[0].data()?.rating);
          nextTopRating = Number.isFinite(best) ? best : null;
        }
      } catch {
        const ratingQuery = query(collection(db, "ratings"), where("userId", "==", userId), limit(20));
        const snap = await getDocs(ratingQuery);
        meterDbRead("home:user_ratings_fallback", snap.size);
        if (!snap.empty) {
          const ratings = snap.docs.map((d) => Number(d.data()?.rating) || 0);
          nextTopRating = Math.max(...ratings);
        }
      }

      const payload = {
        savedCount: nextSavedCount,
        topRating: nextTopRating,
        lastSavedProduct: nextLastSavedProduct,
      };
      writeCache(userStatsCacheKey, payload, REFRESH_INTERVAL.USER_LIGHT_1H);
      return payload;
    },
    initialData: userId
      ? (readCache<{ savedCount: number | "-"; topRating: number | null; lastSavedProduct: ProductLite | null }>(`rakivinum_cache_home_user_stats_${userId}_v1`)
        || { savedCount: "-", topRating: null, lastSavedProduct: null })
      : { savedCount: "-", topRating: null, lastSavedProduct: null },
    ...stableQueryOptions(REFRESH_INTERVAL.USER_LIGHT_1H),
  });

  useEffect(() => {
    if (userStatsQuery.error && isQuotaError(userStatsQuery.error)) setQuotaExceeded(true);
  }, [userStatsQuery.error]);

  const savedCount = userId ? (userStatsQuery.data?.savedCount ?? "-") : "-";
  const topRating = userId ? (userStatsQuery.data?.topRating ?? null) : null;
  const lastSavedProduct = userId ? (userStatsQuery.data?.lastSavedProduct ?? null) : null;
  const licenseWarning = dismissedLicenseWarning ? null : (licenseWarningQuery.data ?? null);


  useEffect(() => {
    const historyStr = localStorage.getItem('rakivinum_scan_history') || '[]';
    try {
      const history = JSON.parse(historyStr);
      setRecentScans(Array.isArray(history) ? history.slice(0, 4) : []);
    } catch (e) {
      console.error("Error loading scan history", e);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserId(user ? user.uid : null);
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="p-4 space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full overflow-y-auto w-full pb-24 scroll-smooth">
      {licenseWarning && (
        <div className="bg-red-500/20 border border-red-500/30 p-4 rounded-3xl animate-in slide-in-from-top duration-500">
           <div className="flex items-center gap-3">
              <div className="bg-red-500/20 p-2 rounded-lg">
                 <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
              </div>
              <div className="flex-1">
                 <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-0.5">VAŽNO OBAVEŠTENJE O LICENCI</p>
                 <p className="text-xs text-white font-medium leading-relaxed">{licenseWarning}</p>
              </div>
              <button
                type="button"
                onClick={() => setDismissedLicenseWarning(true)}
                className="p-1.5 hover:bg-white/5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-red-500/20"
              >
                <X className="w-4 h-4 text-text-secondary" />
              </button>
           </div>
        </div>
      )}

      {quotaExceeded && (
        <div className="empty-state card-elevated rounded-[20px] px-4 py-3 text-center">
          <p className="text-xs text-text-secondary leading-relaxed">
            Privremeno nedostupno: dnevna Firestore kvota je potrošena. Podaci će se automatski vratiti nakon resetovanja kvote.
          </p>
        </div>
      )}
      
      {/* Brand Header according to Brand Guide */}
      <div className="flex flex-col items-center justify-center py-8 space-y-2 relative">
         <div className="w-24 h-[1px] bg-gradient-to-r from-transparent via-gold-500/50 to-transparent mb-4" />
         
         <div className="w-56 h-auto relative group">
            {/* Ambient gold glow behind the logo */}
            <div className="absolute inset-0 bg-gold-500/20 blur-[40px] rounded-full scale-75 group-hover:scale-100 transition-transform duration-1000" />
            
            <img 
               src="/logo-gold.png" 
               alt="Rakivinum Premium Logo" 
               className="w-full h-auto relative z-10 drop-shadow-[0_5px_15px_rgba(0,0,0,0.5)]"
               referrerPolicy="no-referrer"
               onError={(e) => {
                 const target = e.target as HTMLImageElement;
                 if (target.src.includes('logo-gold.png')) {
                   target.src = '/logo.png';
                 } else {
                   // Final fallback if no local logo exists
                   target.src = 'https://picsum.photos/seed/rakivinum-brand/600/400';
                 }
               }}
            />
         </div>

         <div className="text-center pt-2 relative z-10">
            {/* Jedan vidljiv brend-red: logo-gold već nosi vizuel; naslov ispod samo tagline da nema duplog „Rakivinum“ */}
            <h1 className="sr-only">Rakivinum</h1>
            <div className="flex items-center gap-3 mt-1 justify-center">
               <div className="w-8 h-[0.5px] bg-gold-500/30" />
               <p className="text-[10px] text-gold-500 uppercase tracking-[0.4em] font-bold">Rakivinum Mreža</p>
               <div className="w-8 h-[0.5px] bg-gold-500/30" />
            </div>
         </div>

         <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-gold-500/20 to-transparent mt-6" />
      </div>
      
      {/* Daily Recommendation */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="section-title">
            <Sparkles className="w-3 h-3" /> Preporuka Dana
          </h3>
          <span className="eyebrow-label text-text-secondary opacity-55 italic">Premium Izbor</span>
        </div>
        
        {isLoadingRec ? (
          <div className="card-elevated border border-white/5 rounded-[24px] p-6 animate-pulse h-20" />
        ) : (recommendedRakija || recommendedVino) ? (
          <div className="space-y-3">
            {recommendedRakija && (
              <Link
                to={labelHref(recommendedRakija.id)}
                state={{ returnTo: homeReturnTo }}
                onClick={persistLabelReturn}
                className="block group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                <div className="card-soft card-elevated card-interactive border-gold-500/25 p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-black border border-white/10 shrink-0">
                      <img
                        src={recommendedRakija.bottleImageUrl || recommendedRakija.image || `https://picsum.photos/seed/${recommendedRakija.id}/200/200`}
                        alt="Rakija dana"
                        className="h-full w-full object-contain object-center p-0.5 media-crisp"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="eyebrow-label text-gold-500">Rakija dana</p>
                      <h3 className="text-lg font-black text-white truncate italic leading-tight">{recommendedRakija.name || "Rakija"}</h3>
                      <p className="text-[11px] text-text-secondary mt-0.5 opacity-75">Dodirni za detalje →</p>
                    </div>
                  </div>
                </div>
              </Link>
            )}
            {recommendedVino && (
              <Link
                to={labelHref(recommendedVino.id)}
                state={{ returnTo: homeReturnTo }}
                onClick={persistLabelReturn}
                className="block group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                <div className="card-soft card-elevated card-interactive border-purple-500/25 p-4 hover:border-purple-500/50">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-black border border-white/10 shrink-0">
                      <img
                        src={recommendedVino.bottleImageUrl || recommendedVino.image || `https://picsum.photos/seed/${recommendedVino.id}/200/200`}
                        alt="Vino dana"
                        className="h-full w-full object-contain object-center p-0.5 media-crisp"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="eyebrow-label text-purple-400">Vino dana</p>
                      <h3 className="text-lg font-black text-white truncate italic leading-tight">{recommendedVino.name || "Vino"}</h3>
                      <p className="text-[11px] text-text-secondary mt-0.5 opacity-75">Dodirni za detalje →</p>
                    </div>
                  </div>
                </div>
              </Link>
            )}
          </div>
        ) : (
          <Link
            to="/admin"
            className="block empty-state card-elevated rounded-[24px] p-8 text-center text-text-secondary text-[11px] uppercase tracking-widest font-black hover:text-white hover:border-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <Sparkles className="w-6 h-6 text-gold-500/35 mx-auto mb-3" aria-hidden />
            Dodajte proizvode za preporuku
          </Link>
        )}
      </section>

      {/* Club Actions & Perks */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="section-title">
            <Gift className="w-3 h-3" /> Akcije & Pogodnosti
          </h3>
          <Link
            to="/my-clubs"
            className="text-[9px] text-white/70 uppercase font-black hover:text-white transition-colors flex items-center gap-1 rounded-lg px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            Moji Klubovi <ArrowUpRight className="w-2 h-2" />
          </Link>
        </div>

        {activeActions.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x hide-scrollbar px-1">
            {activeActions.map((action) => {
              const isClubMember = joinedClubs.includes(action.distilleryId);
              return (
                <div 
                  key={action.id} 
                  className={cn(
                    "min-w-[240px] w-[240px] p-4 rounded-[28px] border snap-center relative overflow-hidden group transition-all duration-200 active:scale-[0.98]",
                    isClubMember
                      ? "bg-gradient-to-br from-gold-500/20 to-bg-card-elevated border-gold-500/30"
                      : "bg-bg-card border-white/5 opacity-80"
                  )}
                >
                  {isClubMember && (
                    <div className="absolute top-3 right-3 bg-gold-500 text-black text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter animate-pulse">
                      Članska Pogodnost
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gold-500/10 flex items-center justify-center text-gold-500 shrink-0">
                        {action.rewardType === 'voucher_code' ? <Ticket className="w-5 h-5" /> : <Gift className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[11px] font-black text-white uppercase truncate">{action.title}</h4>
                        <p className="text-[9px] text-white/70 mt-0.5 line-clamp-1">
                           {distilleryMap[action.distilleryId] || "Lokalni Proizvođač"}
                        </p>
                      </div>
                    </div>
                    
                    <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                       <p className="text-[9px] text-white/70 uppercase font-bold tracking-widest leading-none mb-1">Uslov</p>
                       <p className="text-[10px] text-white font-medium">
                        {action.condition === 'combined_automated' ? (
                          `Cilj: ${action.targetScans} Skenova & ${action.targetRatings} Ocena`
                        ) : action.conditionLabel || 
                         (action.condition === '3_scans' ? `Skeniraj ${action.targetValue || 3} puta istu rakiju` : 
                          action.condition === 'high_rating' ? `Ostavi ${action.targetValue || 1} ocenu iznad 4.5` : 
                          action.condition === 'loyal_customer' ? `Ostvari ${action.targetValue || 10} interakcija` :
                          'Podeli na društvenim mrežama')}
                       </p>
                    </div>

                    {!isClubMember ? (
                      <Link
                        to={`/distillery/${action.distilleryId}`}
                        className="w-full py-2.5 btn-secondary text-center text-[10px] block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
                      >
                        Postani Član za nagradu
                      </Link>
                    ) : (
                      <Link
                        to="/my-clubs"
                        className="w-full py-2.5 btn-secondary text-center text-[10px] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Prati Napredak
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state card-elevated rounded-[28px] p-10 text-center max-w-md mx-auto space-y-2">
            <Gift className="w-8 h-8 text-gold-500/30 mx-auto" aria-hidden />
            <p className="text-[10px] text-white/85 uppercase font-black tracking-widest">Trenutno nema aktivnih akcija</p>
            <p className="ui-caption uppercase tracking-tighter text-text-secondary/75">Vratite se kasnije za nove poklone</p>
          </div>
        )}
      </section>

      {/* Stats Quick View (Replaces Hero Dashboard) */}
      <section className="bg-gradient-to-r from-gold-500/10 to-transparent border-l-2 border-gold-500 p-4 rounded-r-2xl shadow-[0_10px_30px_rgba(212,175,55,0.08)] card-elevated">
        <Link
          to="/collection"
          className="flex items-center justify-between group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base -m-1 p-1"
        >
           <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gold-500/20 flex items-center justify-center">
                 <Trophy className="w-5 h-5 text-gold-500" />
              </div>
              <div>
                 <p className="text-[11px] text-gold-500 font-black uppercase tracking-widest">Vaša kolekcija</p>
                 <h4 className="text-white font-bold text-sm">
                   {savedCount} Boca <span className="text-text-secondary font-normal mx-1">|</span> {topRating ? `${topRating.toFixed(1)} ★` : 'Bez ocena'}
                 </h4>
              </div>
           </div>
           <ArrowRight className="w-4 h-4 text-text-secondary group-hover:text-gold-500 transition-colors" />
        </Link>
      </section>

      {/* Recent Scans (Continuity) */}
      {recentScans.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="section-title">
              <Clock className="w-3 h-3" /> Nedavno Skenirano
            </h3>
            <Link to="/collection" className="text-[9px] text-white/70 uppercase font-black hover:text-white transition-colors">Istraži Sve</Link>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x hide-scrollbar">
            {recentScans.map((item) => (
              <Link
                key={item.id}
                to={labelHref(item.id)}
                state={{ returnTo: homeReturnTo }}
                onClick={persistLabelReturn}
                className="min-w-[120px] w-[120px] card-soft card-elevated card-interactive p-3 snap-center hover:border-gold-500/35 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                <div className="aspect-[2/3] rounded-xl overflow-hidden bg-black mb-2 border border-white/5">
                  <img
                    src={item.image || `https://picsum.photos/seed/${item.id}/200/300`}
                    alt={item.name}
                    className="h-full w-full object-contain object-center p-1.5 media-crisp"
                  />
                </div>
                <p className="text-[11px] font-black text-white truncate px-1 italic">{item.name}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide px-1 mt-0.5">{item.type}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Installation Banner (PWA Strategy) */}
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("rakivinum_trigger_install"));
        }}
        className="w-full text-left bg-gradient-to-br from-gold-500/10 to-bg-card-elevated border border-white/10 rounded-3xl p-6 relative overflow-hidden group active:scale-95 transition-all duration-200 hover:border-gold-500/35 card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
      >
        <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-gold-500/10 rounded-full blur-2xl group-hover:bg-gold-500/20 transition-all" />
        <div className="flex gap-4 relative z-10">
          <div className="w-12 h-12 rounded-2xl bg-gold-500 flex items-center justify-center text-black shadow-lg shadow-gold-500/20 shrink-0">
             <Download className="w-6 h-6" />
          </div>
          <div className="space-y-1">
             <h4 className="text-sm font-black text-white uppercase tracking-tight">Vrati se kad god poželiš</h4>
             <p className="text-[10px] text-text-secondary leading-relaxed opacity-70">
                Instaliraj <span className="text-gold-500 font-bold italic">Rakivinum</span> na ekran telefona jednim klikom.
             </p>
          </div>
        </div>
      </button>

      {/* Quick Tools - Compact */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="section-title">Brzi Alati</h3>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <Link
            to="/radionica?tab=razblazivanje"
            className="card-soft card-elevated border border-white/10 rounded-[22px] p-4 flex flex-col gap-2 transition-all duration-200 active:scale-95 hover:border-gold-500/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <div className="w-8 h-8 rounded-lg bg-gold-500/10 flex items-center justify-center text-gold-500">
              <Droplet className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-sm text-white">Razblaživanje</p>
              <p className="text-[10px] text-text-secondary leading-tight opacity-70">Spuštanje jačine.</p>
            </div>
          </Link>
          
          <Link
            to="/radionica?tab=prvenac"
            className="card-soft card-elevated border border-white/10 rounded-[22px] p-4 flex flex-col gap-2 transition-all duration-200 active:scale-95 hover:border-gold-500/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <div className="w-8 h-8 rounded-lg bg-gold-500/10 flex items-center justify-center text-gold-500">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-sm text-white">Prvenac</p>
              <p className="text-[10px] text-text-secondary leading-tight opacity-70">Čuvanje srca.</p>
            </div>
          </Link>
        </div>
      </section>

      {/* Bottom Action (Primary Button) */}
      <Link
        to="/scan"
        className="block w-full py-4 btn-primary text-center text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/90 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
      >
        Skeniraj Bocu
      </Link>

    </div>
  );
}
