import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp, deleteDoc, onSnapshot } from "firebase/firestore";
import { ArrowLeft, MapPin, Globe, Loader2, Star, Hexagon, CheckCircle, Phone, Mail, Award, History, Info, Users, ImageIcon, Share2, X } from "lucide-react";
import { cn } from "../lib/utils";
import { recordClubMembershipAchievement } from "../lib/achievements";

export default function Distillery() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBackSafe = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/", { replace: true });
  };
  
  const [distillery, setDistillery] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'products' | 'about'>('products');
  const [isMember, setIsMember] = useState(false);
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const [activeGalleryImage, setActiveGalleryImage] = useState<string | null>(null);
  const resolvedMapsUrl =
    String(distillery?.mapsUrl || "").trim() ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      (distillery?.location?.city ? `${distillery.location.city} ` : "") + (distillery?.location?.address || distillery?.name || "Srbija")
    )}`;
  const handleShareDistillery = async () => {
    const shareUrl = window.location.href;
    const shareTitle = `${distillery?.name || "Destilerija"} • Rakivinum`;
    const shareText = `Pogledaj profil proizvođača ${distillery?.name || ""} u Rakivinum aplikaciji.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      }
    } catch (err: any) {
      if (String(err?.name || "").toLowerCase().includes("abort")) return;
      console.warn("Native share failed, fallback to clipboard", err);
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link destilerije je kopiran.");
    } catch (err) {
      console.error("Copy share link failed", err);
      alert("Deljenje trenutno nije dostupno na ovom uređaju.");
    }
  };

  useEffect(() => {
    const visitorId = localStorage.getItem('rakivinum_visitor_id');
    
    async function fetchData() {
      if (!id) return;
      setIsLoading(true);
      try {
        // Fetch Distillery Profile
        const docRef = doc(db, 'distilleries', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const dData = { id: docSnap.id, ...docSnap.data() } as any;
          if (dData.isArchived) {
            setDistillery(null);
            setProducts([]);
            return;
          }
          if (!dData.isVerified) {
            setDistillery(null);
            setProducts([]);
            return;
          }
          setDistillery(dData);
        } else {
          setDistillery(null);
          setProducts([]);
          return;
        }

        // Fetch their products
        const productsQuery = query(collection(db, 'products'), where('distilleryId', '==', id));
        const productsSnap = await getDocs(productsQuery);
        const mappedProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        setProducts(mappedProducts.filter(p => p.isApproved !== false && !p.isArchivedByDistillery && p.publicLabelDisabled !== true));
      } catch (err) {
        console.error("Error fetching distillery data", err);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();

    // REAL-TIME SYNC FOR MEMBERSHIP & COUNT
    if (!id) return;
    const qMember = query(collection(db, 'club_memberships'), where('visitorId', '==', visitorId), where('distilleryId', '==', id));
    const unsubMember = onSnapshot(qMember, (snap) => {
      setIsMember(!snap.empty);
      
      const storageKey = `clubs_${visitorId}`;
      let clubs = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!snap.empty) {
        if (!clubs.includes(id)) {
          clubs.push(id);
          localStorage.setItem(storageKey, JSON.stringify(clubs));
        }
      } else {
        if (clubs.includes(id)) {
          clubs = clubs.filter((c: string) => c !== id);
          localStorage.setItem(storageKey, JSON.stringify(clubs));
        }
      }
    });

    const qAllMembers = query(collection(db, 'club_memberships'), where('distilleryId', '==', id));
    const unsubCount = onSnapshot(qAllMembers, (snap) => {
      setTotalMembers(snap.size);
    });

    return () => {
      unsubMember();
      unsubCount();
    };
  }, [id]);

  const [isJoining, setIsJoining] = useState(false);

  const toggleClubMembership = async () => {
    if (isJoining) return;
    const visitorId = localStorage.getItem('rakivinum_visitor_id');
    const storageKey = `clubs_${visitorId}`;
    let clubs = JSON.parse(localStorage.getItem(storageKey) || '[]');
    
    setIsJoining(true);
    try {
      if (isMember) {
        // LEAVE CLUB
        const q = query(collection(db, 'club_memberships'), where('visitorId', '==', visitorId), where('distilleryId', '==', id));
        const snap = await getDocs(q);
        
        const deletePromises = snap.docs.map(d => deleteDoc(doc(db, 'club_memberships', d.id)));
        await Promise.all(deletePromises);

        clubs = clubs.filter((cid: string) => cid !== id);
        setIsMember(false);
      } else {
        // JOIN CLUB
        if (clubs.length >= 5) {
          alert("Možete biti član najviše 5 klubova istovremeno. Odjavite se iz nekog kluba kako biste se učlanili u novi.");
          setIsJoining(false);
          return;
        }

        // CHECK IF ALREADY IN DB
        const qExist = query(collection(db, 'club_memberships'), where('visitorId', '==', visitorId), where('distilleryId', '==', id));
        const existSnap = await getDocs(qExist);
        
        if (existSnap.empty) {
          await addDoc(collection(db, 'club_memberships'), {
            visitorId,
            distilleryId: id,
            createdAt: serverTimestamp()
          });
        }

        if (id && !clubs.includes(id)) {
          clubs.push(id);
        }
        setIsMember(true);
        recordClubMembershipAchievement(clubs.length);
        alert(`Dobrodošli u ${distillery?.name} klub! Od sada ćete dobijati ekskluzivne pogodnosti ovog proizvođača.`);
      }
      localStorage.setItem(storageKey, JSON.stringify(clubs));
    } catch (e) {
      console.error("Error toggling membership", e);
      alert("Došlo je do greške. Molimo pokušajte ponovo.");
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-bg-base flex flex-col items-center justify-center p-4">
         <Loader2 className="w-12 h-12 text-gold-500 animate-spin mb-4" />
         <p className="text-gold-500 font-medium">Učitavanje proizvođača...</p>
      </div>
    );
  }

  if (!distillery) {
    return (
      <div className="min-h-[100dvh] bg-bg-base flex flex-col items-center justify-center p-6 text-center">
        <div className="empty-state card-elevated max-w-md w-full space-y-5 rounded-[28px] p-10">
          <p className="text-white text-xl font-bold">Proizvođač nije dostupan</p>
          <p className="text-text-secondary text-sm leading-relaxed">
            Profil nije u javnom katalogu (arhiviran proizvođač ili još uvek bez javnog sertifikata u Rakivinum mreži).
          </p>
          <button type="button" onClick={goBackSafe} className="w-full py-3 btn-primary text-xs">
            Nazad
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-bg-base pb-20">
      {/* Header Overlay */}
      <div className="relative h-64 w-full bg-bg-card-elevated border-b border-border-gold overflow-hidden">
        {distillery.logoUrl && (
           <img 
             src={distillery.logoUrl} 
             alt={distillery.name} 
             className="absolute inset-0 w-full h-full object-cover media-crisp opacity-20 blur-sm" 
           />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-base to-transparent" />
        
        <button
          type="button"
          onClick={goBackSafe}
          className="absolute top-6 left-4 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-black/50 border border-border-subtle text-white backdrop-blur-md transition-colors hover:text-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={handleShareDistillery}
          className="absolute top-6 right-4 z-20 w-10 h-10 flex items-center justify-center rounded-xl bg-black/50 border border-border-subtle text-white backdrop-blur-md transition-colors hover:text-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
          title="Podeli destileriju"
        >
          <Share2 className="w-5 h-5" />
        </button>

        <div className="absolute bottom-6 left-6 right-6 z-20 flex gap-4 items-end">
          <div className="w-24 h-24 bg-bg-card border-2 border-gold-500 rounded-full flex items-center justify-center shadow-2xl overflow-hidden shrink-0 relative group p-2 card-elevated">
             {distillery.logoUrl ? (
               <img src={distillery.logoUrl} alt={distillery.name} className="w-full h-full object-contain media-crisp" />
             ) : (
               <span className="text-gold-500 text-3xl font-serif">{distillery.name?.charAt(0) || "D"}</span>
             )}
          </div>
          <div className="pb-1">
            <h1 className="text-2xl font-serif font-bold text-white leading-tight flex flex-wrap items-center gap-2">
              {distillery.name}
              {distillery.isVerified && (
                <div className="inline-flex items-center gap-1.5 bg-green-500/10 backdrop-blur-md px-2.5 py-1 rounded-full border border-green-500/20 text-green-500">
                  <CheckCircle className="w-3.5 h-3.5 fill-current" />
                  <span className="text-[10px] font-semibold uppercase tracking-tighter">Sertifikovan Proizvođač</span>
                </div>
              )}
            </h1>
            <p className="text-sm text-gold-500 flex items-center gap-1 mt-1 font-medium">
              <MapPin className="w-3.5 h-3.5" /> 
              {distillery.location?.city ? `${distillery.location.city}, ` : ''}
              {distillery.location?.address || distillery.region || "Srbija"}
            </p>
            {totalMembers !== null && (
              <p className="text-[10px] text-text-secondary mt-1 font-bold uppercase tracking-wider flex items-center gap-1.5 opacity-80">
                <Users className="w-3 h-3 text-gold-500/50" /> {totalMembers} {totalMembers === 1 ? 'član' : totalMembers < 5 ? 'člana' : 'članova'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={toggleClubMembership}
            disabled={isJoining}
            className={cn(
              "ml-auto mb-1 shrink-0 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated disabled:opacity-50 disabled:pointer-events-none",
              isMember ? "btn-secondary" : "btn-primary shadow-lg shadow-gold-500/25",
            )}
          >
            {isJoining ? (
              <Loader2 className="w-3 h-3 animate-spin mx-auto" />
            ) : isMember ? (
               <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-3 h-3" /> Član Kluba
               </span>
            ) : "Postani Član Kluba"}
          </button>
        </div>
      </div>

      <div className="p-4 flex gap-2 border-b border-white/10 bg-bg-card-elevated/85 sticky top-0 z-30 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={`flex-1 py-3 px-4 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated ${
            activeTab === "products"
              ? "bg-gold-500 text-black shadow-lg shadow-gold-500/20"
              : "bg-white/5 text-text-secondary hover:text-white border border-white/10"
          }`}
        >
          Proizvodi
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("about")}
          className={`flex-1 py-3 px-4 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated ${
            activeTab === "about"
              ? "bg-gold-500 text-black shadow-lg shadow-gold-500/20"
              : "bg-white/5 text-text-secondary hover:text-white border border-white/10"
          }`}
        >
          O nama
        </button>
      </div>

      <div className="p-6 space-y-7 max-w-lg mx-auto">
        {activeTab === 'products' ? (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
               <Hexagon className="w-5 h-5 text-gold-500" /> Katalog Pića ({products.length})
            </h2>
            
            {products.length > 0 ? (
              <div className="space-y-8">
                {/* RAKIJE */}
                {products.filter(p => !p.type?.toLowerCase().includes('vino') && !p.type?.toLowerCase().includes('wine')).length > 0 && (
                  <div className="space-y-4">
                     <h3 className="text-sm font-black text-text-secondary uppercase tracking-widest border-b border-white/5 pb-2">Destilati i Rakije</h3>
                     <div className="grid grid-cols-2 gap-4">
                       {products.filter(p => !p.type?.toLowerCase().includes('vino') && !p.type?.toLowerCase().includes('wine')).map(prod => (
                         <div 
                           key={prod.id}
                           onClick={() => navigate(`/label/${prod.id}`)}
                           className="card-soft card-elevated card-interactive rounded-3xl p-4 flex flex-col items-center gap-3 cursor-pointer hover:border-gold-500/60 hover:scale-[1.02] text-center group shadow-md"
                         >
                           <div className="h-32 w-20 relative rounded-lg overflow-hidden bg-black group-hover:drop-shadow-[0_10px_15px_rgba(212,175,55,0.2)] transition-all">
                             <img 
                               src={prod.bottleImageUrl || prod.image || "https://picsum.photos/seed/rakivinum/200/200"}
                              className="h-full w-full object-contain object-center p-1 media-crisp"
                               onError={(e) => { (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/rakivinum/200/200'; }}
                               alt={prod.name}
                             />
                           </div>
                           <div className="w-full">
                             <p className="text-sm font-black text-white line-clamp-1">{prod.name}</p>
                             <p className="text-[12px] text-text-secondary uppercase font-bold mt-1 tracking-tight">{prod.type} • {prod.alcoholPercentage}% vol</p>
                             {prod.averageRating > 0 && (
                                <div className="inline-flex items-center gap-1 mt-2 bg-gold-500/10 px-2 py-0.5 rounded-full border border-gold-500/20">
                                  <Star className="w-3 h-3 text-gold-500 fill-current" />
                                  <span className="text-[10px] font-black text-gold-500">{prod.averageRating.toFixed(1)}</span>
                                </div>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}

                {/* VINA */}
                {products.filter(p => p.type?.toLowerCase().includes('vino') || p.type?.toLowerCase().includes('wine')).length > 0 && (
                  <div className="space-y-4">
                     <h3 className="text-sm font-black text-text-secondary uppercase tracking-widest border-b border-white/5 pb-2">Vina</h3>
                     <div className="grid grid-cols-2 gap-4">
                       {products.filter(p => p.type?.toLowerCase().includes('vino') || p.type?.toLowerCase().includes('wine')).map(prod => (
                         <div 
                           key={prod.id}
                           onClick={() => navigate(`/label/${prod.id}`)}
                           className="card-soft card-elevated card-interactive rounded-3xl p-4 flex flex-col items-center gap-3 cursor-pointer hover:border-gold-500/60 hover:scale-[1.02] text-center group shadow-md"
                         >
                           <div className="h-32 w-20 relative rounded-lg overflow-hidden bg-black group-hover:drop-shadow-[0_10px_15px_rgba(212,175,55,0.2)] transition-all">
                             <img 
                               src={prod.bottleImageUrl || prod.image || "https://picsum.photos/seed/wine/200/200"}
                              className="h-full w-full object-contain object-center p-1 media-crisp"
                               onError={(e) => { (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/wine/200/200'; }}
                               alt={prod.name}
                             />
                           </div>
                           <div className="w-full">
                             <p className="text-sm font-black text-white line-clamp-1">{prod.name}</p>
                             <p className="text-[12px] text-text-secondary uppercase font-bold mt-1 tracking-tight">{prod.type} • {prod.alcoholPercentage}% vol</p>
                             {prod.averageRating > 0 && (
                                <div className="inline-flex items-center gap-1 mt-2 bg-gold-500/10 px-2 py-0.5 rounded-full border border-gold-500/20">
                                  <Star className="w-3 h-3 text-gold-500 fill-current" />
                                  <span className="text-[10px] font-black text-gold-500">{prod.averageRating.toFixed(1)}</span>
                                </div>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}
              </div>
            ) : (
               <div className="empty-state card-elevated border border-border-subtle p-10 rounded-[32px] text-center max-w-md mx-auto space-y-2">
                 <Hexagon className="w-8 h-8 text-gold-500/30 mx-auto" aria-hidden />
                 <p className="text-text-secondary text-sm leading-relaxed">Trenutno nema unetih pića u katalogu.</p>
               </div>
            )}
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             {/* Extended Story */}
             <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                   <History className="w-4 h-4" /> Istorija i Vizija
                </h3>
                <p className="text-white text-base leading-relaxed whitespace-pre-wrap font-medium opacity-90">
                   {distillery.story || distillery.description || "Ovaj proizvođač još uvek nije uneo svoju zvaničnu priču."}
                </p>
             </div>

             {distillery.specificNotes && (
               <>
                 <div className="h-px bg-white/5" />
                 <div className="space-y-4">
                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                     <Info className="w-4 h-4" /> Specifičnosti
                   </h3>
                  <div className="card-soft card-elevated p-4 rounded-[24px] border border-white/10">
                    <p className="text-white text-[15px] leading-relaxed whitespace-pre-wrap">{distillery.specificNotes}</p>
                   </div>
                 </div>
               </>
             )}

             {Array.isArray(distillery.galleryImages) && distillery.galleryImages.length > 0 && (
               <>
                 <div className="h-px bg-white/5" />
                 <div className="space-y-4">
                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                     <Award className="w-4 h-4" /> Foto galerija
                   </h3>
                   <div className="grid grid-cols-2 gap-3">
                    {distillery.galleryImages.map((img: string, idx: number) => (
                      <button
                        key={`${img}-${idx}`}
                        type="button"
                        onClick={() => setActiveGalleryImage(img)}
                        className="block w-full rounded-2xl overflow-hidden border border-white/10 bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                      >
                         <img
                           src={img}
                           alt={`${distillery.name} galerija ${idx + 1}`}
                          className="w-full h-32 object-cover object-center media-crisp hover:scale-[1.03] transition-transform"
                           referrerPolicy="no-referrer"
                         />
                      </button>
                     ))}
                   </div>
                 </div>
               </>
             )}

            {(!Array.isArray(distillery.galleryImages) || distillery.galleryImages.length === 0) && (
              <>
                <div className="h-px bg-white/5" />
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                    <Award className="w-4 h-4" /> Foto galerija
                  </h3>
                  <div className="empty-state card-elevated p-5 rounded-[24px] flex items-center gap-3 border border-white/10">
                    <div className="w-9 h-9 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center text-gold-500/70 shrink-0">
                      <ImageIcon className="w-4 h-4" aria-hidden />
                    </div>
                    <p className="text-sm text-text-secondary leading-snug">Galerija još nije dodata od strane proizvođača.</p>
                  </div>
                </div>
              </>
            )}

             <div className="h-px bg-white/5" />

             {/* Connection Info */}
             <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                   <Phone className="w-4 h-4" /> Kontakt podaci
                </h3>
                <div className="grid gap-3">
                   {distillery.phone && (
                    <a
                      href={`tel:${distillery.phone}`}
                      className="card-soft card-elevated card-interactive flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-500">
                           <Phone className="w-5 h-5" />
                        </div>
                        <div>
                           <p className="text-[12px] uppercase font-bold text-text-secondary">Telefon</p>
                           <p className="text-white font-bold">{distillery.phone}</p>
                        </div>
                     </a>
                   )}
                   {distillery.email && (
                    <a
                      href={`mailto:${distillery.email}`}
                      className="card-soft card-elevated card-interactive flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-500">
                           <Mail className="w-5 h-5" />
                        </div>
                        <div>
                           <p className="text-[12px] uppercase font-bold text-text-secondary">Email adresa</p>
                           <p className="text-white font-bold">{distillery.email}</p>
                        </div>
                     </a>
                   )}
                   {distillery.website && (
                    <a
                      href={distillery.website}
                      target="_blank"
                      rel="noreferrer"
                      className="card-soft card-elevated card-interactive flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                        <div className="w-10 h-10 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-500">
                           <Globe className="w-5 h-5" />
                        </div>
                        <div>
                           <p className="text-[12px] uppercase font-bold text-text-secondary">Veb sajt</p>
                           <p className="text-white font-bold">{distillery.website.replace('https://', '')}</p>
                        </div>
                     </a>
                   )}
                </div>
             </div>

             <div className="h-px bg-white/5" />

             {/* Location Details */}
             <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gold-500 flex items-center gap-2">
                   <MapPin className="w-4 h-4" /> Gde se nalazimo
                </h3>
                <div className="card-soft card-elevated p-4 rounded-[24px] border border-white/10 space-y-4">
                   <div className="space-y-1">
                     {distillery.location?.city && <p className="text-white font-medium">{distillery.location?.city}</p>}
                     <p className="text-white font-medium">{distillery.location?.address || distillery.region || "Adresa nije navedena"}</p>
                   </div>
                  {(distillery.location?.address || distillery.name || distillery.mapsUrl) && (
                     <a
                      href={resolvedMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-4 btn-primary text-xs flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/90 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                       <MapPin className="w-4 h-4" /> Otvori u Google Mapama
                     </a>
                   )}
                </div>
             </div>

          </div>
        )}
      </div>

      {activeGalleryImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setActiveGalleryImage(null)}
        >
          <button
            type="button"
            onClick={() => setActiveGalleryImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-black/60 border border-white/20 text-white flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-black/80"
            aria-label="Zatvori uvećanu sliku"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={activeGalleryImage}
            alt="Uvećana slika destilerije"
            className="max-w-full max-h-[88vh] object-contain rounded-2xl border border-white/15 shadow-2xl"
            onClick={() => setActiveGalleryImage(null)}
            referrerPolicy="no-referrer"
          />
        </div>
      )}

    </div>
  );
}
