import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bookmark, Trash2, ChevronRight, Info, Star } from "lucide-react";
import { auth, db } from "../lib/firebase";
import { collection, query, getDocs, doc, getDoc, deleteDoc, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getOrCreateVisitorId } from "../lib/visitorIdentity";

export default function Collection() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();

  const removePendingRatingEntry = (productId: string) => {
    try {
      const raw = localStorage.getItem("rakivinum_pending_ratings") || "[]";
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? parsed : [];
      const next = queue.filter((x: any) => x?.id !== productId);
      localStorage.setItem("rakivinum_pending_ratings", JSON.stringify(next));
      if (next.length > 0) {
        localStorage.setItem("rakivinum_pending_rating", JSON.stringify(next[0]));
      } else {
        localStorage.removeItem("rakivinum_pending_rating");
      }
      window.dispatchEvent(new Event("rakivinum_pending_ratings_changed"));
    } catch (e) {
      console.error("Error removing pending rating entry", e);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const fetchCollection = async () => {
      setLoading(true);
      
      let savedList: any[] = [];
      
      if (user) {
        const colRef = collection(db, 'users', user.uid, 'savedItems');
        const snapshot = await getDocs(colRef);
        savedList = snapshot.docs.map(d => ({ id: d.id, productId: d.data().productId, createdAt: d.data().createdAt }));
      } else {
        const visitorId = getOrCreateVisitorId();
        const guestSnap = await getDocs(
          query(collection(db, "guest_saved_items"), where("visitorId", "==", visitorId))
        );
        const remoteGuestList = guestSnap.docs.map((d) => ({
          id: d.id,
          productId: d.data().productId,
          isGuest: true,
          createdAt: d.data().createdAt,
        }));
        const historyStr = localStorage.getItem('rakivinum_guest_collection') || '[]';
        let localGuestList: any[] = [];
        try {
          const guestIds = JSON.parse(historyStr);
          if (Array.isArray(guestIds)) {
            localGuestList = guestIds.map((id) => ({
              id: `${visitorId}_${id}`,
              productId: id,
              isGuest: true,
            }));
          }
        } catch (e) {
          console.error("Error parsing local guest collection", e);
        }
        const byProduct = new Map<string, any>();
        [...remoteGuestList, ...localGuestList].forEach((item) => {
          if (!item?.productId) return;
          byProduct.set(String(item.productId), item);
        });
        savedList = Array.from(byProduct.values());
      }

      if (savedList.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }
      
      // Fetch product basic details for each saved item
      const detailedItems = await Promise.all(
        savedList.map(async (saved) => {
          const prodSnap = await getDoc(doc(db, 'products', saved.productId));
          if (prodSnap.exists()) {
            return {
              ...saved,
              product: { id: prodSnap.id, ...prodSnap.data() }
            };
          }
          return null;
        })
      );

      setItems(detailedItems.filter(i => i !== null));
      setLoading(false);
    };

    fetchCollection();
  }, [user]);

  const removeItem = async (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    
    if (item.isGuest) {
      const visitorId = getOrCreateVisitorId();
      const historyStr = localStorage.getItem('rakivinum_guest_collection') || '[]';
      try {
        let collection = JSON.parse(historyStr);
        collection = collection.filter((id: string) => id !== item.productId);
        localStorage.setItem('rakivinum_guest_collection', JSON.stringify(collection));
        await deleteDoc(doc(db, "guest_saved_items", `${visitorId}_${item.productId}`));
        removePendingRatingEntry(item.productId);
        setItems(prev => prev.filter(i => i.id !== item.id));
      } catch (e) {}
      return;
    }

    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'savedItems', item.id));
      removePendingRatingEntry(item.productId);
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (err) {
      console.error("Error removing item:", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base pb-24 animate-in fade-in duration-300">
        <div className="p-6 flex items-center gap-4 border-b border-white/5">
          <div className="w-12 h-12 rounded-2xl bg-white/5 motion-safe:animate-pulse" aria-hidden />
          <div className="flex-1 space-y-2">
            <div className="h-8 w-36 rounded-xl bg-white/10 motion-safe:animate-pulse" aria-hidden />
            <div className="h-3 w-28 rounded bg-white/5 motion-safe:animate-pulse" aria-hidden />
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/5 motion-safe:animate-pulse" aria-hidden />
        </div>
        <div className="p-4 space-y-4 relative z-10">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="card-elevated border border-white/8 rounded-[32px] p-4 flex gap-6 motion-safe:animate-pulse"
              aria-hidden
            >
              <div className="w-24 h-32 rounded-2xl bg-white/10 shrink-0" />
              <div className="flex-1 space-y-3 py-1">
                <div className="h-3 w-20 rounded bg-white/10" />
                <div className="h-7 w-full max-w-[220px] rounded-lg bg-white/10" />
                <div className="h-3 w-32 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
        <p className="sr-only">Učitavanje kolekcije…</p>
      </div>
    );
  }

  if (!user && items.length === 0) {
    return (
      <div className="min-h-screen bg-bg-base p-6 flex flex-col items-center justify-center text-center">
        <div className="empty-state card-elevated border border-white/8 w-full max-w-sm rounded-[32px] p-10 space-y-6">
          <div className="w-20 h-20 bg-gold-500/10 rounded-full flex items-center justify-center border border-gold-500/20 mx-auto">
            <Bookmark className="w-10 h-10 text-gold-500/50" aria-hidden />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-white italic">Kolekcija čeka</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              Skeniraj bocu i sačuvaj je — kolekcija se čuva na ovom uređaju i bez prijave. Prijavom Google nalogom postaje trajna.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => navigate("/scan")}
              className="w-full py-3.5 btn-primary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              Skeniraj bocu
            </button>
            <button
              type="button"
              onClick={() => navigate("/menu")}
              className="w-full py-3 btn-tertiary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              Prijavi se Google nalogom
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base pb-24 animate-in fade-in duration-700">
      {/* Dynamic Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-gold-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-gold-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <div className="p-4 sm:p-6 flex items-center gap-3 sm:gap-4 sticky top-0 bg-bg-base/80 backdrop-blur-xl z-30 border-b border-white/5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-gold-500 hover:text-black transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Arhiva</h1>
          <p className="ui-caption uppercase tracking-[0.2em] font-bold text-gold-500/80">Moja Kolekcija</p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shadow-lg shadow-gold-500/5">
            <Bookmark className="w-6 h-6 text-gold-500" />
        </div>
      </div>

      <div className="p-3 sm:p-4 relative z-10 max-w-lg mx-auto w-full">
        {items.length === 0 ? (
          <div className="py-12 sm:py-20 flex flex-col items-center justify-center text-center px-2 sm:px-4">
            <div className="empty-state card-elevated w-full max-w-md rounded-[32px] p-10 space-y-6">
              <div className="w-24 h-24 bg-gold-500/5 rounded-[28px] flex items-center justify-center border border-gold-500/15 mx-auto shadow-inner">
                <Info className="w-10 h-10 text-gold-500/40" aria-hidden />
              </div>
              <div className="space-y-2">
                <p className="text-2xl font-black text-white tracking-tight">Kolekcija je prazna</p>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Započnite digitalnu arhivu skeniranjem boca i klikom na „U kolekciju“.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="w-full py-4 btn-primary text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                Istraži pića
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:gap-6">
            {items.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/label/${item.product.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/label/${item.product.id}`);
                  }
                }}
                className="group relative card-soft card-elevated border border-white/8 rounded-[28px] sm:rounded-[32px] p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 active:scale-[0.99] sm:active:scale-[0.98] transition-all overflow-hidden hover:border-gold-500/30 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                {/* Decorative background glow */}
                <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-gold-500/5 blur-[40px] opacity-0 group-hover:opacity-100 motion-reduce:group-hover:opacity-0 transition-opacity" />

                <div className="w-[min(100%,9rem)] h-40 sm:w-24 sm:h-32 mx-auto sm:mx-0 rounded-2xl overflow-hidden bg-black shrink-0 border border-white/10 shadow-lg relative z-10">
                  <img 
                    src={item.product.bottleImageUrl || item.product.image || `https://picsum.photos/seed/${item.product.id}/200/300`} 
                    className="h-full w-full object-contain object-center p-1 transition-transform duration-500 sm:group-hover:scale-[1.02]" 
                    alt={item.product.name} 
                  />
                </div>

                <div className="flex-1 min-w-0 relative z-10 text-center sm:text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-gold-500/10 border border-gold-500/20 text-gold-500 rounded-md eyebrow-label tracking-[0.1em]">
                      {item.product.type}
                    </span>
                    <span className="text-[10px] text-text-secondary/70 font-bold uppercase tracking-wider">
                      {item.product.alcoholPercentage}% vol
                    </span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-black text-white leading-tight mb-2 sm:group-hover:text-gold-500 transition-colors">
                    {item.product.name}
                  </h3>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                     <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-gold-500 fill-gold-500" />
                        <span className="text-xs font-bold text-white">{(item.product.averageRating || 0).toFixed(1)}</span>
                     </div>
                     <span className="w-1 h-1 rounded-full bg-white/20 hidden sm:inline" aria-hidden />
                     <p className="ui-caption w-full sm:w-auto text-center sm:text-left sm:truncate font-medium text-text-secondary/90">
                        {item.createdAt ? `Sačuvano: ${new Date(item.createdAt?.seconds * 1000).toLocaleDateString('sr-RS')}` : 'Lokalni unos'}
                     </p>
                  </div>
                </div>

                <div className="flex flex-row sm:flex-col items-center justify-center gap-2 sm:gap-2 relative z-10 shrink-0 pt-1 sm:pt-0 border-t border-white/5 sm:border-t-0 mt-1 sm:mt-0">
                  <button
                    type="button"
                    onClick={(e) => removeItem(e, item)}
                    className="min-h-[48px] min-w-[48px] sm:min-h-0 sm:min-w-0 sm:w-12 sm:h-12 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center border border-red-500/20 hover:bg-red-500 hover:text-white transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    title="Ukloni iz kolekcije"
                    aria-label="Ukloni iz kolekcije"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <div
                    className="min-h-[48px] min-w-[48px] sm:min-h-0 sm:min-w-0 sm:w-12 sm:h-12 bg-white/5 text-text-secondary rounded-2xl flex items-center justify-center border border-white/5 opacity-100 translate-x-0 sm:opacity-0 sm:translate-x-4 sm:group-hover:opacity-100 sm:group-hover:translate-x-0 transition-all duration-500 pointer-events-none"
                    aria-hidden
                  >
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
