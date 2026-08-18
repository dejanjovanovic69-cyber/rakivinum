import { Radar, RadarChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import { Star, Wine } from "lucide-react";
import { Link } from "react-router-dom";
import { pickBestProductImageUrl, isImgFallbackUrl, RAKIVINUM_MARK_FALLBACK } from "../../lib/imageFallback";

type Sensory = { aroma: number; taste: number; color: number; finish: number; harmony: number };

export type TonightDrink = {
  id: string;
  name: string;
  distilleryName: string;
  type?: string;
  image?: string;
  bottleImageUrl?: string;
  reason: string;
  userRating?: number | null;
  lastWeekRating?: number | null;
  sensoryScores?: Sensory | null;
  alcoholPercentage?: number;
  isFavorite?: boolean;
};

type Props = {
  item: TonightDrink;
  onDrinkNow: (item: TonightDrink) => void;
  onAddToMenu: (item: TonightDrink) => void;
  labelHref?: string;
};

export default function DrinkCard({ item, onDrinkNow, onAddToMenu, labelHref }: Props) {
  const radarData = item.sensoryScores
    ? [
        { k: "Miris", v: item.sensoryScores.aroma },
        { k: "Ukus", v: item.sensoryScores.taste },
        { k: "Čistoća", v: item.sensoryScores.color },
        { k: "Aftertaste", v: item.sensoryScores.finish },
        { k: "Harmonija", v: item.sensoryScores.harmony },
      ]
    : null;

  /**
   * Bez `onError` slomljena slika ostaje kao ikonica pokvarene slike: deo kataloga
   * pokazuje na hostove sa nevazecim sertifikatom (npr. sacera.rs), pa zahtev padne
   * jos pre nego sto stigne bilo kakav sadrzaj.
   */
  const thumb = (
    <img
      src={pickBestProductImageUrl(item)}
      alt={item.name}
      className="h-full w-full object-contain object-center p-1"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={(e) => {
        const el = e.currentTarget;
        if (!isImgFallbackUrl(el.src)) el.src = RAKIVINUM_MARK_FALLBACK;
      }}
    />
  );

  return (
    <article className="rounded-2xl border border-white/10 bg-bg-card p-4 space-y-3">
      <div className="flex gap-3">
        {labelHref ? (
          <Link to={labelHref} className="block h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
            {thumb}
          </Link>
        ) : (
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
            {thumb}
          </div>
        )}
        {labelHref ? (
          <Link to={labelHref} className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-black text-white">{item.name}</h4>
            <p className="truncate text-[11px] text-text-secondary">{item.distilleryName || "Proizvođač"}</p>
            <p className="mt-1 text-[11px] italic text-gold-300">{item.reason}</p>
            {item.isFavorite && (
              <span className="mt-1 inline-flex rounded-full border border-gold-500/50 bg-gold-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-gold-200">
                Tvoj favorit
              </span>
            )}
          </Link>
        ) : (
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-black text-white">{item.name}</h4>
            <p className="truncate text-[11px] text-text-secondary">{item.distilleryName || "Proizvođač"}</p>
            <p className="mt-1 text-[11px] italic text-gold-300">{item.reason}</p>
            {item.isFavorite && (
              <span className="mt-1 inline-flex rounded-full border border-gold-500/50 bg-gold-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-gold-200">
                Tvoj favorit
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5 text-gold-500" />
          Moja ocena:{" "}
          <strong className={typeof item.userRating === "number" ? "text-gold-300" : "text-text-secondary"}>
            {typeof item.userRating === "number" ? item.userRating.toFixed(1) : "—"}
          </strong>
        </span>
        {typeof item.lastWeekRating === "number" && (
          <span className="inline-flex items-center gap-1 text-gold-300">Prošla nedelja: {item.lastWeekRating.toFixed(1)}</span>
        )}
        <span className="inline-flex items-center gap-1">
          <Wine className="h-3.5 w-3.5 text-gold-500" />
          {typeof item.alcoholPercentage === "number" ? `${item.alcoholPercentage}%` : "n/a"}
        </span>
      </div>
      {radarData && (
        <div className="hidden h-36 rounded-xl border border-white/10 bg-black/20 p-2 md:block">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.14)" />
              <PolarAngleAxis dataKey="k" tick={{ fontSize: 9, fill: "#d7d7d7" }} />
              <PolarRadiusAxis domain={[0, 5]} tick={false} axisLine={false} />
              <Radar dataKey="v" stroke="#d4af37" fill="#d4af37" fillOpacity={0.35} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onDrinkNow(item)}
          className="flex-1 rounded-xl border border-gold-500/40 bg-gold-500/10 py-2 text-[11px] font-black uppercase tracking-wide text-gold-300"
        >
          Pijem ovo!
        </button>
        <button
          type="button"
          onClick={() => onAddToMenu(item)}
          className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-[11px] font-black uppercase tracking-wide text-white"
        >
          Dodaj u večerašnji meni
        </button>
      </div>
    </article>
  );
}

