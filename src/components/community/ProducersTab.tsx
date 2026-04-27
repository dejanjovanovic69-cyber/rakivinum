import React from "react";
import { CheckCircle, ChevronRight, Compass, Loader2, MapPin, Search, SearchSlash, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { DistilleryItem } from "./types";

type ProducersTabProps = {
  distilleries: DistilleryItem[];
  producerView: "regions" | "list";
  setProducerView: (view: "regions" | "list") => void;
  selectedRegion: string;
  setSelectedRegion: (value: string) => void;
  producerSearch: string;
  setProducerSearch: (value: string) => void;
  filteredMapDistilleries: DistilleryItem[];
  isCatalogLoaded: boolean;
  tabCls: (active: boolean) => string;
  onOpenDistillery: (distilleryId: string) => void;
};

export default function ProducersTab({
  distilleries,
  producerView,
  setProducerView,
  selectedRegion,
  setSelectedRegion,
  producerSearch,
  setProducerSearch,
  filteredMapDistilleries,
  isCatalogLoaded,
  tabCls,
  onOpenDistillery,
}: ProducersTabProps) {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="relative overflow-hidden card-elevated border border-white/8 rounded-[28px] p-4">
        <div className="absolute -right-8 -top-8 w-36 h-36 bg-gold-500/8 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5 text-gold-500 animate-[spin_12s_linear_infinite] motion-reduce:animate-none" />
          </div>
          <div>
            <h3 className="text-base font-black text-white italic leading-tight">Rakijski i vinski putevi</h3>
            <p className="text-[11px] text-text-secondary mt-0.5">{distilleries.length} sertifikovanih proizvođača</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 p-1 card-elevated border border-white/10 rounded-2xl">
        <button type="button" onClick={() => setProducerView("regions")} className={tabCls(producerView === "regions")}>
          Po regiji
        </button>
        <button type="button" onClick={() => setProducerView("list")} className={tabCls(producerView === "list")}>
          Lista
        </button>
      </div>

      {producerView === "regions" && (
        <div className="card-elevated border border-white/8 rounded-[28px] p-4 space-y-3">
          <p className="eyebrow-label text-text-secondary px-1">Izaberi regiju</p>
          <div className="grid grid-cols-2 gap-2">
            {["Sve", "Beograd", "Vojvodina", "Šumadija", "Zapadna Srbija", "Istočna Srbija", "Južna Srbija", "Ostalo"].map((reg) => {
              const active = reg === "Sve" ? selectedRegion === "" : selectedRegion === reg;
              return (
                <button
                  key={reg}
                  type="button"
                  onClick={() => {
                    setSelectedRegion(reg === "Sve" ? "" : reg);
                    setProducerView("list");
                  }}
                  className={cn(
                    "py-3 px-3 rounded-2xl border text-[11px] font-black uppercase tracking-wide transition-all duration-200 active:scale-95 text-center",
                    active
                      ? "bg-gold-500 border-gold-500 text-black shadow-[0_4px_12px_rgba(212,175,55,0.22)]"
                      : "bg-bg-card border-white/8 text-text-secondary hover:border-gold-500/40 hover:text-white",
                  )}
                >
                  {reg}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {producerView === "list" && (
        <div className="card-elevated border border-white/8 rounded-[28px] p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" aria-hidden />
            <input
              type="search"
              value={producerSearch}
              onChange={(e) => setProducerSearch(e.target.value)}
              placeholder="Pretraži po imenu, regiji…"
              className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-[13px] text-white transition-all outline-none"
              autoComplete="off"
            />
          </div>
          {selectedRegion && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-secondary">Regija:</span>
              <button
                type="button"
                onClick={() => setSelectedRegion("")}
                className="flex items-center gap-1 px-2.5 py-1 bg-gold-500/10 border border-gold-500/25 rounded-full text-[10px] font-bold text-gold-500 hover:bg-gold-500/20 transition-colors"
              >
                {selectedRegion} <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {filteredMapDistilleries.length > 0 ? (
            <div className="space-y-2">
              {filteredMapDistilleries.map((dist) => (
                <button
                  key={dist.id}
                  type="button"
                  onClick={() => onOpenDistillery(dist.id)}
                  className="w-full card-soft border border-white/8 rounded-2xl p-4 flex items-center justify-between gap-3 hover:border-gold-500/30 transition-all active:scale-[0.98] group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 bg-black border-2 border-white/10 group-hover:border-gold-500/50 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-[0_0_0_1px_rgba(212,175,55,0.06)] transition-all duration-300">
                      {dist.logoUrl ? (
                        <img src={dist.logoUrl} alt={dist.name} className="w-full h-full object-contain p-1 media-crisp" />
                      ) : (
                        <span className="text-gold-500 font-black font-serif text-lg">{String(dist.name || "D").charAt(0)}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-black text-white text-sm truncate leading-snug">{dist.name}</p>
                        {dist.isVerified && (
                          <span className="inline-flex items-center gap-0.5 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-green-400 uppercase shrink-0">
                            <CheckCircle className="w-2.5 h-2.5 fill-current" /> Sertif.
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-gold-500 shrink-0" />
                        <span className="text-[10px] text-text-secondary uppercase tracking-wide truncate">{dist.region || "Srbija"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-gold-500 group-hover:text-black transition-all shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          ) : isCatalogLoaded ? (
            <div className="empty-state py-10 text-center space-y-2">
              <SearchSlash className="w-8 h-8 text-white/15 mx-auto" />
              <p className="text-text-secondary text-sm">Nema proizvođača za izabrane kriterijume.</p>
            </div>
          ) : (
            <div className="py-14 text-center">
              <Loader2 className="w-8 h-8 text-gold-500/30 animate-spin motion-reduce:animate-none mx-auto mb-3" />
              <p className="text-text-secondary text-sm">Učitavanje…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
