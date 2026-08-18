import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  Search,
  PackageOpen,
  Star,
  Trophy,
  FileDown,
  Trash2,
  Heart,
  Gift,
  ShieldCheck,
  CircleCheck,
  CheckCircle2,
  GripVertical,
  ArrowUpDown,
  ScanLine,
  Compass,
  Sparkles,
  Copy,
  Share2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { auth } from "../lib/firebase";
import { pickBestProductImageUrl, RAKIVINUM_MARK_FALLBACK, isImgFallbackUrl } from "../lib/imageFallback";
import { bumpRiznicaDebugCounter, getRiznicaDebugCounters, riznicaService } from "../services/riznicaService";
import type { RiznicaCategory, RiznicaPrivacySettings } from "../types/riznica";
import type { RiznicaItemWithProduct } from "../services/riznicaService";
import jsPDF from "jspdf";
import QRCode from "qrcode";

type RiznicaViewItem = RiznicaItemWithProduct;
type SortMode = "added-desc" | "rating-desc" | "shelf-asc";

const CATEGORY_LABELS: Record<Exclude<RiznicaCategory, null>, string> = {
  favoriti: "Favoriti",
  "specijalna-rezerva": "Specijalna rezerva",
  "za-poklon": "Za poklon",
  probano: "Probano",
};

const SHELVES = ["polica-1", "polica-2", "polica-3", "polica-4", "polica-5"];
const MAX_RIZNICA_ITEMS = 300;
let riznicaComponentMounts = 0;

const CATEGORY_THEME: Record<Exclude<RiznicaCategory, null>, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  favoriti: { icon: Heart, className: "text-rose-300 bg-rose-500/15 border-rose-500/30" },
  "specijalna-rezerva": { icon: ShieldCheck, className: "text-violet-300 bg-violet-500/15 border-violet-500/30" },
  "za-poklon": { icon: Gift, className: "text-sky-300 bg-sky-500/15 border-sky-500/30" },
  probano: { icon: CircleCheck, className: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30" },
};

function toDate(value: unknown): Date {
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") return (value as { toDate: () => Date }).toDate();
  const parsed = new Date(value as string | number | Date);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function useCountUp(target: number, durationMs = 500): number {
  void durationMs;
  // Crisis mode: avoid RAF-driven setState loops that caused render storms.
  return target;
}

export default function MojaRiznica() {
  const [items, setItems] = useState<RiznicaViewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(() => auth.currentUser);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<RiznicaCategory>(null);
  const uid = user?.uid || null;
  const [sortMode, setSortMode] = useState<SortMode>("added-desc");
  const [draggingDrinkId, setDraggingDrinkId] = useState<string | null>(null);
  const [workingDrinkId, setWorkingDrinkId] = useState<string | null>(null);
  const [movedDrinkId, setMovedDrinkId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; icon?: "success" | "info" } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [privacy, setPrivacy] = useState<RiznicaPrivacySettings>({
    riznicaPublic: false,
    riznicaPublicNotes: false,
    riznicaLastSharedAt: null,
  });
  const [shareQrDataUrl, setShareQrDataUrl] = useState<string>("");
  const renderCountRef = useRef(0);
  const filteredComputeRef = useRef(0);
  const statsComputeRef = useRef(0);
  const shelvesComputeRef = useRef(0);
  const dataEffectRunsRef = useRef(0);
  const privacyEffectRunsRef = useRef(0);
  const qrEffectRunsRef = useRef(0);
  const authEffectRunsRef = useRef(0);
  const mountCountRef = useRef(0);
  const filteredInvalidationsRef = useRef(0);
  const statsInvalidationsRef = useRef(0);
  const shelvesInvalidationsRef = useRef(0);
  const memoDepsRef = useRef<{ filtered: string; stats: string; shelves: string }>({
    filtered: "",
    stats: "",
    shelves: "",
  });
  renderCountRef.current += 1;

  useEffect(() => {
    authEffectRunsRef.current += 1;
    bumpRiznicaDebugCounter("effectAuthLoads");
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
  }, []);

  useEffect(() => {
    riznicaComponentMounts += 1;
    mountCountRef.current = riznicaComponentMounts;
  }, []);

  useEffect(() => {
    dataEffectRunsRef.current += 1;
    bumpRiznicaDebugCounter("effectDataLoads");
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    const snapshot = riznicaService.getMyRiznicaSnapshot(uid);
    setItems(snapshot);
    setLoading(false);

    if (snapshot.length > 0) {
      console.info("Riznica: Snapshot exists, skipping network.");
      const missingImageCount = snapshot.filter((row) => {
        const p = row.product as Record<string, unknown> | null;
        const image = String((p?.image as string) || (p?.bottleImageUrl as string) || "").trim();
        return image.length === 0;
      }).length;
      const hydrateSessionKey = `riznica_hydrate_${uid}`;
      if (missingImageCount > 0 && !sessionStorage.getItem(hydrateSessionKey)) {
        sessionStorage.setItem(hydrateSessionKey, "1");
        void riznicaService
          .revalidateMyRiznica(uid, true)
          .then((fresh) => {
            if (fresh.length > 0) setItems(fresh);
          })
          .catch(() => {
            // keep snapshot if hydrate fails
          });
      }
      return;
    }

    const sessionKey = `riznica_lock_${uid}`;
    const hasCheckedThisSession = sessionStorage.getItem(sessionKey);
    if (!hasCheckedThisSession) {
      sessionStorage.setItem(sessionKey, "1");
      void riznicaService
        .revalidateMyRiznica(uid, false)
        .then((fresh) => {
          if (fresh.length > 0) setItems(fresh);
        })
        .catch((err) => console.error("Riznica revalidate failed", err));
    }
  }, [uid]);

  useEffect(() => {
    privacyEffectRunsRef.current += 1;
    bumpRiznicaDebugCounter("effectPrivacyLoads");
    const loadPrivacy = async () => {
      if (!uid) return;
      const settings = await riznicaService.getPrivacySettings();
      setPrivacy(settings);
    };
    void loadPrivacy();
  }, [uid]);

  useEffect(() => {
    qrEffectRunsRef.current += 1;
    bumpRiznicaDebugCounter("effectQrLoads");
    if (!uid) {
      setShareQrDataUrl("");
      return;
    }
    const shareUrl = `https://rakivinum.com/riznica/${encodeURIComponent(uid)}`;
    void QRCode.toDataURL(shareUrl, { margin: 1, width: 200 })
      .then((dataUrl) => setShareQrDataUrl(dataUrl))
      .catch(() => setShareQrDataUrl(""));
  }, [uid]);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    filteredComputeRef.current += 1;
    const q = search.trim().toLowerCase();
    const base = items.filter((item) => {
      if (filterCategory && item.category !== filterCategory) return false;
      if (!q) return true;
      const n = String(item.product?.name || "").toLowerCase();
      const t = String(item.product?.type || "").toLowerCase();
      return n.includes(q) || t.includes(q);
    });
    return [...base].sort((a, b) => {
      if (sortMode === "rating-desc") return (Number(b.userRating) || 0) - (Number(a.userRating) || 0);
      if (sortMode === "shelf-asc") {
        const shelfA = String(a.shelf || "polica-1").localeCompare(String(b.shelf || "polica-1"));
        if (shelfA !== 0) return shelfA;
        return (Number(a.position) || 0) - (Number(b.position) || 0);
      }
      return toDate(b.addedAt).getTime() - toDate(a.addedAt).getTime();
    });
  }, [items, search, filterCategory, sortMode]);
  {
    const depKey = `${items.length}|${search}|${String(filterCategory)}|${sortMode}`;
    if (memoDepsRef.current.filtered !== depKey) {
      memoDepsRef.current.filtered = depKey;
      filteredInvalidationsRef.current += 1;
    }
  }

  const stats = useMemo(() => {
    statsComputeRef.current += 1;
    return riznicaService.getRiznicaStats(filtered);
  }, [filtered]);
  {
    const depKey = `${filtered.length}|${filteredComputeRef.current}`;
    if (memoDepsRef.current.stats !== depKey) {
      memoDepsRef.current.stats = depKey;
      statsInvalidationsRef.current += 1;
    }
  }
  const statsDrinksAnimated = useCountUp(stats.totalDrinks, 450);
  const statsRatingAnimated = useCountUp(stats.avgRating || 0, 450);
  const typeDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((item) => {
      const t = String(item.product?.type || "Nepoznato").trim();
      counts.set(t, (counts.get(t) || 0) + 1);
    });
    const total = Math.max(1, filtered.length);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count, pct: Math.round((count / total) * 100) }));
  }, [filtered]);

  const byShelf = useMemo(() => {
    shelvesComputeRef.current += 1;
    const map = new Map<string, RiznicaViewItem[]>();
    for (const shelf of SHELVES) map.set(shelf, []);
    for (const item of filtered) {
      const shelf = item.shelf && SHELVES.includes(item.shelf) ? item.shelf : "polica-1";
      map.get(shelf)?.push(item);
    }
    for (const shelf of SHELVES) {
      map.set(
        shelf,
        (map.get(shelf) || []).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)),
      );
    }
    return map;
  }, [filtered]);
  {
    const depKey = `${filtered.length}|${shelvesComputeRef.current}`;
    if (memoDepsRef.current.shelves !== depKey) {
      memoDepsRef.current.shelves = depKey;
      shelvesInvalidationsRef.current += 1;
    }
  }

  const patchLocal = (drinkId: string, patch: Partial<RiznicaViewItem>) => {
    setItems((prev) => prev.map((item) => (item.drinkId === drinkId ? { ...item, ...patch } : item)));
  };

  const runMutation = useCallback(async (drinkId: string, action: () => Promise<void>) => {
    setWorkingDrinkId(drinkId);
    setErrorMessage(null);
    try {
      await action();
    } catch (err) {
      setErrorMessage(String((err as Error)?.message || "Greška pri snimanju izmene."));
      throw err;
    } finally {
      setWorkingDrinkId(null);
    }
  }, []);

  const showToast = useCallback((message: string, icon: "success" | "info" = "info") => {
    setToast({ text: message, icon });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === message ? null : prev));
    }, 1900);
  }, []);

  const shareUrl = useMemo(() => {
    if (!uid) return "";
    return `https://rakivinum.com/riznica/${encodeURIComponent(uid)}`;
  }, [uid]);
  const isMobileSharePreferred = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const touchDevice =
      typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)").matches : false;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return (touchDevice || mobileUa) && typeof navigator.share === "function";
  }, []);

  const handlePrivacyChange = useCallback(
    async (next: Pick<RiznicaPrivacySettings, "riznicaPublic" | "riznicaPublicNotes">) => {
      const previous = privacy;
      const optimistic: RiznicaPrivacySettings = {
        ...previous,
        riznicaPublic: next.riznicaPublic,
        riznicaPublicNotes: next.riznicaPublic ? next.riznicaPublicNotes : false,
        riznicaLastSharedAt: next.riznicaPublic ? previous.riznicaLastSharedAt : null,
      };
      setPrivacy(optimistic);
      try {
        const saved = await riznicaService.updatePrivacySettings({
          riznicaPublic: optimistic.riznicaPublic,
          riznicaPublicNotes: optimistic.riznicaPublicNotes,
        });
        setPrivacy(saved);
        if (saved.riznicaPublic) showToast("Riznica je sada javna", "success");
      } catch (err) {
        setPrivacy(previous);
        const msg = String((err as Error)?.message || "");
        setErrorMessage(
          msg.includes("unauthorized")
            ? "Nalog nije verifikovan za ovu akciju. Osvežite stranicu i pokušajte ponovo."
            : "Greška pri čuvanju podešavanja deljenja.",
        );
      }
    },
    [privacy, showToast],
  );

  const handleCategory = useCallback(async (drinkId: string, category: RiznicaCategory) => {
    let prevItem: RiznicaViewItem | undefined;
    setItems((prev) => {
      prevItem = prev.find((i) => i.drinkId === drinkId);
      return prev.map((item) => (item.drinkId === drinkId ? { ...item, category } : item));
    });
    try {
      await runMutation(drinkId, () => riznicaService.updateRiznicaItem(drinkId, { category }));
      showToast("Kategorija ažurirana.");
    } catch {
      if (prevItem) {
        setItems((prev) => prev.map((item) => (item.drinkId === drinkId ? prevItem! : item)));
      }
    }
  }, [runMutation, showToast]);

  const handleRemove = useCallback(async (drinkId: string) => {
    let removedItem: RiznicaViewItem | undefined;
    setItems((prev) => {
      removedItem = prev.find((i) => i.drinkId === drinkId);
      return prev.filter((item) => item.drinkId !== drinkId);
    });
    try {
      await runMutation(drinkId, () => riznicaService.removeFromRiznica(drinkId));
      showToast("Uklonjeno iz Riznice.");
    } catch {
      if (removedItem) {
        setItems((prev) => [...prev, removedItem!]);
      }
    }
  }, [runMutation, showToast]);

  const moveDrinkToShelf = useCallback(async (drinkId: string, nextShelf: string) => {
    const normalizedShelf = SHELVES.includes(nextShelf) ? nextShelf : "polica-1";
    let prevItem: RiznicaViewItem | undefined;
    let nextPosition = 0;
    setItems((prev) => {
      prevItem = prev.find((i) => i.drinkId === drinkId);
      nextPosition = prev.filter((x) => (x.shelf || "polica-1") === normalizedShelf && x.drinkId !== drinkId).length;
      return prev.map((item) =>
        item.drinkId === drinkId ? { ...item, shelf: normalizedShelf, position: nextPosition } : item,
      );
    });
    try {
      await runMutation(drinkId, () => riznicaService.updateRiznicaItem(drinkId, { shelf: normalizedShelf, position: nextPosition }));
      setMovedDrinkId(drinkId);
      showToast(`Bočica premeštena na ${normalizedShelf.replace("polica-", "Policu ")}.`);
      window.setTimeout(() => setMovedDrinkId((prev) => (prev === drinkId ? null : prev)), 600);
    } catch {
      if (prevItem) {
        setItems((prev) => prev.map((item) => (item.drinkId === drinkId ? prevItem! : item)));
      }
    }
  }, [runMutation, showToast]);

  const updateRating = useCallback(async (drinkId: string, rating: number | null) => {
    let prevItem: RiznicaViewItem | undefined;
    setItems((prev) => {
      prevItem = prev.find((i) => i.drinkId === drinkId);
      return prev.map((item) => (item.drinkId === drinkId ? { ...item, userRating: rating } : item));
    });
    try {
      await runMutation(drinkId, () => riznicaService.updateRiznicaItem(drinkId, { userRating: rating }));
      showToast("Ocena je sačuvana.");
    } catch {
      if (prevItem) {
        setItems((prev) => prev.map((item) => (item.drinkId === drinkId ? prevItem! : item)));
      }
    }
  }, [runMutation, showToast]);
  const handleDragStart = useCallback((drinkId: string) => setDraggingDrinkId(drinkId), []);
  const handleDragEnd = useCallback(() => setDraggingDrinkId(null), []);

  const exportPdf = async () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const username = auth.currentUser?.displayName || auth.currentUser?.email || "Korisnik";
    const generatedAt = new Date().toLocaleString("sr-RS");
    const shareUid = auth.currentUser?.uid || uid || "";
    const publicUrl = shareUid
      ? `https://rakivinum.com/riznica/${encodeURIComponent(shareUid)}`
      : `${window.location.origin}/moja-riznica`;
    const qrDataUrl = await QRCode.toDataURL(publicUrl).catch(() => "");
    if (qrDataUrl) {
      try {
        doc.addImage(qrDataUrl, "PNG", 500, 28, 64, 64);
      } catch {
        // ignore QR render errors
      }
    }
    doc.setFontSize(18);
    doc.text(`Moja Riznica - ${username}`, 40, 45);
    doc.setFontSize(11);
    doc.text(`Datum generisanja: ${generatedAt}`, 40, 65);
    doc.text(`Broj pica: ${stats.totalDrinks} | Prosek: ${stats.avgRating?.toFixed(2) || "-"}`, 40, 82);
    let y = 110;
    for (const shelf of SHELVES) {
      const shelfItems = byShelf.get(shelf) || [];
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      const shelfIdx = Number(shelf.replace("polica-", "")) || 1;
      doc.setFontSize(12);
      doc.text(`Polica ${shelfIdx}`, 40, y);
      y += 16;
      if (shelfItems.length === 0) {
        doc.setFontSize(10);
        doc.text("- Prazna polica", 52, y);
        y += 14;
        continue;
      }
      shelfItems.forEach((item) => {
        if (y > 780) {
          doc.addPage();
          y = 50;
        }
        const line = `${String(item.product?.name || item.drinkId)} | ${String(item.product?.type || "tip?")} | ocena: ${item.userRating ?? "-"}`;
        doc.setFontSize(10);
        const image = String(pickBestProductImageUrl(item.product || {}) || "");
        if (image && image.startsWith("data:image/")) {
          try {
            doc.addImage(image, "JPEG", 52, y - 8, 14, 18);
          } catch {
            // ignore if image cannot be added
          }
        }
        doc.text(line.slice(0, 110), 72, y);
        y += 18;
      });
      y += 8;
    }
    doc.save(`moja-riznica-${Date.now()}.pdf`);
    showToast("Riznica exportovana u PDF.");
  };

  if (!uid) {
    return (
      <div className="min-h-screen bg-bg-base p-6 flex items-center justify-center text-center">
        <div className="card-elevated rounded-3xl border border-white/10 p-8 max-w-md w-full">
          <h1 className="text-2xl font-black text-white mb-2">Moja Riznica</h1>
          <p className="text-sm text-text-secondary">
            Za pristup Riznici potrebno je da budete prijavljeni Google nalogom.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base pb-24">
      <div className="sticky top-0 z-20 bg-bg-base/90 backdrop-blur border-b border-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-white">{`Moja Riznica (${items.length})`}</h1>
          <button
            type="button"
            onClick={exportPdf}
            className="px-3 py-2 rounded-xl border border-gold-500/30 text-gold-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          >
            <FileDown className="w-4 h-4" /> Export PDF
          </button>
        </div>
        {isOffline && (
          <p className="text-[11px] rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-1">
            Offline režim: prikaz iz cache-a, izmene mogu kasniti do ponovnog online stanja.
          </p>
        )}
        {errorMessage && (
          <p className="text-[11px] rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 px-2 py-1">{errorMessage}</p>
        )}
        {items.length >= MAX_RIZNICA_ITEMS && (
          <p className="text-[11px] rounded-lg bg-gold-500/10 border border-gold-500/30 text-gold-300 px-2 py-1">
            Dostigli ste limit od {MAX_RIZNICA_ITEMS} stavki. Uklonite neku stavku pre dodavanja nove.
          </p>
        )}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pretraga po nazivu ili tipu..."
            className="w-full pl-9 pr-3 py-3 rounded-xl bg-black/30 border border-white/15 text-base text-white"
          />
        </div>
        <div className="flex gap-2 overflow-auto">
          <button
            type="button"
            onClick={() => setFilterCategory(null)}
            className={`px-4 py-2 rounded-full text-sm border shadow-sm transition-colors ${filterCategory === null ? "border-gold-500 bg-gold-500/12 text-gold-300" : "border-white/25 bg-white/[0.06] text-white/85 hover:border-white/40"}`}
          >
            Sve
          </button>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterCategory(value as Exclude<RiznicaCategory, null>)}
              className={`px-4 py-2 rounded-full text-sm border shadow-sm transition-colors ${filterCategory === value ? "border-gold-500 bg-gold-500/12 text-gold-300" : "border-white/25 bg-white/[0.06] text-white/85 hover:border-white/40"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <ArrowUpDown className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="w-full pl-9 pr-3 py-3 rounded-xl bg-black/30 border border-white/15 text-base text-white"
          >
            <option value="added-desc">Sort: Najnovije dodato</option>
            <option value="rating-desc">Sort: Najviša ocena</option>
            <option value="shelf-asc">Sort: Po polici</option>
          </select>
        </div>
      </div>

      <div className="px-4 pt-4">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-gold-400" />
            <h2 className="text-sm font-black text-white uppercase tracking-wider">Deljenje Riznice</h2>
          </div>
          <p className="text-[10px] text-text-secondary">Link i QR kod su aktivni samo dok je riznica javna.</p>
          <button
            type="button"
            onClick={() =>
              void handlePrivacyChange({
                riznicaPublic: !privacy.riznicaPublic,
                riznicaPublicNotes: privacy.riznicaPublicNotes,
              })
            }
            className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2"
          >
            <div className="text-left">
              <p className="text-xs font-bold text-white">Učini Riznicu javnom</p>
              <p className="text-[10px] text-text-secondary">Omogućava javnu stranicu za deljenje preko linka i QR-a.</p>
            </div>
            <div className={`w-10 h-6 rounded-full p-1 transition-colors ${privacy.riznicaPublic ? "bg-gold-500" : "bg-white/15"}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${privacy.riznicaPublic ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </button>
          <button
            type="button"
            disabled={!privacy.riznicaPublic}
            onClick={() =>
              void handlePrivacyChange({
                riznicaPublic: privacy.riznicaPublic,
                riznicaPublicNotes: !privacy.riznicaPublicNotes,
              })
            }
            className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="text-left">
              <p className="text-xs font-bold text-white">Prikaži beleške javno</p>
              <p className="text-[10px] text-text-secondary">Vidljivo samo kada je javno deljenje uključeno.</p>
            </div>
            <div className={`w-10 h-6 rounded-full p-1 transition-colors ${privacy.riznicaPublicNotes ? "bg-gold-500" : "bg-white/15"}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${privacy.riznicaPublicNotes ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </button>
          <div className="rounded-xl border border-white/10 bg-black/20 p-2">
            <p className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Share link</p>
            <div className="flex items-center gap-2">
              <input value={shareUrl} readOnly className="flex-1 text-[11px] rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-white" />
              <button
                type="button"
                disabled={!privacy.riznicaPublic}
                onClick={async () => {
                  try {
                    if (isMobileSharePreferred) {
                      await navigator.share({
                        title: "Moja Riznica",
                        text: "Pogledaj moju javnu Riznicu",
                        url: shareUrl,
                      });
                      showToast("Link podeljen!", "success");
                    } else {
                      await navigator.clipboard.writeText(shareUrl);
                      showToast("Link kopiran!", "success");
                    }
                  } catch {
                    if (!isMobileSharePreferred) {
                      showToast("Kopiranje nije uspelo.");
                    }
                  }
                }}
                className="px-2 py-1.5 rounded-lg border border-gold-500/30 text-gold-300 text-[10px] font-bold inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMobileSharePreferred ? <Share2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {isMobileSharePreferred ? "Podeli" : "Kopiraj"}
              </button>
            </div>
          </div>
          {privacy.riznicaPublic && shareQrDataUrl ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 flex items-center gap-3">
              <img
                src={shareQrDataUrl}
                alt="QR kod za javnu Riznicu"
                className="w-28 h-28 rounded-xl bg-white p-2 border border-gold-500/35 shadow-[0_10px_30px_rgba(212,175,55,0.18)]"
              />
              <p className="text-[11px] text-text-secondary">QR vodi na javnu stranicu vaše Riznice.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] text-text-secondary">Uključite javnu Riznicu da biste koristili link i QR kod.</p>
            </div>
          )}
        </section>
      </div>

      <div className="p-4 grid grid-cols-2 gap-3">
        <StatCard icon={PackageOpen} label="Pića" value={String(Math.round(statsDrinksAnimated))} />
        <StatCard icon={Star} label="Prosek" value={stats.avgRating === null ? "-" : statsRatingAnimated.toFixed(2)} />
        <StatCard icon={Trophy} label="Top tip" value={stats.topType || "-"} />
      </div>
      {typeDistribution.length > 0 && (
        <div className="px-4 pb-2">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-gold-400 mb-2">Raspodela po tipu</p>
            <div className="space-y-2">
              {typeDistribution.map((row) => (
                <div key={row.type} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-white/85 truncate">{row.type}</span>
                    <span className="text-gold-300 font-bold">{row.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-gold-500/80 to-gold-300/80" style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-4 pb-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`stats-skeleton-${i}`} className="h-16 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`shelf-skeleton-${i}`} className="rounded-2xl border border-white/10 bg-white/5 h-40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-black/30 p-8 text-center">
            <PackageOpen className="w-10 h-10 mx-auto text-gold-400/70 mb-3" />
            <h2 className="text-xl font-black text-white mb-2">Riznica je trenutno prazna</h2>
            <p className="text-sm text-text-secondary mb-4">Dodaj prvo piće iz skenera i započni svoju digitalnu riznicu.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Link to="/scan" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold-500 text-black text-xs font-black uppercase tracking-wider shadow-[0_8px_20px_rgba(212,175,55,0.35)]">
                <ScanLine className="w-4 h-4" /> Skeniraj novo piće
              </Link>
              <Link to="/distilleries" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/20 text-white text-xs font-black uppercase tracking-wider">
                <Compass className="w-4 h-4" /> Idi na destilerije
              </Link>
              <Link to="/tonight" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gold-500/30 text-gold-300 text-xs font-black uppercase tracking-wider">
                <Sparkles className="w-4 h-4" /> Pogledaj večerašnje predloge
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5 px-4 pb-6">
          {SHELVES.map((shelfId, index) => {
            const shelfItems = byShelf.get(shelfId) || [];
            return (
              <section
                key={shelfId}
                className="relative [perspective:1000px]"
                aria-label={`Drop zona za policu ${index + 1}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const drinkId = e.dataTransfer.getData("text/plain");
                  if (drinkId) void moveDrinkToShelf(drinkId, shelfId);
                  setDraggingDrinkId(null);
                }}
                onPointerUp={() => {
                  if (draggingDrinkId) {
                    void moveDrinkToShelf(draggingDrinkId, shelfId);
                    setDraggingDrinkId(null);
                  }
                }}
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "translateY(0px)" : "translateY(8px)",
                  transition: "opacity 280ms ease, transform 320ms ease",
                  transitionDelay: `${index * 60}ms`,
                }}
              >
                <div className="text-sm uppercase tracking-[0.16em] text-gold-500/80 mb-2 font-black">
                  Polica {index + 1} • {index === 0 ? "Favoriti" : index === 1 ? "Specijalna rezerva" : index === 2 ? "Za poklon" : index === 3 ? "Probano" : "Ostalo"}
                </div>
                <div className="rounded-2xl border border-white/15 bg-gradient-to-b from-white/10 via-black/25 to-black/45 p-3 shadow-[0_30px_40px_rgba(0,0,0,0.35),inset_0_-16px_24px_rgba(0,0,0,0.45)] [transform:rotateX(1deg)]">
                  {shelfItems.length === 0 ? (
                    <p className="text-xs text-text-secondary py-4 text-center">Prazna polica</p>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
                      {shelfItems.map((item) => (
                        <BottleCard
                          key={item.drinkId}
                          item={item}
                          busy={workingDrinkId === item.drinkId}
                          onCategory={handleCategory}
                          onRemove={handleRemove}
                          onMoveShelf={moveDrinkToShelf}
                          onRating={updateRating}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          moved={movedDrinkId === item.drinkId}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] rounded-full border border-gold-500/30 bg-black/85 px-4 py-2 text-[11px] font-bold text-gold-300">
          <span className="inline-flex items-center gap-1.5">
            {toast.icon === "success" ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
            {toast.text}
          </span>
        </div>
      )}
      {(import.meta.env.DEV || localStorage.getItem("rakivinum_debug_riznica") === "1") && (
        <div className="fixed bottom-4 left-4 z-[95] rounded-xl border border-cyan-400/40 bg-black/80 px-3 py-2 text-[10px] text-cyan-200">
          <div>{`render: ${renderCountRef.current}`}</div>
          <div>{`mounts: ${mountCountRef.current}`}</div>
          <div>{`effect:data: ${dataEffectRunsRef.current}`}</div>
          <div>{`effect:privacy: ${privacyEffectRunsRef.current}`}</div>
          <div>{`effect:qr: ${qrEffectRunsRef.current}`}</div>
          <div>{`effect:auth: ${authEffectRunsRef.current}`}</div>
          <div>{`invalid:filtered ${filteredInvalidationsRef.current}`}</div>
          <div>{`invalid:stats ${statsInvalidationsRef.current}`}</div>
          <div>{`invalid:shelves ${shelvesInvalidationsRef.current}`}</div>
          <div>{`filtered: ${filteredComputeRef.current}`}</div>
          <div>{`stats: ${statsComputeRef.current}`}</div>
          <div>{`shelves: ${shelvesComputeRef.current}`}</div>
          <div>{`edgeCalls: ${getRiznicaDebugCounters().fetchEdgeRiznicaCalls}`}</div>
          <div>{`drinkHydrationCalls: ${getRiznicaDebugCounters().drinkHydrationCalls}`}</div>
        </div>
      )}
    </div>
  );
}

const StatCard = memo(function StatCard({
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
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-base font-black text-white truncate">{value}</div>
    </div>
  );
});

const BottleCard = memo(function BottleCard({
  item,
  busy,
  onCategory,
  onRemove,
  onMoveShelf,
  onRating,
  onDragStart,
  onDragEnd,
  moved,
}: {
  item: RiznicaViewItem;
  busy: boolean;
  onCategory: (drinkId: string, category: RiznicaCategory) => void;
  onRemove: (drinkId: string) => void;
  onMoveShelf: (drinkId: string, shelf: string) => void;
  onRating: (drinkId: string, rating: number | null) => void;
  onDragStart: (drinkId: string) => void;
  onDragEnd: () => void;
  moved: boolean;
}) {
  const cat = item.category && item.category in CATEGORY_THEME ? CATEGORY_THEME[item.category] : null;
  const CatIcon = cat?.icon;
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.drinkId);
        onDragStart(item.drinkId);
      }}
      onDragEnd={onDragEnd}
      className={`min-w-[11rem] sm:min-w-0 rounded-2xl border border-white/10 bg-black/40 p-2.5 transition-all duration-300 ${busy ? "opacity-60" : "hover:border-gold-500/40 hover:-translate-y-0.5 hover:shadow-[0_12px_20px_rgba(0,0,0,0.35)]"} ${moved ? "scale-[1.02] opacity-90 ring-1 ring-gold-400/50" : ""}`}
      aria-label={`Bočica ${String(item.product?.name || item.drinkId)}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary"><GripVertical className="w-3 h-3" /> Drag</span>
        {cat && CatIcon && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] ${cat.className}`}>
            <CatIcon className="w-3 h-3" />
            {CATEGORY_LABELS[item.category as Exclude<RiznicaCategory, null>]}
          </span>
        )}
      </div>
      <div className="h-32 rounded-xl bg-black overflow-hidden mb-2">
        <img
          src={pickBestProductImageUrl(item.product || {})}
          alt={String(item.product?.name || "Piće")}
          className="w-full h-full object-contain p-1 transition-transform duration-300 hover:scale-[1.03]"
          onError={(e) => {
            const el = e.target as HTMLImageElement;
            if (isImgFallbackUrl(el.src)) return;
            el.src = RAKIVINUM_MARK_FALLBACK;
          }}
        />
      </div>
      <p className="text-sm text-white font-bold truncate">{String(item.product?.name || item.drinkId)}</p>
      <p className="text-xs text-text-secondary mb-2 truncate">{String(item.product?.type || "Tip nepoznat")}</p>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gold-300 font-bold">{item.userRating ? `${item.userRating.toFixed(1)} ★` : "Bez ocene"}</span>
        <select
          value={item.userRating ?? ""}
          onChange={(e) => onRating(item.drinkId, e.target.value ? Number(e.target.value) : null)}
          className="text-xs rounded-md bg-black/40 border border-white/15 text-white px-2 py-1"
        >
          <option value="">Ocena</option>
          {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      <select
        value={item.category || ""}
        onChange={(e) => onCategory(item.drinkId, (e.target.value || null) as RiznicaCategory)}
        className="w-full text-xs rounded-lg bg-black/40 border border-white/15 text-white p-1.5 mb-2"
      >
        <option value="">Bez kategorije</option>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <div className="flex gap-1 mb-2">
        <button
          type="button"
          onClick={() => onRemove(item.drinkId)}
          className="w-full text-xs rounded-lg border border-red-500/40 text-red-300 py-1.5 inline-flex items-center justify-center gap-1"
        >
          <Trash2 className="w-3 h-3" /> Ukloni
        </button>
      </div>
      <select
        value={item.shelf || "polica-1"}
        onChange={(e) => onMoveShelf(item.drinkId, e.target.value)}
        className="w-full text-[10px] rounded-lg bg-black/40 border border-white/10 text-white p-1"
      >
        {SHELVES.map((s, idx) => (
          <option key={s} value={s}>{`Polica ${idx + 1}`}</option>
        ))}
      </select>
    </article>
  );
});
