import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Loader2, ChevronRight, Award, Search, X } from "lucide-react";
import { isQuotaError } from "../lib/resilience";
import { fetchPublicDistilleries } from "../lib/dataService";

type DistilleryRow = {
  id: string;
  name?: string;
  logoUrl?: string;
  region?: string;
  location?: string | { address?: string; city?: string };
};

export default function Distilleries() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBackSafe = () => {
    const navState = location.state as { returnTo?: string } | null;
    if (navState?.returnTo) {
      navigate(navState.returnTo);
      return;
    }
    const rt = new URLSearchParams(location.search).get("rt");
    if (rt) {
      navigate(rt);
      return;
    }
    navigate("/", { replace: true });
  };
  const [distilleries, setDistilleries] = useState<DistilleryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const normalizeText = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .replace(/š/g, "s")
      .replace(/č/g, "c")
      .replace(/ć/g, "c")
      .replace(/ž/g, "z")
      .replace(/đ/g, "dj");

  useEffect(() => {
    async function fetchDistilleries() {
      try {
        const publicDistilleries = await fetchPublicDistilleries({
          limitCount: 300,
          cacheKey: "rakivinum_cache_distilleries_page_v1",
          ttlMs: 30 * 60 * 1000,
        });
        setDistilleries(publicDistilleries);
      } catch (err) {
        console.error(err);
        if (isQuotaError(err)) setQuotaExceeded(true);
      } finally {
        setIsLoading(false);
      }
    }
    fetchDistilleries();
  }, []);

  const filteredDistilleries = distilleries.filter(d => {
    const q = normalizeText(searchQuery);
    const locationObj = typeof d.location === "object" && d.location !== null ? d.location : null;
    return (
      normalizeText(d.name).includes(q) ||
      normalizeText(d.location).includes(q) ||
      normalizeText(locationObj?.address).includes(q) ||
      normalizeText(locationObj?.city).includes(q) ||
      normalizeText(d.region).includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-base pb-24">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="p-3 card-soft card-elevated border border-white/10 rounded-2xl text-text-secondary">
              <ArrowLeft className="w-5 h-5 opacity-50" />
            </div>
            <div className="space-y-2">
              <div className="h-7 w-56 rounded-lg bg-white/10 animate-pulse" />
              <div className="h-3 w-40 rounded bg-gold-500/20 animate-pulse" />
            </div>
          </div>
          <div className="h-14 card-soft card-elevated border border-white/10 rounded-2xl animate-pulse" />
        </div>
        <div className="px-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`distillery-skeleton-${i}`}
              className="w-full card-soft card-elevated border border-white/10 rounded-[28px] p-5 flex items-center justify-between"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/10 shrink-0 animate-pulse" />
                <div className="space-y-2">
                  <div className="h-4 w-40 rounded bg-white/10 animate-pulse" />
                  <div className="h-3 w-28 rounded bg-white/5 animate-pulse" />
                </div>
              </div>
              <Loader2 className="w-5 h-5 text-gold-500/50 animate-spin" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base pb-24">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={goBackSafe}
            className="p-3 card-soft card-elevated border border-white/10 rounded-2xl text-text-secondary hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white uppercase italic">Destilerije & Vinarije</h1>
            <p className="ui-caption uppercase font-bold tracking-widest text-gold-500/75">Sertifikovani proizvođači</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" aria-hidden />
          <input
            type="search"
            placeholder="Pretraži po nazivu ili lokaciji…"
            className="w-full card-soft card-elevated border border-white/10 rounded-2xl py-4 pl-12 pr-12 text-white text-sm focus:border-gold-500/50 transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-text-secondary hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              aria-label="Obriši pretragu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-6 space-y-4">
        {filteredDistilleries.length > 0 ? (
          filteredDistilleries.map((d) => (
            <button
              type="button"
              key={d.id}
              onClick={() => navigate(`/distillery/${d.id}`)}
              className="w-full card-soft card-elevated card-interactive border border-white/10 rounded-[28px] p-5 flex items-center justify-between group hover:border-gold-500/35 transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-black border-2 border-white/10 group-hover:border-gold-500/50 flex items-center justify-center overflow-hidden shrink-0 shadow-[0_0_0_1px_rgba(212,175,55,0.06)] transition-all duration-300">
                  {d.logoUrl ? (
                    <img src={d.logoUrl} alt={d.name} className="w-full h-full object-contain object-center p-1.5 media-crisp" />
                  ) : (
                    <Award className="w-6 h-6 text-gold-500" aria-hidden />
                  )}
                </div>
                <div>
                  <h3 className="text-white font-black uppercase italic leading-tight">{d.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <MapPin className="w-3 h-3 text-gold-500" />
                    <span className="text-[10px] text-text-secondary uppercase font-bold">
                      {typeof d.location === "string"
                        ? d.location
                        : d.location?.city || d.location?.address
                          ? [d.location.city, d.location.address].filter(Boolean).join(", ")
                          : d.region || "Srbija"}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-gold-500 transition-colors" />
            </button>
          ))
        ) : (
          <div className="empty-state card-elevated max-w-md mx-auto py-12 px-6 text-center space-y-4 rounded-[28px]">
            <Search className="w-10 h-10 text-gold-500/35 mx-auto" aria-hidden />
            <p className="text-sm text-text-secondary leading-relaxed">
              {quotaExceeded
                ? "Privremeno nedostupno: dnevna Firestore kvota je potrošena. Lista će se automatski vratiti nakon resetovanja kvote."
                : searchQuery.trim()
                  ? `Nema rezultata za „${searchQuery.trim()}”. Pokušajte drugačiji naziv ili grad.`
                  : "Trenutno nema javnih proizvođača u listi."}
            </p>
            {searchQuery.trim() ? (
              <button type="button" onClick={() => setSearchQuery("")} className="w-full max-w-xs mx-auto py-2.5 btn-tertiary text-[11px] normal-case font-semibold">
                Obriši pretragu
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
