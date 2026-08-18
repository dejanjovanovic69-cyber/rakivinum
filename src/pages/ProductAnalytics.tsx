import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Star,
  QrCode,
  TrendingUp,
  MapPin,
  MessageSquare,
  Lightbulb,
  Dna,
  Info,
  Download,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { cn } from "../lib/utils";
import {
  fetchScannerProductById,
  fetchPublicProductRatingSummary,
  fetchPublicProductRatings,
  fetchPublicScanClustersByProductId,
} from "../lib/dataService";
import { getReadSavingEstimate, isQuotaSaverActive } from "../lib/quotaSaver";
import { meterSavedReads } from "../lib/requestMeter";

type RatingDoc = {
  rating: number;
  reviewText?: string | null;
  createdAt?: { toDate: () => Date } | Date | null;
  sensoryScores?: {
    aroma: number;
    taste: number;
    color: number;
    finish: number;
    harmony: number;
  };
};

const RADAR_LABELS: { key: keyof NonNullable<RatingDoc["sensoryScores"]>; subject: string }[] = [
  { key: "aroma", subject: "Miris" },
  { key: "taste", subject: "Ukus" },
  { key: "color", subject: "Čistoća" },
  { key: "finish", subject: "Aftertaste" },
  { key: "harmony", subject: "Harmonija" },
];

function formatRelativeSr(date: Date): string {
  const diff = Date.now() - date.getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "Upravo sada";
  if (h < 24) return `Pre ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Juče";
  if (d < 7) return `Pre ${d} dana`;
  return date.toLocaleDateString("sr-RS");
}

export default function ProductAnalytics() {
  const QUOTA_SAVER = isQuotaSaverActive();
  const { id } = useParams();
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
    navigate("/admin", { replace: true });
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<{
    name: string;
    scanCount?: number;
    averageRating?: number;
    ratingCount?: number;
  } | null>(null);
  const [ratings, setRatings] = useState<RatingDoc[]>([]);
  const [scanClusters, setScanClusters] = useState<{ region: string; val: number }[]>([]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Nedostaje ID proizvoda.");
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await fetchScannerProductById(id);
        const summary = await fetchPublicProductRatingSummary(id);
        if (cancelled) return;

        if (!row) {
          setProduct(null);
          setError("Proizvod nije pronađen.");
          setLoading(false);
          return;
        }
        const pdata = row as Record<string, unknown>;
        setProduct({
          name: (pdata.name as string) || "Proizvod",
          scanCount: Number(summary?.scanCount ?? pdata.scanCount) || 0,
          averageRating:
            typeof summary?.averageRating === "number"
              ? summary.averageRating
              : typeof pdata.averageRating === "number"
                ? pdata.averageRating
                : undefined,
          ratingCount:
            typeof summary?.ratingCount === "number"
              ? summary.ratingCount
              : typeof pdata.ratingCount === "number"
                ? pdata.ratingCount
                : undefined,
        });

        if (cancelled) return;
        const list = await fetchPublicProductRatings(id, QUOTA_SAVER ? 120 : 200);
        if (cancelled) return;
        setRatings(
          list.map((r) => ({
            rating: typeof r.rating === "number" ? r.rating : Number(r.rating) || 0,
            reviewText: (r.reviewText ?? r.comment ?? null) as string | null | undefined,
            createdAt: r.createdAt as RatingDoc["createdAt"],
            sensoryScores: r.sensoryScores as RatingDoc["sensoryScores"],
          })),
        );

        const top = await fetchPublicScanClustersByProductId(id, QUOTA_SAVER ? 3 : 5);
        if (cancelled) return;
        setScanClusters(top);
        if (QUOTA_SAVER) {
          meterSavedReads(getReadSavingEstimate("distillery"), "ProductAnalytics:reduced ratings/cluster limits");
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Greška pri učitavanju podataka.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, QUOTA_SAVER]);

  const radarData = useMemo(() => {
    const withS = ratings.filter(
      (r) =>
        r.sensoryScores &&
        RADAR_LABELS.every(
          ({ key }) => typeof r.sensoryScores![key] === "number" && !Number.isNaN(r.sensoryScores![key])
        )
    );
    if (withS.length === 0) return null;
    return RADAR_LABELS.map(({ key, subject }) => ({
      subject,
      A:
        withS.reduce((sum, r) => sum + Number(r.sensoryScores![key]), 0) / withS.length,
      fullMark: 5,
    }));
  }, [ratings]);

  const trendData = useMemo(() => {
    const byDay = new Map<string, { sum: number; n: number }>();
    ratings.forEach((r) => {
      if (typeof r.rating !== "number") return;
      let d: Date;
      if (r.createdAt && typeof (r.createdAt as { toDate?: () => Date }).toDate === "function") {
        d = (r.createdAt as { toDate: () => Date }).toDate();
      } else if (r.createdAt instanceof Date) {
        d = r.createdAt;
      } else return;
      const key = d.toISOString().slice(0, 10);
      const cur = byDay.get(key) || { sum: 0, n: 0 };
      cur.sum += r.rating;
      cur.n += 1;
      byDay.set(key, cur);
    });
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([iso, v]) => ({
        day: new Date(iso + "T12:00:00").toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit" }),
        rating: Math.round((v.sum / v.n) * 100) / 100,
      }));
  }, [ratings]);

  const avgRating = useMemo(() => {
    if (ratings.length === 0) return null;
    const s = ratings.reduce((acc, r) => acc + (typeof r.rating === "number" ? r.rating : 0), 0);
    return Math.round((s / ratings.length) * 100) / 100;
  }, [ratings]);

  const trendDelta = useMemo(() => {
    if (trendData.length < 2) return null;
    const a = trendData[trendData.length - 2].rating;
    const b = trendData[trendData.length - 1].rating;
    return Math.round((b - a) * 100) / 100;
  }, [trendData]);

  const comments = useMemo(() => {
    return ratings
      .filter((r) => r.reviewText && String(r.reviewText).trim().length > 0)
      .slice(0, 12)
      .map((r) => {
        let d = new Date();
        if (r.createdAt && typeof (r.createdAt as { toDate?: () => Date }).toDate === "function") {
          d = (r.createdAt as { toDate: () => Date }).toDate();
        } else if (r.createdAt instanceof Date) d = r.createdAt;
        return {
          user: "Anonimni degustator",
          rating: Math.round(Number(r.rating) || 0),
          text: String(r.reviewText).trim(),
          date: formatRelativeSr(d),
        };
      });
  }, [ratings]);

  const convPct =
    product && product.scanCount > 0 && ratings.length > 0
      ? Math.min(100, Math.round((ratings.length / product.scanCount) * 100))
      : 0;

  const insightLines = useMemo(() => {
    const out: { title: string; body: string; highlight?: boolean }[] = [];
    if (avgRating != null && avgRating >= 4.5) {
      out.push({
        title: "Jak utisak kupaca",
        body: `Prosečna ocena na uzorku od ${ratings.length} ocena je ${avgRating.toFixed(1)}/5 — percepcija kvaliteta je visoka.`,
        highlight: true,
      });
    }
    if (trendDelta != null) {
      if (trendDelta > 0.05) {
        out.push({
          title: "Trend kvaliteta",
          body: `U poslednjim zabeleženim danima prosečna ocena raste (oko +${trendDelta.toFixed(2)} po koraku na grafikonu).`,
        });
      } else if (trendDelta < -0.05) {
        out.push({
          title: "Trend kvaliteta",
          body: `Poslednji segmenti pokazuju blagi pad proseka; vredi proveriti recenzije u donjem delu stranice.`,
        });
      }
    }
    if (scanClusters.length > 0) {
      out.push({
        title: "Geografski klasteri skenova",
        body: `Najviše skenova u uzorku: ${scanClusters[0].region} (${scanClusters[0].val}). Koordinate su grubo grupisane (bez adrese).`,
      });
    }
    if (out.length === 0) {
      out.push({
        title: "Skupljanje podataka",
        body:
          ratings.length === 0
            ? "Još nema ocena za ovaj proizvod. Podstaknite goste na sken i ocenu sa etikete."
            : "Kad bude više ocena sa tekstom i senzorskim profilom, uvid će biti bogatiji.",
      });
    }
    return out.slice(0, 3);
  }, [avgRating, ratings.length, trendDelta, scanClusters]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-2 border-gold-500/20 border-t-gold-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center p-6 text-center gap-4">
        <p className="text-text-secondary text-sm">{error || "Proizvod nije pronađen."}</p>
        <button
          type="button"
          onClick={goBackSafe}
          className="text-gold-500 text-xs font-bold uppercase"
        >
          Nazad
        </button>
      </div>
    );
  }

  const displayAvg = avgRating ?? product.averageRating ?? null;
  const displayRatingsCount = ratings.length || product.ratingCount || 0;
  const displayScans = product.scanCount ?? 0;

  const exportProductCSV = () => {
    if (!id) return;
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(["Polje", "Vrednost"].join(";"));
    lines.push(["Proizvod", esc(product.name)].join(";"));
    lines.push(["ID", id].join(";"));
    lines.push(["Skenova (proizvod)", String(displayScans)].join(";"));
    lines.push(["Ocena u uzorku", String(ratings.length)].join(";"));
    lines.push(["Prosek (uzorak)", displayAvg != null ? String(displayAvg) : ""].join(";"));
    lines.push(["Conv. %", displayScans > 0 ? String(convPct) : ""].join(";"));
    lines.push("");
    lines.push(["Dan", "Prosek ocene"].join(";"));
    trendData.forEach((t) => lines.push([t.day, String(t.rating)].join(";")));
    lines.push("");
    lines.push(["Klaster", "Broj skenova"].join(";"));
    scanClusters.forEach((c) => lines.push([esc(c.region), String(c.val)].join(";")));
    lines.push("");
    lines.push(["Tekst recenzije", "Ocena"].join(";"));
    comments.forEach((c) => lines.push([esc(c.text), String(c.rating)].join(";")));
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Proizvod_${id.slice(0, 12)}.csv`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-bg-base text-white p-4 pb-24 space-y-6">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex gap-3 text-left">
        <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-100/90 leading-relaxed">
          KPI, trend, komentari i klasteri skenova učitavaju se iz Firestore-a za ovaj proizvod. Senzorski radar
          prikazuje proseke samo kada ocene sadrže senzorski profil (kao sa etikete).
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={goBackSafe} className="p-2 -ml-2 text-text-secondary">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="text-center min-w-0 flex-1 px-2">
          <h1 className="text-lg font-bold truncate">{product.name}</h1>
          <p className="text-[10px] text-gold-500 font-bold uppercase tracking-widest">Deep Dive Analitika</p>
        </div>
        <button
          type="button"
          onClick={exportProductCSV}
          className="p-2 text-gold-500 hover:text-gold-400"
          title="Preuzmi CSV izveštaj"
        >
          <Download className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          {
            label: "Ocena",
            val: displayAvg != null ? displayAvg.toFixed(1) : "—",
            icon: Star,
            color: "text-gold-500",
          },
          {
            label: "Skenovi",
            val: displayScans >= 1000 ? `${(displayScans / 1000).toFixed(1)}k` : String(displayScans),
            icon: QrCode,
            color: "text-blue-400",
          },
          {
            label: "Ocene",
            val: String(displayRatingsCount),
            icon: MessageSquare,
            color: "text-green-400",
          },
          {
            label: "Conv",
            val: displayScans > 0 ? `${convPct}%` : "—",
            icon: TrendingUp,
            color: "text-purple-400",
          },
        ].map((kpi, idx) => (
          <div
            key={idx}
            className="bg-bg-card border border-border-subtle p-3 rounded-2xl flex flex-col items-center gap-1"
          >
            <kpi.icon className={cn("w-4 h-4", kpi.color)} />
            <span className="text-sm font-bold">{kpi.val}</span>
            <span className="text-[8px] text-text-secondary uppercase font-bold">{kpi.label}</span>
          </div>
        ))}
      </div>

      <div className="bg-bg-card border border-border-subtle p-5 rounded-[32px] space-y-4">
        <div className="flex items-center gap-2">
          <Dna className="w-4 h-4 text-gold-500" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Senzorski Profil</h3>
        </div>
        <div className="h-64 w-full flex justify-center">
          {radarData ? (
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.12)" />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 10, fontWeight: 700 }}
                />
                <PolarRadiusAxis domain={[0, 5]} tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 8 }} />
                <Radar
                  name={product.name}
                  dataKey="A"
                  stroke="var(--color-gold-500)"
                  fill="var(--color-gold-500)"
                  fillOpacity={0.4}
                />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-text-secondary italic self-center text-center px-4">
              Nema dovoljno ocena sa senzorskim skorovima (miris, ukus, …). Radar će se pojaviti kada korisnici
              ocenjuju preko etikete sa punim upitnikom.
            </p>
          )}
        </div>
      </div>

      <div className="bg-bg-card border border-border-subtle p-5 rounded-[32px] space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Trend Kvaliteta</h3>
          {trendDelta != null && (
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-bold",
                trendDelta >= 0 ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-400"
              )}
            >
              {trendDelta >= 0 ? "+" : ""}
              {trendDelta.toFixed(2)} poslednji korak
            </span>
          )}
        </div>
        <div className="h-40 w-full -ml-4">
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: "var(--color-text-secondary)" }}
                  dy={10}
                />
                <YAxis domain={[3, 5]} hide />
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-bg-card-elevated)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="rating"
                  stroke="var(--color-gold-500)"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "var(--color-gold-500)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-text-secondary italic text-center py-8">Nema vremenskog niza ocena.</p>
          )}
        </div>
      </div>

      <div className="bg-bg-card border border-border-subtle p-5 rounded-[32px] space-y-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gold-500" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Klasteri skeniranja</h3>
        </div>
        <div className="space-y-3">
          {scanClusters.length > 0 ? (
            scanClusters.map((loc, i) => (
              <div
                key={i}
                className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5"
              >
                <div>
                  <p className="text-xs font-bold">{loc.region}</p>
                  <p className="text-[10px] text-text-secondary">{loc.val} skenova (u uzorku)</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-text-secondary italic text-center py-2">
              Nema geolokacije u uzorku skenova ili skenovi nisu dostupni ovom nalogu.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-text-secondary px-2">Uvidi</h3>
        {insightLines.map((ins, i) => (
          <div
            key={i}
            className={cn(
              "p-4 rounded-3xl relative overflow-hidden border",
              ins.highlight
                ? "bg-gradient-to-br from-gold-500/20 to-transparent border-gold-500/20"
                : "bg-white/5 border-white/10"
            )}
          >
            <Lightbulb
              className={cn(
                "absolute -right-2 -bottom-2 w-16 h-16 rotate-12",
                ins.highlight ? "text-gold-500/10" : "text-white/5"
              )}
            />
            <div className="flex gap-3 relative z-10">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  ins.highlight ? "bg-gold-500/20" : "bg-white/10"
                )}
              >
                <TrendingUp className={cn("w-4 h-4", ins.highlight ? "text-gold-500" : "text-white/40")} />
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-bold">{ins.title}</p>
                <p className="text-[10px] text-text-secondary leading-relaxed">{ins.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-text-secondary px-2">Utisci sa tekstom</h3>
        <div className="space-y-3">
          {comments.length > 0 ? (
            comments.map((comment, i) => (
              <div key={i} className="bg-bg-card border border-border-subtle p-4 rounded-2xl space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-white/40">{comment.user}</span>
                  <span className="text-[10px] text-text-secondary">{comment.date}</span>
                </div>
                <p className="text-xs italic leading-relaxed text-text-primary/90">&quot;{comment.text}&quot;</p>
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, j) => (
                    <Star
                      key={j}
                      className={cn(
                        "w-2.5 h-2.5",
                        j < comment.rating ? "fill-gold-500 text-gold-500" : "text-white/10"
                      )}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-text-secondary italic text-center">Nema tekstualnih recenzija u uzorku.</p>
          )}
        </div>
      </div>
    </div>
  );
}



