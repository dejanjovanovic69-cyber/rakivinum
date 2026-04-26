import React, { useEffect, useState } from "react";
import { Star, X, Bell } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Da" : "Ne";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const city = typeof o.city === "string" ? o.city.trim() : "";
    const address = typeof o.address === "string" ? o.address.trim() : "";
    if (city || address) return [city, address].filter(Boolean).join(", ");
  }
  return "";
}

export default function NotificationSystem() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showNotification, setShowNotification] = useState(false);
  const [pendingData, setPendingData] = useState<{ id: string; name: string } | null>(null);
  type PendingQueueItem = { id: string; name: string; timestamp: number };

  useEffect(() => {
    const getPendingQueue = (): PendingQueueItem[] => {
      try {
        const raw = localStorage.getItem('rakivinum_pending_ratings') || '[]';
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((x: unknown) => {
            const item = x as Partial<PendingQueueItem> | null;
            return {
              id: String(item?.id || ""),
              name: safeText(item?.name) || "Piće",
              timestamp: Number(item?.timestamp || 0),
            };
          })
          .filter((x) => x.id.length > 0 && Number.isFinite(x.timestamp) && x.timestamp > 0);
      } catch {
        return [];
      }
    };

    const setPendingQueue = (queue: PendingQueueItem[]) => {
      const normalized = (Array.isArray(queue) ? queue : [])
        .map((x: PendingQueueItem) => ({
          id: String(x?.id || ""),
          name: safeText(x?.name) || "Piće",
          timestamp: Number(x?.timestamp || 0),
        }))
        .filter((x) => x.id.length > 0 && Number.isFinite(x.timestamp) && x.timestamp > 0);
      localStorage.setItem('rakivinum_pending_ratings', JSON.stringify(normalized));
      window.dispatchEvent(new Event('rakivinum_pending_ratings_changed'));
      if (normalized[0]) {
        localStorage.setItem('rakivinum_pending_rating', JSON.stringify(normalized[0]));
      } else {
        localStorage.removeItem('rakivinum_pending_rating');
      }
    };

    const checkPendingRatings = () => {
      const queue = getPendingQueue();
      const legacy = localStorage.getItem('rakivinum_pending_rating');
      if (queue.length === 0 && legacy) {
        try {
          const legacyData = JSON.parse(legacy);
          if (legacyData?.id) {
            queue.push({
              id: legacyData.id,
              name: safeText(legacyData.name) || "Piće",
              timestamp: Number(legacyData.timestamp || Date.now()),
            });
            setPendingQueue(queue);
          }
        } catch {
          return;
        }
      }
      if (queue.length === 0) return;

      try {
          const data = queue[0];
        const scanTime = new Date(data.timestamp);
        const now = new Date();
        
        // "Sutradan" - Check if it's at least 12 hours later AND it's next calendar day
        const isNextDay = now.getDate() !== scanTime.getDate() || now.getMonth() !== scanTime.getMonth();
        const hoursDiff = (now.getTime() - scanTime.getTime()) / (1000 * 60 * 60);
        
        // User requested around 11h or 12h. 
        // We check if it's at least 11 AM and the next day.
        const currentHour = now.getHours();
        
        if (isNextDay && hoursDiff >= 12 && currentHour >= 11) {
          const visitorId = localStorage.getItem('rakivinum_visitor_id');
          const ymd = now.toISOString().slice(0, 10);
          const hasRatedGlobal = visitorId && localStorage.getItem(`rakivinum_rated_day_${visitorId}`) === ymd;

          if (!hasRatedGlobal) {
            setPendingData({
              id: String(data?.id || ""),
              name: safeText(data?.name) || "Piće",
            });
            setShowNotification(true);
          } else {
            // Already rated today, keep queue and try later.
          }
        }
      } catch (e) {
        console.error("Error parsing pending rating", e);
      }
    };

    // Initial check
    checkPendingRatings();
    const onFocusCheck = () => {
      if (document.visibilityState !== "visible") return;
      checkPendingRatings();
    };
    const onVisibilityCheck = () => {
      if (document.visibilityState !== "visible") return;
      checkPendingRatings();
    };
    window.addEventListener("focus", onFocusCheck);
    document.addEventListener("visibilitychange", onVisibilityCheck);
    return () => {
      window.removeEventListener("focus", onFocusCheck);
      document.removeEventListener("visibilitychange", onVisibilityCheck);
    };
  }, []);

  const handleAction = () => {
    if (pendingData) {
      const returnTo = `${location.pathname}${location.search}`;
      try {
        sessionStorage.setItem("rakivinum_last_label_return_v1", returnTo);
      } catch {
        // ignore storage errors
      }
      navigate(`/label/${pendingData.id}?autoRate=true&rt=${encodeURIComponent(returnTo)}`, {
        state: { returnTo },
      });
      setShowNotification(false);
      const queue = (() => {
        try {
          const raw = localStorage.getItem('rakivinum_pending_ratings') || '[]';
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      const next = queue.filter((x: PendingQueueItem) => x?.id !== pendingData.id);
      localStorage.setItem('rakivinum_pending_ratings', JSON.stringify(next));
      if (next[0]) {
        localStorage.setItem('rakivinum_pending_rating', JSON.stringify(next[0]));
      } else {
        localStorage.removeItem('rakivinum_pending_rating');
      }
    }
  };

  const handleClose = () => {
    setShowNotification(false);
    // Don't remove from storage yet, maybe they want to be reminded later? 
    // Actually, for better UX, let's just snooze it for 4 hours
    const snoozeTime = new Date().getTime() + (4 * 60 * 60 * 1000);
    if (pendingData) {
       localStorage.setItem('rakivinum_pending_rating', JSON.stringify({ ...pendingData, timestamp: snoozeTime }));
    }
  };

  return (
    <AnimatePresence>
      {showNotification && pendingData && (
        <motion.div 
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 20, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-[200] px-4 pointer-events-none"
        >
          <div className="max-w-sm mx-auto bg-bg-card-elevated border border-gold-500/30 rounded-2xl p-4 shadow-2xl shadow-black pointer-events-auto backdrop-blur-xl">
            <div className="flex gap-4">
              <div className="w-12 h-12 bg-gold-500/10 rounded-xl flex items-center justify-center shrink-0 border border-gold-500/20">
                <Bell className="w-6 h-6 text-gold-500 animate-bounce motion-reduce:animate-none" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="eyebrow-label text-gold-500 tracking-[0.12em]">Rakivinum Mreža</p>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="p-1.5 rounded-full text-text-secondary hover:bg-white/5 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
                    aria-label="Zatvori obaveštenje"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs font-bold text-white leading-tight">
                  Utisci su se slegli. Kako ti se juče svidelo piće <span className="text-gold-500">{safeText(pendingData.name) || "Piće"}</span>?
                </p>
                <p className="ui-caption text-text-secondary/95 normal-case tracking-normal">
                  Oceni proizvod ako ti se dopao i sačuvaj ga u kolekciju.
                </p>
                
                <div className="pt-2">
                  <button 
                    type="button"
                    onClick={handleAction}
                    className="w-full py-2.5 btn-primary text-[11px] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
                  >
                    <Star className="w-3.5 h-3.5 fill-current shrink-0" /> Oceni odmah
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
