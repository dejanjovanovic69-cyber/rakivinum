import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Search, PackageOpen, Star, Trophy, Calendar } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { pickBestProductImageUrl, RAKIVINUM_MARK_FALLBACK, isImgFallbackUrl } from "../lib/imageFallback";
import { riznicaService, type RiznicaItemWithProduct } from "../services/riznicaService";
import type { RiznicaCategory } from "../types/riznica";
import { auth } from "../lib/firebase";

const SHELVES = ["polica-1", "polica-2", "polica-3", "polica-4", "polica-5"];
const CATEGORY_LABELS: Record<Exclude<RiznicaCategory, null>, string> = {
  favoriti: "Favoriti",
  "specijalna-rezerva": "Specijalna rezerva",
  "za-poklon": "Za poklon",
  probano: "Probano",
};

export default function PublicRiznica() {
  const { uid = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<RiznicaCategory>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [ownerHandle, setOwnerHandle] = useState<string | null>(null);
  const [ownerAvatar, setOwnerAvatar] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [items, setItems] = useState<RiznicaItemWithProduct[]>([]);
  const [viewerUid, setViewerUid] = useState<string | null>(auth.currentUser?.uid || null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await riznicaService.getPublicRiznicaByUid(uid);
      setIsPublic(data.isPublic);
      setOwnerName(data.ownerName);
      setOwnerHandle(data.ownerHandle);
      setOwnerAvatar(data.ownerAvatar);
      setItems(data.items);
      setLoading(false);
    };
    void load();
  }, [uid]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setViewerUid(u?.uid || null));
  }, []);

  useEffect(() => {
    const title = ownerName ? `Riznica - ${ownerName}` : "Javna Riznica";
    document.title = title;
    const upsertMeta = (property: string, content: string) => {
      const selector = `meta[property="${property}"]`;
      let node = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!node) {
        node = document.createElement("meta");
        node.setAttribute("property", property);
        document.head.appendChild(node);
      }
      node.setAttribute("content", content);
    };
    upsertMeta("og:title", title);
    upsertMeta("og:description", "Pogledaj javnu read-only Riznicu.");
    upsertMeta("og:type", "website");
    upsertMeta("og:url", `${window.location.origin}/riznica/${encodeURIComponent(uid)}`);
  }, [ownerName, uid]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filterCategory && item.category !== filterCategory) return false;
      if (!q) return true;
      const n = String(item.product?.name || "").toLowerCase();
      const t = String(item.product?.type || "").toLowerCase();
      return n.includes(q) || t.includes(q);
    });
  }, [items, search, filterCategory]);

  const stats = useMemo(() => riznicaService.getRiznicaStats(filtered), [filtered]);
  const byShelf = useMemo(() => {
    const map = new Map<string, RiznicaItemWithProduct[]>();
    SHELVES.forEach((s) => map.set(s, []));
    filtered.forEach((item) => {
      const shelf = item.shelf && SHELVES.includes(item.shelf) ? item.shelf : "polica-1";
      map.get(shelf)?.push(item);
    });
    SHELVES.forEach((s) =>
      map.set(
        s,
        (map.get(s) || []).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)),
      ),
    );
    return map;
  }, [filtered]);

  if (loading) {
    return <div className="min-h-screen bg-bg-base p-8 text-center text-text-secondary">Učitavanje javne Riznice...</div>;
  }

  if (!isPublic) {
    const missingOrPrivate =
      !ownerName && !ownerHandle && !ownerAvatar && items.length === 0;
    return (
      <div className="min-h-screen bg-bg-base p-6 flex items-center justify-center text-center">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-8 max-w-md">
          <h1 className="text-2xl font-black text-white mb-2">{missingOrPrivate ? "Riznica nije dostupna" : "Riznica je privatna"}</h1>
          <p className="text-sm text-text-secondary">
            {missingOrPrivate
              ? "Link nije validan ili vlasnik trenutno ne deli javnu Riznicu."
              : "Vlasnik nije omogućio javno deljenje ove Riznice."}
          </p>
          <Link to="/" className="mt-4 inline-block px-4 py-2 rounded-xl border border-white/20 text-white text-xs font-bold uppercase">
            Nazad na početnu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base pb-20">
      <div className="sticky top-0 z-10 bg-bg-base/90 backdrop-blur border-b border-white/5 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <img
            src={ownerAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(ownerName || ownerHandle || "R")}&background=1f1f1f&color=d4af37`}
            alt="Avatar vlasnika Riznice"
            className="w-12 h-12 rounded-full object-cover border-2 border-gold-500/40 bg-black/40 shadow-[0_8px_24px_rgba(212,175,55,0.22)]"
            referrerPolicy="no-referrer"
          />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-text-secondary">Podeljeno od {ownerName || ownerHandle || "korisnika"}</p>
            <h1 className="text-xl font-black text-white truncate">
              Riznica {ownerHandle ? `@${ownerHandle}` : ownerName ? `- ${ownerName}` : "korisnika"}
            </h1>
          </div>
        </div>
        {viewerUid && viewerUid === uid ? (
          <Link
            to="/moja-riznica"
            className="inline-block mt-1 px-3 py-1.5 rounded-lg border border-gold-500/35 text-gold-300 text-[10px] font-bold uppercase tracking-wider"
          >
            Nazad na moju riznicu
          </Link>
        ) : null}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pretraga po nazivu ili tipu..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white"
          />
        </div>
        <div className="flex gap-2 overflow-auto">
          <button
            type="button"
            onClick={() => setFilterCategory(null)}
            className={`px-3 py-1.5 rounded-full text-xs border ${filterCategory === null ? "border-gold-500 text-gold-400" : "border-white/15 text-text-secondary"}`}
          >
            Sve
          </button>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterCategory(value as Exclude<RiznicaCategory, null>)}
              className={`px-3 py-1.5 rounded-full text-xs border ${filterCategory === value ? "border-gold-500 text-gold-400" : "border-white/15 text-text-secondary"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-3">
        <StatCard icon={PackageOpen} label="Pića" value={String(stats.totalDrinks)} />
        <StatCard icon={Star} label="Prosek" value={stats.avgRating?.toFixed(2) || "-"} />
        <StatCard icon={Trophy} label="Top tip" value={stats.topType || "-"} />
        <StatCard icon={Calendar} label="Najstarija godina" value={stats.oldestYear ? String(stats.oldestYear) : "-"} />
      </div>

      <div className="space-y-5 px-4">
        {SHELVES.map((shelfId, index) => {
          const shelfItems = byShelf.get(shelfId) || [];
          return (
            <section key={shelfId} className="relative [perspective:1000px]">
              <div className="text-xs uppercase tracking-[0.2em] text-gold-500/80 mb-2 font-black">Polica {index + 1}</div>
              <div className="rounded-2xl border border-white/15 bg-gradient-to-b from-white/10 via-black/25 to-black/45 p-3 shadow-[0_30px_40px_rgba(0,0,0,0.35),inset_0_-16px_24px_rgba(0,0,0,0.45)] [transform:rotateX(1deg)]">
                {shelfItems.length === 0 ? (
                  <p className="text-xs text-text-secondary py-4 text-center">Prazna polica</p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
                    {shelfItems.map((item) => (
                      <article key={item.drinkId} className="min-w-[11rem] sm:min-w-0 rounded-2xl border border-white/10 bg-black/40 p-2.5">
                        <div className="h-32 rounded-xl bg-black overflow-hidden mb-2">
                          <img
                            src={pickBestProductImageUrl(item.product || {})}
                            alt={String(item.product?.name || "Piće")}
                            className="w-full h-full object-contain p-1"
                            onError={(e) => {
                              const el = e.target as HTMLImageElement;
                              if (isImgFallbackUrl(el.src)) return;
                              el.src = RAKIVINUM_MARK_FALLBACK;
                            }}
                          />
                        </div>
                        <p className="text-xs text-white font-bold truncate">{String(item.product?.name || item.drinkId)}</p>
                        <p className="text-[10px] text-text-secondary truncate">{String(item.product?.type || "Tip nepoznat")}</p>
                        <div className="mt-1 text-[10px] text-gold-300">{item.userRating ? `${item.userRating.toFixed(1)} ★` : "Bez ocene"}</div>
                        {item.category && <div className="mt-1 text-[10px] text-white/80">{CATEGORY_LABELS[item.category as Exclude<RiznicaCategory, null>]}</div>}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 p-3">
      <div className="flex items-center gap-2 text-gold-500 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm font-black text-white truncate">{value}</div>
    </div>
  );
}
