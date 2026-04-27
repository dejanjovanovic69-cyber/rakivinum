import React from "react";
import { ChevronRight, MapPin, Search, SearchSlash, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { DistilleryItem, FilterOption, ProductItem } from "./types";

type SearchResultsTabProps = {
  filterOptions: readonly FilterOption[];
  activeProductFilter: string;
  setActiveProductFilter: (value: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  filteredProducts: ProductItem[];
  filteredDistilleries: DistilleryItem[];
  hasSearchQuery: boolean;
  navigateToReviews: () => void;
  openLabelWithReturn: (productId: string, returnTo: string) => void;
  searchReturnTo: string;
  openDistillery: (distilleryId: string) => void;
  distLocation: (distillery: DistilleryItem) => string;
  onResetFilters: () => void;
};

export default function SearchResultsTab({
  filterOptions,
  activeProductFilter,
  setActiveProductFilter,
  searchQuery,
  setSearchQuery,
  filteredProducts,
  filteredDistilleries,
  hasSearchQuery,
  navigateToReviews,
  openLabelWithReturn,
  searchReturnTo,
  openDistillery,
  distLocation,
  onResetFilters,
}: SearchResultsTabProps) {
  return (
    <>
      <div className="overflow-x-auto grab-scrollbar -mx-4 px-4 pb-1">
        <div className="flex gap-2 min-w-max">
          {filterOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setActiveProductFilter(opt.id)}
              className={cn(
                "px-3.5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-200 active:scale-95 whitespace-nowrap",
                activeProductFilter === opt.id
                  ? "bg-gold-500 text-black border-gold-500 shadow-[0_4px_14px_rgba(212,175,55,0.28)]"
                  : "bg-bg-card border-white/10 text-text-secondary hover:border-white/25 hover:text-white",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6 animate-in fade-in">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-widest font-bold text-text-secondary">Pretraga</p>
          <button
            type="button"
            onClick={navigateToReviews}
            className="px-3 py-1.5 rounded-full border border-white/15 text-[10px] font-black uppercase tracking-wide text-text-secondary hover:text-white hover:border-white/35 transition-colors"
          >
            Nazad u Zajednicu
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pretraži proizvode, destilerije, vinarije…"
            className="w-full card-elevated border border-white/25 rounded-2xl py-4 pl-12 pr-12 text-white text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/35 focus-visible:border-gold-500/35"
            autoComplete="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Obriši"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {filteredProducts.length > 0 && (
          <div className="space-y-3">
            <h3 className="section-title px-1">Proizvodi ({filteredProducts.length})</h3>
            <div className="grid grid-cols-2 gap-3">
              {filteredProducts.map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => openLabelWithReturn(prod.id, searchReturnTo)}
                  className="card-elevated border border-white/8 rounded-[20px] p-3.5 flex flex-col items-center gap-2.5 text-center hover:border-gold-500/30 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                >
                  <div className="w-16 h-20 rounded-xl bg-black/60 border border-gold-500/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] flex items-center justify-center overflow-hidden">
                    <img
                      src={prod.bottleImageUrl || prod.image || `https://picsum.photos/seed/${prod.id}/200/300`}
                      className="h-full w-full object-contain object-center media-crisp p-0.5"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://picsum.photos/seed/rakivinum/200/200";
                      }}
                      alt={prod.name}
                    />
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="text-sm font-bold text-white line-clamp-1 leading-snug">{prod.name}</p>
                    <p className="eyebrow-label text-text-secondary/90 mt-0.5">{prod.type}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasSearchQuery && filteredDistilleries.length > 0 && (
          <div className="space-y-2">
            <h3 className="section-title px-1">Destilerije/Vinarije ({filteredDistilleries.length})</h3>
            {filteredDistilleries.map((dist) => (
              <button
                key={dist.id}
                type="button"
                onClick={() => openDistillery(dist.id)}
                className="w-full card-elevated border border-white/8 rounded-[20px] p-4 flex items-center justify-between gap-3 hover:border-gold-500/30 transition-all active:scale-[0.98] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                <div className="min-w-0">
                  <p className="font-bold text-white text-sm truncate">{dist.name}</p>
                  <p className="text-[11px] text-text-secondary mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-gold-500 shrink-0" />
                    {distLocation(dist)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {hasSearchQuery && filteredProducts.length === 0 && filteredDistilleries.length === 0 && (
          <div className="empty-state card-elevated max-w-md mx-auto py-10 px-6 text-center space-y-4 rounded-[28px]">
            <SearchSlash className="w-10 h-10 text-gold-500/35 mx-auto" aria-hidden />
            <p className="text-sm text-text-secondary leading-relaxed">{`Nema rezultata za „${searchQuery}"`}</p>
            <button type="button" onClick={onResetFilters} className="w-full max-w-xs mx-auto py-2.5 btn-tertiary text-[11px]">
              Resetuj filter
            </button>
          </div>
        )}
      </div>
    </>
  );
}
