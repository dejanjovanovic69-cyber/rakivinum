import React from "react";
import { ChevronRight, Info, Sparkles, Star } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ProductItem } from "./types";

type TopsTabProps = {
  topRakija: ProductItem[];
  topVina: ProductItem[];
  topsReturnTo: string;
  openLabelWithReturn: (productId: string, returnTo: string) => void;
};

export default function TopsTab({ topRakija, topVina, topsReturnTo, openLabelWithReturn }: TopsTabProps) {
  return (
    <div className="card-elevated border border-white/8 rounded-[28px] overflow-hidden animate-in fade-in duration-300">
      <div className="p-4 space-y-6">
        <div className="space-y-0.5">
          <p className="eyebrow-label text-gold-500 flex items-center gap-1.5 px-1 mb-2">
            <Star className="w-3 h-3" /> Top 10 Rakija
          </p>
          {topRakija.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openLabelWithReturn(p.id, topsReturnTo)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gold-500/5 transition-all group active:scale-[0.99]"
            >
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
          {topRakija.length === 0 && <p className="text-[11px] text-text-secondary/60 italic px-3 py-2">Nema ocenjenih rakija.</p>}
        </div>

        <div className="border-t border-white/5" />

        <div className="space-y-0.5">
          <p className="eyebrow-label text-purple-400 flex items-center gap-1.5 px-1 mb-2">
            <Sparkles className="w-3 h-3" /> Top 10 Vina
          </p>
          {topVina.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openLabelWithReturn(p.id, topsReturnTo)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-purple-500/5 transition-all group active:scale-[0.99]"
            >
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
          {topVina.length === 0 && <p className="text-[11px] text-text-secondary/60 italic px-3 py-2">Nema ocenjenih vina.</p>}
        </div>

        <div className="flex items-start gap-2 p-3 bg-white/[0.03] border border-white/6 rounded-xl">
          <Info className="w-3 h-3 text-gold-500/70 shrink-0 mt-0.5" />
          <p className="text-[11px] text-text-secondary leading-relaxed italic">
            Top 10 se računa po prosečnoj oceni (`averageRating`) iz javnih utisaka. Rakije i vina se rangiraju odvojeno, prikazuju se samo artikli sa ocenom većom od 0, a lista se automatski osvežava kako pristižu nove ocene.
          </p>
        </div>
      </div>
    </div>
  );
}
