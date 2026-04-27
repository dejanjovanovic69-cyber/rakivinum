import React from "react";
import { cn } from "../../lib/utils";
import type { CompareFilterOption, ProductItem } from "./types";

type CompareTabProps = {
  compareFilter: string;
  compareFilterOptions: readonly CompareFilterOption[];
  setCompareFilter: (value: string) => void;
  resetCompareSelection: () => void;
  compareLeftQuery: string;
  setCompareLeftQuery: (value: string) => void;
  compareRightQuery: string;
  setCompareRightQuery: (value: string) => void;
  compareLeftId: string;
  setCompareLeftId: (value: string) => void;
  compareRightId: string;
  setCompareRightId: (value: string) => void;
  leftCandidateList: ProductItem[];
  rightCandidateList: ProductItem[];
  compareLeft: ProductItem | null;
  compareRight: ProductItem | null;
  metricVal: (value: unknown) => number;
  openLabelWithReturn: (productId: string, returnTo: string) => void;
};

export default function CompareTab({
  compareFilter,
  compareFilterOptions,
  setCompareFilter,
  resetCompareSelection,
  compareLeftQuery,
  setCompareLeftQuery,
  compareRightQuery,
  setCompareRightQuery,
  compareLeftId,
  setCompareLeftId,
  compareRightId,
  setCompareRightId,
  leftCandidateList,
  rightCandidateList,
  compareLeft,
  compareRight,
  metricVal,
  openLabelWithReturn,
}: CompareTabProps) {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="card-elevated border border-white/8 rounded-[28px] p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="section-title">Uporedi 2 artikla</h3>
          <button
            type="button"
            onClick={resetCompareSelection}
            className="px-2.5 py-1.5 rounded-lg border border-white/15 text-[10px] font-black uppercase tracking-wider text-text-secondary hover:text-white hover:border-gold-500/35 transition-colors"
          >
            Reset
          </button>
        </div>

        <div className="overflow-x-auto grab-scrollbar -mx-1 px-1 pb-1">
          <div className="flex gap-2 min-w-max">
            {compareFilterOptions.map((opt) => (
              <button
                key={`cmp-filter-${opt.id}`}
                type="button"
                onClick={() => {
                  if (opt.id !== compareFilter) {
                    setCompareFilter(opt.id);
                    setCompareLeftId("");
                    setCompareRightId("");
                    setCompareLeftQuery("");
                    setCompareRightQuery("");
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors",
                  compareFilter === opt.id
                    ? "bg-gold-500 text-black border-gold-500"
                    : "bg-bg-card border-white/10 text-text-secondary hover:text-white hover:border-white/25",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] text-text-secondary uppercase tracking-widest font-bold">Prvi artikal</label>
            <input
              type="search"
              value={compareLeftQuery}
              onChange={(e) => {
                setCompareLeftQuery(e.target.value);
                setCompareLeftId("");
              }}
              placeholder="Pretraži naziv..."
              className="w-full bg-bg-card-elevated border border-white/10 rounded-xl py-2.5 px-3 text-[12px] text-white"
            />
            {!compareLeft && (
              <div className="max-h-44 overflow-y-auto rounded-xl border border-white/8 bg-black/20">
                {leftCandidateList.length > 0 ? (
                  leftCandidateList.map((p) => (
                    <button
                      key={`left-match-${p.id}`}
                      type="button"
                      onClick={() => {
                        setCompareLeftId(p.id);
                        setCompareLeftQuery(p.name || "");
                      }}
                      className="w-full px-3 py-2 text-left border-b border-white/5 last:border-b-0 hover:bg-white/5"
                    >
                      <p className="text-[12px] font-semibold text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-text-secondary">Ocena {(p.averageRating || 0).toFixed(1)}</p>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-[11px] text-text-secondary italic">Nema rezultata.</p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-text-secondary uppercase tracking-widest font-bold">Drugi artikal</label>
            <input
              type="search"
              value={compareRightQuery}
              onChange={(e) => {
                setCompareRightQuery(e.target.value);
                setCompareRightId("");
              }}
              placeholder="Pretraži naziv..."
              className="w-full bg-bg-card-elevated border border-white/10 rounded-xl py-2.5 px-3 text-[12px] text-white"
            />
            {!compareRight && (
              <div className="max-h-44 overflow-y-auto rounded-xl border border-white/8 bg-black/20">
                {rightCandidateList.length > 0 ? (
                  rightCandidateList.map((p) => (
                    <button
                      key={`right-match-${p.id}`}
                      type="button"
                      onClick={() => {
                        setCompareRightId(p.id);
                        setCompareRightQuery(p.name || "");
                      }}
                      className="w-full px-3 py-2 text-left border-b border-white/5 last:border-b-0 hover:bg-white/5"
                    >
                      <p className="text-[12px] font-semibold text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-text-secondary">Ocena {(p.averageRating || 0).toFixed(1)}</p>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-[11px] text-text-secondary italic">Nema rezultata.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {compareLeft && compareRight ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[compareLeft, compareRight].map((p) => (
                <div key={`cmp-card-${p.id}`} className="rounded-xl border border-white/10 bg-bg-card p-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      const rt = `/community?tab=compare&cf=${encodeURIComponent(compareFilter)}&l=${encodeURIComponent(compareLeftId)}&r=${encodeURIComponent(compareRightId)}&lq=${encodeURIComponent(compareLeftQuery)}&rq=${encodeURIComponent(compareRightQuery)}`;
                      openLabelWithReturn(p.id, rt);
                    }}
                    className="w-full rounded-xl overflow-hidden border border-gold-500/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] bg-black/60"
                    title="Otvori etiketu"
                  >
                    <img
                      src={p.bottleImageUrl || p.image || `https://picsum.photos/seed/${p.id}/220/320`}
                      alt={p.name || "Piće"}
                      className="w-full h-36 object-contain object-center p-2 media-crisp"
                    />
                  </button>
                  <p className="text-[11px] font-black text-white line-clamp-2">{p.name || "Piće"}</p>
                  <p className="text-[10px] text-text-secondary">Tip: {p.type || "—"}</p>
                  <p className="text-[10px] text-gold-500 font-bold">Ocena: {(p.averageRating || 0).toFixed(1)}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Sažetak poređenja</p>
              <div className="space-y-1 text-[11px]">
                <p className="text-white/90">
                  Prosečna ocena:{" "}
                  <span className={cn(metricVal(compareLeft.averageRating) >= metricVal(compareRight.averageRating) ? "text-gold-500 font-bold" : "text-white")}>
                    {compareLeft.name}
                  </span>{" "}
                  {metricVal(compareLeft.averageRating) === metricVal(compareRight.averageRating)
                    ? "je izjednačena sa"
                    : metricVal(compareLeft.averageRating) > metricVal(compareRight.averageRating)
                      ? "ima višu ocenu od"
                      : "ima nižu ocenu od"}{" "}
                  <span className={cn(metricVal(compareRight.averageRating) >= metricVal(compareLeft.averageRating) ? "text-gold-500 font-bold" : "text-white")}>
                    {compareRight.name}
                  </span>.
                </p>
                <p className="text-white/80">
                  Alkohol: {typeof compareLeft.alcoholPercentage === "number" ? `${compareLeft.alcoholPercentage}%` : "—"} vs{" "}
                  {typeof compareRight.alcoholPercentage === "number" ? `${compareRight.alcoholPercentage}%` : "—"}.
                </p>
                <p className="text-white/70 italic">Napomena: rang i poređenje su bazirani na trenutno dostupnim javnim ocenama zajednice.</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-text-secondary italic">
            Pronađi i izaberi 2 artikla da vidiš ozbiljno poređenje (slike, ocene i sažetak).
          </p>
        )}
      </div>
    </div>
  );
}
