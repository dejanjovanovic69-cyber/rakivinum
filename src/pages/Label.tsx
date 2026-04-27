import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Star, MapPin, Share2, BookmarkPlus, Hexagon, X, Loader2, CheckCircle, Dna, ShieldCheck, FileText, Download, Gift } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { app, auth, db } from "../lib/firebase";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs, Timestamp, limit } from "firebase/firestore";
import { analyzeReviewText } from "../lib/reviewTextPolicy";
import { isPostTrialFrozen } from "../lib/distilleryTrial";
import { waitForImages, addPngImageFitPageCentered } from "../lib/pdfFitImage";
import { getNextBadgeProgress, recordRatingAchievement } from "../lib/achievements";
import { isSuperuserEmail } from "../lib/authz";
import { buildStableVisitorSeed, getOrCreateVisitorId } from "../lib/visitorIdentity";
import { logProductScan } from "../lib/logProductScan";
import { fetchPublicDistilleryById, fetchPublicProductRatings, fetchScannerProductById } from "../lib/dataService";
import { CACHE_TTL } from "../lib/cachePolicy";
import { stableQueryOptions } from "../lib/queryDefaults";
import { queryKeys } from "../lib/queryKeys";
import { 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  Radar, 
  ResponsiveContainer 
} from "recharts";

type ProductData = {
  id: string;
  name?: string;
  type?: string;
  image?: string;
  bottleImageUrl?: string;
  distilleryId?: string;
  alcoholPercentage?: number;
  alcohol?: number;
  averageRating?: number;
  rating?: number;
  ratingCount?: number;
  scanCount?: number;
  distillery?: string;
  description?: string;
  story?: string;
  sensoryProfile?: {
    aroma?: number;
    taste?: number;
    clarity?: number;
    texture?: number;
    aftertaste?: number;
  };
  publicLabelDisabled?: boolean;
  isArchivedByDistillery?: boolean;
  [key: string]: unknown;
};

type DistilleryData = {
  id: string;
  name?: string;
  region?: string;
  website?: string;
  logoUrl?: string;
  isVerified?: boolean;
  [key: string]: unknown;
};

type ReviewData = {
  id: string;
  isFlagged?: boolean;
  createdAt?: { seconds?: number; toDate?: () => Date };
  rating?: number;
  reviewText?: string;
  comment?: string;
  productName?: string;
  productImage?: string;
  userLocation?: string;
  [key: string]: unknown;
};

type PendingQueueItem = { id: string };
type SensoryKey = "aroma" | "taste" | "color" | "finish" | "harmony";
type RatedTodayError = Error & { code?: string };

function toCreatedAtMs(value: ReviewData["createdAt"]): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null) {
    if (typeof (value as { seconds?: unknown }).seconds === "number") {
      return ((value as { seconds: number }).seconds || 0) * 1000;
    }
    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      try {
        return ((value as { toDate: () => Date }).toDate()?.getTime() || 0);
      } catch {
        return 0;
      }
    }
  }
  return 0;
}

type LabelPagePayload = {
  labelAccessDenied: "archived" | "qr_disabled" | null;
  productData: ProductData | null;
  distilleryData: DistilleryData | null;
  reviews: ReviewData[];
  labelQuotaBlocked: boolean;
};

const EMPTY_LABEL_PAYLOAD: LabelPagePayload = {
  labelAccessDenied: null,
  productData: null,
  distilleryData: null,
  reviews: [],
  labelQuotaBlocked: false,
};

function getRatedCheckCacheKey(actorKey: string, ymd: string) {
  return `rakivinum_rated_check_${actorKey}_${ymd}`;
}

function readRatedCheckCache(actorKey: string, ymd: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(getRatedCheckCacheKey(actorKey, ymd));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore session cache read errors
  }
  return null;
}

function writeRatedCheckCache(actorKey: string, ymd: string, value: boolean) {
  try {
    sessionStorage.setItem(getRatedCheckCacheKey(actorKey, ymd), value ? "1" : "0");
  } catch {
    // ignore session cache write errors
  }
}

function getSavedStateCacheKey(productId: string, uid: string | null, visitorId: string | null) {
  return `rakivinum_saved_state_${uid ? `u:${uid}` : `v:${visitorId || "anon"}`}_${productId}`;
}

function readSavedStateCache(productId: string, uid: string | null, visitorId: string | null): boolean | null {
  try {
    const raw = localStorage.getItem(getSavedStateCacheKey(productId, uid, visitorId));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore local cache read errors
  }
  return null;
}

function writeSavedStateCache(productId: string, uid: string | null, visitorId: string | null, value: boolean) {
  try {
    localStorage.setItem(getSavedStateCacheKey(productId, uid, visitorId), value ? "1" : "0");
  } catch {
    // ignore local cache write errors
  }
}

export default function Label() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const normalizeReturnPath = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;
    if (trimmed.startsWith("/")) return trimmed;
    if (/^[a-zA-Z0-9_-]/.test(trimmed)) return `/${trimmed}`;
    return null;
  };
  const resolveReturnTarget = (): string => {
    const navState = location.state as { returnTo?: string } | null;
    const fromState = normalizeReturnPath(navState?.returnTo);
    if (fromState) return fromState;

    const fromQuery = normalizeReturnPath(new URLSearchParams(location.search).get("rt"));
    if (fromQuery) return fromQuery;

    try {
      const fromStoragePath = normalizeReturnPath(sessionStorage.getItem("rakivinum_last_label_return_v1"));
      if (fromStoragePath) return fromStoragePath;

      const fromCommunityPath = normalizeReturnPath(sessionStorage.getItem("rakivinum_last_community_return_v1"));
      if (fromCommunityPath) return fromCommunityPath;

      const lastCommunityTab = sessionStorage.getItem("rakivinum_last_community_tab_v1");
      if (lastCommunityTab) return `/community?tab=${encodeURIComponent(lastCommunityTab)}`;
    } catch {
      // ignore storage errors
    }

    return "/";
  };
  const goBackSafe = () => {
    navigate(resolveReturnTarget());
  };
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Real Data State
  const [productData, setProductData] = useState<ProductData | null>(null);
  const isAdminTester = isSuperuserEmail(auth.currentUser?.email);
  const [distilleryData, setDistilleryData] = useState<DistilleryData | null>(null);
  const [labelAccessDenied, setLabelAccessDenied] = useState<"archived" | "qr_disabled" | null>(null);
  const [labelQuotaBlocked, setLabelQuotaBlocked] = useState(false);
  const [reviews, setReviews] = useState<ReviewData[]>([]);

  const labelPageQuery = useQuery<LabelPagePayload>({
    queryKey: queryKeys.label.page(id ?? "missing"),
    enabled: Boolean(id),
    queryFn: async (): Promise<LabelPagePayload> => {
      if (!id) return EMPTY_LABEL_PAYLOAD;

      try {
        const row = await fetchScannerProductById(id);
        let labelAccessDenied: "archived" | "qr_disabled" | null = null;
        let productData: ProductData | null = null;
        let distilleryData: DistilleryData | null = null;

        if (!row) {
          // fall through to reviews only (isto kao raniji useEffect)
        } else {
          const pData = row as ProductData;
          if (pData.publicLabelDisabled === true) {
            return {
              labelAccessDenied: "qr_disabled",
              productData: null,
              distilleryData: null,
              reviews: [],
              labelQuotaBlocked: false,
            };
          }
          if (pData.isArchivedByDistillery) {
            return {
              labelAccessDenied: "archived",
              productData: null,
              distilleryData: null,
              reviews: [],
              labelQuotaBlocked: false,
            };
          }
          if (pData.isApproved === false) {
            labelAccessDenied = null;
          } else {
            labelAccessDenied = null;
            productData = pData;
            if (pData.distilleryId) {
              try {
                const distRow = await fetchPublicDistilleryById(pData.distilleryId);
                distilleryData = (distRow as DistilleryData) || null;
              } catch (distErr) {
                console.warn("Label: distillery fetch", distErr);
                distilleryData = null;
              }
            }
          }
        }

        let reviewsOut: ReviewData[] = [];
        let quotaBlocked = false;
        try {
          const reviewRows = await fetchPublicProductRatings(id, 120);
          reviewsOut = reviewRows
            .map((reviewDoc) => ({ ...(reviewDoc as ReviewData) }))
            .filter((review) => !review.isFlagged)
            .sort((a, b) => toCreatedAtMs(b.createdAt) - toCreatedAtMs(a.createdAt));
        } catch (revErr) {
          console.error("Label: reviews fetch", revErr);
          const e = revErr as { code?: unknown; message?: unknown } | null;
          const code = String(e?.code || "").toLowerCase();
          const msg = String(e?.message || "").toLowerCase();
          if (code.includes("resource-exhausted") || msg.includes("quota")) {
            quotaBlocked = true;
          }
        }

        return {
          labelAccessDenied,
          productData,
          distilleryData,
          reviews: reviewsOut,
          labelQuotaBlocked: quotaBlocked,
        };
      } catch (err) {
        console.error("Error fetching product data", err);
        const e = err as { code?: unknown; message?: unknown } | null;
        const code = String(e?.code || "").toLowerCase();
        const msg = String(e?.message || "").toLowerCase();
        const blocked = code.includes("resource-exhausted") || msg.includes("quota");
        return { ...EMPTY_LABEL_PAYLOAD, labelQuotaBlocked: blocked };
      }
    },
    ...stableQueryOptions(CACHE_TTL.PUBLIC_BY_ID_1H),
  });

  const isLoadingProduct = Boolean(id) && labelPageQuery.isPending;
  const isLoadingReviews = Boolean(id) && labelPageQuery.isPending;

  useEffect(() => {
    if (!id) {
      setLabelAccessDenied(null);
      setProductData(null);
      setDistilleryData(null);
      setReviews([]);
      setLabelQuotaBlocked(false);
      return;
    }
    if (labelPageQuery.isPending) {
      setLabelAccessDenied(null);
      setProductData(null);
      setDistilleryData(null);
      setReviews([]);
      setLabelQuotaBlocked(false);
      return;
    }
    const payload = labelPageQuery.data ?? EMPTY_LABEL_PAYLOAD;
    setLabelAccessDenied(payload.labelAccessDenied);
    setProductData(payload.productData);
    setDistilleryData(payload.distilleryData);
    setReviews(payload.reviews);
    setLabelQuotaBlocked(payload.labelQuotaBlocked);
  }, [id, labelPageQuery.isPending, labelPageQuery.data]);

  // Auto-open rating samo za punu javnu etiketu (sertifikovan proizvođač); modal postoji samo u tom grananju UI-a.
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('autoRate') !== "true") return;
    if (!productData || productData.id !== id) return;
    if (!distilleryData || distilleryData.isVerified !== true) return;
    setIsRatingModalOpen(true);
  }, [location.search, distilleryData, productData, id]);

  useEffect(() => {
    setIsRatingModalOpen(false);
    setLabelAccessDenied(null);
    setLabelQuotaBlocked(false);
  }, [id]);

  useEffect(() => {
    if (distilleryData && distilleryData.isVerified !== true) {
      setIsRatingModalOpen(false);
    }
  }, [distilleryData]);

  // Clear pending rating if user is looking at the same product
  useEffect(() => {
    const pendingStr = localStorage.getItem('rakivinum_pending_rating');
    if (pendingStr) {
      try {
        const data = JSON.parse(pendingStr);
        if (data.id === id) {
          localStorage.removeItem('rakivinum_pending_rating');
          try {
            const queueRaw = localStorage.getItem('rakivinum_pending_ratings') || '[]';
            const queue = JSON.parse(queueRaw);
            const safeQueue: PendingQueueItem[] = Array.isArray(queue)
              ? queue.filter((x): x is PendingQueueItem => !!x && typeof x.id === "string")
              : [];
            const next = safeQueue.filter((x) => x.id !== id);
            localStorage.setItem('rakivinum_pending_ratings', JSON.stringify(next));
            window.dispatchEvent(new Event('rakivinum_pending_ratings_changed'));
          } catch (queueErr) {
            console.error("Error syncing pending ratings queue in Label", queueErr);
          }
        }
      } catch (e) {
        console.error("Error parsing pending rating in Label", e);
      }
    }
  }, [id]);

  // Rating Modal State
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [userRating, setUserRating] = useState(0);
  const [sensoryScores, setSensoryScores] = useState({
    aroma: 4,
    taste: 4,
    color: 4,
    finish: 4,
    harmony: 4
  });
  const [reviewText, setReviewText] = useState("");
  const [userLocation, setUserLocation] = useState("");
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const lastRatingSubmitAtRef = useRef(0);
  const [hasRatedToday, setHasRatedToday] = useState(false);
  const [showIntegrityNotice, setShowIntegrityNotice] = useState(false);
  const [ratingSuccess, setRatingSuccess] = useState<{
    open: boolean;
    unlockedCount: number;
    suspiciousSource: boolean;
    avgRating: number;
    nextBadgeHint: string;
  }>({
    open: false,
    unlockedCount: 0,
    suspiciousSource: false,
    avgRating: 0,
    nextBadgeHint: "",
  });
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const certificateRef = useRef<HTMLDivElement>(null);
  const sanitizePublicLocation = (value: unknown) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (!clean) return null;
    // Public, but bounded to avoid accidental over-sharing and payload abuse.
    return clean.slice(0, 120);
  };
  const getPrecisePublicLocation = (data: Record<string, unknown>) => {
    const localityInfo = data?.localityInfo as { informative?: Array<{ name?: string }> } | undefined;
    const country = String(data?.countryName || data?.country || "").trim();
    const city = String(data?.city || data?.locality || "").trim();
    const locality = String(data?.locality || localityInfo?.informative?.[0]?.name || "").trim();
    const principal = String(data?.principalSubdivision || data?.region || "").trim();
    const place = locality || city;
    if (place && principal && place.toLowerCase() !== principal.toLowerCase()) return `${place}, ${principal}`;
    if (place) return place;
    if (principal) return principal;
    return country || "Srbija";
  };
  const ensureVisitorId = () => getOrCreateVisitorId();

  // Membership & Visitor Info
  useEffect(() => {
    if (!productData?.distilleryId) {
      setIsMember(false);
    } else {
      try {
        const visitorId = localStorage.getItem('rakivinum_visitor_id');
        const raw = localStorage.getItem(`clubs_${visitorId || ''}`) || '[]';
        const clubs = JSON.parse(raw);
        const list = Array.isArray(clubs) ? clubs : [];
        setIsMember(list.includes(productData.distilleryId));
      } catch {
        setIsMember(false);
      }
    }

    // Integrity check - can only rate one product per day
    const visitorId = ensureVisitorId();
    const lastGlobalRatingDate = localStorage.getItem(`last_rating_date_${visitorId}`);
    const today = new Date().toDateString();
    
    if (lastGlobalRatingDate === today) {
      setHasRatedToday(true);
    }
  }, [id, productData]);

  // Auto-detect location for "Scanning Geography"
  useEffect(() => {
    const fetchIpLocation = async () => {
      try {
        const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
        const data = await res.json();
        setUserLocation(getPrecisePublicLocation(data));
      } catch (e) {
        console.error("IP geocoding error", e);
        setUserLocation("Srbija");
      }
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          // Simple reverse geocoding to get City/Region if possible
          const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&localityLanguage=sr`);
          const data = await res.json();
          setUserLocation(getPrecisePublicLocation(data));
        } catch (e) {
          console.error("Geocoding error", e);
          fetchIpLocation();
        }
      }, (err) => {
        console.warn("Geolocation denied or unavailable, falling back to IP-based location", err);
        fetchIpLocation();
      }, { timeout: 5000 });
    } else {
      fetchIpLocation();
    }
  }, []);

  /** Direktan ulazak na etiketu (QR URL u browseru) — beleži sken i scanCount. Preskoči ako je iz in-app skenera (već logovano) ili admin pregled. */
  useEffect(() => {
    if (!productData?.id || labelAccessDenied) return;
    const navState = location.state as { fromInAppScanner?: boolean; adminLabelPreview?: boolean } | null;
    if (navState?.adminLabelPreview || navState?.fromInAppScanner) return;

    const pid = productData.id;
    const guardKey = `rakivinum_label_open_scan_${pid}`;
    const last = Number(sessionStorage.getItem(guardKey) || "0");
    if (Date.now() - last < 2500) return;
    sessionStorage.setItem(guardKey, String(Date.now()));

    void logProductScan(pid, productData, "label_open");
  }, [productData, labelAccessDenied, location.state]);

  // Save to History (LocalStorage for anonymous continuity)
  useEffect(() => {
    if (productData) {
      const historyStr = localStorage.getItem('rakivinum_scan_history') || '[]';
      try {
        let history = JSON.parse(historyStr);
        if (!Array.isArray(history)) history = [];
        
        // Remove if exists to re-add at front (most recent)
        history = history.filter((h: { id?: string }) => h.id !== productData.id);
        
        // Add to front
        history.unshift({
          id: productData.id,
          name: productData.name,
          type: productData.type || "Rakija",
          image: productData.bottleImageUrl || productData.image,
          timestamp: Date.now()
        });
        
        // Limit to 10 items
        localStorage.setItem('rakivinum_scan_history', JSON.stringify(history.slice(0, 10)));
      } catch (e) {
        console.error("Error updating scan history", e);
      }
    }
  }, [productData]);

  useEffect(() => {
    const checkSaved = async () => {
      if (!productData?.id) return;

      try {
        if (!auth.currentUser) {
          const visitorId = ensureVisitorId();
          const cachedSaved = readSavedStateCache(productData.id, null, visitorId);
          if (typeof cachedSaved === "boolean") {
            setSaved(cachedSaved);
            return;
          }
          try {
            const raw = localStorage.getItem("rakivinum_guest_collection") || "[]";
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.includes(productData.id)) {
              setSaved(true);
              writeSavedStateCache(productData.id, null, visitorId, true);
              return;
            }
          } catch {
            // ignore local cache parse errors
          }
          const guestRef = doc(db, "guest_saved_items", `${visitorId}_${productData.id}`);
          const guestSnap = await getDoc(guestRef);
          const exists = guestSnap.exists();
          setSaved(exists);
          writeSavedStateCache(productData.id, null, visitorId, exists);
          return;
        }

        const cachedSaved = readSavedStateCache(productData.id, auth.currentUser.uid, null);
        if (typeof cachedSaved === "boolean") {
          setSaved(cachedSaved);
          return;
        }
        const docRef = doc(db, 'users', auth.currentUser.uid, 'savedItems', productData.id);
        const savedSnap = await getDoc(docRef);
        const exists = savedSnap.exists();
        setSaved(exists);
        writeSavedStateCache(productData.id, auth.currentUser.uid, null, exists);
      } catch (error) {
        const code = String((error as { code?: unknown } | null)?.code || "");
        if (!code.includes("permission-denied")) {
          console.error("Error checking saved status", error);
        }
        setSaved(false);
      }
    };

    void checkSaved();
  }, [productData?.id]);

  useEffect(() => {
    const checkPreviousRating = async () => {
      if (!id) return;
      
      try {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startTs = Timestamp.fromDate(startOfToday);
        const visitorId = ensureVisitorId();
        const ymd = now.toISOString().slice(0, 10);
        if (!isAdminTester && visitorId && localStorage.getItem(`rakivinum_rated_day_${visitorId}`) === ymd) {
          setHasRatedToday(true);
          return;
        }
        if (!isAdminTester && auth.currentUser?.uid && localStorage.getItem(`rakivinum_rated_day_uid_${auth.currentUser.uid}`) === ymd) {
          setHasRatedToday(true);
          return;
        }

        const actorKey = auth.currentUser?.uid ? `u:${auth.currentUser.uid}` : visitorId ? `v:${visitorId}` : "";
        if (!isAdminTester && actorKey) {
          const cached = readRatedCheckCache(actorKey, ymd);
          if (typeof cached === "boolean") {
            setHasRatedToday(cached);
            return;
          }
        }

        // Zlatno pravilo: jedan dan, jedan glas (jedna ocena dnevno po korisniku/gostu, bilo koje piće)
        let q;
        if (auth.currentUser?.uid) {
          q = query(
            collection(db, 'ratings'),
            where('userId', '==', auth.currentUser.uid),
            where('createdAt', '>=', startTs),
            limit(1)
          );
        } else if (visitorId) {
          q = query(
            collection(db, 'ratings'),
            where('visitorId', '==', visitorId),
            where('createdAt', '>=', startTs),
            limit(1)
          );
        } else {
          return;
        }

        const querySnapshot = await getDocs(q);
        if (!isAdminTester) {
          const hasToday = !querySnapshot.empty;
          setHasRatedToday(hasToday);
          const actorKey = auth.currentUser?.uid ? `u:${auth.currentUser.uid}` : visitorId ? `v:${visitorId}` : "";
          if (actorKey) writeRatedCheckCache(actorKey, ymd, hasToday);
        }
      } catch (error) {
        console.error("Greška pri proveri prethodnih ocena:", error);
      }
    };

    checkPreviousRating();
  }, [id, isAdminTester]);

  const toggleSave = async () => {
    if (isSaving || !productData?.id) return;
    
    if (!auth.currentUser) {
      const visitorId = ensureVisitorId();
      const historyStr = localStorage.getItem('rakivinum_guest_collection') || '[]';
      try {
        let collection = JSON.parse(historyStr);
        if (!Array.isArray(collection)) collection = [];
        
        if (saved) {
          collection = collection.filter((id: string) => id !== productData.id);
          setSaved(false);
          writeSavedStateCache(productData.id, null, visitorId, false);
        } else {
          collection.push(productData.id);
          setSaved(true);
          writeSavedStateCache(productData.id, null, visitorId, true);
        }
        localStorage.setItem('rakivinum_guest_collection', JSON.stringify(collection));
        const guestRef = doc(db, "guest_saved_items", `${visitorId}_${productData.id}`);
        if (saved) {
          await deleteDoc(guestRef);
        } else {
          await setDoc(guestRef, {
            visitorId,
            productId: productData.id,
            createdAt: serverTimestamp(),
          }, { merge: true });
        }
        alert(saved ? "Uklonjeno iz lokalne arhive." : "Sačuvano u lokalnu arhivu na ovom uređaju!");
      } catch (e) {
        console.error("Error updating guest collection", e);
      }
      return;
    }
    
    setIsSaving(true);
    try {
      const docRef = doc(db, 'users', auth.currentUser.uid, 'savedItems', productData.id);
      if (saved) {
        await deleteDoc(docRef);
        writeSavedStateCache(productData.id, auth.currentUser.uid, null, false);
      } else {
        await setDoc(docRef, {
          productId: productData.id,
          createdAt: serverTimestamp()
        });
        writeSavedStateCache(productData.id, auth.currentUser.uid, null, true);
      }
    } catch (error) {
       console.error("Error saving/removing bottle", error);
    } finally {
      setIsSaving(false);
    }
  };

  const ensureSavedInCollection = async () => {
    if (!productData?.id) return;
    if (saved) return;

    if (!auth.currentUser) {
      const visitorId = ensureVisitorId();
      const historyStr = localStorage.getItem('rakivinum_guest_collection') || '[]';
      try {
        let collection = JSON.parse(historyStr);
        if (!Array.isArray(collection)) collection = [];
        if (!collection.includes(productData.id)) {
          collection.push(productData.id);
          localStorage.setItem('rakivinum_guest_collection', JSON.stringify(collection));
        }
        try {
          await setDoc(doc(db, "guest_saved_items", `${visitorId}_${productData.id}`), {
            visitorId,
            productId: productData.id,
            createdAt: serverTimestamp(),
          }, { merge: true });
        } catch (remoteErr) {
          const code = String((remoteErr as { code?: unknown } | null)?.code || "");
          if (!code.includes("permission-denied")) {
            console.warn("Guest remote save skipped:", remoteErr);
          }
        }
        setSaved(true);
        writeSavedStateCache(productData.id, null, visitorId, true);
      } catch (e) {
        console.error("Error ensuring guest collection", e);
      }
      return;
    }

    try {
      const docRef = doc(db, 'users', auth.currentUser.uid, 'savedItems', productData.id);
      await setDoc(docRef, {
        productId: productData.id,
        createdAt: serverTimestamp()
      }, { merge: true });
      setSaved(true);
      writeSavedStateCache(productData.id, auth.currentUser.uid, null, true);
    } catch (error) {
      console.error("Error ensuring saved item", error);
    }
  };

  const scheduleRatingForTomorrow = async () => {
    if (!productData?.id) return;
    await ensureSavedInCollection();

    const normalizedProductName = typeof productData?.name === "string" ? productData.name : "Piće";

    const entry = {
      id: productData.id,
      name: normalizedProductName || "Piće",
      timestamp: Date.now(),
    };

    try {
      const queueRaw = localStorage.getItem('rakivinum_pending_ratings') || '[]';
      const queue = JSON.parse(queueRaw);
      const safeQueue: PendingQueueItem[] = Array.isArray(queue)
        ? queue.filter((x): x is PendingQueueItem => !!x && typeof x.id === "string")
        : [];
      const withoutSame = safeQueue.filter((x) => x.id !== entry.id);
      withoutSame.unshift(entry);
      localStorage.setItem('rakivinum_pending_ratings', JSON.stringify(withoutSame.slice(0, 20)));
      window.dispatchEvent(new Event('rakivinum_pending_ratings_changed'));
      // Backward compatibility for existing notification logic.
      localStorage.setItem('rakivinum_pending_rating', JSON.stringify(entry));
      alert("Dodato u kolekciju i podsetnik za sutra je sačuvan.");
    } catch (e) {
      console.error("Error scheduling next-day rating", e);
      alert("Sačuvano u kolekciju, ali podsetnik nije uspešno upisan.");
    }
  };

  const handleShare = async () => {
    if (!productData) return;
    const shareUrl = window.location.href;
    const shareTitle = `${productData.name || "Artikal"} • ${distilleryData?.name || "Rakivinum"}`;
    const shareText = `Pogledaj artikal ${productData.name || ""} u Rakivinum aplikaciji.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      }
    } catch (err: unknown) {
      // User canceled share sheet — don't show error.
      const e = err as { name?: unknown } | null;
      if (String(e?.name || "").toLowerCase().includes("abort")) return;
      console.warn("Native share failed, falling back to clipboard", err);
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link artikla je kopiran.");
    } catch (err) {
      console.error("Share fallback failed", err);
      alert("Deljenje trenutno nije dostupno na ovom uređaju.");
    }
  };

  const generatePDF = async () => {
    if (!productData) return;
    setIsGeneratingPDF(true);
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const cssVars = getComputedStyle(document.documentElement);
    const themeBg = cssVars.getPropertyValue("--color-bg-card").trim() || "#161618";
    const themeGold = cssVars.getPropertyValue("--color-gold-500").trim() || "#D4AF37";
    
    // Distillery Logo logic
    const distilleryLogo = distilleryData?.logoUrl || '/logo-gold.png';
    const logoSrc =
      distilleryLogo.startsWith('data:') || distilleryLogo.startsWith('http')
        ? distilleryLogo
        : `${window.location.origin}${distilleryLogo.startsWith('/') ? distilleryLogo : `/${distilleryLogo}`}`;

    // Create a hidden template for the PDF
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
        <div style="display: flex; flex-direction: column; align-items: center;">
           <img src="${logoSrc}" style="max-height: 90px; max-width: 260px; width: auto; height: auto; object-fit: contain;" crossorigin="anonymous">
          <p style="text-transform: uppercase; letter-spacing: 0.4em; font-size: 10px; color: rgba(212, 175, 55, 0.6); margin-top: 10px;">Potvrda Autentičnosti Rakivinum Protokola</p>
        </div>
        
        <div style="width: 150px; height: 1px; background: ${themeGold}; margin: 8px auto;"></div>
        
        <div style="margin: 4px 0 12px;">
          <p style="text-transform: uppercase; font-size: 12px; letter-spacing: 0.2em; color: rgba(255,255,255,0.5);">Ovim se verifikuje senzorni status za</p>
          <h2 style="font-size: 48px; margin: 15px 0; color: white; font-style: italic; font-weight: 900;">${productData.name}</h2>
          <p style="font-size: 22px; color: ${themeGold}; font-weight: bold; margin-bottom: 40px;">${distilleryData?.name || productData.distillery}</p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; text-align: left; padding: 40px; background: rgba(255,255,255,0.03); border: 1px solid rgba(212, 175, 55, 0.1); border-radius: 24px;">
             <div>
                <p style="font-size: 11px; text-transform: uppercase; color: ${themeGold}; margin-bottom: 10px; font-weight: 800; border-bottom: 1px solid rgba(212,175,55,0.2); padding-bottom: 5px;">Senzorna Analiza (DNA)</p>
                <p style="font-size: 14px; margin: 8px 0;">Miris / Aroma: <span style="color: white; font-weight: 800;">${productData.sensoryProfile?.aroma || 92}%</span></p>
                <p style="font-size: 14px; margin: 8px 0;">Ukus / Tekstura: <span style="color: white; font-weight: 800;">${productData.sensoryProfile?.taste || 88}%</span></p>
                <p style="font-size: 14px; margin: 8px 0;">Završnica / Finish: <span style="color: white; font-weight: 800;">85%</span></p>
             </div>
             <div>
                <p style="font-size: 11px; text-transform: uppercase; color: ${themeGold}; margin-bottom: 10px; font-weight: 800; border-bottom: 1px solid rgba(212,175,55,0.2); padding-bottom: 5px;">Tehnička Verifikacija</p>
                <p style="font-size: 14px; margin: 8px 0;">Alkohol: <span style="color: white; font-weight: 800;">${productData.alcoholPercentage || 40}% Vol.</span></p>
                <p style="font-size: 14px; margin: 8px 0;">Rakivinum ID: <span style="color: white; font-weight: 800;">#${productData.id.slice(0, 8).toUpperCase()}</span></p>
                <p style="font-size: 14px; margin: 8px 0;">Region: <span style="color: white; font-weight: 800;">${distilleryData?.region || "Srbija"}</span></p>
             </div>
          </div>
        </div>

        <div style="margin-top: 50px; border-top: 1px solid rgba(212, 175, 55, 0.1); padding-top: 30px;">
           <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="text-align: left;">
                 <p style="font-size: 9px; text-transform: uppercase; color: rgba(255,255,255,0.3); margin: 0;">Datum Izdavanja</p>
                 <p style="font-size: 12px; color: white; font-weight: bold;">${new Date().toLocaleDateString('sr-RS')}</p>
              </div>
              <div style="text-align: right;">
                 <p style="font-size: 9px; text-transform: uppercase; color: ${themeGold}; font-weight: 900; letter-spacing: 0.2em;">Zvanični Protokol</p>
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
      pdf.save(`Sertifikat_${productData.name.replace(/\s+/g, '_')}.pdf`);
    } catch (e) {
      console.error("PDF Error:", e);
    } finally {
      document.body.removeChild(element);
      setIsGeneratingPDF(false);
    }
  };

    const submitRating = async () => {
    if (!distilleryData?.isVerified) {
      alert("Ocene i utisci na javnoj etiketi dostupni su samo za sertifikovane proizvođače.");
      return;
    }
    if (isSubmittingRating) return;
    if (Date.now() - lastRatingSubmitAtRef.current < 2500) return;
    lastRatingSubmitAtRef.current = Date.now();
    if (hasRatedToday && !isAdminTester) {
      setIsRatingModalOpen(false);
      setShowIntegrityNotice(true);
      return;
    }

    const policy = analyzeReviewText(reviewText);
    if (!policy.allowed) {
      alert(policy.userMessage || "Tekst ocene nije u skladu sa pravilima anonimnosti.");
      return;
    }
    
    setIsSubmittingRating(true);
    try {
      // Calculate final rating from sensory scores
      const avgRating = (sensoryScores.aroma + sensoryScores.taste + sensoryScores.color + sensoryScores.finish + sensoryScores.harmony) / 5;
      
      const visitorId = ensureVisitorId();

      const edgeBase = String(import.meta.env.VITE_EDGE_API_BASE || "").trim().replace(/\/$/, "");
      const submitUrl = edgeBase ? `${edgeBase}/api/submit` : "/api/submit";
      const submitPayload = {
        productId: productData?.id,
        distilleryId: productData?.distilleryId || distilleryData?.id || "unknown",
        productName: productData?.name || "Rakija",
        productImage: productData?.bottleImageUrl || productData?.image || "https://picsum.photos/seed/rakivinum/800/1000",
        rating: avgRating,
        reviewText: reviewText.trim() || null,
        userLocation: sanitizePublicLocation(userLocation),
        visitorId: visitorId || null,
        userAgent: navigator.userAgent,
        clientFingerprint: buildStableVisitorSeed(),
        website: "",
      };

      const submitRes = await fetch(submitUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(submitPayload),
      });
      const secure = (await submitRes.json()) as {
        averageRating?: number;
        ratingCount?: number;
        suspiciousSource?: boolean;
        error?: string;
      };
      if (!submitRes.ok) {
        const err: RatedTodayError = new Error(String(secure?.error || "submit_failed"));
        err.code = String(secure?.error || submitRes.status);
        throw err;
      }

      // Mark as rated today locally (global: jedan glas dnevno)
      const todayString = new Date().toDateString();
      const ymd = new Date().toISOString().slice(0, 10);
      if (!isAdminTester && visitorId) {
        localStorage.setItem(`rakivinum_rated_day_${visitorId}`, ymd);
      }
      if (!isAdminTester && auth.currentUser?.uid) {
        localStorage.setItem(`rakivinum_rated_day_uid_${auth.currentUser.uid}`, ymd);
      }
      if (!isAdminTester && visitorId) {
        localStorage.setItem(`last_rating_date_${visitorId}`, todayString);
      }
      localStorage.removeItem('rakivinum_pending_rating'); // They rated, no notification needed tomorrow
      try {
        const queueRaw = localStorage.getItem('rakivinum_pending_ratings') || '[]';
        const queue = JSON.parse(queueRaw);
        const safeQueue: PendingQueueItem[] = Array.isArray(queue)
          ? queue.filter((x): x is PendingQueueItem => !!x && typeof x.id === "string")
          : [];
        const next = safeQueue.filter((x) => x.id !== productData?.id);
        localStorage.setItem('rakivinum_pending_ratings', JSON.stringify(next));
      } catch (queueErr) {
        console.error("Error cleaning pending ratings queue after rating", queueErr);
      }
      window.dispatchEvent(new Event('rakivinum_pending_ratings_changed'));

      if (!isAdminTester) {
        setHasRatedToday(true);
      }
      
      if (typeof secure.averageRating === "number" && typeof secure.ratingCount === "number") {
        setProductData(prev => prev ? ({ ...prev, averageRating: secure.averageRating, ratingCount: secure.ratingCount }) : null);
      }

      setIsRatingModalOpen(false);
      setUserRating(0);
      setSensoryScores({ aroma: 4, taste: 4, color: 4, finish: 4, harmony: 4 });
      setReviewText("");
      const unlocked = recordRatingAchievement(productData?.type);
      setRatingSuccess({
        open: true,
        unlockedCount: unlocked.length,
        suspiciousSource: !!secure?.suspiciousSource,
        avgRating,
        nextBadgeHint: (() => {
          const next = getNextBadgeProgress();
          if (!next) return "Otključali ste sve dostupne bedževe. Impresivno!";
          return `Sledeći bedž: ${next.name} (${next.title}) • ${next.details}`;
        })(),
      });
    } catch (error: unknown) {
      console.error("Error submitting rating", error);
      const e = error as { code?: unknown; message?: unknown } | null;
      const code = String(e?.code || "");
      const message = String(e?.message || "");

      if (code.includes("already-exists")) {
        setHasRatedToday(true);
        setShowIntegrityNotice(true);
        alert("Već ste ocenili danas. Pravilo je 1 proizvod dnevno, sledeća ocena je moguća sutra.");
      } else if (code.includes("permission-denied")) {
        alert("Ocena trenutno nije dozvoljena sa ovog izvora. Ako mislite da je greška, javite se administratoru.");
      } else if (message.toLowerCase().includes("identifikator posetioca")) {
        alert("Nedostaje identifikator uređaja. Osvežite stranicu i pokušajte ponovo.");
      } else {
        alert("Greška prilikom čuvanja ocene. Pokušajte ponovo za nekoliko sekundi.");
      }
    } finally {
      setIsSubmittingRating(false);
    }
  };

  if (isLoadingProduct) {
    return (
      <div className="min-h-[100dvh] bg-bg-base flex flex-col items-center justify-center p-4">
         <Loader2 className="w-12 h-12 text-gold-500 animate-spin mb-4" />
         <p className="text-gold-500 font-medium">Učitavanje podataka o rakiji...</p>
      </div>
    );
  }

  if (!productData && !isLoadingProduct) {
    const title =
      labelQuotaBlocked
        ? "Privremeno nedostupno"
        : labelAccessDenied === "qr_disabled"
        ? "Javni pristup je isključen"
        : labelAccessDenied === "archived"
          ? "Proizvod nije dostupan"
          : "Proizvod nije u bazi";
    const subtitle =
      labelQuotaBlocked
        ? "Dnevna Firestore kvota je trenutno potrošena. Pokušajte ponovo kasnije kada se kvota resetuje."
        : labelAccessDenied === "qr_disabled"
        ? "Vlasnik proizvoda je isključio javni QR/link ka ovoj etiketi. Za pristup kontaktirajte proizvođača."
        : labelAccessDenied === "archived"
          ? "Ovaj artikal je povučen iz javnog prikaza."
          : "Skenirani kod ne odgovara nijednom registrovanom proizvodu u Rakivinum sistemu. Budite oprezni.";
    return (
      <div className="min-h-[100dvh] bg-bg-base flex flex-col items-center justify-center p-8 text-center">
         <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
            <X className="w-10 h-10 text-red-500" />
         </div>
         <h2 className="text-2xl font-black text-white mb-2">{title}</h2>
         <p className="text-text-secondary text-sm max-w-xs mb-8">
            {subtitle}
         </p>
         <button 
          onClick={goBackSafe}
           className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all"
           aria-label="Nazad"
         >
          <ArrowLeft className="w-6 h-6" />
         </button>
      </div>
    );
  }

  const showFullPublicLabel = !!(distilleryData && distilleryData.isVerified === true);

  if (productData && !showFullPublicLabel) {
    const pct = productData.alcoholPercentage ?? productData.alcohol ?? "";
    const trialFrozen = distilleryData ? isPostTrialFrozen(distilleryData) : false;
    const notice = !distilleryData
      ? "Javni podaci o proizvođaču za ovaj artikal nisu dostupni. Prikazuju se slika flaše, naziv i jačina."
      : trialFrozen
        ? "Probni period proizvođača je istekao. Ostaju slika flaše, naziv i jačina; lokacija, proizvođač, opis i utisci vraćaju se nakon nastavka saradnje i sertifikacije."
        : "Proizvođač još nije javno sertifikovan u Rakivinum mreži. Do tada vidite sliku flaše, naziv i jačinu — bez identiteta proizvođača, lokacije, opisa i utisaka.";
    const bottleSrc =
      productData.bottleImageUrl || productData.image || "https://picsum.photos/seed/rakivinum/800/1000";
    return (
      <div className="min-h-[100dvh] bg-bg-base relative flex flex-col p-6 pb-24 overflow-x-hidden">
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[-10%] right-[-10%] w-[400px] h-[400px] bg-gold-500/5 rounded-full blur-[100px]" />
          <div className="absolute bottom-[10%] left-[-10%] w-[300px] h-[300px] bg-gold-500/5 rounded-full blur-[80px]" />
        </div>
        <button
          type="button"
          onClick={goBackSafe}
          className="relative z-10 mb-6 w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-gold-500/20 transition-colors shrink-0"
          aria-label="Nazad"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-8 max-w-sm mx-auto w-full">
          <div className="relative w-full aspect-[2/3] max-w-[300px]">
            <div className="absolute inset-0 bg-gold-500/15 rounded-[40px] blur-[40px] opacity-60" />
            <div className="relative h-full w-full rounded-[40px] overflow-hidden border border-gold-500/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22),0_24px_48px_-12px_rgba(0,0,0,0.85)] bg-black">
              <img
                src={bottleSrc}
                alt={productData.name || "Piće"}
                className="h-full w-full object-contain object-center p-3 media-crisp"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${encodeURIComponent(productData.type || "pice")}/800/1000`;
                }}
              />
              <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[10px] font-bold text-gold-500 uppercase tracking-widest">
                {pct !== "" ? `${pct}% vol.` : "—"}
              </div>
            </div>
          </div>
          <div className="w-full space-y-4 rounded-[32px] border border-white/10 bg-bg-card/80 p-8 backdrop-blur-xl text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-500/90">Javni prikaz</p>
            {productData.type ? (
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">{productData.type}</p>
            ) : null}
            <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">{productData.name}</h1>
            <p className="text-xl font-bold text-gold-500">{pct !== "" ? `${pct}% vol.` : "—"}</p>
            <p className="text-xs text-text-secondary leading-relaxed text-left">
              {notice}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-bg-base relative pb-56 animate-in fade-in zoom-in-95 duration-700">
      
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-gold-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] left-[-10%] w-[400px] h-[400px] bg-gold-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Hero Section - Immersive Presentation */}
      <div className="relative z-10">
        <div className="relative h-[560px] sm:h-[620px] w-full flex items-center justify-center pt-20 px-6">
          {/* Top Navbar */}
          <div className="absolute top-0 left-0 w-full p-6 pt-[env(safe-area-inset-top,24px)] flex justify-between items-center z-[100]">
            <button 
              onClick={goBackSafe}
              className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-xl flex items-center justify-center text-white border border-white/10 hover:bg-gold-500 hover:text-black transition-all duration-300"
              aria-label="Nazad"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div className="bg-gradient-to-r from-gold-500/20 to-gold-500/5 backdrop-blur-xl px-4 py-2 rounded-full border border-gold-500/30 flex items-center gap-2 animate-pulse transition-all">
              <Hexagon className="w-4 h-4 text-gold-500 fill-gold-500/20" />
              <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Rakivinum Autentik</span>
            </div>
            <button 
              onClick={handleShare}
              className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-xl flex items-center justify-center text-white border border-white/10 hover:bg-gold-500 hover:text-black transition-all duration-300 active:scale-90"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>

          {/* Large Bottle Image Display */}
          <div className="relative w-full aspect-[2/3] max-w-[340px] group">
             {/* Glowing Halo */}
             <div className="absolute inset-0 bg-gold-500/20 rounded-[40px] blur-[60px] opacity-50 group-hover:opacity-80 transition-opacity duration-1000" />
             
             {/* Main Image in Premium Frame */}
             <div className="relative h-full w-full rounded-[48px] overflow-hidden border border-gold-500/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28),0_30px_60px_-15px_rgba(0,0,0,0.8)] bg-black">
                <img 
                  src={productData.bottleImageUrl || productData.image || "https://picsum.photos/seed/rakivinum/800/1000"} 
                  alt={productData.name} 
                  className="h-full w-full object-contain object-center p-3 sm:p-4 media-crisp transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${productData.type || 'pice'}/800/1000`;
                  }}
                />
                
                {/* Information Overlays */}
                <div className="absolute top-6 right-6">
                  <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[10px] font-bold text-gold-500 uppercase tracking-widest">
                    {productData.alcoholPercentage || productData.alcohol || 40}% Vol.
                  </div>
                </div>

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent px-5 pb-4 pt-12">
                   <p className="text-[9px] font-black text-gold-500 uppercase tracking-[0.26em] mb-1.5">Originalni Proizvod</p>
                    {distilleryData?.isVerified && (
                     <div className="inline-flex items-center gap-1.5 bg-green-500/10 backdrop-blur-sm px-2.5 py-1 rounded-full border border-green-500/20 text-green-500 text-[9px] font-semibold uppercase tracking-wider">
                       <CheckCircle className="w-3.5 h-3.5 fill-current" />
                       Sertifikovani proizvođač
                     </div>
                   )}
                </div>
             </div>
          </div>
        </div>

        <div className="px-6 mt-3">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>

        {/* Product Identity Content */}
        <div className="px-6 mt-4 relative z-20">
          <div className="card-soft backdrop-blur-2xl rounded-[32px] p-8 shadow-2xl space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-gold-500 mb-2">
                  <MapPin className="w-4 h-4" />
                  <span className="eyebrow-label">{distilleryData?.region || "Region Srbije"}</span>
                </div>
                <h1 className="text-4xl font-black text-white leading-tight tracking-tight drop-shadow-md">
                   {productData.name}
                </h1>
                <p className="text-lg text-text-secondary font-medium">
                   {distilleryData?.name || productData.distillery || "Proizvođač neprijavljen"}
                </p>
              </div>

              {/* Club Perks Integration */}
              {isMember && (
                <div className="card-soft bg-gold-500/10 border-gold-500/30 rounded-2xl p-4 flex items-center gap-3 animate-in zoom-in-95 duration-500 mb-2">
                    <div className="w-10 h-10 rounded-full bg-gold-500/20 flex items-center justify-center shrink-0">
                      <Gift className="w-5 h-5 text-gold-500 animate-bounce" />
                    </div>
                    <div>
                      <p className="eyebrow-label text-gold-500">Aktivna Članska Pogodnost</p>
                      <p className="text-[11px] text-white font-medium">Kao član kluba ovog proizvođača, skeniranjem ove boce brže ostvarujete pravo na nagrade.</p>
                    </div>
                </div>
              )}
              
              <div className="flex flex-col gap-3">
                 {distilleryData?.website && (
                   <a 
                     href={distilleryData.website} 
                     target="_blank" 
                     rel="noreferrer" 
                     className="inline-flex items-center justify-center gap-2 px-6 py-3 btn-primary text-xs rounded-full"
                   >
                     Poseti sajt
                   </a>
                 )}
                <button
                  onClick={() => {
                    const targetDistilleryId = productData?.distilleryId || distilleryData?.id;
                    if (!targetDistilleryId) {
                      alert("Destilerija nije povezana sa ovim proizvodom.");
                      return;
                    }
                    navigate(`/distillery/${targetDistilleryId}`);
                  }}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 btn-secondary text-xs rounded-full"
                >
                  <Hexagon className="w-4 h-4 text-gold-500" />
                  Pogledaj sve proizvode
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
               <div className="card-soft card-elevated rounded-2xl p-4">
                  <p className="text-[9px] text-white/70 uppercase font-bold tracking-widest mb-1">Ocena Korisnika</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-black text-white">
                      {productData.averageRating !== undefined 
                        ? Number(productData.averageRating).toFixed(1) 
                        : (productData.rating || "0.0")}
                    </span>
                    <div className="flex flex-col">
                      <div className="flex text-gold-500">
                        <Star className="w-3 h-3 fill-current" />
                      </div>
                      <span className="text-[10px] text-white/70 whitespace-nowrap">({productData.ratingCount || 0})</span>
                    </div>
                  </div>
               </div>

               <div
                 className="card-soft card-elevated rounded-2xl p-4"
                 title="Broj skeniranja digitalne etikete (QR). Ocene zajednice su poseban podatak i mogu postojati i pre prvog zabeleženog skena."
               >
                  <p className="text-[9px] text-white/70 uppercase font-bold tracking-widest mb-1">Broj Skeniranja</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-black text-white">
                      {(() => {
                        const scans = Number(productData.scanCount) || 0;
                        const ratings = Number(productData.ratingCount) || 0;
                        if (scans === 0 && ratings > 0) return "—";
                        return scans;
                      })()}
                    </span>
                    {(Number(productData.scanCount) || 0) > 0 && (
                      <span className="text-[10px] text-white/70 pb-1.5 font-bold">PUTA</span>
                    )}
                  </div>
                  {(Number(productData.scanCount) || 0) === 0 && (Number(productData.ratingCount) || 0) > 0 && (
                    <p className="text-[9px] text-white/50 leading-snug mt-2">
                      Još nema zabeleženih skenova etikete; prosečna ocena je iz utisaka zajednice.
                    </p>
                  )}
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sensory & Detailed Description */}
      <div className="px-6 mt-12 space-y-12 relative z-10">
        
        {/* Story Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-4">
             <div className="h-px flex-1 bg-white/10" />
            <h3 className="section-title shrink-0">Beleške majstora</h3>
             <div className="h-px flex-1 bg-white/10" />
          </div>
          <p className="text-text-primary leading-[1.8] font-medium text-center max-w-lg mx-auto italic opacity-90">
            "{productData.description || productData.story || "Ovaj vrhunski destilat nosi u sebi esenciju srpske tradicije i pažljivo biranih plodova voća."}"
          </p>
        </section>

        {/* Sensory Profile (Enhanced Radar) */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 justify-center mb-2">
            <Dna className="w-4 h-4 text-gold-500" />
            <h3 className="section-title text-white">DNA profil ukusa</h3>
          </div>
          <div className="bg-bg-card/40 border border-white/10 rounded-[40px] p-6 h-72 w-full flex justify-center items-center shadow-inner relative overflow-hidden card-elevated">
             {/* subtle background glow inside radar container */}
             <div className="absolute inset-0 bg-gold-500/5 blur-3xl pointer-events-none" />
             
             <ResponsiveContainer width="100%" height="100%">
               <RadarChart 
                cx="50%" 
                cy="50%" 
                outerRadius="65%" 
                data={[
                  { subject: 'Aroma', A: productData.sensoryProfile?.aroma || 80 },
                  { subject: 'Ukus', A: productData.sensoryProfile?.taste || 85 },
                  { subject: 'Čistoća', A: productData.sensoryProfile?.clarity || 90 },
                  { subject: 'Tekstura', A: productData.sensoryProfile?.texture || 70 },
                  { subject: 'Završnica', A: productData.sensoryProfile?.aftertaste || 75 },
                ]}
               >
                 <PolarGrid stroke="rgba(255,255,255,0.05)" />
                 <PolarAngleAxis 
                   dataKey="subject" 
                  tick={{ fill: 'rgba(142,146,153,1)', fontSize: 10, fontWeight: 700 }}
                 />
                 <Radar
                   name="Rakija"
                   dataKey="A"
                  stroke="var(--color-gold-500)"
                  fill="var(--color-gold-500)"
                   fillOpacity={0.4}
                 />
               </RadarChart>
             </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-white/70 text-center max-w-[200px] mx-auto leading-relaxed uppercase tracking-tighter">
             *Podaci bazirani na agregatnim ocenama zajednice
          </p>
        </section>

        {/* User Reviews Section */}
        <section className="space-y-8 pb-10">
          <div className="flex items-center justify-between">
            <h3 className="section-title text-white">
              <Star className="w-4 h-4 text-gold-500" /> Utisci
            </h3>
            <span className="text-[10px] font-bold text-white/70 uppercase">{reviews.length} Unosa</span>
          </div>

          <div className="space-y-4">
            {isLoadingReviews ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 text-gold-500 animate-spin" />
              </div>
            ) : reviews.length === 0 ? (
              <div className="empty-state card-elevated p-10 text-center space-y-3 max-w-lg mx-auto rounded-[32px]">
                <div className="text-gold-500/30 text-4xl" aria-hidden>
                  ☆
                </div>
                <p className="text-xs text-text-secondary font-medium leading-relaxed">
                  Budi prvi koji će oceniti ovo piće i podeliti senzorno iskustvo sa Rakivinum zajednicom.
                </p>
              </div>
            ) : (
              reviews.map((review, idx) => (
                <div key={idx} className="bg-bg-card/30 border border-white/5 rounded-[28px] p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 100}ms` }}>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gold-500/10 border border-gold-500/20 flex items-center justify-center text-gold-500 font-black italic">
                        G
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white tracking-tight">Gost</p>
                        {review.userLocation ? (
                          <p
                            className="text-[11px] text-text-secondary/90 font-normal leading-snug mt-0.5 truncate max-w-[220px]"
                            title={review.userLocation}
                          >
                            {review.userLocation}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  <div className="flex bg-gold-500/10 px-2 py-1 rounded-lg items-center gap-1">
                      <span className="text-xs font-black text-gold-500">{review.rating?.toFixed(1) || "5.0"}</span>
                      <Star className="w-2.5 h-2.5 text-gold-500 fill-current" />
                  </div>
                  </div>
                  {review.reviewText && (
                    <p className="text-xs text-text-primary leading-relaxed bg-white/5 p-3 rounded-xl border-l-2 border-gold-500/50">
                      {review.reviewText}
                    </p>
                  )}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-[9px] text-text-secondary uppercase font-mono opacity-50">
                      {review.createdAt?.seconds ? new Date(review.createdAt.seconds * 1000).toLocaleDateString('sr-RS') : "Nedavno"}
                    </span>
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className={`w-2 h-2 ${s <= review.rating ? 'text-gold-500 fill-current' : 'text-white/10'}`} />
                      ))}
                    </div>
                  </div>
                </div>
              ))
             )}
          </div>
        </section>
      </div>

      {/* Sticky Combined CTA - Fixed Overlap */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] bg-bg-card/90 backdrop-blur-2xl border-t border-border-gold pb-safe">
        <div className="max-w-md mx-auto p-4 space-y-3">
          {hasRatedToday && (
            <div className="p-3 bg-gold-500/5 border border-gold-500/10 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2">
               <ShieldCheck className="w-4 h-4 text-gold-500 shrink-0 mt-0.5" />
               <div className="space-y-1">
                 <p className="text-[9px] font-black text-gold-500 uppercase tracking-widest leading-none italic">Zlatno Pravilo Integrity</p>
                 <p className="text-[8px] text-text-secondary leading-relaxed font-medium">
                  Danas ste već ocenili jedan proizvod. Zlatno pravilo (1 proizvod dnevno) čuva status Elite kluba. 
                   <span className="text-white"> Sačuvajte u kolekciju i ocenite sutra!</span>
                 </p>
               </div>
            </div>
          )}
          <div className="flex gap-3">
            <button 
              onClick={toggleSave}
              disabled={isSaving}
              className={`flex-1 h-14 rounded-full font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                saved 
                  ? 'bg-gold-500/10 text-gold-500 border border-gold-500/50' 
                  : 'bg-bg-base border border-border-subtle text-white'
              } ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <BookmarkPlus className={`w-5 h-5 ${saved ? 'text-gold-500' : ''}`} />
              {saved ? 'U kolekciji' : 'U kolekciju'}
            </button>

            <button 
              onClick={() => {
                if (hasRatedToday) {
                  void scheduleRatingForTomorrow();
                } else {
                  setIsRatingModalOpen(true);
                }
              }}
              className={`flex-[1.5] h-14 rounded-full font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl border-2 ${
                hasRatedToday 
                  ? 'bg-bg-card text-gold-500 border-gold-500/40 hover:bg-gold-500/5' 
                  : 'bg-transparent border-gold-500 text-gold-500 shadow-gold-500/10 hover:bg-gold-500/5'
              }`}
            >
              <Star className={`w-5 h-5 ${hasRatedToday ? '' : 'fill-current'}`} />
              {hasRatedToday ? 'Oceni sutra' : 'Oceni proizvod'}
            </button>
          </div>
        </div>
      </div>

      {isRatingModalOpen && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto pt-10 pb-20">
          <div className="bg-bg-card border border-border-subtle rounded-[32px] w-full max-w-sm p-6 space-y-6 animate-in slide-in-from-bottom-8 duration-300 relative shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <div className="flex justify-between items-center border-b border-white/5 pb-4">
              <div className="space-y-1">
                <h3 className="text-xl font-black text-white italic">Oceni Proizvod</h3>
                <p className="text-[10px] text-gold-500 font-bold uppercase tracking-widest">Senzorska Analiza</p>
              </div>
              <button 
                onClick={() => setIsRatingModalOpen(false)}
                className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-text-secondary hover:text-white transition-colors"
                title="Zatvori"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4 py-2">
              <div className="space-y-6">
                {([
                  { key: 'aroma', label: 'Miris / Aroma' },
                  { key: 'taste', label: 'Ukus' },
                  { key: 'color', label: 'Boja / Bistrina' },
                  { key: 'finish', label: 'Završnica' },
                  { key: 'harmony', label: 'Harmonija / Karakter' }
                ] as const).map((attr: { key: SensoryKey; label: string }) => (
                  <div key={attr.key} className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-text-primary font-bold">{attr.label}</span>
                      <span className="text-gold-500 font-black">{sensoryScores[attr.key].toFixed(1)}</span>
                    </div>
                    <div className="relative w-full h-8 flex items-center">
                      <input 
                        type="range"
                        min="1"
                        max="5"
                        step="0.1"
                        value={sensoryScores[attr.key]}
                        onChange={(e) => setSensoryScores({...sensoryScores, [attr.key]: parseFloat(e.target.value)})}
                        className="absolute w-full h-3 appearance-none bg-black/40 rounded-full outline-none cursor-pointer border border-white/5 z-20"
                        style={{
                          background: `linear-gradient(to right, var(--color-gold-500) ${((sensoryScores[attr.key] - 1) / 4) * 100}%, rgba(0,0,0,0.4) ${((sensoryScores[attr.key] - 1) / 4) * 100}%)`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-6 border-t border-white/5 text-center">
                <p className="text-[10px] text-white/70 uppercase tracking-[0.3em] mb-1">Ukupna DNA Ocena</p>
                <div className="text-4xl font-black text-gold-500 italic drop-shadow-[0_4px_10px_rgba(212,175,55,0.3)]">
                  {((sensoryScores.aroma + sensoryScores.taste + sensoryScores.color + sensoryScores.finish + sensoryScores.harmony) / 5).toFixed(1)}
                </div>
              </div>
            </div>

            <textarea
              className="w-full bg-bg-base border border-border-subtle rounded-2xl p-4 text-white text-sm focus:outline-none focus:border-gold-500 transition-colors resize-none placeholder:text-white/20"
              placeholder="Nije teško biti fin :) - Podelite utiske..."
              rows={3}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            />

    <div className="space-y-4 text-left">
      <div className="space-y-2">
        <input
          type="text"
          value={userLocation}
          onChange={(e) => setUserLocation(e.target.value)}
          className="w-full bg-bg-base border border-border-subtle rounded-2xl p-4 text-white font-bold text-sm focus:outline-none focus:border-gold-500 transition-colors"
          placeholder='Unesite mesto (npr. "Lipolist" ili "Restoran Stara Priča, Lipolist")'
        />
      </div>
       {!userLocation && (
         <p className="text-[10px] text-white/70 px-2 italic font-medium">
         Ako GPS nije dostupan, pokušaćemo približnu lokaciju preko IP adrese. Možete ručno upisati tačnije mesto.
         </p>
       )}
     </div>

            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={submitRating}
                disabled={isSubmittingRating}
                className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.2em] flex items-center justify-center transition-all text-xs border-2 ${
                  !isSubmittingRating
                    ? 'bg-gold-500 text-black border-gold-500 shadow-xl shadow-gold-500/20 active:scale-95' 
                    : 'bg-bg-base text-text-secondary border-border-subtle cursor-not-allowed'
                }`}
              >
                {isSubmittingRating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Snimi ocenu'}
              </button>
              <button
                onClick={() => setIsRatingModalOpen(false)}
                className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors"
              >
                Odustani i nazad
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integrity / Fraud Prevention Notice Portal */}
      {showIntegrityNotice && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-bg-card border border-gold-500/30 rounded-[40px] w-full max-w-sm p-8 space-y-8 animate-in zoom-in-95 duration-300 relative overflow-hidden text-center shadow-[0_0_50px_rgba(212,175,55,0.15)]">
            <div className="w-20 h-20 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto border border-gold-500/20">
               <ShieldCheck className="w-10 h-10 text-gold-500" />
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl font-black font-serif italic text-white">Objektivnost Protokola</h3>
              <p className="text-xs text-text-secondary leading-relaxed px-4">
                Rakivinum čuva integritet svakog glasa. Pravilo je <span className="text-gold-500 font-bold italic">1 proizvod dnevno</span>, odnosno jedna ocena u 24h.
              </p>
            </div>
            <button 
              onClick={() => setShowIntegrityNotice(false)}
              className="w-full py-4 btn-primary text-[10px]"
            >
              Razumem i poštujem
            </button>
            <p className="text-[9px] text-white/60 uppercase tracking-widest">Digitalni Pečat Kvaliteta</p>
          </div>
        </div>
      )}

      {ratingSuccess.open && (
        <div className="fixed inset-0 z-[210] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-bg-card border border-gold-500/30 rounded-[40px] w-full max-w-sm p-8 space-y-6 animate-in zoom-in-95 duration-300 relative overflow-hidden text-center shadow-[0_0_50px_rgba(212,175,55,0.15)]">
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto border border-green-500/20">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black font-serif italic text-white">Ocena je uspešno sačuvana</h3>
              <p className="text-xs text-text-secondary leading-relaxed px-2">
                Hvala na doprinosu zajednici. Vaša DNA ocena <span className="text-gold-500 font-black">{ratingSuccess.avgRating.toFixed(1)}</span> je dodata u agregat proizvoda.
              </p>
            </div>

            {ratingSuccess.suspiciousSource ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200 leading-relaxed">
                Sistem je automatski označio izvor za dodatnu administratorsku proveru. Ocena je ipak sačuvana.
              </div>
            ) : (
              <div className="rounded-2xl border border-gold-500/20 bg-gold-500/5 p-3 text-[11px] text-text-secondary leading-relaxed">
                Nastavite da ocenjujete i otključavajte bedževe kroz Rakivinum izazove.
              </div>
            )}

            {ratingSuccess.unlockedCount > 0 && (
              <div className="rounded-2xl border border-gold-500/30 bg-gold-500/10 p-3 text-[12px] text-gold-500 font-black uppercase tracking-wide flex items-center justify-center gap-2">
                <Gift className="w-4 h-4" />
                Otključali ste {ratingSuccess.unlockedCount} bedž(a)!
              </div>
            )}

            <p className="text-[11px] text-text-secondary leading-relaxed">
              {ratingSuccess.nextBadgeHint}
            </p>

            <button
              onClick={() => setRatingSuccess({ open: false, unlockedCount: 0, suspiciousSource: false, avgRating: 0, nextBadgeHint: "" })}
              className="w-full py-4 btn-primary text-[10px]"
            >
              Super, nastavi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
