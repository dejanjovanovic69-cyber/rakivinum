import React from "react";
import { Flag, Loader2, MessageCircle, Star, Users as UsersIcon } from "lucide-react";
import type { RatingItem } from "./types";

type ReviewsTabProps = {
  loading: boolean;
  visibleRatings: RatingItem[];
  reviewsReturnTo: string;
  openLabelWithReturn: (productId: string, returnTo: string) => void;
  handleReport: (e: React.MouseEvent, ratingId: string) => void | Promise<void>;
  safeStr: (value: unknown) => string;
  formatRatingDate: (value: RatingItem["createdAt"]) => string;
};

export default function ReviewsTab({
  loading,
  visibleRatings,
  reviewsReturnTo,
  openLabelWithReturn,
  handleReport,
  safeStr,
  formatRatingDate,
}: ReviewsTabProps) {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="card-elevated border border-white/8 rounded-[28px] overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-white/5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4 h-4 text-gold-500" />
          </div>
          <h3 className="text-sm font-black text-white uppercase tracking-widest italic">Utisci zajednice</h3>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 text-gold-500 animate-spin motion-reduce:animate-none" />
              <p className="text-sm text-text-secondary italic">Osluškujemo tajne buradi…</p>
            </div>
          ) : visibleRatings.length === 0 ? (
            <div className="empty-state py-12 text-center space-y-3">
              <MessageCircle className="w-10 h-10 text-gold-500/20 mx-auto" />
              <p className="text-text-secondary italic text-sm">Još nema ocena. Budi prvi!</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {visibleRatings.slice(0, 15).map((rating) => (
                <div
                  key={rating.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openLabelWithReturn(rating.productId, reviewsReturnTo)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openLabelWithReturn(rating.productId, reviewsReturnTo);
                    }
                  }}
                  className="py-5 first:pt-0 last:pb-0 cursor-pointer group hover:bg-white/[0.02] -mx-4 px-4 rounded-2xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                        <UsersIcon className="w-4 h-4 text-gold-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">Gost</p>
                        {rating.userLocation ? (
                          <p className="text-[11px] text-text-secondary/80 font-normal leading-snug mt-0.5 truncate" title={safeStr(rating.userLocation)}>
                            {safeStr(rating.userLocation)}
                          </p>
                        ) : null}
                        <p className="text-[10px] text-text-secondary/60 tabular-nums mt-0.5">
                          {formatRatingDate(rating.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-gold-500/10 px-2.5 py-1 rounded-lg border border-gold-500/20 shrink-0">
                      <Star className="w-3 h-3 text-gold-500 fill-current" />
                      <span className="text-xs font-black text-gold-500">{rating.rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start">
                    <div className="w-14 h-[72px] rounded-xl bg-black/60 border border-gold-500/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] overflow-hidden shrink-0">
                      <img
                        src={rating.productImage || `https://picsum.photos/seed/rakivinum_${rating.productId}/200/300`}
                        alt="Piće"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-contain object-center p-0.5 media-crisp group-hover:scale-[1.03] transition-transform duration-500"
                      />
                    </div>
                    <div className="flex-1 space-y-1.5 pt-0.5 min-w-0">
                      <h4 className="eyebrow-label text-gold-500/80 tracking-[0.12em] truncate">
                        {rating.productName || "Ekskluzivni Destilat"}
                      </h4>
                      <p className="text-text-primary text-[13px] leading-relaxed line-clamp-3 italic opacity-90">
                        „{rating.reviewText || rating.comment || "Vrhunski užitak i preporuka!"}"
                      </p>
                      <button
                        type="button"
                        onClick={(e) => handleReport(e, rating.id)}
                        className="ui-caption uppercase font-bold tracking-widest text-text-secondary/45 hover:text-red-400 transition-colors flex items-center gap-1 pt-1"
                      >
                        Prijavi <Flag className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
