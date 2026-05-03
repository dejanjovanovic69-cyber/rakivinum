import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import { waitForImages, addPngImageFitPageCentered } from "../lib/pdfFitImage";
import { collection, query, where, getDocs, orderBy, Timestamp, addDoc, serverTimestamp, doc, updateDoc, getCountFromServer, limit } from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";
import { 
  BarChart3, 
  BarChart2,
  TrendingUp, 
  Users, 
  QrCode, 
  Star, 
  MapPin, 
  ArrowUpRight, 
  ArrowDownRight,
  ChevronRight,
  Bell,
  CalendarDays,
  Activity,
  Download,
  Copy,
  X,
  ArrowLeft,
  Crown,
  Smartphone,
  Info,
  FileText,
  Share2,
  Loader2,
  AlertTriangle,
  Ticket,
  Gift,
  Sparkles,
  Settings,
  Globe,
  Lock
} from "lucide-react";
import { 
  BarChart,
  Bar,
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  LabelList,
  Cell
} from "recharts";
import { cn } from "../lib/utils";
import DistilleryAnalyticsModal from "../components/admin/DistilleryAnalyticsModal";
import { isPostTrialFrozen, parseTrialEndDate } from "../lib/distilleryTrial";
import { shouldRunRefresh } from "../lib/refreshGate";
import { REFRESH_INTERVAL } from "../lib/cachePolicy";
import { readCache, writeCache } from "../lib/resilience";
import { meterDbRead } from "../lib/requestMeter";

const processImageToDataURL = (file: File, maxWidth: number, maxHeight: number, quality = 0.6): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }

        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context nije dostupan."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Neuspešno učitavanje slike."));
    };
    reader.onerror = () => reject(new Error("Neuspešno čitanje fajla."));
  });
};

export default function DistilleryDashboard() {
  const EMERGENCY_READ_FREEZE = false;
  type DashboardDistillery = {
    id: string;
    name?: string;
    isVerified?: boolean;
    isArchived?: boolean;
    ownerId?: string;
    trialEndsAt?: unknown;
    lastAppAccessAt?: { toDate?: () => Date } | string | number | Date;
    location?: { city?: string; address?: string };
    [key: string]: string | number | boolean | Date | { toDate?: () => Date } | { city?: string; address?: string } | string[] | undefined;
  };
  type DashboardProduct = {
    id: string;
    name?: string;
    type?: string;
    alcoholPercentage?: number;
    description?: string;
    bottleImageUrl?: string;
    image?: string;
    barcode?: string;
    isApproved?: boolean;
    createdAt?: { toDate?: () => Date } | string | number | Date;
    updatedAt?: { toDate?: () => Date } | string | number | Date;
    scanCount?: number;
    ratingCount?: number;
    averageRating?: number;
    publicLabelDisabled?: boolean;
    [key: string]: string | number | boolean | Date | { toDate?: () => Date } | undefined;
  };
  type DashboardRating = {
    id: string;
    productId?: string;
    rating?: number;
    userName?: string;
    userId?: string;
    location?: string;
    city?: string;
    createdAt?: { toDate?: () => Date } | string | number | Date;
    [key: string]: string | number | boolean | Date | { toDate?: () => Date } | undefined;
  };
  type DashboardScan = {
    id: string;
    productId?: string;
    userName?: string;
    userId?: string;
    location?: string;
    city?: string;
    createdAt?: { toDate?: () => Date } | string | number | Date;
    [key: string]: string | number | boolean | Date | { toDate?: () => Date } | undefined;
  };

  const navigate = useNavigate();
  const location = useLocation();
  const goBackSafe = () => {
    const navState = location.state as { returnTo?: string } | null;
    if (navState?.returnTo) {
      navigate(navState.returnTo);
      return;
    }
    const rt = new URLSearchParams(location.search).get("rt");
    if (rt) {
      navigate(rt);
      return;
    }
    navigate("/menu", { replace: true });
  };
  const [loading, setLoading] = useState(true);
  const [qrModalProduct, setQrModalProduct] = useState<DashboardProduct | null>(null);
  const [isDistilleryQrOpen, setIsDistilleryQrOpen] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const distilleryQrRef = useRef<HTMLCanvasElement>(null);
  
  const [distillery, setDistillery] = useState<DashboardDistillery | null>(null);
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [ratings, setRatings] = useState<DashboardRating[]>([]);
  const [filteredRatings, setFilteredRatings] = useState<DashboardRating[]>([]);
  const [scans, setScans] = useState<DashboardScan[]>([]);
  const [filteredScans, setFilteredScans] = useState<DashboardScan[]>([]);
  const [timeFilter, setTimeFilter] = useState<string>('Sve Vreme');
  const [aiSummary, setAiSummary] = useState<string>('');
  const [generatingAi, setGeneratingAi] = useState(false);
  const [isClubModalOpen, setIsClubModalOpen] = useState(false);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [isAnalyticsModalOpen, setIsAnalyticsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DashboardProduct | null>(null);
  const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
  const [isEditDistilleryModalOpen, setIsEditDistilleryModalOpen] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [activeDashboardTab, setActiveDashboardTab] = useState('analitika');
  const [clubActions, setClubActions] = useState<Array<{ id: string; [key: string]: unknown }>>([]);
  const [clubMembersCount, setClubMembersCount] = useState<number | "-">("-");
  const toDateSafe = (value: unknown): Date => {
    if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
      const d = (value as { toDate?: () => Date }).toDate?.();
      return d instanceof Date ? d : new Date(0);
    }
    if (value instanceof Date) return value;
    const d = new Date((value || 0) as string | number | Date);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  };

  const distilleryUrl = distillery ? `${window.location.origin}/distillery/${distillery.id}` : '';

  useEffect(() => {
    let cancelled = false;
    if (!distillery?.id) return;
    const actionsCacheKey = `rakivinum_cache_dist_dashboard_actions_${distillery.id}_v1`;
    const memberCountCacheKey = `rakivinum_cache_dist_dashboard_member_count_${distillery.id}_v1`;

    const refreshClubPanel = async () => {
      if (!shouldRunRefresh(`dist-dashboard:${distillery.id}:club-panel`, REFRESH_INTERVAL.USER_LIGHT_1H)) return;
      try {
        const qActions = query(
          collection(db, 'club_actions'),
          where('distilleryId', '==', distillery.id),
          orderBy('createdAt', 'desc'),
          limit(40),
        );
        const actionsSnap = await getDocs(qActions);
        meterDbRead("distDashboard:club_actions", actionsSnap.size);
        const nextActions = actionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!cancelled) {
          setClubActions(nextActions);
        }
        writeCache(actionsCacheKey, nextActions, REFRESH_INTERVAL.USER_LIGHT_1H);
      } catch (err) {
        console.error("Error fetching actions", err);
        if (!cancelled) {
          const cachedActions = readCache<Array<{ id: string; [key: string]: unknown }>>(actionsCacheKey);
          if (cachedActions) setClubActions(cachedActions);
        }
      }

      try {
        const qMembers = query(
          collection(db, 'club_memberships'),
          where('distilleryId', '==', distillery.id),
        );
        const countSnap = await getCountFromServer(qMembers);
        meterDbRead("distDashboard:club_memberships_count", 1);
        const nextCount = countSnap.data().count;
        if (!cancelled) setClubMembersCount(nextCount);
        writeCache(memberCountCacheKey, nextCount, REFRESH_INTERVAL.USER_LIGHT_1H);
      } catch (err) {
        console.error("Error fetching members", err);
        if (!cancelled) {
          const cachedCount = readCache<number>(memberCountCacheKey);
          if (typeof cachedCount === "number") setClubMembersCount(cachedCount);
        }
      }
    };

    console.log("Fetching data for distillery:", distillery.id);
    const cachedActions = readCache<Array<{ id: string; [key: string]: unknown }>>(actionsCacheKey);
    const cachedCount = readCache<number>(memberCountCacheKey);
    if (cachedActions) setClubActions(cachedActions);
    if (typeof cachedCount === "number") setClubMembersCount(cachedCount);
    if (!cachedActions || typeof cachedCount !== "number" || shouldRunRefresh(`dist-dashboard:${distillery.id}:initial-club-panel`, REFRESH_INTERVAL.USER_LIGHT_1H)) {
      void refreshClubPanel();
    }
    const onFocusRefresh = () => {
      if (document.visibilityState !== "visible") return;
      void refreshClubPanel();
    };
    const onVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      onFocusRefresh();
    };
    window.addEventListener("focus", onFocusRefresh);
    document.addEventListener("visibilitychange", onVisibilityRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocusRefresh);
      document.removeEventListener("visibilitychange", onVisibilityRefresh);
    };
  }, [distillery?.id]);

  const trialEndKey = parseTrialEndDate(distillery?.trialEndsAt)?.getTime() ?? 0;
  useEffect(() => {
    if (!distillery) return;
    const frozen = isPostTrialFrozen(distillery);
    if (!distillery.isVerified) {
      setIsDistilleryQrOpen(false);
      setIsNfcInfoOpen(false);
      setQrModalProduct(null);
      setActiveDashboardTab((tab) => (tab === "alati" ? "analitika" : tab));
    }
    if (frozen) {
      setIsDistilleryQrOpen(false);
      setIsNfcInfoOpen(false);
      setQrModalProduct(null);
      setIsClubModalOpen(false);
      setIsAnalyticsModalOpen(false);
      setActiveDashboardTab("proizvodi");
    }
  }, [distillery?.id, distillery?.isVerified, trialEndKey]);

  useEffect(() => {
    if (EMERGENCY_READ_FREEZE) {
      setLoading(false);
      return;
    }
    // Sajam / gužva: stalni ručni refresh ovog ekrana i dalje troši Firestore read-ove kad istekne keš; podaci su i inače ograničeni feed + agregat sa proizvoda.
    const initData = async () => {
      setLoading(true);
      try {
        const user = auth.currentUser;
        if (!user) {
           setLoading(false);
           return;
        }

        // Fetch User's Distillery (by UID or Email)
        const dq = query(collection(db, "distilleries"), where("ownerId", "==", user.uid), limit(5));
        const dSnap = await getDocs(dq);
        
        let distData = null;
        if (!dSnap.empty) {
           const first = dSnap.docs[0];
           const raw = first.data() as DashboardDistillery;
           if (!raw?.isArchived) {
             distData = { id: first.id, ...raw };
           }
        } else if (user.email) {
           // Try by email
           const eq = query(collection(db, "distilleries"), where("email", "==", user.email), limit(5));
           const eSnap = await getDocs(eq);
           if (!eSnap.empty) {
             const first = eSnap.docs[0];
             const raw = first.data() as DashboardDistillery;
             if (!raw?.isArchived) {
               distData = { id: first.id, ...raw };
               const owner = raw?.ownerId;
               if (!owner || owner !== user.uid) {
                 try {
                   await updateDoc(doc(db, "distilleries", first.id), { ownerId: user.uid });
                   distData = { ...distData, ownerId: user.uid };
                 } catch (e) {
                   console.warn("Could not sync distillery ownerId from email match", e);
                 }
               }
             }
           }
        }

        // No fallback: dashboard access is strictly for linked, active distilleries only.

        if (distData) {
           setDistillery(distData);
           try {
             const sessionKey = `logged_access_${distData.id}`;
             if (!sessionStorage.getItem(sessionKey)) {
               await updateDoc(doc(db, 'distilleries', distData.id), {
                 lastAppAccessAt: serverTimestamp(),
                 lastAppAccessByUid: user.uid,
                 lastAppAccessByEmail: (user.email || "").toLowerCase(),
               });
               sessionStorage.setItem(sessionKey, "true");
             }
           } catch (e) {
             console.warn("Could not update last app access from dashboard", e);
           }

           // Fetch Products
           const pq = query(collection(db, "products"), where("distilleryId", "==", distData.id), limit(80));
           const pSnap = await getDocs(pq);
           const pData = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
           meterDbRead("distDashboard:products", pSnap.size);
           setProducts(pData);

           // Live feed only: bounded reads (avoid client-side aggregation of hundreds of docs).
           try {
             const rQ = query(
               collection(db, "ratings"),
               where("distilleryId", "==", distData.id),
               orderBy("createdAt", "desc"),
               limit(15),
             );
             const rSnap = await getDocs(rQ);
             meterDbRead("distDashboard:ratings_feed", rSnap.size);
             const rData = rSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as DashboardRating[];
             setRatings(rData);
           } catch (e) {
             console.warn("Feed ocena (orderBy) nije uspeo — probam bez sortiranja (čeka se indeks?):", e);
             try {
               const rFb = query(
                 collection(db, "ratings"),
                 where("distilleryId", "==", distData.id),
                 limit(15),
               );
               const rSnap2 = await getDocs(rFb);
               meterDbRead("distDashboard:ratings_feed_fallback", rSnap2.size);
               setRatings(rSnap2.docs.map((d) => ({ id: d.id, ...d.data() })) as DashboardRating[]);
             } catch (e2) {
               console.warn("Greška pri učitavanju ocena (dashboard feed):", e2);
               setRatings([]);
             }
           }

           try {
             const sQ = query(
               collection(db, "scans"),
               where("distilleryId", "==", distData.id),
               orderBy("timestamp", "desc"),
               limit(15),
             );
             const sSnap = await getDocs(sQ);
             meterDbRead("distDashboard:scans_feed", sSnap.size);
             const sData = sSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as DashboardScan[];
             setScans(sData);
           } catch (e) {
             console.warn("Feed skenova (orderBy) nije uspeo — probam bez sortiranja:", e);
             try {
               const sFb = query(
                 collection(db, "scans"),
                 where("distilleryId", "==", distData.id),
                 limit(15),
               );
               const sSnap2 = await getDocs(sFb);
               meterDbRead("distDashboard:scans_feed_fallback", sSnap2.size);
               setScans(sSnap2.docs.map((d) => ({ id: d.id, ...d.data() })) as DashboardScan[]);
             } catch (e2) {
               console.warn("Greška pri učitavanju skenova (dashboard feed):", e2);
               setScans([]);
             }
           }
        }

      } catch (err) {
        console.error("Dashboard init error", err);
      } finally {
        setLoading(false);
      }
    };

    // Use onAuthStateChanged to ensure auth is ready
    const unsub = auth.onAuthStateChanged(user => {
       if (user) {
         initData();
       } else {
         setLoading(false);
       }
    });

    return () => unsub();
  }, [EMERGENCY_READ_FREEZE]);

  useEffect(() => {
     // Apply Time Filter
     const now = new Date();
     let cutoff = new Date(0); // All time

     if (timeFilter === 'Danas') {
        cutoff = new Date();
        cutoff.setHours(0,0,0,0);
     } else if (timeFilter === 'Ove Nedelje') {
        cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
     } else if (timeFilter === 'Ovog Meseca') {
        cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 1);
     } else if (timeFilter === 'Ove Godine') {
        cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 1);
     }

     const filteredRatingsList = ratings.filter(r => {
        const d = toDateSafe(r.createdAt);
        return d >= cutoff;
     });

     const filteredScansList = scans.filter(s => {
        const d = toDateSafe((s as { timestamp?: unknown; createdAt?: unknown }).timestamp || s.createdAt);
        return d >= cutoff;
     });

     setFilteredRatings(filteredRatingsList);
     setFilteredScans(filteredScansList);
  }, [timeFilter, ratings, scans]);

  const generateAiAnalysis = async () => {
    setGeneratingAi(true);
    try {
      const texts = filteredRatings.filter(r => r.reviewText).map(r => r.reviewText).join("\n");
      
      if (!texts.trim()) {
        setAiSummary("Nema dovoljno tekstualnih recenzija za AI generisanje u ovom periodu.");
        setGeneratingAi(false);
        return;
      }

      const { GoogleGenAI } = await import('@google/genai');
      // AI Studio injects GEMINI_API_KEY into process.env.GEMINI_API_KEY via vite.config.ts
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Ti si somelijer i ekspert za balkanske rakije i vina. Pročitaj ove recenzije za proizvode proizvođača "${distillery?.name || 'vašeg brenda'}":\n\n${texts}\n\nNapiši profesionalni, ohrabrujući poslovni izveštaj (do 150 reči) namenjen menadžmentu. Istakni šta kupci najviše vole i na šta eventualno treba obratiti pažnju. Zadrži poslovni, autoritativni i pozitivan ton B2B konsultanta.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });

      setAiSummary(response.text || "Greška pri generisanju.");
    } catch (error) {
      console.error("AI Error:", error);
      setAiSummary("Trenutno nije moguće generisati AI analizu. Pokušajte ponovo.");
    } finally {
      setGeneratingAi(false);
    }
  };

  const copyDistilleryUrl = () => {
    if (!distillery) return;
    navigator.clipboard.writeText(`${window.location.origin}/distillery/${distillery.id}`);
    alert("Link kopiran!");
  };

  const downloadDistilleryQR = () => {
    if (!distilleryQrRef.current) return;
    const canvas = distilleryQrRef.current;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `Rakivinum_Master_QR_Ornament.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateDistilleryPDF = async () => {
    if (!distillery?.isVerified) {
      alert(
        "Zvanični PDF sertifikat dostupan je kada administrator uključi status „Sertifikovan proizvođač”. Tokom probnog naloga možete koristiti analitiku i upravljanje artiklima."
      );
      return;
    }
    setIsGeneratingCert(true);
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const cssVars = getComputedStyle(document.documentElement);
    const themeBg = cssVars.getPropertyValue("--color-bg-card").trim() || "#161618";
    const themeGold = cssVars.getPropertyValue("--color-gold-500").trim() || "#D4AF37";

    // We can't easily use React component inside this async function for raw DOM
    // So we'll use a reliable QR API for the PDF generation to ensure perfect quality
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(distilleryUrl)}&color=000000&bgcolor=ffffff`;
    
    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.left = "-9999px";
    element.style.top = "0";
    element.style.width = "800px";
    element.style.padding = "60px";
    element.style.backgroundColor = themeBg;
    element.style.color = "white";
    element.style.fontFamily = "serif";
    
    element.innerHTML = `
      <div style="border: 3px solid ${themeGold}; padding: 28px 36px 32px; text-align: center; position: relative; background: ${themeBg}; display: flex; flex-direction: column; gap: 12px;">
        <div>
           <img src="${window.location.origin}/logo-gold.png" style="max-height: 90px; max-width: 260px; width: auto; height: auto; margin: 0 auto; display: block; object-fit: contain;" crossorigin="anonymous">
           <p style="text-transform: uppercase; letter-spacing: 0.4em; font-size: 10px; color: rgba(212, 175, 55, 0.6); margin-top: 10px;">Zvanični Rakivinum Digitalni Protokol</p>
        </div>
        
        <div style="width: 150px; height: 1px; background: ${themeGold}; margin: 8px auto;"></div>
        
        <div style="margin: 4px 0 12px;">
          <p style="text-transform: uppercase; font-size: 13px; letter-spacing: 0.2em; color: rgba(255,255,255,0.5);">Ovim se potvrđuje da je brend</p>
          <h2 style="font-size: 48px; margin: 20px 0; color: white; font-style: italic; font-weight: 900;">${distillery?.name || 'Proizvođač'}</h2>
          <p style="font-size: 18px; color: ${themeGold}; font-weight: bold; max-width: 500px; margin: 0 auto; line-height: 1.6;">
            Verifikovan član Rakivinum mreže za proveru autentičnosti i senzornu analizu vrhunskih proizvoda.
          </p>
          
          <div style="margin-top: 40px; display: flex; flex-direction: column; align-items: center; gap: 20px;">
             <div style="padding: 15px; background: white; border-radius: 15px;">
                <img src="${qrUrl}" style="width: 120px; height: 120px;" crossorigin="anonymous">
             </div>
             <p style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.2em; color: ${themeGold}; font-weight: bold;">Digitalni Dokaz Autentičnosti</p>
          </div>

          <div style="margin-top: 40px; padding: 30px; background: rgba(255,255,255,0.03); border: 1px solid rgba(212, 175, 55, 0.1); border-radius: 24px; display: inline-block;">
             <p style="font-size: 11px; text-transform: uppercase; color: ${themeGold}; margin-bottom: 10px; font-weight: 800;">Digitalni Pečat Kvaliteta</p>
             <p style="font-size: 14px; margin: 0; opacity: 0.8;">Status: <span style="color: ${themeGold}; font-weight: bold;">SERIFIKOVAN PROIZVOĐAČ</span></p>
             <p style="font-size: 12px; margin-top: 5px; opacity: 0.6;">UUID: RAK-BRAND-ORNAMENT-2026</p>
          </div>
        </div>

        <div style="margin-top: 50px; border-top: 1px solid rgba(212, 175, 55, 0.1); padding-top: 30px;">
           <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="text-align: left;">
                 <p style="font-size: 9px; text-transform: uppercase; color: rgba(255,255,255,0.3); margin: 0;">Datum Verifikacije</p>
                 <p style="font-size: 12px; color: white; font-weight: bold;">${new Date().toLocaleDateString('sr-RS')}</p>
              </div>
              <div style="text-align: right;">
                 <p style="font-size: 9px; text-transform: uppercase; color: ${themeGold}; font-weight: 900; letter-spacing: 0.2em;">Administracija Protokola</p>
                 <p style="font-size: 14px; color: white; font-weight: 900; font-family: sans-serif;">RAKIVINUM AUTENTIK</p>
              </div>
           </div>
        </div>
        
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); opacity: 0.05; width: 80%; pointer-events: none;">
           <img src="/logo-mono.png" style="width: 100%; height: auto;" crossorigin="anonymous">
        </div>
      </div>
    `;
    
    document.body.appendChild(element);
    
    try {
      await waitForImages(element);
      const canvas = await html2canvas(element, {
        backgroundColor: themeBg,
        scale: 2,
        useCORS: true,
        allowTaint: true
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      addPngImageFitPageCentered(pdf, imgData);
      pdf.save(`Rakivinum_Sertifikat.pdf`);
    } catch (e) {
      console.error("Distillery PDF Error:", e);
    } finally {
      document.body.removeChild(element);
      setIsGeneratingCert(false);
    }
  };

  const handleShareDistillery = async () => {
    try {
      if (!distillery) return;
      const url = `${window.location.origin}/distillery/${distillery.id}`;
      if (navigator.share) {
        await navigator.share({
          title: "Rakivinum - Sertifikovan Proizvođač",
          text: `Pogledajte katalog proizvoda za ${distillery.name}.`,
          url: url
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert("Link ka vašem profilu je kopiran. Možete ga poslati putem Vibera ili Emaila.");
      }
    } catch (err) {
      console.error("Error sharing distillery", err);
    }
  };

  const downloadQR = () => {
    if (!qrRef.current || !qrModalProduct) return;
    const canvas = qrRef.current;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `QR_${qrModalProduct.name.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [isNfcInfoOpen, setIsNfcInfoOpen] = useState(false);
  const [isGeneratingCert, setIsGeneratingCert] = useState(false);

  // KPI prosek i ukupne interakcije iz denormalizovanih polja na proizvodima (0 dodatnih čitanja).
  const productAggregates = useMemo(() => {
    let totalRatingSum = 0;
    let totalRatingsCount = 0;
    let totalScansCount = 0;
    for (const p of products) {
      totalScansCount += Number(p.scanCount) || 0;
      const rc = Number(p.ratingCount) || 0;
      const ar = Number(p.averageRating);
      if (rc > 0 && Number.isFinite(ar)) {
        totalRatingsCount += rc;
        totalRatingSum += ar * rc;
      }
    }
    return {
      totalInteractions: totalScansCount + totalRatingsCount,
      currentAvgRating: totalRatingsCount > 0 ? (totalRatingSum / totalRatingsCount).toFixed(1) : "0.0",
      totalScansCount,
      totalRatingsCount,
    };
  }, [products]);

  const { totalInteractions, currentAvgRating } = productAggregates;

  // Sort products by ratingCount from product documents (ne iz feed-a od 15 ocena).
  const sortedProducts = [...products]
    .map((p) => {
      const rc = Number(p.ratingCount) || 0;
      const ar = Number(p.averageRating);
      const avgDisplay = rc > 0 && Number.isFinite(ar) ? ar.toFixed(1) : "0.0";
      return { ...p, ratingCount: rc, avgRating: avgDisplay };
    })
    .sort((a, b) => b.ratingCount - a.ratingCount);

  const displayedProducts = showAllProducts ? sortedProducts : sortedProducts.slice(0, 3);


  // Calculate Chart Data (Combined scans + ratings per day for the last 7 days)
  const computeChartData = () => {
     const data = [];
     const days = ['Ned', 'Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub'];
     for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayName = days[d.getDay()];
        
        // Combined activity
        const ratingCount = filteredRatings.filter(r => {
           const rd = toDateSafe(r.createdAt);
           return rd.toDateString() === d.toDateString();
        }).length;

        const scanCount = filteredScans.filter(s => {
          const rd = toDateSafe((s as { timestamp?: unknown; createdAt?: unknown }).timestamp || s.createdAt);
          return rd.toDateString() === d.toDateString();
       }).length;

        data.push({
           name: i === 0 ? 'Danas' : dayName,
           ocene: ratingCount + scanCount
        });
     }
     return data;
  };
  const dynamicChartData = computeChartData();

  // Compute region/location breakdown (city-level from scans)
  const computeRegionsData = () => {
     const regionsCount: Record<string, number> = {};
     let hasData = false;
     filteredScans.forEach((s) => {
        const loc = safeText((s as { city?: unknown; locationName?: unknown }).city) || safeText((s as { locationName?: unknown }).locationName) || "Privatna Konzumacija";
        regionsCount[loc] = (regionsCount[loc] || 0) + 1;
        hasData = true;
     });
     
     if (!hasData) {
        return [{ name: "Nema Podataka", value: 0 }];
     }

     return Object.entries(regionsCount)
       .map(([name, value]) => ({ name, value }))
       .sort((a,b) => b.value - a.value)
       .slice(0, 5); // top 5
  };
  const dynamicRegionsData = computeRegionsData();

  const computeTopCitiesData = () => {
    const cityCount: Record<string, number> = {};
    filteredScans.forEach((s) => {
      const city = safeText((s as { city?: unknown }).city) || "Nepoznat grad";
      cityCount[city] = (cityCount[city] || 0) + 1;
    });
    return Object.entries(cityCount)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  };
  const topCitiesData = computeTopCitiesData();

  const computeTopVenuesData = () => {
    const venueCount: Record<string, number> = {};
    filteredScans.forEach((s) => {
      if (!(s as { isPublicVenue?: boolean }).isPublicVenue) return;
      const venue = safeText((s as { venueName?: unknown }).venueName);
      if (!venue || venue === "Privatna Konzumacija") return;
      venueCount[venue] = (venueCount[venue] || 0) + 1;
    });
    const MIN_VENUE_SCANS = 3;
    const all = Object.entries(venueCount).map(([name, value]) => ({ name, value }));
    const shown = all
      .filter((x) => x.value >= MIN_VENUE_SCANS)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    const hiddenCount = all
      .filter((x) => x.value < MIN_VENUE_SCANS)
      .reduce((acc, x) => acc + x.value, 0);
    if (hiddenCount > 0) {
      shown.push({ name: "Ostalo", value: hiddenCount });
    }
    return shown;
  };
  const topVenuesData = computeTopVenuesData();

  // Compute sentiment Breakdown (1 to 5 stars)
  const computeSentimentData = () => {
     const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
     filteredRatings.forEach(r => {
        if (r.rating >= 1 && r.rating <= 5) {
           counts[r.rating as keyof typeof counts]++;
        }
     });
     const total = filteredRatings.length || 1;
     return [
        { stars: 5, count: counts[5], percent: Math.round((counts[5] / total) * 100) },
        { stars: 4, count: counts[4], percent: Math.round((counts[4] / total) * 100) },
        { stars: 3, count: counts[3], percent: Math.round((counts[3] / total) * 100) },
        { stars: 2, count: counts[2], percent: Math.round((counts[2] / total) * 100) },
        { stars: 1, count: counts[1], percent: Math.round((counts[1] / total) * 100) },
     ];
  };
  const sentimentData = computeSentimentData();

  // Compute Time of Day (Morning, Afternoon, Evening, Night)
  const computeTimeOfDayData = () => {
     let morning = 0, afternoon = 0, evening = 0, night = 0;
     filteredRatings.forEach(r => {
        const d = toDateSafe(r.createdAt);
        const hour = d.getHours();
        if (hour >= 6 && hour < 12) morning++;
        else if (hour >= 12 && hour < 18) afternoon++;
        else if (hour >= 18 && hour < 22) evening++;
        else night++; // 22 to 6
     });
     const total = filteredRatings.length || 1;
     return [
       { period: 'Jutro (06-12)', count: morning, percent: Math.round((morning/total)*100) },
       { period: 'Popodne (12-18)', count: afternoon, percent: Math.round((afternoon/total)*100) },
       { period: 'Veče (18-22)', count: evening, percent: Math.round((evening/total)*100) },
       { period: 'Noć (22-06)', count: night, percent: Math.round((night/total)*100) }
     ].sort((a,b) => b.count - a.count);
  };
  const timeOfDayData = computeTimeOfDayData();

  const safeText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (!value) return fallback;
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const firstString = Object.values(obj).find((v) => typeof v === "string");
      if (typeof firstString === "string") return firstString;
      return fallback;
    }
    return fallback;
  };

  // Compute Activity Feed (Live Feed)
  const computeActivityFeed = () => {
    const combined = [
      ...filteredRatings.map(r => ({ ...r, type: 'rating', date: toDateSafe(r.createdAt) })),
      ...filteredScans.map(s => ({ ...s, type: 'scan', date: toDateSafe((s as { timestamp?: unknown; createdAt?: unknown }).timestamp || s.createdAt) }))
    ].sort((a,b) => b.date.getTime() - a.date.getTime()).slice(0, 5);
    
    // Mask identity for anonymity
    return combined.map(item => ({
      ...item,
      displayName: safeText(item.userName) || `Gost #${String(item.userId || 'anon').slice(-4).toUpperCase()}`,
      safeLocation: safeText(item.location) || safeText(item.city) || "Privatno",
    }));
  };
  const activityFeed = computeActivityFeed();

  // Compute Loyalty Ranking (Top Scan/Rating Users)
  const computeLoyaltyRanking = () => {
    const userStats: Record<string, { count: number, name: string, lastActive: Date, isIdentified: boolean }> = {};
    [...filteredRatings, ...filteredScans].forEach(item => {
      const idKey = safeText(item.userId) || "anonymous";
      // Even if identified (registered), we can display an alias for the owner
      const isIdentified = !!item.userEmail;
      if (!userStats[idKey]) {
        userStats[idKey] = { 
          count: 0, 
          name: safeText(item.userName) || `Gost #${idKey.slice(-4).toUpperCase()}`, 
          lastActive: toDateSafe((item as { createdAt?: unknown; timestamp?: unknown }).createdAt || (item as { timestamp?: unknown }).timestamp),
          isIdentified
        };
      }
      userStats[idKey].count++;
      const itemDate = toDateSafe((item as { createdAt?: unknown; timestamp?: unknown }).createdAt || (item as { timestamp?: unknown }).timestamp);
      if (itemDate > userStats[idKey].lastActive) {
        userStats[idKey].lastActive = itemDate;
      }
    });

    return Object.entries(userStats)
      .map(([id, stats]) => ({ id, ...stats }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 5);
  };
  const loyaltyRanking = computeLoyaltyRanking();

  // Conversion KPI iz agregata proizvoda; uniqueUsers i dalje iz malog feed uzorka.
  const conversionStats = {
    scans: productAggregates.totalScansCount,
    ratings: productAggregates.totalRatingsCount,
    rate:
      productAggregates.totalScansCount > 0
        ? Math.round((productAggregates.totalRatingsCount / productAggregates.totalScansCount) * 100)
        : 0,
    uniqueUsers: new Set([...filteredScans, ...filteredRatings].map((i) => i.userEmail || i.userId)).size,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-gold-500/20 border-t-gold-500 rounded-full animate-spin" />
        <p className="text-gold-500 font-medium animate-pulse">Učitavanje analitike...</p>
      </div>
    );
  }

  if (!distillery && !loading) {
     return (
       <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
          <div className="text-center space-y-4">
             <AlertTriangle className="w-12 h-12 text-gold-500 mx-auto" />
             <h2 className="text-white font-bold text-xl">Niste Gosti Registrovane Destilerije/Vinarije</h2>
             <p className="text-text-secondary text-sm">Vaš nalog nema dodeljenu destileriju/vinariju.</p>
          </div>
       </div>
     );
  }

  const hasProducerKit = !!distillery?.isVerified;
  const rawTrialEnd = distillery?.trialEndsAt;
  let trialEndDate: Date | null = null;
  if (rawTrialEnd) {
    try {
      const d = toDateSafe(rawTrialEnd);
      trialEndDate = Number.isNaN(d.getTime()) ? null : d;
    } catch {
      trialEndDate = null;
    }
  }
  const trialEndLabel = trialEndDate ? trialEndDate.toLocaleDateString("sr-RS") : null;
  const trialExpired = trialEndDate ? trialEndDate.getTime() < Date.now() : false;
  const postTrialFrozen = isPostTrialFrozen(distillery);
  /** Dok useEffect ne prebaci tab, izbegni prazan ekran kada je nalog zamrznut a state je još na analitika/alati. */
  const dashboardTab = postTrialFrozen ? "proizvodi" : activeDashboardTab;

  return (
    <div className="min-h-screen bg-bg-base text-white p-4 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={goBackSafe}
            className="p-2 -ml-2 text-text-secondary hover:text-white transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Zdravo, {distillery?.name}</h1>
              <button 
                onClick={() => {
                  if (postTrialFrozen) {
                    alert("Profil destilerije nije moguće menjati dok probni period nije produžen ili nalog nije sertifikovan.");
                    return;
                  }
                  setIsEditDistilleryModalOpen(true);
                }}
                disabled={postTrialFrozen}
                className="p-1.5 bg-white/5 border border-white/10 rounded-lg text-text-secondary hover:text-gold-500 hover:border-gold-500/50 transition-all disabled:opacity-40 disabled:pointer-events-none"
                title={postTrialFrozen ? "Nedostupno posle isteka probnog perioda" : "Izmeni profil"}
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-text-secondary flex items-center gap-1.5 uppercase tracking-widest font-semibold text-gold-500/70">
              <Activity className="w-3 h-3" /> Dashboard Destilerije/Vinarije
            </p>
          </div>
        </div>
        <button className="relative p-3 bg-bg-card border border-border-subtle rounded-2xl text-text-secondary hover:text-white transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-gold-500 rounded-full border-2 border-bg-card" />
        </button>
      </div>

      {postTrialFrozen ? (
        <div className="rounded-2xl border border-slate-500/40 bg-slate-900/50 p-4 space-y-2">
          <p className="text-[11px] text-slate-200 font-bold uppercase tracking-widest">Probni period je istekao</p>
          <p className="text-xs text-white/90 leading-relaxed">
            Nalog ostaje u sistemu, ali su onemogućeni profil destilerije, klub, marketing alati i analitika. Možete menjati samo <span className="text-gold-500 font-semibold">naziv i jačinu</span> postojećih artikala. Javna etiketa prikazuje isto to gostima. Za pun pristup ponovo uključite saradnju (sertifikat / produženje) preko office@rakivinum.com.
          </p>
        </div>
      ) : !hasProducerKit ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <p className="text-[11px] text-amber-100 font-bold uppercase tracking-widest">Probni nalog</p>
          <p className="text-xs text-white/90 leading-relaxed">
            Još uvek nemate status <span className="text-gold-500 font-semibold">Sertifikovan proizvođač</span>. Javna oznaka sertifikata, QR izvoz, master QR, marketing linkovi i zvanični PDF sertifikat otključavaju se kada potvrdite saradnju i administrator uključi sertifikat.
          </p>
          {trialEndLabel && (
            <p className="text-[11px] text-text-secondary">
              Probni period do: <span className="text-white font-semibold">{trialEndLabel}</span>
              {trialExpired ? " — kada istekne, ostaje samo osnovni zapis artikala dok se ne produži saradnja." : "."}
            </p>
          )}
        </div>
      ) : null}

      {/* TABS */}
      <div className="flex gap-2 p-1 bg-bg-card-elevated border border-border-subtle rounded-2xl max-w-full overflow-x-auto custom-scrollbar sticky top-3 z-40 backdrop-blur-md shadow-xl mb-4">
        {(postTrialFrozen
          ? [{ id: "proizvodi", label: "Moji Artikli", icon: <Gift className="w-3 h-3" /> }]
          : [
           { id: 'analitika', label: 'Analitika', icon: <BarChart3 className="w-3 h-3"/> },
           { id: 'proizvodi', label: 'Moji Artikli', icon: <Gift className="w-3 h-3"/> },
           { id: 'zajednica', label: 'Zajednica', icon: <Users className="w-3 h-3"/> },
           { id: 'alati', label: 'Alati & QR', icon: <QrCode className="w-3 h-3"/> }
        ]).map((t) => (
           <button 
             key={t.id}
             title={t.id === "alati" && !hasProducerKit ? "Dostupno nakon sertifikacije" : undefined}
             onClick={() => setActiveDashboardTab(t.id)}
             className={cn(
               "flex-1 justify-center px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex items-center gap-2",
               dashboardTab === t.id ? "bg-gold-500 text-black shadow-[0_0_15px_rgba(212,175,55,0.4)]" : "text-text-secondary hover:bg-white/5",
               t.id === "alati" && !hasProducerKit && dashboardTab !== t.id && "opacity-70"
             )}
           >
             {t.icon} <span className="hidden sm:inline">{t.label}</span>
           </button>
        ))}
      </div>

      {dashboardTab === 'analitika' && !postTrialFrozen && (
      <div className="flex gap-2 p-1 bg-bg-card border border-border-subtle rounded-xl max-w-fit overflow-x-auto custom-scrollbar mb-4">
        {['Danas', 'Ove Nedelje', 'Ovog Meseca', 'Prošli Mesec', 'Ove Godine', 'Sve Vreme'].map((tab) => (
          <button 
            key={tab}
            onClick={() => setTimeFilter(tab)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
              timeFilter === tab ? "bg-gold-500 text-black shadow-lg" : "text-text-secondary hover:text-white"
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      )}

      {dashboardTab === 'analitika' && !postTrialFrozen && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          
          <div className="grid grid-cols-2 gap-3">
             <button 
               onClick={() => setIsAnalyticsModalOpen(true)}
               className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-3xl flex flex-col items-center justify-center gap-2 group hover:bg-blue-500 hover:text-white transition-all shadow-lg shadow-blue-500/10"
             >
                <BarChart2 className="w-5 h-5 text-blue-400 group-hover:text-white" />
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 group-hover:text-white">Detaljni Izveštaj & AI</span>
             </button>
             <button 
               onClick={() => {
                 if (!hasProducerKit) {
                   alert(
                     "PDF sertifikat je deo paketa za sertifikovane proizvođače. Kontaktirajte nas kada potvrdite nastavak saradnje."
                   );
                   return;
                 }
                 void generateDistilleryPDF();
               }}
               disabled={!hasProducerKit || isGeneratingCert}
               className="p-4 bg-gold-500/10 border border-gold-500/20 rounded-3xl flex flex-col items-center justify-center gap-2 group hover:bg-gold-500 hover:text-black transition-all shadow-lg shadow-gold-500/10 disabled:opacity-50"
             >
                {isGeneratingCert ? <Loader2 className="w-5 h-5 animate-spin text-gold-500 group-hover:text-black" /> : <FileText className="w-5 h-5 text-gold-500 group-hover:text-black" />}
                <span className="text-[10px] font-black uppercase tracking-widest text-gold-500 group-hover:text-black">Preuzmi Sertifikat (PDF)</span>
             </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
        <div className="bg-bg-card border border-border-subtle p-4 rounded-3xl space-y-3 relative overflow-hidden group">
          <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest">Interakcije</p>
          <div className="flex items-end gap-2">
            <span className="text-xl font-bold">{totalInteractions}</span>
          </div>
        </div>

        <div className="bg-bg-card border border-border-subtle p-4 rounded-3xl space-y-3 relative overflow-hidden group">
          <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest">Ocena</p>
          <div className="flex items-end gap-2">
            <span className="text-xl font-bold text-gold-500">{currentAvgRating}</span>
          </div>
        </div>

        <div className="bg-bg-card border border-border-subtle p-4 rounded-3xl space-y-3 relative overflow-hidden group">
          <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest">Članovi Kluba</p>
          <div className="flex items-end gap-2 text-gold-500">
            <span className="text-xl font-bold">{clubMembersCount === "-" || !clubMembersCount ? 0 : clubMembersCount}</span>
            <Users className="w-3 h-3 mb-1 shrink-0" />
          </div>
          <div className="absolute -right-2 -bottom-2 w-12 h-12 bg-gold-500/5 blur-xl group-hover:bg-gold-500/10 transition-all" />
        </div>
      </div>

      <div className="bg-bg-card border border-border-subtle rounded-[32px] p-6 space-y-4">
          <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gold-500" /> Geografija Skeniranja
                </h4>
                <p className="text-[10px] text-text-secondary mt-1">Gde se vaši proizvodi najviše očitavaju i ocenjuju (GPS verifikacija).</p>
              </div>
          </div>

          <div className="space-y-6 pt-2">
              <div className="space-y-2">
                {dynamicRegionsData.map((loc, i) => (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0 group">
                      <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-bg-card-elevated border border-white/5 flex items-center justify-center text-[10px] font-black text-gold-500">
                            {i + 1}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white group-hover:text-gold-500 transition-colors truncate max-w-[150px]">{loc.name}</p>
                            <a 
                              href={loc.name === "Privatna Konzumacija" ? undefined : `https://maps.google.com/?q=${encodeURIComponent(loc.name)}`} 
                              target={loc.name === "Privatna Konzumacija" ? undefined : "_blank"} 
                              rel="noreferrer"
                              className={cn("text-[8px] uppercase tracking-widest text-text-secondary flex items-center gap-1 mt-0.5", loc.name !== "Privatna Konzumacija" && "hover:text-blue-400")}
                            >
                                {loc.name === "Privatna Konzumacija" ? "Kuća / Privatni objekat" : <>MAPS <ArrowUpRight className="w-2 h-2" /></>}
                            </a>
                          </div>
                      </div>
                      <div className="text-right flex items-center gap-4">
                          <div>
                            <p className="text-[10px] font-black text-white">{loc.value}</p>
                            <p className="text-[8px] uppercase text-text-secondary">Skenova</p>
                          </div>
                          <QrCode className="w-4 h-4 text-text-secondary hover:text-gold-500 cursor-pointer transition-colors" />
                      </div>
                  </div>
                ))}
              </div>

              {/* Chart for visual context */}
              <div className="h-32 w-full -ml-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dynamicRegionsData} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" hide />
                    <Bar dataKey="value" fill="var(--color-gold-500)" radius={[0, 4, 4, 0]} barSize={10} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {dynamicRegionsData.length === 0 && (
                <p className="text-sm text-text-secondary italic text-center py-6">Nema evidentiranih lokacija u ovom periodu.</p>
              )}
          </div>
      </div>

      {/* AI Report Section */}
      <div className="bg-gradient-to-br from-bg-card-elevated to-black border border-gold-500/20 rounded-3xl p-6 relative overflow-hidden">
         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 relative z-10">
            <div>
              <h3 className="text-lg font-bold text-gold-500 flex items-center gap-2">
                <Crown className="w-5 h-5" />
                AI Sažetak Tržišta
              </h3>
              <p className="text-xs text-text-secondary mt-1">Veštačka inteligencija čita i sumira mišljenja potrošača za izabrani period.</p>
            </div>
            {filteredRatings.length > 0 && !aiSummary && (
              <button 
                onClick={generateAiAnalysis}
                disabled={generatingAi}
                className="px-4 py-2 bg-gold-500 text-black font-bold text-xs uppercase rounded-xl hover:bg-gold-400 transition-colors flex items-center gap-2"
              >
                {generatingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generiši AI Sažetak"}
              </button>
            )}
         </div>

         <div className="relative z-10 min-h-[100px] border border-dashed border-gold-500/30 rounded-xl bg-black/30 p-5">
            {generatingAi ? (
              <div className="flex items-center gap-3 text-gold-500 font-medium">
                 <Loader2 className="w-5 h-5 animate-spin" /> Analiziram recenzije u ovom periodu...
              </div>
            ) : aiSummary ? (
              <p className="text-text-primary/90 text-sm leading-relaxed first-letter:text-4xl first-letter:font-black first-letter:text-gold-500 first-letter:float-left first-letter:mr-2">
                {aiSummary}
              </p>
            ) : (
              <p className="text-sm text-text-secondary italic leading-relaxed">
                Pritisnite dugme iznad kako bi naš sistem ispisao jasan zaključak na osnovu svih ocena.
              </p>
            )}
         </div>
      </div>
        </div>
      )}

      {dashboardTab === 'zajednica' && !postTrialFrozen && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Reports Grid */}
      <div className="grid grid-cols-1 gap-4">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Live Activity Feed */}
            <div className="bg-bg-card border-2 border-gold-500/35 rounded-[32px] p-6 space-y-4 shadow-[0_0_0_1px_rgba(212,175,55,0.08)]">
              <div>
                <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-gold-500" /> Najnovije Aktivnosti
                </h4>
                <p className="text-[10px] text-text-secondary mt-1">Uživo pregled skenova i ocena vaših proizvoda.</p>
              </div>
              <div className="space-y-4 pt-2">
                 {activityFeed.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 group bg-black/35 border border-white/20 rounded-2xl p-3 hover:border-gold-500/40 transition-colors">
                       <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-[10px]",
                          item.type === 'rating' ? "bg-green-500/10 text-green-500" : "bg-gold-500/10 text-gold-500"
                        )}>
                          {item.type === 'rating' ? <Star className="w-4 h-4 fill-current"/> : <QrCode className="w-4 h-4"/>}
                       </div>
                       <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-white truncate">
                             {item.displayName} {item.type === 'rating' ? 'ocenio' : 'skenirao'} {products.find(p => p.id === item.productId)?.name || "proizvod"}
                          </p>
                          <p className="text-[9px] text-text-secondary">
                             {item.date.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })} • {item.safeLocation}
                          </p>
                       </div>
                       {item.type === 'rating' && (
                          <div className="text-gold-500 font-bold text-[10px] flex items-center gap-0.5">
                             {safeText((item as { rating?: unknown }).rating)} <Star className="w-2.5 h-2.5 fill-current"/>
                          </div>
                       )}
                    </div>
                 ))}
                 {activityFeed.length === 0 && (
                    <p className="text-sm text-text-secondary italic text-center py-4">Nema skorašnjih aktivnosti.</p>
                 )}
              </div>
            </div>

            {/* Loyalty / Top Fans */}
            <div className="bg-bg-card border-2 border-gold-500/35 rounded-[32px] p-6 space-y-4 shadow-[0_0_0_1px_rgba(212,175,55,0.08)]">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                      <Users className="w-4 h-4 text-gold-500" /> Verni Potrošači (Loyalty)
                  </h4>
                  <span className="text-[10px] font-black text-gold-500 bg-gold-500/10 border border-gold-500/30 px-2 py-1 rounded-lg uppercase tracking-widest">
                    Članova kluba: {clubMembersCount === "-" ? 0 : clubMembersCount}
                  </span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">Gosti koji najčešće očitavaju i ocenjuju vaš brend.</p>
              </div>
              <div className="space-y-4 pt-2">
                 {loyaltyRanking.map((user, idx) => (
                    <div key={idx} className="flex items-center justify-between group bg-black/35 border border-white/20 rounded-2xl p-3 hover:border-gold-500/40 transition-colors">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-black text-text-secondary group-hover:text-gold-500">
                             {idx + 1}
                          </div>
                          <div>
                             <div className="flex items-center gap-2">
                               <p className="text-xs font-bold text-white">{user.name}</p>
                               {user.isIdentified && <span className="bg-green-500/10 text-green-500 text-[8px] px-1.5 py-0.5 rounded border border-green-500/20 font-black uppercase text-center">Registracija</span>}
                             </div>
                             <p className="text-[8px] uppercase text-text-secondary">Zadnja aktivnost: {user.lastActive.toLocaleDateString('sr-RS')}</p>
                          </div>
                       </div>
                       <div className="bg-gold-500/10 px-2 py-1 rounded-md border border-gold-500/20">
                          <p className="text-[10px] font-black text-gold-500">{user.count} <span className="text-[8px] opacity-70">x</span></p>
                       </div>
                    </div>
                 ))}
                 {loyaltyRanking.length === 0 && (
                    <p className="text-sm text-text-secondary italic text-center py-4">Još nema lojalnih korisnika.</p>
                 )}
              </div>
            </div>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           {/* Sentiment Overview */}
           <div className="bg-bg-card border-2 border-gold-500/35 rounded-[32px] p-6 space-y-4 shadow-[0_0_0_1px_rgba(212,175,55,0.08)]">
              <div>
                 <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                    <Star className="w-4 h-4 text-gold-500" /> Distribucija Ocena
                 </h4>
                 <p className="text-[10px] text-text-secondary mt-1">Zadovoljstvo korisnika razloženo na zvezdice.</p>
              </div>
              <div className="space-y-3 pt-2">
                 {sentimentData.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-xs bg-black/35 border border-white/20 rounded-xl p-2.5">
                       <span className="w-4 font-bold text-text-secondary flex items-center gap-1">{item.stars} <Star className="w-2 h-2 fill-current"/></span>
                       <div className="flex-1 h-2 bg-black rounded-full overflow-hidden border border-white/5">
                          <div className={cn("h-full rounded-full", item.stars >= 4 ? "bg-green-500" : item.stars === 3 ? "bg-yellow-500" : "bg-red-500")} style={{ width: `${item.percent}%` }} />
                       </div>
                       <div className="w-16 text-right space-x-2">
                          <span className="text-white font-bold">{item.count}</span>
                          <span className="text-text-secondary text-[10px]">({item.percent}%)</span>
                       </div>
                    </div>
                 ))}
                 {sentimentData.every(s => s.count === 0) && (
                    <p className="text-sm text-text-secondary italic text-center">Nema ocena.</p>
                 )}
              </div>
           </div>

           {/* Time of Day */}
           <div className="bg-bg-card border-2 border-gold-500/35 rounded-[32px] p-6 space-y-4 shadow-[0_0_0_1px_rgba(212,175,55,0.08)]">
              <div>
                 <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-gold-500" /> Doba Konzumacije
                 </h4>
                 <p className="text-[10px] text-text-secondary mt-1">U kom delu dana ljudi najviše piju vaša pića.</p>
              </div>
              <div className="space-y-3 pt-2">
                 {timeOfDayData.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-xs bg-black/35 border border-white/20 rounded-xl p-2.5">
                       <span className="w-24 font-bold text-text-secondary truncate">{item.period}</span>
                       <div className="flex-1 h-2 bg-black rounded-full overflow-hidden border border-white/5">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${item.percent}%` }} />
                       </div>
                       <div className="w-16 text-right space-x-2">
                          <span className="text-white font-bold">{item.count}</span>
                          <span className="text-text-secondary text-[10px]">({item.percent}%)</span>
                       </div>
                    </div>
                 ))}
                 {timeOfDayData.every(t => t.count === 0) && (
                    <p className="text-sm text-text-secondary italic text-center">Nema skeniranja.</p>
                 )}
              </div>
           </div>
          </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <div className="bg-bg-card border-2 border-gold-500/35 rounded-[32px] p-6 space-y-4 shadow-[0_0_0_1px_rgba(212,175,55,0.08)]">
             <div>
               <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                 <MapPin className="w-4 h-4 text-gold-500" /> Top 5 Gradova
               </h4>
               <p className="text-[10px] text-text-secondary mt-1">Gradovi gde se vaši proizvodi najviše skeniraju.</p>
             </div>
             <div className="space-y-2 pt-1">
               {topCitiesData.length > 0 ? topCitiesData.map((c, idx) => (
                 <div key={c.name} className="flex items-center justify-between bg-black/35 border border-white/20 rounded-xl px-3 py-2">
                   <p className="text-xs text-white font-bold truncate">{idx + 1}. {c.name}</p>
                   <p className="text-[10px] text-gold-500 font-black">{c.value} skenova</p>
                 </div>
               )) : (
                 <p className="text-sm text-text-secondary italic text-center py-4">Nema dovoljno podataka.</p>
               )}
             </div>
           </div>

           <div className="bg-bg-card border-2 border-gold-500/35 rounded-[32px] p-6 space-y-4 shadow-[0_0_0_1px_rgba(212,175,55,0.08)]">
             <div>
               <h4 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                 <Globe className="w-4 h-4 text-gold-500" /> Top 5 Restorana / Kafana
               </h4>
               <p className="text-[10px] text-text-secondary mt-1">
                 Prikazujemo samo javne lokacije (minimum 3 skena po objektu); kućna skeniranja ostaju pod Privatna Konzumacija.
               </p>
             </div>
             <div className="space-y-2 pt-1">
               {topVenuesData.length > 0 ? topVenuesData.map((v, idx) => (
                 <div key={v.name} className="flex items-center justify-between bg-black/35 border border-white/20 rounded-xl px-3 py-2">
                   <p className="text-xs text-white font-bold truncate">{idx + 1}. {v.name}</p>
                   <p className="text-[10px] text-gold-500 font-black">{v.value} skenova</p>
                 </div>
               )) : (
                 <p className="text-sm text-text-secondary italic text-center py-4">
                   Još nema dovoljno javnih skenova za top listu.
                 </p>
               )}
             </div>
           </div>
         </div>
         </div>
        </div>
      )}

      {dashboardTab === 'analitika' && !postTrialFrozen && (
         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Conversion Funnel */}
      <div className="bg-gradient-to-r from-bg-card to-black border border-border-subtle rounded-[32px] p-6">
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
               <TrendingUp className="w-4 h-4 text-gold-500" /> Put Korisnika (Engagement Journey)
            </h4>
            <p className="text-[10px] text-text-secondary mb-4 italic leading-relaxed">
               Pratimo putanju gosta od prvog skena do verifikovane ocene. Kvalitetna etiketa i poziv na akciju (CTA) direktno utiču na stopu konverzije vaših kupaca u verna fanove.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
               <div className="space-y-1">
                  <p className="text-[10px] text-text-secondary uppercase font-bold">Ukupno Skena</p>
                  <p className="text-xl font-bold text-white">{conversionStats.scans}</p>
               </div>
               <div className="space-y-1">
                  <p className="text-[10px] text-text-secondary uppercase font-bold">Procenjeni Gosti</p>
                  <p className="text-xl font-bold text-white">{conversionStats.uniqueUsers}</p>
               </div>
               <div className="space-y-1">
                  <p className="text-[10px] text-text-secondary uppercase font-bold">Stopa Konverzije</p>
                  <p className="text-xl font-bold text-gold-500">{conversionStats.rate}%</p>
               </div>
               <div className="space-y-1">
                  <p className="text-[10px] text-text-secondary uppercase font-bold">Ukupno Ocena</p>
                  <p className="text-xl font-bold text-white">{conversionStats.ratings}</p>
               </div>
            </div>
            <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex">
               <div className="h-full bg-gold-500" style={{ width: `${100 - conversionStats.rate}%` }} />
               <div className="h-full bg-green-500" style={{ width: `${conversionStats.rate}%` }} />
            </div>
            <p className="text-[9px] text-text-secondary mt-2 italic text-center">
               Zlatno: Samo skeniranje • Zeleno: Skeniranje sa ostavljenom ocenom
            </p>
         </div>
         </div>
      )}

      {dashboardTab === 'zajednica' && !postTrialFrozen && (
         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
         {/* Coupons & Promotions (Requested feature) */}
         <div className="bg-bg-card border border-gold-500/10 rounded-[32px] p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
               <Ticket className="w-16 h-16 text-gold-500" />
            </div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
               <Gift className="w-4 h-4 text-gold-500" /> Rakivinum Loyalty
            </h4>
            <div className="flex items-center justify-between mt-4">
               <div className="space-y-1">
                  <p className="text-xs font-bold text-white">Privatnost & Nagrade</p>
                  <p className="text-[10px] text-text-secondary max-w-[240px]">
                     Korisnik dobija digitalni vaučer direktno u aplikaciju. Putem "Uputstva na poleđini" vaučera, on kontaktira vašu firmu da preuzme nagradu - bez potrebe da ostavlja mejl.
                  </p>
               </div>
               <button 
                  onClick={() => setIsClubModalOpen(true)}
                  className="px-4 py-2 bg-gold-500/10 border border-gold-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-gold-500 hover:bg-gold-500 hover:text-black transition-all whitespace-nowrap"
               >
                  Nova Akcija
               </button>
            </div>

            {/* List of active actions */}
            {clubActions.length > 0 && (
              <div className="mt-6 space-y-3">
                <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] border-b border-white/5 pb-2">Vaše Aktivne Akcije</p>
                <div className="grid gap-3">
                  {clubActions.map((action) => (
                    <div key={action.id} className="bg-white/5 border border-white/5 p-3 rounded-2xl flex items-center justify-between group">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gold-500/10 flex items-center justify-center text-gold-500">
                             <Ticket className="w-4 h-4" />
                          </div>
                          <div>
                             <p className="text-xs font-bold text-white uppercase">{safeText((action as { title?: unknown }).title)}</p>
                             <p className="text-[9px] text-text-secondary">
                               Cilj: {safeText((action as { targetValue?: unknown }).targetValue) || 3} • Preostalo: {(action as { endsAt?: unknown }).endsAt ? Math.ceil((toDateSafe((action as { endsAt?: unknown }).endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : '?'} dana
                             </p>
                          </div>
                       </div>
                       <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full", action.isActive ? "bg-green-500 animate-pulse" : "bg-red-500")} />
                          <span className="text-[8px] font-black text-white px-2 py-1 bg-white/5 rounded-md uppercase tracking-widest">{action.isActive ? 'Aktivna' : 'Pauza'}</span>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
         </div>
         </div>
      )}

      {dashboardTab === 'analitika' && !postTrialFrozen && (
         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Main Trend Chart */}
      <div className="bg-bg-card border border-border-subtle p-5 rounded-[32px] space-y-6 relative overflow-hidden group">

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Trend Aktivnosti</h3>
          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-tighter">
            <span className="flex items-center gap-1.5 text-gold-500">
              <div className="w-1.5 h-1.5 rounded-full bg-gold-500" /> Interakcije (zadnjih 7 dana)
            </span>
          </div>
        </div>
        
        <div className="px-2">
          <p className="text-[10px] text-text-secondary italic leading-relaxed">
            Grafikon prikazuje kretanje interesovanja za vaš brend. Skokovi obično označavaju vikende, sajmove ili marketinške kampanje koje su pokrenule digitalna očitavanja.
          </p>
        </div>
        
        <div className="h-48 w-full -ml-4 transition-all duration-300">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dynamicChartData}>
              <defs>
                <linearGradient id="colorOcenes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-gold-500)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--color-gold-500)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 10, fill: "var(--color-text-secondary)", fontWeight: 600}}
                dy={10}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: "var(--color-bg-card-elevated)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
                itemStyle={{color: "var(--color-gold-500)"}}
              />
              <Area 
                type="monotone" 
                dataKey="ocene" 
                stroke="var(--color-gold-500)" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorOcenes)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

      </div>
         </div>
      )}

      {dashboardTab === 'proizvodi' && (
         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-bg-card border border-gold-500/25 rounded-2xl p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-white uppercase tracking-widest">Profil destilerije / vinarije</p>
          <p className="text-[10px] text-text-secondary mt-1">Uredite opis, specifičnosti i fotografije objekta.</p>
        </div>
        <button
          onClick={() => {
            if (postTrialFrozen) {
              alert("Profil destilerije nije moguće menjati dok probni period nije produžen ili nalog nije sertifikovan.");
              return;
            }
            setIsEditDistilleryModalOpen(true);
          }}
          disabled={postTrialFrozen}
          className="px-4 py-2 bg-gold-500/10 border border-gold-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-gold-500 hover:bg-gold-500 hover:text-black transition-all disabled:opacity-40 disabled:pointer-events-none"
        >
          Uredi profil
        </button>
      </div>
      {/* Top Products */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Najpopularnija Pića</h3>
            <p className="text-[10px] text-text-secondary italic">Popularnost se meri na osnovu učestalosti skeniranja i visine ocena korisnika za izabrani period.</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                if (postTrialFrozen) {
                  alert("Novi artikli se ne mogu dodavati dok probni period nije produžen ili nalog nije sertifikovan.");
                  return;
                }
                setIsAddProductModalOpen(true);
              }}
              className={cn(
                "px-3 py-1 text-black text-[10px] font-black uppercase rounded-lg transition-colors flex items-center justify-center whitespace-nowrap shadow-lg shadow-gold-500/20",
                postTrialFrozen ? "bg-white/10 text-text-secondary cursor-not-allowed opacity-60" : "bg-gold-500 hover:bg-gold-400"
              )}
            >
              + Dodaj Piće
            </button>
            <button 
              onClick={() => setShowAllProducts(!showAllProducts)}
              className="text-[10px] font-bold text-text-secondary hover:text-gold-500 uppercase flex items-center gap-1 transition-colors"
            >
              {showAllProducts ? 'Smanji prikaz' : 'Vidi sve'} <ChevronRight className={cn("w-3 h-3 transition-transform", showAllProducts && "rotate-90")} />
            </button>
          </div>
        </div>
        <div className="space-y-3">
          {displayedProducts.map((product, idx) => (
            <div 
              key={product.id || idx} 
              className="bg-bg-card border border-border-subtle p-3.5 rounded-2xl flex items-center justify-between group active:scale-[0.98] transition-all hover:border-gold-500/30"
            >
              <div 
                className="flex items-center gap-3 cursor-pointer flex-1"
                onClick={() => {
                  if (postTrialFrozen) {
                    alert("Analitika artikla nije dostupna dok probni period nije produžen ili nalog nije sertifikovan.");
                    return;
                  }
                  navigate(`/product-analytics/${product.id}`);
                }}
              >
                <div className="w-12 h-12 bg-bg-card-elevated border border-border-subtle rounded-xl flex items-center justify-center text-xl shadow-inner group-hover:bg-gold-500/5 transition-colors overflow-hidden shrink-0">
                   {product.bottleImageUrl ? <img src={product.bottleImageUrl} className="h-full object-cover" /> : '🥃'}
                </div>
                <div className="flex-1 truncate">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white group-hover:text-gold-500 transition-colors truncate">{product.name}</p>
                    {product.isApproved === false && (
                       <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 rounded text-[8px] font-black uppercase tracking-widest whitespace-nowrap">Na Odobrenju</span>
                    )}
                  </div>
                  <p className="text-[10px] text-text-secondary mt-0.5">{product.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs font-bold text-white">{product.ratingCount || 0}</p>
                  <p className="text-[10px] font-bold text-green-500 flex items-center justify-end"><Star className="w-2 h-2 fill-green-500 mr-0.5"/> {product.avgRating || "0.0"}</p>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProduct(product);
                    setIsEditProductModalOpen(true);
                  }}
                  className="px-3 py-2 bg-white/5 rounded-xl text-text-secondary hover:bg-white/10 transition-all border border-white/10 flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase hidden sm:inline">Izmeni</span>
                </button>
                <button
                  type="button"
                  title={product.publicLabelDisabled ? "Javni link ka etiketi je isključen" : "Isključi javni QR (sopstveni štampani kodovi neće raditi)"}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await updateDoc(doc(db, "products", product.id), {
                        publicLabelDisabled: !product.publicLabelDisabled,
                      });
                    } catch (err: unknown) {
                      alert((err as { message?: string } | null)?.message || "Greška pri čuvanju.");
                    }
                  }}
                  className={cn(
                    "px-2 py-2 rounded-xl border text-[9px] font-black uppercase shrink-0",
                    product.publicLabelDisabled
                      ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                      : "border-white/10 text-text-secondary hover:text-amber-400 bg-white/5"
                  )}
                >
                  {product.publicLabelDisabled ? "QR off" : "QR javno"}
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hasProducerKit) {
                      alert(
                        "Izvoz QR koda za etikete dostupan je sertifikovanim proizvođačima. Tokom probnog perioda možete uređivati artikle i pratiti analitiku."
                      );
                      return;
                    }
                    setQrModalProduct(product);
                  }}
                  title={!hasProducerKit ? "Dostupno nakon sertifikacije" : undefined}
                  className={cn(
                    "px-3 py-2 rounded-xl border flex items-center gap-2",
                    hasProducerKit
                      ? "bg-gold-500/10 text-gold-500 hover:bg-gold-500 border-gold-500/20 hover:text-black transition-all"
                      : "bg-white/5 text-text-secondary border-white/10 cursor-not-allowed opacity-60"
                  )}
                >
                  <QrCode className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase hidden sm:inline">Export QR</span>
                </button>
              </div>
            </div>
          ))}
          {sortedProducts.length === 0 && (
             <p className="text-sm text-text-secondary italic text-center py-6">Nema unetih proizvoda.</p>
          )}
        </div>
      </div>
         </div>
      )}

      {dashboardTab === 'alati' && !postTrialFrozen && (
         <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {!hasProducerKit ? (
            <div className="rounded-[32px] border border-amber-500/25 bg-bg-card-elevated p-8 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                <Lock className="w-7 h-7 text-amber-400" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">Alati & QR</h3>
              <p className="text-xs text-text-secondary leading-relaxed max-w-md mx-auto">
                Master QR, marketing linkovi, NFC uputstva i zvanični PDF sertifikat otključavaju se kada administrator uključi status sertifikovanog proizvođača. Tokom probnog naloga dostupni su unos artikala, analitika i zajednica.
              </p>
            </div>
          ) : (
            <>
          <div className="grid grid-cols-1 gap-3 pb-2 pt-2">
            <button 
              onClick={() => setIsDistilleryQrOpen(true)}
              className="flex flex-col items-center justify-center p-6 bg-gold-500/5 border border-gold-500/20 rounded-[32px] group hover:bg-gold-500/10 transition-all active:scale-95 text-center"
            >
               <QrCode className="w-8 h-8 text-gold-500 mb-2 group-hover:scale-110 transition-transform" />
               <p className="text-[10px] font-black uppercase tracking-widest text-gold-500 leading-tight">Master Katalog QR</p>
               <p className="text-[8px] text-text-secondary mt-1 uppercase tracking-tight">QR kod za vašu javnu stranicu sa svim artiklima</p>
            </button>
          </div>
      {/* Marketing Alati SECTION (Renamed) */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-2 px-2">
           <Smartphone className="w-5 h-5 text-gold-500" />
           <h3 className="text-sm font-bold uppercase tracking-wider text-white">Marketing Alati</h3>
        </div>
        
        <div className="grid gap-4">
           {/* Social Media & Ads Kit */}
           <div className="bg-gradient-to-br from-bg-card-elevated to-black border border-blue-500/20 rounded-[32px] p-6 space-y-4 relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl" />
              <div className="flex items-start justify-between">
                 <div className="space-y-1">
                    <h4 className="font-black text-white text-md uppercase tracking-tight">Social Media & Ads Kit</h4>
                    <p className="text-[10px] text-text-secondary leading-relaxed max-w-[200px]">
                       Generišite linkove za Facebook i Instagram oglase sa automatskim filterima za praćenje konverzija.
                    </p>
                 </div>
                 <div className="w-14 h-14 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-inner group-hover:scale-110 transition-transform">
                    <Share2 className="w-7 h-7 text-blue-500" />
                  </div>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!distilleryUrl) return;
                    const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(distilleryUrl)}`;
                    window.open(fbUrl, "_blank", "noopener,noreferrer");
                  }}
                  className="py-3 bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500/20 transition-colors"
                >
                  Podeli na Facebook
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!distilleryUrl) return;
                    await navigator.clipboard.writeText(distilleryUrl);
                    alert("Link je kopiran. Zalepite ga u Instagram Story ili bio.");
                  }}
                  className="py-3 bg-purple-500/10 border border-purple-500/30 text-purple-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-500/20 transition-colors"
                >
                  Kopiraj za Instagram
                </button>
                <div className="flex items-center gap-2 p-3 bg-black/40 rounded-xl border border-white/5">
                   <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                   <p className="text-[9px] text-text-secondary">Instagram nema direktan link-post kao FB; koristi se Story/bio uz kopiran link.</p>
                </div>
              </div>
           </div>

           {/* Smart Table Talkers Card */}
           <div className="bg-gradient-to-br from-bg-card-elevated to-bg-base border border-gold-500/20 rounded-[32px] p-6 space-y-4 relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-gold-500/5 rounded-full blur-2xl" />
              <div className="flex items-start justify-between">
                 <div className="space-y-1">
                    <h4 className="font-black text-white text-md uppercase tracking-tight">Digitalni Stoni Stala-ci</h4>
                    <p className="text-[10px] text-text-secondary leading-relaxed max-w-[200px]">
                       Odštampajte Master QR ili podesite NFC stalke. Povećajte broj direktnih ocena brenda na mestu prodaje.
                    </p>
                 </div>
                 <div className="w-14 h-14 bg-gold-500/10 rounded-2xl flex items-center justify-center border border-gold-500/20 shadow-inner group-hover:scale-110 transition-transform">
                    <QrCode className="w-7 h-7 text-gold-500" />
                 </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setIsDistilleryQrOpen(true)}
                  className="py-3 bg-gold-500 text-black border border-gold-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black hover:text-gold-500 transition-all shadow-lg shadow-gold-500/20"
                >
                  Master QR Kit
                </button>
                <button 
                  onClick={() => setIsNfcInfoOpen(true)}
                  className="py-3 bg-white/5 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-gold-500 transition-all"
                >
                  Postavi NFC
                </button>
              </div>

              <div className="pt-2">
                 <p className="text-[10px] text-text-secondary uppercase tracking-widest font-black mb-2 opacity-50">Tvoj Master Link (Rakivinum)</p>
                 <div className="flex gap-2">
                    <div className="flex-1 bg-black/40 border border-white/5 px-3 py-2 rounded-lg text-[10px] text-gold-500/70 font-mono truncate">
                       {distilleryUrl}
                    </div>
                    <button 
                      onClick={copyDistilleryUrl}
                      className="p-2 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-gold-500 hover:text-black transition-all"
                    >
                       <Copy className="w-3.5 h-3.5" />
                    </button>
                 </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                 <button 
                   onClick={handleShareDistillery}
                   className="py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white flex items-center justify-center gap-2 hover:bg-white/10"
                 >
                   <Share2 className="w-3.5 h-3.5 text-gold-500" /> Podeli Status
                 </button>
                 <button 
                   onClick={() => void generateDistilleryPDF()}
                   disabled={!hasProducerKit || isGeneratingCert}
                   className="py-3 bg-gold-500/10 border border-gold-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-gold-500 flex items-center justify-center gap-2 hover:bg-gold-500 hover:text-black transition-all disabled:opacity-50"
                 >
                   {isGeneratingCert ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                   Sertifikat (PDF)
                 </button>
              </div>
           </div>

           <div 
             onClick={() => setIsNfcInfoOpen(true)}
             className="bg-bg-card-elevated border border-border-subtle rounded-[24px] p-5 flex items-center gap-4 group cursor-pointer hover:border-gold-500/50 transition-all"
           >
              <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center shrink-0 border border-white/10">
                 <Info className="w-6 h-6 text-text-secondary group-hover:text-gold-500 transition-colors" />
              </div>
              <div className="flex-1">
                 <p className="text-xs font-bold text-white uppercase tracking-tight">Pametni Stoni Stala-ci (Vodič)</p>
                 <p className="text-[9px] text-text-secondary mt-0.5">Saznajte kako da digitalizujete stolove i povežete Google Maps lokacije.</p>
              </div>
              <ChevronRight className="w-4 h-4 text-text-secondary" />
           </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Upozorenja i Obaveštenja</h3>
        <div className="space-y-3">
          <div className="bg-gold-500/5 border border-gold-500/10 p-4 rounded-2xl flex gap-3">
             <div className="w-10 h-10 shrink-0 bg-gold-500/10 rounded-xl flex items-center justify-center">
                <Star className="w-5 h-5 text-gold-500" />
             </div>
             <div>
                <p className="text-xs font-bold text-white">Novi rekord!</p>
                <p className="text-[10px] text-text-secondary mt-0.5">Jedno vaše piće je dostiglo 1.000 skeniranja u Beogradu.</p>
             </div>
          </div>
          <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex gap-3">
             <div className="w-10 h-10 shrink-0 bg-white/5 rounded-xl flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-white/40" />
             </div>
             <div>
                <p className="text-xs font-bold text-white">Sajam pića - Podsetnik</p>
                <p className="text-[10px] text-text-secondary mt-0.5">Vaši proizvodi će biti istaknuti na početnoj strani tokom trajanja sajma.</p>
             </div>
          </div>
        </div>
      </div>

            </>
          )}
         </div>
      )}

      {/* Add Product Modal */}
      <AddProductModal 
        isOpen={isAddProductModalOpen} 
        onClose={() => setIsAddProductModalOpen(false)} 
        distilleryId={distillery?.id || ''}
        locked={postTrialFrozen}
      />

      {/* Detailed Analytics Modal */}
      {isAnalyticsModalOpen && (
        <DistilleryAnalyticsModal 
          distillery={distillery} 
          onClose={() => setIsAnalyticsModalOpen(false)} 
        />
      )}

      {/* Edit Product Modal */}
      <EditProductModal 
        isOpen={isEditProductModalOpen} 
        onClose={() => setIsEditProductModalOpen(false)} 
        product={editingProduct}
        minimalEdit={postTrialFrozen}
        onSave={() => {
           // Refresh logic if needed, but onSnapshot should handle it
           alert("Izmene su sačuvane i poslate na ponovno odobrenje!");
        }}
      />

      {/* Edit Distillery Modal */}
      <EditDistilleryModal 
        isOpen={isEditDistilleryModalOpen}
        onClose={() => setIsEditDistilleryModalOpen(false)}
        distillery={distillery}
        readOnly={postTrialFrozen}
      />

      {/* QR Export Modal */}
      {qrModalProduct && hasProducerKit && (
        <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-bg-card border border-white/10 rounded-[40px] w-full max-w-sm p-8 space-y-8 animate-in zoom-in-95 duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6">
                <button 
                  onClick={() => setQrModalProduct(null)}
                  className="p-3 bg-black/40 rounded-full text-text-secondary hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="text-center space-y-2">
                 <h3 className="text-xl font-bold font-serif text-white">Digitalno Mesto</h3>
                 <p className="text-xs text-gold-500 uppercase tracking-widest font-bold">{qrModalProduct.name}</p>
              </div>

              <div className="flex flex-col items-center gap-8">
                 <div className="p-6 bg-white rounded-3xl shadow-[0_20px_50px_rgba(212,175,55,0.3)]">
                    <QRCodeCanvas 
                      id="product-qr-canvas"
                      value={`${window.location.origin}/label/${qrModalProduct.id}`}
                      size={200}
                      level={"H"}
                      includeMargin={false}
                      ref={qrRef}
                    />
                 </div>

                 <div className="w-full space-y-4">
                    <button 
                      onClick={downloadQR}
                      className="w-full py-4 bg-gold-500 text-black rounded-full font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl shadow-gold-500/20 active:scale-95 transition-all"
                    >
                      <Download className="w-5 h-5" /> Preuzmi QR Kod (.PNG)
                    </button>
                    <p className="text-[10px] text-text-secondary text-center max-w-[200px] mx-auto leading-relaxed">
                       Ovaj kod odštampajte na etiketi. Skeniranjem korisnik otvara digitalni profil vašeg brenda.
                    </p>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Distillery Master QR Modal */}
      {isDistilleryQrOpen && hasProducerKit && (
        <div className="fixed inset-0 z-[140] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-bg-card border border-gold-500/40 rounded-[40px] w-full max-w-sm p-8 space-y-8 animate-in zoom-in-95 duration-300 relative overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.15)]">
              <button 
                onClick={() => setIsDistilleryQrOpen(false)}
                className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center space-y-3">
                 <Crown className="w-8 h-8 text-gold-500 mx-auto" />
                 <h3 className="text-2xl font-black font-serif italic text-white flex flex-col">
                    <span>Master Rakivinum</span>
                    <span className="not-italic text-[10px] uppercase tracking-[0.4em] text-gold-500 mt-1">Brend Identitet</span>
                 </h3>
                 <p className="text-[10px] text-text-secondary uppercase tracking-widest font-bold">{distillery?.name || 'Vaš Brend'}</p>
              </div>

              <div className="flex flex-col items-center gap-8">
                 <div className="p-6 bg-white rounded-3xl shadow-[0_20px_50px_rgba(212,175,55,0.4)]">
                    <QRCodeCanvas 
                      id="distillery-qr-canvas"
                      value={distilleryUrl}
                      size={200}
                      level={"H"}
                      includeMargin={false}
                      ref={distilleryQrRef}
                    />
                 </div>

                 <div className="w-full space-y-4">
                    <button 
                      onClick={downloadDistilleryQR}
                      className="w-full py-4 bg-gold-500 text-black rounded-full font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl shadow-gold-500/30 active:scale-95 transition-all text-xs"
                    >
                      <Download className="w-5 h-5" /> Preuzmi Master QR
                    </button>
                    <p className="text-[9px] text-text-secondary text-center leading-relaxed">
                       Ovaj kod vodi goste na vaš <strong>kompletan katalog</strong> u Rakivinum mreži. Idealno za sto, meni ili vinske karte.
                    </p>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Club Setup Flow */}
      <ClubSetupModal 
        isOpen={isClubModalOpen} 
        onClose={() => setIsClubModalOpen(false)} 
        distilleryId={distillery?.id || ''}
      />

      {/* NFC / Smart Table Talker Instructions Modal */}
      {isNfcInfoOpen && hasProducerKit && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[32px] w-full max-w-sm p-8 space-y-6 relative max-h-[90vh] overflow-y-auto hide-scrollbar">
              <button 
                onClick={() => setIsNfcInfoOpen(false)}
                className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center space-y-2">
                 <div className="w-14 h-14 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-gold-500/20">
                    <Smartphone className="w-7 h-7 text-gold-500" />
                 </div>
                 <h3 className="text-xl font-black text-white uppercase tracking-tight">Postavi Smart Stalke</h3>
                 <p className="text-xs text-text-secondary leading-relaxed">
                   Uputstvo za digitalizaciju kafanskih stolova u 4 koraka.
                 </p>
              </div>

              <div className="space-y-6">
                 <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center shrink-0 text-gold-500 font-bold text-xs border border-gold-500/30">1</div>
                    <div className="space-y-1">
                       <p className="text-xs font-black text-white uppercase tracking-wider">Nabavi Tagove</p>
                       <p className="text-[10px] text-text-secondary leading-normal">Kupite samolepljive NFC tagove (NTAG213). Jeftini su i lako se nabavljaju online.</p>
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center shrink-0 text-gold-500 font-bold text-xs border border-gold-500/30">2</div>
                    <div className="space-y-1">
                       <p className="text-xs font-black text-white uppercase tracking-wider">NFC Tools Aplikacija</p>
                       <p className="text-[10px] text-text-secondary leading-normal">Instalirajte besplatnu aplikaciju "NFC Tools" na svoj telefon.</p>
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center shrink-0 text-gold-500 font-bold text-xs border border-gold-500/30">3</div>
                    <div className="space-y-3 flex-1">
                       <div>
                        <p className="text-xs font-black text-white uppercase tracking-wider">Upiši link (Rakivinum)</p>
                        <p className="text-[10px] text-text-secondary leading-normal">U aplikaciji odaberite "Write" → "URL" i nalepite vaš <strong>Master Link</strong>.</p>
                       </div>
                       <div className="bg-black/40 border border-white/5 rounded-xl p-3 flex items-center gap-3">
                          <div className="flex-1 text-[9px] font-mono text-gold-500/70 truncate uppercase tracking-tighter">
                             {distilleryUrl}
                          </div>
                           <button 
                             onClick={copyDistilleryUrl}
                             className="p-2 bg-gold-500/10 border border-gold-500/20 rounded-lg text-gold-500 hover:bg-gold-500 hover:text-black transition-all"
                           >
                              <Copy className="w-3.5 h-3.5" />
                           </button>
                       </div>
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center shrink-0 text-gold-500 font-bold text-xs border border-gold-500/30">4</div>
                    <div className="space-y-1">
                       <p className="text-xs font-black text-white uppercase tracking-wider">Zalepi i Podeli</p>
                       <p className="text-[10px] text-text-secondary leading-normal">Zalepite tag na kartončić, stalak ili vinski meni. Gost samo prisloni telefon!</p>
                    </div>
                 </div>
              </div>

              <button 
                onClick={() => setIsNfcInfoOpen(false)}
                className="w-full py-4 bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest rounded-2xl text-[10px]"
              >
                Razumem, idemo dalje
              </button>
           </div>
        </div>
      )}

    </div>
  );
}

// Sub-component for Club Creation Flow
function ClubSetupModal({ isOpen, onClose, distilleryId }: { isOpen: boolean, onClose: () => void, distilleryId: string }) {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [actionData, setActionData] = useState({
    title: '',
    targetScans: 5,
    targetRatings: 5,
    durationDays: 15,
    reward: 'voucher_code',
    instructions: '',
  });

  const handleSaveAction = async () => {
    if (!distilleryId) return;
    if (!actionData.title || !actionData.instructions) {
      alert("Molimo popunite sva polja.");
      return;
    }
    setIsSaving(true);
    try {
      const createdAt = new Date();
      const endsAt = new Date();
      endsAt.setDate(createdAt.getDate() + actionData.durationDays);

      const conditionLabel = `Skeniraj ${actionData.targetScans} pića i oceni ${actionData.targetRatings} pića (Zlatno pravilo: 1 dan = 1 ocena)`;

      await addDoc(collection(db, 'club_actions'), {
        distilleryId,
        title: actionData.title,
        condition: 'combined_automated',
        conditionLabel,
        targetScans: Number(actionData.targetScans),
        targetRatings: Number(actionData.targetRatings),
        rewardType: actionData.reward,
        rewardLabel: rewards.find(r => r.id === actionData.reward)?.label || 'Nagrada',
        rewardValue: actionData.instructions,
        isActive: true,
        durationDays: Number(actionData.durationDays),
        createdAt: serverTimestamp(),
        endsAt: endsAt
      });
      alert(`Akcija uspešno kreirana! Traje ${actionData.durationDays} dana. Gosti moraju ispoštovati zlatno pravilo ocena.`);
      onClose();
      setStep(1);
    } catch (err) {
      console.error("Error saving action", err);
      alert("Greška pri kreiranju akcije.");
    } finally {
      setIsSaving(false);
    }
  };

  const rewards = [
    { id: 'voucher_code', label: 'Digitalni Kod (Vaučer)', sub: 'Sistem šalje kod nakon ispunjenja cilja' },
    { id: 'secret_link', label: 'Tajni Link', sub: 'Link se otključava samo pobednicima' },
    { id: 'instructions', label: 'Poklon / Instrukcija', sub: 'npr. "Pokaži ovaj ekran konobaru za gratis čašicu"' },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[32px] w-full max-w-sm p-8 space-y-6 relative overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.15)] max-h-[90vh] overflow-y-auto hide-scrollbar">
        
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-white/5">
           <div className="h-full bg-gold-500 transition-all duration-500" style={{ width: `${(step / 2) * 100}%` }} />
        </div>

        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-6 pt-2">
           {step === 1 && (
             <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
               <div className="space-y-2">
                  <h3 className="text-xl font-black text-white uppercase italic">Definišite Ciljeve</h3>
                  <p className="text-[10px] text-text-secondary leading-relaxed uppercase tracking-widest font-bold">Koliko interakcija je potrebno za nagradu?</p>
               </div>
               
               <div className="space-y-6">
                 {/* Target Scans */}
                 <div className="space-y-3">
                    <div className="flex justify-between items-center">
                       <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Broj Skeniranja</label>
                       <span className="text-sm font-bold text-white">{actionData.targetScans}</span>
                    </div>
                    <input 
                      type="range" min="1" max="20" step="1"
                      className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-gold-500"
                      value={actionData.targetScans}
                      onChange={(e) => setActionData({...actionData, targetScans: Number(e.target.value)})}
                    />
                 </div>

                 {/* Target Ratings */}
                 <div className="space-y-3">
                    <div className="flex justify-between items-center">
                       <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Broj Ocena (4.5+)</label>
                       <span className="text-sm font-bold text-white">{actionData.targetRatings}</span>
                    </div>
                    <input 
                      type="range" min="1" max="20" step="1"
                      className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-gold-500"
                      value={actionData.targetRatings}
                      onChange={(e) => setActionData({...actionData, targetRatings: Number(e.target.value)})}
                    />
                 </div>

                 {/* Duration */}
                 <div className="space-y-3">
                    <div className="flex justify-between items-center">
                       <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Trajanje (Dani)</label>
                       <span className="text-sm font-bold text-white">{actionData.durationDays}</span>
                    </div>
                    <input 
                      type="range" min="7" max="60" step="1"
                      className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-gold-500"
                      value={actionData.durationDays}
                      onChange={(e) => setActionData({...actionData, durationDays: Number(e.target.value)})}
                    />
                 </div>

                 <div className="p-4 bg-gold-500/10 border border-gold-500/20 rounded-2xl">
                    <p className="text-[9px] text-gold-500/80 leading-relaxed font-bold uppercase tracking-tighter">
                       Zlatno pravilo: Sistem prihvata samo 1 ocenu dnevno po korisniku. Ako gost želi više, mora da sačeka sutrašnji dan.
                    </p>
                 </div>

                 <button 
                   onClick={() => setStep(2)}
                   className="w-full py-4 bg-gold-500 text-black rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-gold-500/20 active:scale-95 transition-all"
                 >
                   Sledeći Korak →
                 </button>
               </div>
             </div>
           )}

           {step === 2 && (
             <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
               <div className="space-y-2">
                  <h3 className="text-xl font-black text-white uppercase italic">Nagrada i Naslov</h3>
                  <p className="text-xs text-text-secondary leading-relaxed uppercase tracking-widest font-bold">Šta dobija verni ljubitelj?</p>
               </div>
               
               <div className="space-y-4">
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Naslov Akcije</label>
                    <input 
                      type="text"
                      placeholder="npr. Rakivinum Expert Poklon"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all shadow-inner"
                      value={actionData.title}
                      onChange={(e) => setActionData({...actionData, title: e.target.value})}
                    />
                 </div>

                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Tip Nagrade</label>
                    <select 
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all appearance-none"
                      value={actionData.reward}
                      onChange={(e) => setActionData({...actionData, reward: e.target.value})}
                    >
                      {rewards.map(r => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                 </div>

                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Sadržaj Nagrade</label>
                    <textarea 
                      placeholder="npr. Besplatna čašica pri naručivanju ručka"
                      rows={3}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all resize-none shadow-inner"
                      value={actionData.instructions}
                      onChange={(e) => setActionData({...actionData, instructions: e.target.value})}
                    />
                 </div>

                 <button 
                   onClick={handleSaveAction}
                   disabled={isSaving}
                   className="w-full py-4 bg-gold-500 text-black rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 shadow-xl shadow-gold-500/20 active:scale-95 transition-all disabled:opacity-50"
                 >
                   {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                   Aktiviraj Akciju 🚀
                 </button>

                 <button onClick={() => setStep(1)} className="w-full text-[10px] text-text-secondary uppercase font-black flex items-center justify-center gap-1 mt-2 hover:text-white transition-colors">
                    <ArrowLeft className="w-3 h-3" /> Nazad na ciljeve
                 </button>
               </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

function AddProductModal({ isOpen, onClose, distilleryId, locked }: { isOpen: boolean, onClose: () => void, distilleryId: string, locked?: boolean }) {
  const normalizeBarcode = (value: unknown) => String(value || "").replace(/\D/g, "");
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    description: "",
    alcoholPercentage: 40,
    bottleImageUrl: "",
    barcode: ""
  });
  const [isSaving, setIsSaving] = useState(false);

  const PRODUCT_TYPES = [
    "Šljivovica", "Dunjevača", "Kajsijevača", "Viljamovka", "Kruškovaca",
    "Jabukovača", "Višnjevača", "Lozovača", "Travarica", 
    "Medovača", "Malinovača", "Kupinovača", "Liker", "Ostale rakije",
    "Belo vino", "Crveno/Crno vino", "Roze vino", "Penušavo vino", "Dezertno vino", "Ostala vina"
  ];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (locked) {
      alert("Novi artikli se ne mogu dodavati dok probni period nije produžen ili nalog nije sertifikovan.");
      return;
    }
    if (!formData.name || !formData.type) {
      alert("Unesite naziv i tip pića.");
      return;
    }
    
    setIsSaving(true);
    try {
      const docData = {
        name: formData.name.trim(),
        type: formData.type.trim(),
        description: formData.description.trim(),
        alcoholPercentage: Number(formData.alcoholPercentage) || 0,
        bottleImageUrl: formData.bottleImageUrl.trim() || `https://picsum.photos/seed/${formData.name.replace(/\s+/g,'')}/800/1000`,
        barcode: formData.barcode.trim() || null,
        barcodeNormalized: formData.barcode.trim() ? normalizeBarcode(formData.barcode.trim()) : null,
        distilleryId: distilleryId,
        createdAt: serverTimestamp(),
        isApproved: false, // requires admin approval
        stats: {
          scans: 0,
          uniqueUsers: 0
        },
        ratingCount: 0,
        averageRating: 0
      };

      await addDoc(collection(db, 'products'), docData);
      alert("Piće je uspešno uneto i poslato administratoru na odobrenje!");
      onClose();
    } catch (err: unknown) {
      console.error(err);
      alert("Greška: " + ((err as { message?: string } | null)?.message || "Nepoznata greška"));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[160] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[32px] w-full max-w-sm p-8 space-y-6 relative overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.15)] max-h-[90vh] overflow-y-auto hide-scrollbar">
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-2 pt-2">
           <h3 className="text-xl font-black text-white uppercase italic">Dodaj Piće</h3>
           <p className="text-[10px] text-text-secondary leading-relaxed uppercase tracking-widest font-bold">Svaki unos zahteva odobrenje admina</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Naziv Pića</label>
              <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all shadow-inner" placeholder="npr. Manastirska Lozovača" />
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Tip / Kategorija</label>
              <select required value={formData.type} onChange={e=>setFormData({...formData, type: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all shadow-inner appearance-none cursor-pointer">
                 <option value="">Izaberi...</option>
                 {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Procenat Alkohola (%)</label>
              <input type="number" step="0.1" value={formData.alcoholPercentage} onChange={e=>setFormData({...formData, alcoholPercentage: Number(e.target.value)})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all shadow-inner" />
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Bar-kod (EAN/UPC)</label>
              <input
                type="text"
                value={formData.barcode}
                onChange={e=>setFormData({...formData, barcode: e.target.value})}
                className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all shadow-inner"
                placeholder="npr. 8601234567890"
              />
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest flex items-center justify-between">
                 Slika Flaše (Upload)
                 <span className="text-[8px] opacity-70 italic text-white/50 lowercase">Maks 2MB</span>
              </label>
              <div className="relative group">
                 <input 
                   type="file" 
                   accept="image/*"
                   onChange={async (e) => {
                     const file = e.target.files?.[0];
                     if (file) {
                      if (file.size > 15 * 1024 * 1024) {
                        alert("Slika je prevelika za obradu na telefonu (preko 15MB).");
                        return;
                      }
                      const optimized = await processImageToDataURL(file, 400, 400, 0.6);
                      setFormData({...formData, bottleImageUrl: optimized});
                     }
                   }} 
                   className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                 />
                 <div className="w-full bg-bg-base border border-dashed border-white/20 rounded-xl px-4 py-6 text-center group-hover:border-gold-500/50 transition-all">
                   {formData.bottleImageUrl ? (
                      <div className="flex items-center gap-3 justify-center">
                         <img src={formData.bottleImageUrl} className="w-10 h-10 rounded object-cover border border-white/10" />
                         <span className="text-[10px] text-green-500 font-bold uppercase">Slika Otpremljena</span>
                      </div>
                   ) : (
                      <div className="flex flex-col items-center gap-2">
                         <Download className="w-5 h-5 text-text-secondary group-hover:text-gold-500 transition-colors rotate-180" />
                         <span className="text-[10px] text-text-secondary uppercase">Klikni ili prevuci sliku</span>
                      </div>
                   )}
                 </div>
              </div>
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Opis</label>
              <textarea value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none transition-all shadow-inner resize-none h-20" placeholder="Unesite note ukusa, destilaciju..."></textarea>
           </div>
           
           <button type="submit" disabled={isSaving} className="w-full py-4 bg-gold-500 text-black rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-gold-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 mt-4 disabled:opacity-50">
             {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
             Pošalji na Odobrenje
           </button>
        </form>
      </div>
    </div>
  );
}

function EditProductModal({
  isOpen,
  onClose,
  product,
  onSave,
  minimalEdit,
}: {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: string;
    name?: string;
    type?: string;
    alcoholPercentage?: number;
    description?: string;
    bottleImageUrl?: string;
    image?: string;
    barcode?: string;
  } | null;
  onSave: () => void;
  minimalEdit?: boolean;
}) {
  const normalizeBarcode = (value: unknown) => String(value || "").replace(/\D/g, "");
  const [formData, setFormData] = useState<{
    name: string;
    type: string;
    alcoholPercentage: number;
    description: string;
    bottleImageUrl: string;
    barcode: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        type: product.type,
        alcoholPercentage: product.alcoholPercentage || 40,
        description: product.description || "",
        bottleImageUrl: product.bottleImageUrl || product.image || "",
        barcode: product.barcode || ""
      });
    }
  }, [product, isOpen]);

  if (!isOpen || !formData) return null;

  return (
    <div className="fixed inset-0 z-[210] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[32px] w-full max-w-sm p-8 space-y-6 relative overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.15)] max-h-[90vh] overflow-y-auto hide-scrollbar">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white transition-colors border border-white/10">
          <X className="w-5 h-5" />
        </button>
        <div className="text-center space-y-2 pt-2">
           <h3 className="text-xl font-black text-white uppercase italic">Izmeni Piće</h3>
           <p className="text-[10px] text-gold-500 leading-relaxed font-black uppercase tracking-[0.2em]">Ažurirajte podatke</p>
        </div>
        
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setIsSaving(true);
          try {
            if (minimalEdit) {
              await updateDoc(doc(db, 'products', product.id), {
                name: formData.name.trim(),
                alcoholPercentage: Number(formData.alcoholPercentage) || 0,
                isApproved: false,
                updatedAt: serverTimestamp()
              });
            } else {
            const rawBarcode = String(formData.barcode || "").trim();
            await updateDoc(doc(db, 'products', product.id), {
              ...formData,
              barcode: rawBarcode || null,
              barcodeNormalized: rawBarcode ? normalizeBarcode(rawBarcode) : null,
              isApproved: false, // Must be re-approved if edited
              updatedAt: serverTimestamp()
            });
            }
            onSave();
            onClose();
          } catch (err: unknown) {
            alert("Greška: " + ((err as { message?: string } | null)?.message || "Nepoznata greška"));
          } finally {
            setIsSaving(false);
          }
        }}>
           {minimalEdit && (
             <p className="text-[10px] text-amber-400/90 leading-relaxed border border-amber-500/20 rounded-xl p-3 bg-amber-500/5">
               Probni period je istekao — u aplikaciji možete menjati samo naziv i jačinu. Ostale izmene su onemogućene dok se saradnja ne produži.
             </p>
           )}
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Naziv Pića</label>
              <input required value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none shadow-inner" />
           </div>
           
           {!minimalEdit && (
           <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Kategorija</label>
                <select value={formData.type} onChange={e=>setFormData({...formData, type: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none appearance-none">
                  <option>Šljivovica</option><option>Dunjevača</option><option>Kajsijevača</option><option>Viljamovka</option><option>Kruškovaca</option>
                  <option>Lozovača</option><option>Jabukovača</option><option>Višnjevača</option><option>Travarica</option><option>Medovača</option><option>Malinovača</option><option>Kupinovača</option><option>Liker</option><option>Ostale rakije</option>
                  <option>Belo vino</option><option>Crveno/Crno vino</option><option>Roze vino</option><option>Penušavo vino</option><option>Dezertno vino</option><option>Ostala vina</option>
                </select>
             </div>

          <div className="space-y-2">
             <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Bar-kod (EAN/UPC)</label>
             <input
               type="text"
               value={formData.barcode || ""}
               onChange={e=>setFormData({...formData, barcode: e.target.value})}
               className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none"
               placeholder="npr. 8601234567890"
             />
          </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Alkohol (%)</label>
                <input type="number" step="0.1" value={formData.alcoholPercentage} onChange={e=>setFormData({...formData, alcoholPercentage: Number(e.target.value)})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none" />
             </div>
           </div>
           )}

           {minimalEdit && (
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Alkohol (%)</label>
                <input type="number" step="0.1" value={formData.alcoholPercentage} onChange={e=>setFormData({...formData, alcoholPercentage: Number(e.target.value)})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none" />
             </div>
           )}

           {!minimalEdit && (
           <>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest flex items-center justify-between">Slika Artikla</label>
              <div className="relative group">
                  <input type="file" accept="image/*" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 15 * 1024 * 1024) {
                          alert("Slika je prevelika za obradu na telefonu (preko 15MB).");
                          return;
                        }
                        const optimized = await processImageToDataURL(file, 400, 400, 0.6);
                        setFormData({...formData, bottleImageUrl: optimized});
                      }
                  }} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                  <div className="w-full bg-bg-base border border-dashed border-white/20 rounded-xl px-4 py-6 text-center group-hover:border-gold-500/50 transition-all">
                    {formData.bottleImageUrl ? <img src={formData.bottleImageUrl} className="w-16 h-16 mx-auto rounded object-cover border border-white/10" /> : <Download className="w-5 h-5 mx-auto text-text-secondary" />}
                  </div>
              </div>
           </div>

           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Opis</label>
              <textarea value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none h-20 resize-none"></textarea>
           </div>
           </>
           )}

           <button type="submit" disabled={isSaving} className="w-full py-4 bg-gold-500 text-black rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-gold-500/20 flex items-center justify-center gap-2 mt-2 hover:scale-[1.02] active:scale-95 transition-all">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Sačuvaj Izmene
           </button>
        </form>
      </div>
    </div>
  );
}

function EditDistilleryModal({
  isOpen,
  onClose,
  distillery,
  readOnly,
}: {
  isOpen: boolean;
  onClose: () => void;
  distillery: {
    id: string;
    name?: string;
    description?: string;
    specificNotes?: string;
    region?: string;
    logoUrl?: string;
    coverImageUrl?: string;
    galleryImages?: string[];
    website?: string;
    city?: string;
    address?: string;
    location?: { city?: string; address?: string };
  } | null;
  readOnly?: boolean;
}) {
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    specificNotes: string;
    region: string;
    logoUrl: string;
    coverImageUrl: string;
    galleryImages: string[];
    website: string;
    city: string;
    address: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (distillery) {
      setFormData({
        name: distillery.name || "",
        description: distillery.description || "",
        specificNotes: distillery.specificNotes || "",
        region: distillery.region || "",
        logoUrl: distillery.logoUrl || "",
        coverImageUrl: distillery.coverImageUrl || "",
        galleryImages: Array.isArray(distillery.galleryImages) ? distillery.galleryImages : [],
        website: distillery.website || "",
        city: distillery.location?.city || distillery.city || "",
        address: distillery.location?.address || distillery.address || ""
      });
    }
  }, [distillery, isOpen]);

  if (!isOpen || !formData) return null;

  if (readOnly) {
    return (
      <div className="fixed inset-0 z-[210] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[32px] w-full max-w-sm p-8 space-y-6 relative text-center">
          <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white transition-colors border border-white/10">
            <X className="w-5 h-5" />
          </button>
          <h3 className="text-xl font-black text-white uppercase italic pt-4">Profil nije dostupan</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Posle isteka probnog perioda profil destilerije, logo i opisi se ne mogu menjati iz aplikacije dok se saradnja ne produži ili nalog ne sertifikuje.
          </p>
          <button type="button" onClick={onClose} className="w-full py-4 bg-gold-500 text-black rounded-2xl font-black uppercase tracking-widest text-xs">
            Zatvori
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[210] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[32px] w-full max-w-sm p-8 space-y-6 relative overflow-hidden shadow-[0_0_50px_rgba(212,175,55,0.15)] max-h-[90vh] overflow-y-auto hide-scrollbar">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/5 rounded-full text-text-secondary hover:text-white transition-colors border border-white/10">
          <X className="w-5 h-5" />
        </button>
        <div className="text-center space-y-2 pt-2">
           <h3 className="text-xl font-black text-white uppercase italic">Profil Destilerije</h3>
           <p className="text-[10px] text-gold-500 leading-relaxed font-black uppercase tracking-[0.2em]">Ažurirajte vaše javne podatke</p>
        </div>
        
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setIsSaving(true);
          try {
            await updateDoc(doc(db, 'distilleries', distillery.id), {
              ...formData,
              city: formData.city || "",
              address: formData.address || "",
              location: {
                ...distillery.location,
                city: formData.city || "",
                address: formData.address
              },
              updatedAt: serverTimestamp()
            });
            alert("Profil uspešno ažuriran!");
            onClose();
          } catch (err: unknown) {
            alert("Greška: " + ((err as { message?: string } | null)?.message || "Nepoznata greška"));
          } finally {
            setIsSaving(false);
          }
        }}>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Naziv Proizvođača</label>
              <input required value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500 outline-none shadow-inner" />
           </div>
           
           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Logo (URL ili Upload)</label>
              <div className="relative group">
                  <input type="file" accept="image/*" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 15 * 1024 * 1024) {
                          alert("Slika je prevelika za obradu na telefonu (preko 15MB).");
                          return;
                        }
                        const optimized = await processImageToDataURL(file, 400, 400, 0.6);
                        setFormData({...formData, logoUrl: optimized});
                      }
                  }} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                  <div className="w-full bg-bg-base border border-dashed border-white/20 rounded-xl px-4 py-6 text-center group-hover:border-gold-500/50 transition-all">
                    {formData.logoUrl ? <img src={formData.logoUrl} className="w-12 h-12 mx-auto rounded-lg object-contain bg-white/5 p-1 border border-white/10" /> : <Download className="w-5 h-5 mx-auto text-text-secondary" />}
                    <p className="text-[8px] text-text-secondary mt-2 uppercase">Klikni za Logo</p>
                  </div>
              </div>
           </div>

           <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Regija</label>
                <select value={formData.region} onChange={e=>setFormData({...formData, region: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none">
                   <option>Šumadija</option><option>Vojvodina</option><option>Beograd</option><option>Zapadna Srbija</option>
                   <option>Istočna Srbija</option><option>Južna Srbija</option>
                </select>
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Vebsajt</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-text-secondary" />
                  <input value={formData.website} onChange={e=>setFormData({...formData, website: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl pl-8 pr-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none" placeholder="www.sajt.rs" />
                </div>
             </div>
           </div>

           <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Mesto</label>
                <input
                  value={formData.city || ""}
                  onChange={e=>setFormData({...formData, city: e.target.value})}
                  className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none shadow-inner"
                  placeholder="Grad / selo"
                />
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Adresa</label>
                <input
                  value={formData.address}
                  onChange={e=>setFormData({...formData, address: e.target.value})}
                  className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none shadow-inner"
                  placeholder="Ulica i broj"
                />
             </div>
           </div>

           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Opis Destilerije/Vinarije</label>
              <textarea value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none h-24 resize-none" placeholder="Istorijat, tajna vašeg ukusa..."></textarea>
           </div>

           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Specifičnosti (ukratko)</label>
              <textarea
                value={formData.specificNotes || ""}
                onChange={e=>setFormData({...formData, specificNotes: e.target.value})}
                className="w-full bg-bg-base border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white focus:border-gold-500 outline-none h-20 resize-none"
                placeholder="Npr. autohtone sorte, tip kazana, odležavanje, terroir..."
              />
           </div>

           <div className="space-y-2">
              <label className="text-[10px] font-black text-gold-500 uppercase tracking-widest">Galerija (destilerija / voćnjak)</label>
              <div className="relative group">
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 15 * 1024 * 1024) {
                      alert("Slika je prevelika za obradu na telefonu (preko 15MB).");
                      return;
                    }
                    const optimized = await processImageToDataURL(file, 400, 400, 0.6);
                    const prev = Array.isArray(formData.galleryImages) ? formData.galleryImages : [];
                    const next = [...prev, optimized].slice(0, 8);
                    setFormData({...formData, galleryImages: next});
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className="w-full bg-bg-base border border-dashed border-white/20 rounded-xl px-4 py-4 text-center group-hover:border-gold-500/50 transition-all">
                  <p className="text-[10px] text-text-secondary uppercase">Klikni za dodavanje slike (max 8)</p>
                </div>
              </div>
              {Array.isArray(formData.galleryImages) && formData.galleryImages.length > 0 && (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {formData.galleryImages.map((img: string, idx: number) => (
                    <div key={idx} className="relative group">
                      <img src={img} className="w-full h-16 object-cover rounded-lg border border-white/10" />
                      <button
                        type="button"
                        onClick={() => {
                          const next = formData.galleryImages.filter((_: string, i: number) => i !== idx);
                          setFormData({...formData, galleryImages: next});
                        }}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 border border-red-500/40 text-red-400 text-[10px] leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
           </div>

           <button type="submit" disabled={isSaving} className="w-full py-4 bg-gold-500 text-black rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-gold-500/20 flex items-center justify-center gap-2 mt-2 hover:scale-[1.02] active:scale-95 transition-all">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Sačuvaj Profil
           </button>
        </form>
      </div>
    </div>
  );
}
