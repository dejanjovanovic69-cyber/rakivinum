import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { collection, query, where, getDocs, doc, getDoc, deleteDoc, onSnapshot, limit } from "firebase/firestore";
import { ArrowLeft, Gift, ShieldX, Loader2, Star, CheckCircle2, ChevronRight, Users } from "lucide-react";
import { cn } from "../lib/utils";

/** Firestore / legacy podaci ponekad imaju mapu lokacije umesto stringa — React ne sme renderovati objekat kao dete. */
function safeReactText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Da" : "Ne";
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    const city = typeof o.city === "string" ? o.city.trim() : "";
    const address = typeof o.address === "string" ? o.address.trim() : "";
    if (city || address) return [city, address].filter(Boolean).join(", ");
  }
  return "";
}

function safeCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return 0;
}

export default function MyClubs() {
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const visitorId = localStorage.getItem('rakivinum_visitor_id');

  useEffect(() => {
    if (!visitorId) {
      setIsLoading(false);
      return;
    }

    const fetchClubs = async () => {
      setIsLoading(true);
      try {
        // Fetch memberships from Firestore FIRST
        const qMemberships = query(collection(db, 'club_memberships'), where('visitorId', '==', visitorId));
        const membershipSnap = await getDocs(qMemberships);
        const joinedClubsIds = membershipSnap.docs.map(doc => doc.data().distilleryId);
        
        // Secondary fallback to local storage
        const storageKey = `clubs_${visitorId}`;
        const localJoined = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const allIds = Array.from(new Set([...joinedClubsIds, ...localJoined]));

        if (allIds.length === 0) {
          setClubs([]);
          setIsLoading(false);
          return;
        }

        const clubsData: any[] = [];

        for (const id of allIds) {
          // Fetch Distillery Info
          const dRef = doc(db, 'distilleries', id);
          const dSnap = await getDoc(dRef);
          
          if (!dSnap.exists()) continue;

          const distillery = { id: dSnap.id, ...dSnap.data() };
          
          // Fetch Active Actions for this club
          const qActions = query(
            collection(db, 'club_actions'), 
            where('distilleryId', '==', id),
            where('isActive', '==', true)
          );
          const actionsSnap = await getDocs(qActions);
          const actions = actionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

          // Calculate Progress for each action
          const actionsWithProgress = await Promise.all(actions.map(async (action: any) => {
            let currentScans = 0;
            let currentRatings = 0;
            
            // Get Scans
            const qScans = query(
              collection(db, 'scans'),
              where('visitorId', '==', visitorId),
              where('distilleryId', '==', id),
              limit(500)
            );
            const scansSnap = await getDocs(qScans);
            currentScans = scansSnap.size;

            // Get Ratings
            const qRatings = query(
              collection(db, 'ratings'),
              where('visitorId', '==', visitorId),
              where('distilleryId', '==', id),
              where('rating', '>=', 4.5),
              limit(500)
            );
            const ratingsSnap = await getDocs(qRatings);
            currentRatings = ratingsSnap.size;

            let progress = 0;
            let targets = [];
            
            if (action.condition === 'combined_automated') {
              const scanProgress = Math.min(currentScans / (action.targetScans || 1), 1);
              const ratingProgress = Math.min(currentRatings / (action.targetRatings || 1), 1);
              progress = ((scanProgress + ratingProgress) / 2) * 100;
              targets = [
                { label: 'Skenovi', current: currentScans, target: action.targetScans },
                { label: 'Ocene', current: currentRatings, target: action.targetRatings }
              ];
            } else if (action.condition === '3_scans') {
              progress = (currentScans / (action.targetValue || 3)) * 100;
              targets = [{ label: 'Skenovi', current: currentScans, target: action.targetValue || 3 }];
            } else if (action.condition === 'high_rating') {
              progress = (currentRatings / (action.targetValue || 1)) * 100;
              targets = [{ label: 'Ocene', current: currentRatings, target: action.targetValue || 1 }];
            }

            return { 
              ...action, 
              progress: Math.min(progress, 100),
              targets 
            };
          }));

          clubsData.push({
            ...distillery,
            name: safeReactText((distillery as any)?.name) || "Destilerija",
            logoUrl: typeof (distillery as any)?.logoUrl === "string" ? (distillery as any).logoUrl : "",
            actions: actionsWithProgress.map((a: any) => ({
              ...a,
              title: safeReactText(a?.title) || "Akcija",
              conditionLabel: safeReactText(a?.conditionLabel),
              rewardValue: safeReactText(a?.rewardValue),
              progress: Math.max(0, Math.min(100, safeCount(a?.progress))),
              targets: Array.isArray(a?.targets)
                ? a.targets.map((t: any) => ({
                    label: safeReactText(t?.label) || "Cilj",
                    current: safeCount(t?.current),
                    target: Math.max(1, safeCount(t?.target)),
                  }))
                : [],
            })),
          });
        }

        setClubs(clubsData);
      } catch (err) {
        console.error("Error fetching clubs", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchClubs();
  }, [visitorId]);

  const leaveClub = async (distilleryId: string) => {
    if (!confirm("Da li ste sigurni da želite da napustite ovaj klub? Sav vaš napredak ka nagradama u ovom klubu će biti izgubljen.")) return;

    try {
      // Update LocalStorage
      const storageKey = `clubs_${visitorId}`;
      let joined = JSON.parse(localStorage.getItem(storageKey) || '[]');
      joined = joined.filter((id: string) => id !== distilleryId);
      localStorage.setItem(storageKey, JSON.stringify(joined));

      // Update Firestore
      const q = query(
        collection(db, 'club_memberships'), 
        where('visitorId', '==', visitorId), 
        where('distilleryId', '==', distilleryId)
      );
      const snap = await getDocs(q);
      snap.forEach(async (d) => {
        await deleteDoc(doc(db, 'club_memberships', d.id));
      });

      // Update State
      setClubs(prev => prev.filter(c => c.id !== distilleryId));
      alert("Uspešno ste napustili klub.");
    } catch (e) {
      console.error("Error leaving club", e);
      alert("Došlo je do greške.");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-base pb-24">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 card-soft card-elevated border border-white/10 rounded-2xl text-text-secondary">
              <ArrowLeft className="w-5 h-5 opacity-50" />
            </div>
            <div className="space-y-2">
              <div className="h-7 w-40 rounded-lg bg-white/10 animate-pulse" />
              <div className="h-3 w-28 rounded bg-gold-500/20 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="px-6 space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={`club-skeleton-${i}`} className="card-soft card-elevated border border-white/10 rounded-[32px] overflow-hidden">
              <div className="p-6 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 animate-pulse" />
                  <div className="space-y-2">
                    <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
                    <div className="h-2.5 w-20 rounded bg-white/5 animate-pulse" />
                  </div>
                </div>
                <Loader2 className="w-5 h-5 text-gold-500/50 animate-spin" />
              </div>
              <div className="p-6 space-y-4">
                <div className="h-2 w-full rounded bg-white/5 animate-pulse" />
                <div className="h-2 w-5/6 rounded bg-white/5 animate-pulse" />
                <div className="h-2 w-4/6 rounded bg-white/5 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base pb-24">
      {/* Header */}
      <div className="p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-3 card-soft card-elevated border border-white/10 rounded-2xl text-text-secondary hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tight italic">Moji klubovi</h1>
            <p className="ui-caption uppercase font-bold tracking-[0.2em] flex items-center gap-1.5 text-gold-500/80">
              <Users className="w-3 h-3 shrink-0" aria-hidden /> Članstvo i napredak
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-8">
        {clubs.length === 0 ? (
          <div className="empty-state card-elevated max-w-md mx-auto py-12 px-8 text-center space-y-6 rounded-[32px]">
            <div className="w-20 h-20 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto border border-gold-500/20">
              <Gift className="w-10 h-10 text-gold-500/50" aria-hidden />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Još niste član nijednog kluba</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Posetite stranice destilerija i učlanite se u klub kako biste primali pogodnosti i nagrade.
              </p>
            </div>
            <button type="button" onClick={() => navigate("/distilleries")} className="w-full py-3.5 btn-primary text-xs">
              Istraži destilerije
            </button>
          </div>
        ) : (
          clubs.map((club) => (
            <div key={club.id} className="card-soft card-elevated border border-white/10 rounded-[32px] overflow-hidden group">
               {/* Club Branding */}
               <div className="p-6 flex items-center justify-between border-b border-white/5">
                 <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-black border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                       {club.logoUrl ? (
                         <img
                           src={club.logoUrl}
                           alt={safeReactText(club.name) || "Destilerija"}
                           className="w-full h-full object-contain object-center p-0.5 media-crisp"
                         />
                       ) : (
                         <Gift className="w-6 h-6 text-gold-500" aria-hidden />
                       )}
                    </div>
                    <div>
                      <h4 className="text-lg font-black text-white italic truncate max-w-[180px]">
                        {safeReactText(club.name) || "Destilerija"}
                      </h4>
                      <p className="text-[10px] text-text-secondary uppercase font-bold tracking-widest">Aktivni Član</p>
                    </div>
                 </div>
                 <button
                   type="button"
                   onClick={() => leaveClub(club.id)}
                   className="p-3 rounded-xl text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-40 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
                   title="Napusti klub"
                 >
                   <ShieldX className="w-5 h-5" />
                 </button>
               </div>

               {/* Active Perks & Progress */}
               <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                     <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Vaš Napredak</p>
                     <div className="flex items-center gap-1.5 p-1 px-2 bg-gold-500/10 rounded-lg">
                        <Star className="w-3 h-3 text-gold-500 fill-gold-500" />
                        <span className="text-[9px] font-bold text-gold-500 uppercase tracking-widest">Specijalna Ponuda</span>
                     </div>
                  </div>

                  {club.actions.length === 0 ? (
                    <div className="empty-state rounded-2xl px-4 py-5 text-center">
                      <p className="text-xs text-text-secondary italic leading-relaxed">Trenutno nema aktivnih akcija u ovom klubu.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {club.actions.map((action: any) => {
                        const isCompleted = action.progress >= 100;
                        const dateEnd = action.endsAt?.toDate ? action.endsAt.toDate() : new Date(action.endsAt);
                        const isExpired = dateEnd < new Date() && !isCompleted;
                        const daysLeft = Math.ceil((dateEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                        return (
                          <div key={action.id} className={cn(
                            "space-y-3 p-4 card-soft border border-white/10 rounded-2xl relative overflow-hidden",
                            isExpired && "opacity-60 grayscale"
                          )}>
                             {isExpired && (
                               <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center z-10">
                                  <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em] rotate-12 border-2 border-red-500 p-2">Akcija Istekla</p>
                               </div>
                             )}

                             <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                   <p className="text-xs font-black text-white uppercase tracking-tight leading-none">
                                     {safeReactText(action.title) || "Akcija"}
                                   </p>
                                   {safeReactText(action.conditionLabel) ? (
                                     <p className="text-[10px] text-text-secondary">{safeReactText(action.conditionLabel)}</p>
                                   ) : null}
                                </div>
                                <div className="text-right shrink-0">
                                   <p className="text-xs font-black text-gold-500">{Math.round(action.progress)}%</p>
                                   {!isExpired && daysLeft > 0 && !isCompleted && (
                                     <p className={cn("text-[8px] uppercase font-bold mt-0.5", daysLeft < 3 ? "text-red-500" : "text-text-secondary")}>
                                       Još {daysLeft} dana
                                     </p>
                                   )}
                                </div>
                             </div>

                             {/* Detailed Targets */}
                             <div className="flex gap-4">
                               {action.targets.map((t: any, idx: number) => (
                                 <div key={idx} className="flex-1">
                                    <div className="flex justify-between text-[8px] uppercase font-bold text-text-secondary mb-1">
                                       <span>{t.label}</span>
                                       <span className="text-white">
                                         {safeCount(t.current)} / {Math.max(1, safeCount(t.target))}
                                       </span>
                                    </div>
                                    <div className="h-1 w-full bg-black/40 rounded-full overflow-hidden">
                                       <div 
                                         className="h-full bg-gold-500/50"
                                         style={{
                                           width: `${Math.min((safeCount(t.current) / Math.max(1, safeCount(t.target))) * 100, 100)}%`,
                                         }}
                                       />
                                    </div>
                                 </div>
                               ))}
                             </div>

                             {/* Progress Bar (Combined) */}
                             <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full transition-all duration-1000 ease-out",
                                    isCompleted ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-gold-500"
                                  )}
                                  style={{ width: `${action.progress}%` }}
                                />
                             </div>

                             {isCompleted ? (
                               <div className="pt-2">
                                  <div className="bg-green-500/10 border border-green-500/20 p-3 rounded-xl flex items-center justify-between animate-in zoom-in-95">
                                     <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                        <p className="text-[10px] font-black text-green-500 uppercase">Nagrada Otključana!</p>
                                     </div>
                                     <button
                                       type="button"
                                       onClick={() => {
                                         alert(
                                           `Vaša nagrada: ${safeReactText(action.rewardValue) || "—"}\n\nPreuzmite je prateći instrukcije!`,
                                         );
                                       }}
                                       className="px-3 py-2 shrink-0 bg-green-500 text-black text-[9px] font-black uppercase rounded-lg shadow-lg hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-2 focus-visible:ring-offset-green-500/20"
                                     >
                                       Preuzmi
                                     </button>
                                  </div>
                               </div>
                             ) : isExpired ? (
                               <p className="text-[9px] text-red-500 font-bold uppercase text-center mt-2">Niste ispunili ciljeve na vreme.</p>
                             ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/5">
                     <button
                       type="button"
                       onClick={() => navigate(`/distillery/${club.id}`)}
                       className="w-full py-4 btn-secondary flex items-center justify-center gap-2 text-[10px]"
                     >
                        Pogledaj destileriju <ChevronRight className="w-4 h-4" />
                     </button>
                  </div>
               </div>
            </div>
          ))
        )}
      </div>

      <div className="px-6 text-center pt-2">
        <p className="ui-caption uppercase tracking-[0.35em] font-bold text-text-secondary/50">Rakivinum mreža</p>
      </div>
    </div>
  );
}
