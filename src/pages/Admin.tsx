import React, { useState, useRef, useEffect } from "react";
import { ArrowLeft, Save, Loader2, CheckCircle, Database, Upload, ImageIcon, Trash2, Edit2, Search, ChevronDown, BookOpen, MapPin, Eye, Flag, ShieldAlert, AlertTriangle, Star, Mail, FileText, BarChart2, Building2, ClipboardCopy } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  addDoc,
  getDocs,
  getDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  Timestamp,
  deleteField,
  writeBatch,
  limit,
  getCountFromServer,
  orderBy,
  startAfter,
  documentId,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import DistilleryAnalyticsModal from "../components/admin/DistilleryAnalyticsModal";
import { isSuperuserEmail } from "../lib/authz";
import { waitForImages, addPngImageFitPageCentered } from "../lib/pdfFitImage";
import { shouldRunRefresh } from "../lib/refreshGate";
import { REFRESH_INTERVAL } from "../lib/cachePolicy";
import { meterDbRead } from "../lib/requestMeter";

// Helper function to resize and compress image to base64
const processImageToDataURL = (file: File, maxWidth: number, maxHeight: number, quality: number = 0.8): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
    };
    reader.onerror = error => reject(error);
  });
};

type DistilleryListItem = {
  id: string;
  name?: string;
  isVerified?: boolean;
  isArchived?: boolean;
  email?: string;
  ownerId?: string;
  lastAppAccessAt?: { toDate?: () => Date } | string | number | Date | null;
  trialEndsAt?: { toDate?: () => Date } | string | number | Date | null;
  region?: string;
  website?: string;
  description?: string;
  logoUrl?: string;
  pib?: string;
  mapsUrl?: string;
  location?: { address?: string; city?: string };
  galleryImages?: string[];
  [key: string]: unknown;
};

type ProductListItem = {
  id: string;
  name?: string;
  type?: string;
  distilleryId?: string;
  description?: string;
  alcoholPercentage?: number;
  bottleImageUrl?: string;
  barcode?: string;
  isApproved?: boolean;
  createdAt?: { toMillis?: () => number };
  updatedAt?: { toMillis?: () => number };
  [key: string]: unknown;
};

type CommunityLinkItem = { id: string; label?: string; url?: string; [key: string]: unknown };
type CommunityEventItem = {
  id: string;
  eventDate?: string;
  title?: string;
  location?: string;
  description?: string;
  websiteUrl?: string;
  link?: string;
  mapsUrl?: string;
  [key: string]: unknown;
};
type RatingLite = { rating?: number; productId?: string };
type EventProposalItem = {
  id: string;
  name?: string;
  title?: string;
  location?: string;
  date?: string;
  link?: string;
  description?: string;
  proposerEmail?: string;
  [key: string]: unknown;
};
type LicenseItem = {
  id?: string;
  token?: string;
  clientName?: string;
  comment?: string;
  createdAt?: { toMillis?: () => number } | string | number | Date;
  startDate?: { toMillis?: () => number } | string | number | Date;
  expiresAt?: { toMillis?: () => number; toDate?: () => Date } | string | number | Date;
  usedAt?: { toDate?: () => Date } | string | number | Date;
  deactivatedAt?: { toDate?: () => Date } | string | number | Date;
  lastActivatedBy?: string;
  lastDeactivatedBy?: string;
  activatedDevices?: string[];
  maxDevices?: number;
  isUsed?: boolean;
  [key: string]: unknown;
};
type RatingRow = {
  id: string;
  productId?: string;
  productName?: string;
  userId?: string;
  userLocation?: string;
  reviewText?: string;
  userName?: string;
  rating?: number;
  isFlagged?: boolean;
  createdAt?: { toDate?: () => Date; toMillis?: () => number; seconds?: number };
  [key: string]: unknown;
};
type ClipNavigator = Navigator & { clipboard?: { read?: () => Promise<Array<{ types: string[]; getType: (t: string) => Promise<Blob> }>> } };
type PdfLike = { internal?: { getNumberOfPages?: () => number } };
type WithToDate = { toDate?: () => Date };
const hasToDate = (value: unknown): value is WithToDate => !!value && typeof (value as WithToDate).toDate === "function";

export default function Admin() {
  const normalizeBarcode = (value: unknown) => String(value || "").replace(/\D/g, "");
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
  const adminReturnTo = `${location.pathname}${location.search}`;
  const openAdminLabelPreview = (productId: string) => {
    try {
      sessionStorage.setItem("rakivinum_last_label_return_v1", adminReturnTo);
    } catch {
      // ignore storage errors
    }
    navigate(`/label/${productId}?rt=${encodeURIComponent(adminReturnTo)}`, {
      state: { adminLabelPreview: true, returnTo: adminReturnTo },
    });
  };
  const ADMIN_DISTILLERIES_LIMIT = 500;
  const ADMIN_EVENTS_LIMIT = 400;
  const ADMIN_LINKS_LIMIT = 300;
  const ADMIN_BLOCKED_USERS_LIMIT = 1000;
  const ADMIN_LICENSES_LIMIT = 1200;
  const ADMIN_EVENT_PROPOSALS_LIMIT = 400;
  const ADMIN_PRODUCTS_ALL_LIMIT = 900;
  const ADMIN_PRODUCTS_PER_DISTILLERY_LIMIT = 450;
  const ADMIN_RATINGS_PER_PRODUCT_LIMIT = 2500;
  const ADMIN_FLAGGED_RATINGS_LIMIT = 500;
  const ADMIN_PENDING_APPROVALS_LIMIT = 300;
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualResult, setManualResult] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [adminProducts, setAdminProducts] = useState<ProductListItem[]>([]);
  const [distilleries, setDistilleries] = useState<DistilleryListItem[]>([]);
  type AdminTab = 'approvals' | 'distilleries' | 'events' | 'moderation' | 'licensing';
  const [activeTab, setActiveTab] = useState<AdminTab>('distilleries');
  const [distilleryTab, setDistilleryTab] = useState<'profil' | 'pica' | 'licence' | 'ocene'>('profil');
  const [eventProposals, setEventProposals] = useState<EventProposalItem[]>([]);
  const [communityLinks, setCommunityLinks] = useState<CommunityLinkItem[]>([]);
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>([]);
  const [linkForm, setLinkForm] = useState({ label: "", url: "" });
  const [eventForm, setEventForm] = useState({ title: "", eventDate: "", location: "", description: "", websiteUrl: "", mapsUrl: "" });
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [flaggedRatings, setFlaggedRatings] = useState<RatingRow[]>([]);
  const [allRatings, setAllRatings] = useState<RatingRow[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [modSearch, setModSearch] = useState("");
  const [licenses, setLicenses] = useState<LicenseItem[]>([]);
  const [pendingProductApprovals, setPendingProductApprovals] = useState<ProductListItem[]>([]);
  const [isModerating, setIsModerating] = useState(false);
  const [isGeneratingLicense, setIsGeneratingLicense] = useState(false);
  const [onlineUsersCount, setOnlineUsersCount] = useState<number | null>(null);
  const isSuperAdminUser = isSuperuserEmail(auth.currentUser?.email);
  
  // New batch licensing states
  const [batchEmail, setBatchEmail] = useState("");
  const [batchCount, setBatchCount] = useState(3);
  const [batchDistillery, setBatchDistillery] = useState("");
  const [batchStartDate, setBatchStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [batchEndDate, setBatchEndDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split('T')[0];
  });
  const [lastGeneratedBatchTokens, setLastGeneratedBatchTokens] = useState<string[]>([]);
  const [confirmDeleteLicenseId, setConfirmDeleteLicenseId] = useState<string | null>(null);
  const [licenseLogSearch, setLicenseLogSearch] = useState("");

  useEffect(() => {
    if (!isSuperAdminUser) {
      setOnlineUsersCount(null);
      return;
    }

    let cancelled = false;
    const refreshPresenceCount = async () => {
      try {
        const thresholdMs = Date.now() - 90_000;
        const qPresence = query(
          collection(db, "online_presence"),
          where("isOnline", "==", true),
          where("lastSeenMs", ">=", thresholdMs),
          limit(2000),
        );
        const countSnap = await getCountFromServer(qPresence);
        meterDbRead("admin:online_presence_count", 1);
        if (!cancelled) setOnlineUsersCount(countSnap.data().count);
      } catch (err) {
        console.error("Presence count failed", err);
        if (!cancelled) setOnlineUsersCount(null);
      }
    };

    void refreshPresenceCount();
    const onTick = () => {
      if (document.visibilityState !== "visible") return;
      if (!shouldRunRefresh("admin:presence-count", REFRESH_INTERVAL.ADMIN_PANEL_10M)) return;
      void refreshPresenceCount();
    };
    const onVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      onTick();
    };
    window.addEventListener("focus", onTick);
    document.addEventListener("visibilitychange", onVisibilityRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onTick);
      document.removeEventListener("visibilitychange", onVisibilityRefresh);
    };
  }, [isSuperAdminUser]);

  const PRODUCT_TYPES = [
    "Šljivovica", "Dunjevača", "Kajsijevača", "Viljamovka", "Kruškovaca",
    "Jabukovača", "Višnjevača", "Lozovača", "Travarica", 
    "Medovača", "Malinovača", "Kupinovača", "Liker", "Ostale rakije",
    "Belo vino", "Crveno/Crno vino", "Roze vino", "Penušavo vino", "Dezertno vino", "Ostala vina"
  ];
  
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    description: "",
    alcoholPercentage: 40,
    bottleImageUrl: "",
    barcode: ""
  });

  const [distilleryData, setDistilleryData] = useState({
    id: "",
    name: "",
    region: "Beograd i okolina",
    website: "",
    email: "",
    description: "",
    logoUrl: "",
    pib: "",
    address: "",
    city: "",
    mapsUrl: "",
    trialEndsAt: "" as string,
  });
  const GALLERY_SLOT_COUNT = 6;
  const [galleryImageSlots, setGalleryImageSlots] = useState<string[]>(() => Array.from({ length: GALLERY_SLOT_COUNT }, () => ""));

  const [distilleryToDelete, setDistilleryToDelete] = useState<string | null>(null);
  const [editingDistilleryId, setEditingDistilleryId] = useState<string | null>(null);
  const [analyticsDistillery, setAnalyticsDistillery] = useState<DistilleryListItem | null>(null);
  const [selectedDistilleryId, setSelectedDistilleryId] = useState<string>("");
  const [distSearch, setDistSearch] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const parseGalleryImagesFromSlots = (slots: string[]) => {
    const uniq = new Set<string>();
    return (Array.isArray(slots) ? slots : [])
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((url) => {
        const ok = /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
        if (!ok) return false;
        if (uniq.has(url)) return false;
        uniq.add(url);
        return true;
      });
  };
  const setGallerySlot = (index: number, value: string) => {
    setGalleryImageSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };
  const clearGallerySlots = () => setGalleryImageSlots(Array.from({ length: GALLERY_SLOT_COUNT }, () => ""));
  const readClipboardImageAsDataUrl = async () => {
    const clipboardApi = (navigator as ClipNavigator).clipboard;
    if (!clipboardApi?.read) {
      throw new Error("CLIPBOARD_READ_UNSUPPORTED");
    }
    const items = await clipboardApi.read();
    let imageBlob: Blob | null = null;
    for (const item of items) {
      const imageType = item.types.find((t: string) => t.startsWith("image/"));
      if (!imageType) continue;
      imageBlob = await item.getType(imageType);
      break;
    }
    if (!imageBlob) {
      throw new Error("CLIPBOARD_IMAGE_MISSING");
    }
    const file = new File([imageBlob], "clipboard-image.png", { type: imageBlob.type || "image/png" });
    return processImageToDataURL(file, 400, 400, 0.8);
  };
  const pasteImageFromClipboard = async (target: "product" | "distilleryLogo") => {
    try {
      const clipboardApi = (navigator as ClipNavigator).clipboard;
      if (!clipboardApi?.read) {
        alert("Vaš browser ne podržava direktno čitanje slike iz clipboard-a. Probajte Ctrl+V.");
        return;
      }
      const base64 = await readClipboardImageAsDataUrl();
      if (target === "product") {
        setFormData((prev) => ({ ...prev, bottleImageUrl: base64 }));
        setManualResult("Slika proizvoda uspešno nalepljena iz clipboard-a.");
      } else {
        setDistilleryData((prev) => ({ ...prev, logoUrl: base64 }));
        setManualResult("Logo destilerije uspešno nalepljen iz clipboard-a.");
      }
    } catch (err) {
      console.error("Clipboard paste failed", err);
      alert("Ne mogu da preuzmem sliku iz clipboard-a. Proverite dozvole browsera.");
    }
  };
  const pasteGalleryImageFromClipboard = async (index: number) => {
    try {
      const base64 = await readClipboardImageAsDataUrl();
      setGallerySlot(index, base64);
      setManualResult(`Slika galerije #${index + 1} uspešno nalepljena iz clipboard-a.`);
    } catch (err: unknown) {
      const e = err as { message?: string } | null;
      if (String(e?.message || "").includes("CLIPBOARD_READ_UNSUPPORTED")) {
        alert("Vaš browser ne podržava direktno čitanje slike iz clipboard-a.");
      } else if (String(e?.message || "").includes("CLIPBOARD_IMAGE_MISSING")) {
        alert("U clipboard-u nije pronađena slika. Kopirajte sliku pa pokušajte ponovo.");
      } else {
        console.error("Clipboard paste for gallery failed", err);
        alert("Ne mogu da preuzmem sliku iz clipboard-a. Proverite dozvole browsera.");
      }
    }
  };
  const handleGalleryFileSelect = async (index: number, file?: File) => {
    if (!file) return;
    try {
      const base64 = await processImageToDataURL(file, 400, 400, 0.8);
      setGallerySlot(index, base64);
      setManualResult(`Slika galerije #${index + 1} uspešno dodata.`);
    } catch (err) {
      console.error("Gallery image selection failed", err);
      alert("Greška pri dodavanju slike galerije.");
    }
  };

  const toMillis = (value: unknown): number => {
    if (!value) return 0;
    if (typeof (value as { toMillis?: () => number }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
    if (hasToDate(value)) {
      const d = value.toDate?.();
      if (d instanceof Date) return d.getTime();
    }
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value as string | number | Date).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const generateDistilleryCertificate = async (dist: DistilleryListItem) => {
    // We'll use a reliable QR API for the PDF generation to ensure perfect quality
    const distUrl = `${window.location.origin}/distillery/${dist.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(distUrl)}&color=000000&bgcolor=ffffff`;
    const cssVars = getComputedStyle(document.documentElement);
    const themeBg = cssVars.getPropertyValue("--color-bg-card").trim() || "#161618";
    const themeGold = cssVars.getPropertyValue("--color-gold-500").trim() || "#D4AF37";
    
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
           <img src="${window.location.origin}/logo-gold.png" alt="Rakivinum" style="max-height: 90px; max-width: 260px; width: auto; height: auto; margin: 0 auto; display: block; object-fit: contain;" crossorigin="anonymous" />
           <p style="text-transform: uppercase; letter-spacing: 0.4em; font-size: 10px; color: rgba(212, 175, 55, 0.6); margin-top: 10px;">Zvanični Digitalni Protokol</p>
        </div>
        
        <div style="width: 150px; height: 1px; background: ${themeGold}; margin: 8px auto;"></div>
        
        <div style="margin: 4px 0 12px;">
          <p style="text-transform: uppercase; font-size: 13px; letter-spacing: 0.2em; color: rgba(255,255,255,0.5);">Ovim se potvrđuje da je brend</p>
          <h2 style="font-size: 48px; margin: 20px 0; color: white; font-style: italic; font-weight: 900;">${dist?.name || 'Proizvođač'}</h2>
          <p style="font-size: 18px; color: ${themeGold}; font-weight: bold; max-width: 500px; margin: 0 auto; line-height: 1.6;">
            Verifikovan član Rakivinum mreže za proveru autentičnosti i senzornu analizu vrhunskih rakija i vina.
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
             <p style="font-size: 12px; margin-top: 5px; opacity: 0.6;">UUID: RAK-BRAND-${dist.id?.toUpperCase()}-2026</p>
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
        
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); opacity: 0.07; pointer-events: none; font-size: 180px; font-weight: 900; font-family: system-ui, -apple-system, sans-serif; color: ${themeGold}; letter-spacing: -12px; white-space: nowrap;">
           RV
        </div>
      </div>
    `;
    
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
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
      pdf.save(`Sertifikat_${dist.name.replace(/\s+/g, '_')}.pdf`);
    } catch (e) {
      console.error("PDF generation error:", e);
    } finally {
      document.body.removeChild(element);
    }
  };

  const generateDistilleryPromoCard = async (dist: DistilleryListItem, variant: "fair" | "table") => {
    const [{ default: QRCode }, { default: jsPDF }] = await Promise.all([
      import("qrcode"),
      import("jspdf"),
    ]);
    const distUrl = `${window.location.origin}/distillery/${dist.id}`;
    const qrDataUrl = await QRCode.toDataURL(distUrl, { width: 280, margin: 1 });
    const doc = new jsPDF("p", "mm", variant === "table" ? "a6" : "a4");
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const loadImageAsDataUrl = (src: string) =>
      new Promise<string | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d");
            if (!ctx) return resolve(null);
            ctx.drawImage(img, 0, 0);
            resolve(c.toDataURL("image/png"));
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    const logoData = await loadImageAsDataUrl(`${window.location.origin}/logo-gold.png`);

    // Background
    doc.setFillColor(15, 15, 17);
    doc.rect(0, 0, pageW, pageH, "F");

    // Gold frame
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.8);
    const margin = variant === "table" ? 8 : 14;
    doc.roundedRect(margin, margin, pageW - margin * 2, pageH - margin * 2, 6, 6);

    if (logoData) {
      const logoW = variant === "table" ? 26 : 36;
      const logoH = variant === "table" ? 12 : 16;
      doc.addImage(logoData, "PNG", (pageW - logoW) / 2, variant === "table" ? 10 : 14, logoW, logoH);
    }

    doc.setTextColor(212, 175, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(variant === "table" ? 9 : 12);
    doc.text("RAKIVINUM", pageW / 2, variant === "table" ? 26 : 36, { align: "center" });

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(variant === "table" ? 12 : 20);
    const titleLines = doc.splitTextToSize(dist?.name || "Proizvođač", pageW - margin * 2 - 8);
    let y = variant === "table" ? 34 : 50;
    titleLines.forEach((line: string) => {
      doc.text(line, pageW / 2, y, { align: "center" });
      y += variant === "table" ? 5 : 8;
    });

    doc.setFontSize(variant === "table" ? 8 : 11);
    doc.setTextColor(220, 220, 220);
    const subtitle =
      variant === "fair"
        ? "Skenirajte i pogledajte digitalni profil proizvođača."
        : "Skenirajte kod i saznajte više o ovom proizvođaču.";
    doc.text(doc.splitTextToSize(subtitle, pageW - margin * 2 - 8), pageW / 2, y + (variant === "table" ? 1 : 2), { align: "center" });
    y += variant === "table" ? 14 : 18;

    // QR block
    doc.setFillColor(255, 255, 255);
    const qrBox = variant === "table" ? 58 : 80;
    const qrX = (pageW - qrBox) / 2;
    doc.roundedRect(qrX, y, qrBox, qrBox, 5, 5, "F");
    const qrInner = qrBox - (variant === "table" ? 10 : 14);
    doc.addImage(qrDataUrl, "PNG", (pageW - qrInner) / 2, y + ((qrBox - qrInner) / 2), qrInner, qrInner);
    y += qrBox + (variant === "table" ? 8 : 10);

    doc.setTextColor(212, 175, 55);
    doc.setFontSize(variant === "table" ? 7 : 10);
    doc.text("DIGITALNI IDENTITET PROIZVOĐAČA", pageW / 2, y, { align: "center" });
    y += variant === "table" ? 6 : 10;

    doc.setTextColor(235, 235, 235);
    doc.setFontSize(variant === "table" ? 7 : 9);
    const bodyText =
      variant === "fair"
        ? "Za sajmove i degustacije: postavite ovaj card na štand kako bi gosti odmah otvorili profil i proizvode."
        : "Za restorane i degustacione sale: postavite sto-stalak uz bocu kako bi gosti skeniranjem dobili proverene informacije.";
    doc.text(doc.splitTextToSize(bodyText, pageW - margin * 2 - 8), pageW / 2, y, { align: "center" });
    y += variant === "table" ? 18 : 22;

    doc.setTextColor(170, 170, 170);
    doc.setFontSize(variant === "table" ? 6.5 : 8);
    doc.text("Link: " + distUrl, pageW / 2, y, { align: "center" });

    const fileSuffix = variant === "fair" ? "Sajamski_QR_Card" : "Restoran_Stalak_QR";
    doc.save(`${fileSuffix}_${(dist?.name || "Proizvodjac").replace(/\s+/g, "_")}.pdf`);
  };

  // Filtered list for the search/find functionality
  const filteredDistilleries = distilleries.filter(d => 
    d.name.toLowerCase().includes(distSearch.toLowerCase()) || 
    d.id.toLowerCase().includes(distSearch.toLowerCase())
  );
  const selectedDistillery = distilleries.find((d) => d.id === selectedDistilleryId) || null;
  const selectedDistilleryName = selectedDistillery?.name || "";
  const isLicenseForSelectedDistillery = (lic: { clientName?: string }) =>
    !!selectedDistilleryName &&
    String(lic.clientName || "").trim().toLowerCase() === selectedDistilleryName.trim().toLowerCase();
  const selectedPendingApprovals = selectedDistilleryId
    ? pendingProductApprovals.filter((prod) => prod.distilleryId === selectedDistilleryId)
    : pendingProductApprovals;
  const selectedLicenses = selectedDistilleryId ? licenses.filter(isLicenseForSelectedDistillery) : licenses;
  const selectedDistilleryList = selectedDistilleryId ? distilleries.filter((d) => d.id === selectedDistilleryId) : distilleries;
  const selectedProductIds = new Set(adminProducts.map((p) => p.id));
  const selectedDistilleryRatings = allRatings.filter((r) => selectedProductIds.has(r.productId));
  const selectedFlaggedRatings = flaggedRatings.filter((r) => selectedProductIds.has(r.productId));

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            try {
              const base64 = await processImageToDataURL(file, 400, 400, 0.8);
              
              if (activeTab === 'distilleries' && editingDistilleryId) {
                setDistilleryData(prev => ({ ...prev, logoUrl: base64 }));
                setManualResult("Logo destilerije uspešno nalepljen!");
              } else if (activeTab === 'distilleries' && distilleryTab === 'pica') {
                setFormData(prev => ({ ...prev, bottleImageUrl: base64 }));
                setManualResult("Slika rakije uspešno nalepljena!");
              }
            } catch (err) {
              console.error('Global paste failed', err);
              setManualResult("Greška pri nalepljivanju slike.");
            }
          }
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeTab, editingDistilleryId, distilleryTab]);

  const handleApproveRating = async (id: string) => {
    try {
      await updateDoc(doc(db, 'ratings', id), {
        isFlagged: false,
        isAutoFlagged: false,
        approvedBy: auth.currentUser?.email,
        approvedAt: new Date().toISOString()
      });
      fetchFlaggedRatings();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteRating = async (id: string) => {
    if (!window.confirm("Trajno obrisati ovu ocenu?")) return;
    try {
      const ratingRef = doc(db, "ratings", id);
      const ratingSnap = await getDoc(ratingRef);
      const productId = ratingSnap.exists() ? String((ratingSnap.data() as RatingLite).productId || "").trim() : "";

      if (!productId) {
        await deleteDoc(ratingRef);
        fetchFlaggedRatings();
        fetchRecentRatings();
        return;
      }

      const allSnap = await getDocs(
        query(collection(db, "ratings"), where("productId", "==", productId), limit(ADMIN_RATINGS_PER_PRODUCT_LIMIT)),
      );
      const remaining = allSnap.docs.filter((d) => d.id !== id);
      let sum = 0;
      for (const d of remaining) {
        sum += Number((d.data() as RatingLite).rating || 0);
      }
      const count = remaining.length;
      const avg = count > 0 ? sum / count : 0;

      const batch = writeBatch(db);
      batch.delete(ratingRef);
      batch.update(doc(db, "products", productId), {
        averageRating: avg,
        ratingCount: count,
      });
      await batch.commit();

      fetchFlaggedRatings();
      fetchRecentRatings();
      fetchAdminProducts();
    } catch (err) {
      console.error(err);
      alert("Greška pri brisanju ocene ili ažuriranju proseka proizvoda.");
    }
  };

  const selectDistillery = (id: string) => {
    setSelectedDistilleryId(id);
    setDistSearch("");
    setShowSearchResults(false);
    setDistilleryTab('profil');
    const selected = distilleries.find((d) => d.id === id);
    if (selected) {
      startEditingDistillery(selected);
    }
    // Scroll to the active distillery card for visual confirmation
  };
  const scrollToWorkspaceSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const fetchDistilleries = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'distilleries'), limit(ADMIN_DISTILLERIES_LIMIT)));
      meterDbRead("admin:distilleries", snap.size);
      const list: DistilleryListItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as DistilleryListItem) }));
      list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "sr"));
      setDistilleries(list);
      setSelectedDistilleryId((current) => {
        if (current === "all") return current;
        if (current && list.some((d) => d.id === current)) return current;
        return list[0]?.id || "";
      });
    } catch (err) {
      console.error("Greška pri učitavanju destilerija", err);
    }
  };

  const fetchAdminProducts = async () => {
    try {
      if (!selectedDistilleryId) {
        setAdminProducts([]);
        return;
      }
      // Super admin vidi sve ako želi, ili filtrira po izabranoj destileriji
      if (selectedDistilleryId === "all" && isSuperAdminUser) {
        const snap = await getDocs(query(collection(db, "products"), limit(ADMIN_PRODUCTS_ALL_LIMIT)));
        meterDbRead("admin:products_all", snap.size);
        setAdminProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as ProductListItem) })));
      } else {
        const q = query(
          collection(db, "products"),
          where("distilleryId", "==", selectedDistilleryId),
          limit(ADMIN_PRODUCTS_PER_DISTILLERY_LIMIT),
        );
        const snap = await getDocs(q);
        meterDbRead("admin:products_by_distillery", snap.size);
        setAdminProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as ProductListItem) })));
      }
    } catch (err) {
      console.error("Greška pri učitavanju proizvoda", err);
    }
  };

  const fetchPendingProductApprovals = async () => {
    try {
      const q = query(collection(db, "products"), where("isApproved", "==", false), limit(ADMIN_PENDING_APPROVALS_LIMIT));
      const snap = await getDocs(q);
      meterDbRead("admin:products_pending_approvals", snap.size);
      const list: ProductListItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as ProductListItem) }));
      list.sort((a, b) => {
        const aTs = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
        const bTs = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
        return bTs - aTs;
      });
      setPendingProductApprovals(list);
    } catch (err) {
      console.error("Greška pri učitavanju promena za odobrenje", err);
    }
  };

  const fetchEventProposals = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'eventProposals'), limit(ADMIN_EVENT_PROPOSALS_LIMIT)));
      setEventProposals(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Error fetching event proposals:", err);
    }
  };

  const fetchCommunityLinks = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'community_links'), limit(ADMIN_LINKS_LIMIT)));
      const list: CommunityLinkItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as CommunityLinkItem) }));
      list.sort((a, b) => (a.label || "").localeCompare(b.label || "", 'sr'));
      setCommunityLinks(list);
    } catch (err) {
      console.error("Greška pri učitavanju korisnih linkova:", err);
    }
  };

  const fetchCommunityEvents = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'community_events'), limit(ADMIN_EVENTS_LIMIT)));
      const list: CommunityEventItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as CommunityEventItem) }));
      list.sort((a, b) => String(a.eventDate || "").localeCompare(String(b.eventDate || "")));
      setCommunityEvents(list);
    } catch (err) {
      console.error("Greška pri učitavanju događaja:", err);
    }
  };

  const fetchFlaggedRatings = async () => {
    try {
      // Query for ratings where isFlagged is true OR it was auto-flagged
      const q = query(collection(db, "ratings"), where("isFlagged", "==", true), limit(ADMIN_FLAGGED_RATINGS_LIMIT));
      const snap = await getDocs(q);
      setFlaggedRatings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Error fetching flagged ratings:", err);
    }
  };

  const fetchRecentRatings = async () => {
    try {
      const q = query(collection(db, 'ratings'), limit(300));
      const snap = await getDocs(q);
      meterDbRead("admin:ratings_recent", snap.size);
      setAllRatings(snap.docs.map(d => ({ id: d.id, ...d.data() } as RatingRow)).sort((a, b) => 
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
      ).slice(0, 100));
    } catch (err) {
      console.error("Error fetching ratings:", err);
    }
  };

  const fetchBlockedUsers = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'blocked_users'), limit(ADMIN_BLOCKED_USERS_LIMIT)));
      setBlockedUsers(snap.docs.map(d => d.id));
    } catch (err) {
      console.error("Error fetching blocked users:", err);
    }
  };

  const handleBlockUser = async (userId: string) => {
    if (!userId || userId === 'anonymous') {
      alert("Nije moguće blokirati anonimnog korisnika na ovaj način.");
      return;
    }
    if (!window.confirm(`Da li ste sigurni da želite da BLOKIRATE (banujete) korisnika ${userId}? On više neće moći da ostavlja ocene niti da koristi personalne funkcije.`)) return;
    
    setIsModerating(true);
    try {
      await setDoc(doc(db, 'blocked_users', userId), {
        blockedAt: serverTimestamp(),
        blockedBy: auth.currentUser?.email,
        reason: "Zloupotreba sistema ili neprimereno ponašanje"
      });
      // Also update user doc if it exists
      try {
        await updateDoc(doc(db, 'users', userId), { isBlocked: true });
      } catch (e) {
        console.warn("User doc update failed (might not exist)", e);
      }
      fetchBlockedUsers();
      alert("Korisnik uspešno blokiran.");
    } catch (err) {
      console.error(err);
      alert("Greška pri blokiranju.");
    } finally {
      setIsModerating(false);
    }
  };

  const handleUnblockUser = async (userId: string) => {
    if (!window.confirm("Odblokirati korisnika?")) return;
    try {
      await deleteDoc(doc(db, 'blocked_users', userId));
      try {
        await updateDoc(doc(db, 'users', userId), { isBlocked: false });
      } catch (e) {}
      fetchBlockedUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const fetchLicenses = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'licenses'), limit(ADMIN_LICENSES_LIMIT)));
      setLicenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Error fetching licenses:", err);
    }
  };

  const handleApproveProduct = async (productId: string) => {
    try {
      await updateDoc(doc(db, 'products', productId), {
        isApproved: true,
        approvedAt: serverTimestamp(),
        approvedBy: auth.currentUser?.email || "admin",
      });
      await fetchAdminProducts();
      await fetchPendingProductApprovals();
      alert("Proizvod odobren!");
    } catch (err) {
      console.error(err);
      alert("Greška pri odobravanju proizvoda.");
    }
  };

  const generateLicensePDF = async (clientName: string, tokens: string[]) => {
    const [{ default: QRCode }, { default: jsPDF }] = await Promise.all([
      import("qrcode"),
      import("jspdf"),
    ]);
    const doc = new jsPDF();
    
    // Design Colors
    const GOLD = [184, 134, 11];
    const BLACK = [26, 26, 28];
    
    // Header background
    doc.setFillColor(BLACK[0], BLACK[1], BLACK[2]);
    doc.rect(0, 0, 210, 40, 'F');
    
    // Logo Text (Rakivinum)
    doc.setTextColor(218, 165, 32); // Goldenrod
    doc.setFont("times", "bolditalic");
    doc.setFontSize(30);
    doc.text("RAKIVINUM", 105, 25, { align: 'center' });
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    // Simple ASCII to avoid missing char blocks
    doc.text("DIGITALNI PECAT KVALITETA", 105, 32, { align: 'center' });
    
    // Header separator
    doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
    doc.setLineWidth(0.5);
    doc.line(70, 35, 140, 35);
    
    // Client Info Section
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`LICENCE ZA: ${clientName.toUpperCase()}`, 20, 55);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    const dateFormatted = new Date().toLocaleDateString('en-GB').replace(/\//g, '.');
    doc.text(`Datum izdavanja: ${dateFormatted}.`, 20, 62);
    doc.text(`Ukupno licenci: ${tokens.length}`, 20, 67);
    
    let yPos = 80;
    
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      // Check for page break
      if (yPos > 240) {
        doc.addPage();
        yPos = 30;
      }
      
      // License Card
      doc.setDrawColor(230, 230, 230);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(15, yPos, 180, 50, 3, 3, 'FD');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.text(`LICENCA ${index + 1}`, 22, yPos + 10);
      
      doc.setFont("courier", "bold");
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text(token, 22, yPos + 20);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text("Link za aktivaciju:", 22, yPos + 30);
      
      const link = `${window.location.origin}/activate?token=${token}`;
      doc.setTextColor(0, 0, 255);
      doc.setFontSize(8);
      doc.text(link, 22, yPos + 36);
      
      try {
        const qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 100 });
        doc.addImage(qrDataUrl, 'PNG', 150, yPos + 5, 40, 40);
      } catch (err) {
        console.error("QR Code Error", err);
      }
      
      // QR Code Instructions
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.text("Skenirajte QR kod za preuzimanje digitalnog pecata.", 22, yPos + 44);
      
      yPos += 60;
    }
    
    // Page Footer
    const pageCount = (doc as PdfLike).internal?.getNumberOfPages?.() || 1;
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Stranica ${i} od ${pageCount} | Rakivinum Sistemi`, 105, 290, { align: 'center' });
    }
    
    doc.save(`Rakivinum_Licence_${clientName.replace(/\s+/g, '_')}.pdf`);
  };

  const buildLicenseClipboardText = (clientName: string, tokens: string[], recipientEmail?: string) => {
    const origin = window.location.origin;
    const header = [
      "Rakivinum — licence",
      `Klijent: ${clientName}`,
      recipientEmail ? `Email primaoca: ${recipientEmail}` : null,
      "",
    ]
      .filter((line): line is string => line != null && line !== "")
      .join("\n");
    const body = tokens
      .map((t, idx) => {
        const url = `${origin}/activate?token=${encodeURIComponent(t)}`;
        return `${idx + 1}. Token: ${t}\n   Aktivacija: ${url}`;
      })
      .join("\n\n");
    return `${header}\n${body}\n\nUputstvo: otvorite link na telefonu u Rakivinum aplikaciji i potvrdite aktivaciju.`;
  };

  const copyLicensesToClipboard = async (
    clientName: string,
    tokens: string[],
    recipientEmail?: string,
  ): Promise<boolean> => {
    const text = buildLicenseClipboardText(clientName, tokens, recipientEmail);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        await navigator.clipboard.writeText(tokens.join("\n"));
        return true;
      } catch {
        return false;
      }
    }
  };

  const draftLicenseEmail = (clientName: string, email: string, tokens: string[]) => {
    const subject = encodeURIComponent(`Vaše Rakivinum Licence - ${clientName}`);
    const body = encodeURIComponent(
      `Poštovani,\n\nU nastavku se nalaze aktivacioni kodovi za Rakivinum platformu za pravno lice ${clientName}.\n\n` +
      tokens.map((t, idx) => {
        const url = `${window.location.origin}/activate?token=${t}`;
        return `Licenca ${idx+1}:\nKljuč: ${t}\nLink za aktivaciju: ${url}\n`;
      }).join('\n') +
      `\nInstrukcije:\n1. Otvorite ovaj mejl na mobilnom telefonu i kliknite na link, ili\n2. Skenirajte QR kodove iz priloženog PDF dokumenta.\n\nSrdačan pozdrav,\nRakivinum Administracija`
    );
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
  };

  const sendLicenseEmailDraft = async (clientName: string, email: string, tokens: string[]) => {
    const cleanEmail = String(email || "").trim();
    const cleanTokens = (tokens || []).filter(Boolean);
    if (cleanTokens.length === 0) {
      alert("Nema licenci za slanje.");
      return { copied: false, openedMail: false };
    }
    const copied = await copyLicensesToClipboard(clientName, cleanTokens, cleanEmail || undefined);
    let openedMail = false;
    if (cleanEmail) {
      draftLicenseEmail(clientName, cleanEmail, cleanTokens);
      openedMail = true;
    }
    return { copied, openedMail };
  };

  const handleBatchLicenses = async () => {
    if (!batchDistillery) {
      alert("Molimo unesite naziv klijenta/destilerije.");
      return;
    }
    
    setIsGeneratingLicense(true);
    const generatedTokens = [];
    
    try {
      const startTimestamp = batchStartDate ? Timestamp.fromDate(new Date(batchStartDate)) : serverTimestamp();
      const expiry = batchEndDate ? Timestamp.fromDate(new Date(batchEndDate)) : Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);
      
      const count = batchCount || 1;

      for (let i = 0; i < count; i++) {
        const token = 'lic_' + Math.random().toString(36).substr(2, 9).toUpperCase() + Date.now().toString().slice(-4);
        const payload = {
          token,
          type: 'limited',
          maxDevices: 3,
          activatedDevices: [],
          isUsed: false,
          clientName: batchDistillery,
          createdAt: serverTimestamp(),
          startDate: startTimestamp,
          expiresAt: expiry,
          comment: `Paket za ${batchDistillery} (${i+1}/${count})`
        };
        await setDoc(doc(db, 'licenses', token), payload);
        generatedTokens.push(token);
      }
      
      const { copied, openedMail } = await sendLicenseEmailDraft(batchDistillery, batchEmail, generatedTokens);
      setLastGeneratedBatchTokens(generatedTokens);
      
      // AUTO DOWNLOAD THE PDF IMMEDIATELY SO THEY CAN DRAG AND DROP INTO EMAIL!
      generateLicensePDF(batchDistillery, generatedTokens);
      
      const clipPart = copied
        ? " Tekst sa svim tokenima i linkovima je kopiran u clipboard (nalepite u mejl ako mail draft skrati poruku)."
        : " Kopiranje u clipboard nije uspelo — koristite PDF ili ručno kopirajte tokene.";
      const mailPart = openedMail
        ? " Otvoren je mail draft."
        : " Nema unešenog mejla — nalepite sadržaj iz clipboarda u mejl kada šaljete.";
      alert(
        `Uspešno generisano ${count} licenci za ${batchDistillery}. PDF je preuzet.${mailPart}${clipPart}`,
      );
      // Optional: keep the distillery name filled so they can immediately download PDF
      // We will clear the count to 1 just in case
      setBatchCount(1);
      setBatchEmail("");
      fetchLicenses();
    } catch (err: unknown) {
      console.error(err);
      alert("Greška pri generisanju licenci: " + ((err as { message?: string } | null)?.message || "Nepoznata greška"));
    } finally {
      setIsGeneratingLicense(false);
    }
  };

  const handleUpdateDeviceLimit = async (licId: string, currentLimit: number) => {
    const newLimit = prompt("Unesite novi limit uređaja:", String(currentLimit + 2));
    if (newLimit && !isNaN(Number(newLimit))) {
      try {
        await updateDoc(doc(db, 'licenses', licId), {
          maxDevices: Number(newLimit),
          comment: `Limit povećan na ${newLimit} (${new Date().toLocaleDateString()})`
        });
        fetchLicenses();
      } catch (err) {
        console.error(err);
      }
    }
  };

  useEffect(() => {
    fetchDistilleries();
    fetchEventProposals();
    fetchCommunityLinks();
    fetchCommunityEvents();
    fetchFlaggedRatings();
    fetchRecentRatings();
    fetchBlockedUsers();
    fetchLicenses();
    fetchPendingProductApprovals();
  }, []);

  useEffect(() => {
    fetchAdminProducts();
  }, [selectedDistilleryId]);

  const handleSaveCommunityLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = linkForm.label.trim();
    const url = linkForm.url.trim();
    if (!label || !url) {
      alert("Unesite naziv i URL linka.");
      return;
    }
    try {
      if (editingLinkId) {
        await updateDoc(doc(db, 'community_links', editingLinkId), {
          label,
          url,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'community_links'), {
          label,
          url,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setLinkForm({ label: "", url: "" });
      setEditingLinkId(null);
      fetchCommunityLinks();
    } catch (err) {
      console.error(err);
      alert("Greška pri čuvanju linka.");
    }
  };

  const handleDeleteCommunityLink = async (id: string) => {
    if (!window.confirm("Obrisati ovaj korisni link?")) return;
    try {
      await deleteDoc(doc(db, 'community_links', id));
      if (editingLinkId === id) {
        setEditingLinkId(null);
        setLinkForm({ label: "", url: "" });
      }
      fetchCommunityLinks();
    } catch (err) {
      console.error(err);
      alert("Greška pri brisanju linka.");
    }
  };

  const handleSaveCommunityEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = eventForm.title.trim();
    const eventDate = eventForm.eventDate.trim();
    if (!title || !eventDate) {
      alert("Naziv i datum događaja su obavezni.");
      return;
    }
    try {
      const payload = {
        title,
        eventDate,
        location: eventForm.location.trim(),
        description: eventForm.description.trim(),
        websiteUrl: eventForm.websiteUrl.trim(),
        mapsUrl: eventForm.mapsUrl.trim(),
        updatedAt: serverTimestamp()
      };
      if (editingEventId) {
        await updateDoc(doc(db, 'community_events', editingEventId), payload);
      } else {
        await addDoc(collection(db, 'community_events'), {
          ...payload,
          createdAt: serverTimestamp()
        });
      }
      setEventForm({ title: "", eventDate: "", location: "", description: "", websiteUrl: "", mapsUrl: "" });
      setEditingEventId(null);
      fetchCommunityEvents();
    } catch (err) {
      console.error(err);
      alert("Greška pri čuvanju događaja.");
    }
  };

  const handleDeleteCommunityEvent = async (id: string) => {
    if (!window.confirm("Obrisati ovaj događaj?")) return;
    try {
      await deleteDoc(doc(db, 'community_events', id));
      if (editingEventId === id) {
        setEditingEventId(null);
        setEventForm({ title: "", eventDate: "", location: "", description: "", websiteUrl: "", mapsUrl: "" });
      }
      fetchCommunityEvents();
    } catch (err) {
      console.error(err);
      alert("Greška pri brisanju događaja.");
    }
  };

  const toggleVerification = async (id: string, currentStatus: boolean) => {
    try {
      const nextVerified = !currentStatus;
      await updateDoc(doc(db, 'distilleries', id), {
        isVerified: nextVerified
      });
      if (nextVerified) {
        const pageSize = ADMIN_PRODUCTS_PER_DISTILLERY_LIMIT;
        let cursor: QueryDocumentSnapshot | null = null;
        for (;;) {
          const prodSnap = await getDocs(
            cursor
              ? query(
                  collection(db, "products"),
                  where("distilleryId", "==", id),
                  orderBy(documentId()),
                  startAfter(cursor),
                  limit(pageSize),
                )
              : query(
                  collection(db, "products"),
                  where("distilleryId", "==", id),
                  orderBy(documentId()),
                  limit(pageSize),
                ),
          );
          if (prodSnap.empty) break;
          const approvalTasks = prodSnap.docs
            .filter((p) => (p.data() as ProductListItem).isApproved === false)
            .map((p) => updateDoc(doc(db, "products", p.id), { isApproved: true }));
          if (approvalTasks.length > 0) {
            await Promise.all(approvalTasks);
          }
          const last = prodSnap.docs[prodSnap.docs.length - 1];
          if (!last || prodSnap.docs.length < pageSize) break;
          cursor = last;
        }
      }
      fetchDistilleries();
      fetchAdminProducts();
    } catch (err) {
      console.error("Greška pri promeni statusa:", err);
      alert("Niste ovlašćeni za ovu akciju.");
    }
  };

  const handleAddDistillery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      setManualResult("Greška: Niste prijavljeni.");
      return;
    }
    
    setIsSavingManual(true);
    setManualResult("");

    // Safety timeout to prevent infinite spinning
    const timeout = setTimeout(() => {
      if (isSavingManual) {
        setIsSavingManual(false);
        setManualResult("Operacija traje predugo. Proverite internet vezu ili dozvole.");
      }
    }, 15000);

    try {
       const galleryImages = parseGalleryImagesFromSlots(galleryImageSlots);
       // Ne upisuj ownerId ovde: pri updateDoc bi se prepisao pravim vlasnikom adminov UID,
       // a proizvođač bi ostao samo na email polju — brisanje mejla bi ga trajno isključilo.
       const basePayload: Record<string, unknown> = {
         name: (distilleryData.name || "").trim(),
         region: (distilleryData.region || "Srbija").trim(),
         logoUrl: (distilleryData.logoUrl || "").trim() || "https://picsum.photos/seed/dist/200/200",
         pib: (distilleryData.pib || "").trim(),
         location: {
           address: (distilleryData.address || "").trim(),
           city: (distilleryData.city || "").trim(),
         }
       };
       basePayload.galleryImages = galleryImages;

       if (distilleryData.website?.trim()) basePayload.website = distilleryData.website.trim();
      if (distilleryData.mapsUrl?.trim()) {
        basePayload.mapsUrl = distilleryData.mapsUrl.trim();
      } else if (editingDistilleryId) {
        basePayload.mapsUrl = deleteField();
      }
       if (distilleryData.email?.trim()) {
         basePayload.email = distilleryData.email.trim();
       } else if (editingDistilleryId) {
         basePayload.email = deleteField();
       }
       if (distilleryData.description?.trim()) basePayload.description = distilleryData.description.trim();

       const trialDateStr = (distilleryData.trialEndsAt || "").trim();
       const trialEndsAtTs = trialDateStr
         ? Timestamp.fromDate(new Date(`${trialDateStr}T12:00:00`))
         : Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

       if (editingDistilleryId) {
         const updatePayload: Record<string, unknown> = { ...basePayload };
         if (trialDateStr) {
           updatePayload.trialEndsAt = trialEndsAtTs;
         }
         await updateDoc(doc(db, 'distilleries', editingDistilleryId), updatePayload);
         setManualResult("Destilerija uspešno izmenjena!");
         setEditingDistilleryId(null);
       } else {
         const dId = doc(collection(db, "distilleries")).id;
         await setDoc(doc(db, "distilleries", dId), {
           ...basePayload,
           isVerified: false,
           createdAt: serverTimestamp(),
           trialEndsAt: trialEndsAtTs,
         });
         setManualResult("Destilerija uspešno dodata!");
        setSelectedDistilleryId(dId);
        setActiveTab("distilleries");
       }

       clearTimeout(timeout);
      setDistilleryData({ id: "", name: "", region: "Beograd i okolina", website: "", email: "", description: "", logoUrl: "", pib: "", address: "", city: "", mapsUrl: "", trialEndsAt: "" });
       clearGallerySlots();
       try {
         await fetchDistilleries();
       } catch (e) {
         console.warn("Refresh list failed", e);
       }
    } catch (err: unknown) {
       clearTimeout(timeout);
       console.error("Distillery Save Error:", err);
       setManualResult("Greška: " + ((err as { message?: string } | null)?.message || "Problem sa bazom. Proverite SuperAdmin prava."));
    } finally {
       setIsSavingManual(false);
    }
  };

  const startEditingDistillery = (dist: DistilleryListItem) => {
    setEditingDistilleryId(dist.id);
    let trialInput = "";
    const rawTrial = dist.trialEndsAt;
    if (hasToDate(rawTrial)) {
      const d = rawTrial.toDate?.();
      if (d instanceof Date && !Number.isNaN(d.getTime())) trialInput = d.toISOString().slice(0, 10);
    } else if (rawTrial) {
      const d = new Date(rawTrial as string | number | Date);
      if (!Number.isNaN(d.getTime())) trialInput = d.toISOString().slice(0, 10);
    }
    setDistilleryData({
      id: dist.id,
      name: dist.name,
      region: dist.region,
      website: dist.website || "",
      email: dist.email || "",
      description: dist.description || "",
      logoUrl: dist.logoUrl || "",
      pib: dist.pib || "",
      address: dist.location?.address || "",
      city: dist.location?.city || "",
      mapsUrl: dist.mapsUrl || "",
      trialEndsAt: trialInput,
    });
    setGalleryImageSlots(() => {
      const base = Array.from({ length: GALLERY_SLOT_COUNT }, () => "");
      const src = Array.isArray(dist.galleryImages) ? dist.galleryImages.slice(0, GALLERY_SLOT_COUNT) : [];
      src.forEach((url, idx) => { base[idx] = String(url || "").trim(); });
      return base;
    });
    setManualResult("");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteDistillery = async (id: string) => {
    setIsSavingManual(true);
    try {
      // 1. Delete associated products in bounded pages (avoids unbounded reads).
      const pageSize = 450;
      let more = true;
      while (more) {
        const snap = await getDocs(
          query(collection(db, "products"), where("distilleryId", "==", id), limit(pageSize)),
        );
        if (snap.empty) break;
        await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "products", d.id))));
        more = snap.docs.length >= pageSize;
      }

      // 2. Delete Distillery
      await deleteDoc(doc(db, 'distilleries', id));
      
      setDistilleryToDelete(null);
      fetchDistilleries();
      fetchAdminProducts();
      setManualResult("Destilerija i sve njene rakije su uspešno obrisane.");
    } catch (err: unknown) {
      console.error(err);
      setManualResult("Greška pri brisanju: " + ((err as { message?: string } | null)?.message || "Proverite dozvole."));
      setDistilleryToDelete(null);
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleToggleDistilleryArchive = async (dist: DistilleryListItem) => {
    const nextArchived = !dist?.isArchived;
    const promptText = nextArchived
      ? "Arhivirati destileriju? Proizvodi i pristup biće privremeno sakriveni."
      : "Vratiti destileriju iz arhive?";
    if (!window.confirm(promptText)) return;

    setIsSavingManual(true);
    try {
      await updateDoc(doc(db, "distilleries", dist.id), {
        isArchived: nextArchived,
        archivedAt: nextArchived ? serverTimestamp() : null,
        archivedBy: nextArchived ? (auth.currentUser?.email || "admin") : null,
        restoredAt: !nextArchived ? serverTimestamp() : null,
      });

      const pageSize = ADMIN_PRODUCTS_PER_DISTILLERY_LIMIT;
      let cursor: QueryDocumentSnapshot | null = null;
      for (;;) {
        const prodSnap = await getDocs(
          cursor
            ? query(
                collection(db, "products"),
                where("distilleryId", "==", dist.id),
                orderBy(documentId()),
                startAfter(cursor),
                limit(pageSize),
              )
            : query(
                collection(db, "products"),
                where("distilleryId", "==", dist.id),
                orderBy(documentId()),
                limit(pageSize),
              ),
        );
        if (prodSnap.empty) break;
        await Promise.all(
          prodSnap.docs.map((p) =>
            updateDoc(doc(db, "products", p.id), {
              isArchivedByDistillery: nextArchived,
              updatedAt: serverTimestamp(),
            }),
          ),
        );
        const last = prodSnap.docs[prodSnap.docs.length - 1];
        if (!last || prodSnap.docs.length < pageSize) break;
        cursor = last;
      }

      setManualResult(nextArchived ? "Destilerija je arhivirana." : "Destilerija je vraćena iz arhive.");
      fetchDistilleries();
      fetchAdminProducts();
    } catch (err: unknown) {
      console.error(err);
      setManualResult("Greška pri arhiviranju: " + ((err as { message?: string } | null)?.message || "Nepoznata greška."));
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      setManualResult("Greška: Morate biti prijavljeni.");
      return;
    }

    setIsSavingManual(true);
    setManualResult("");

    try {
      if (editingProductId) {
        const updateData: Record<string, unknown> = {
            name: formData.name.trim(),
            type: formData.type.trim(),
            alcoholPercentage: Number(formData.alcoholPercentage),
            bottleImageUrl: formData.bottleImageUrl.trim() || "https://picsum.photos/seed/rakija/800/1000",
        };
        if (formData.description.trim()) updateData.description = formData.description.trim();
        if (formData.barcode.trim()) {
          const rawBarcode = formData.barcode.trim();
          updateData.barcode = rawBarcode;
          updateData.barcodeNormalized = normalizeBarcode(rawBarcode);
        } else {
          updateData.barcode = null;
          updateData.barcodeNormalized = null;
        }

        await updateDoc(doc(db, 'products', editingProductId), updateData);
        setManualResult("Rakija uspešno izmenjena!");
        setEditingProductId(null);
      } else {
        if (!selectedDistilleryId || selectedDistilleryId === 'all') {
          setManualResult("Greška: Morate izabrati konkretnu destileriju za dodavanje rakije.");
          setIsSavingManual(false);
          return;
        }

        const addData: Record<string, unknown> = {
            distilleryId: selectedDistilleryId,
            name: formData.name.trim(),
            type: formData.type.trim(),
            alcoholPercentage: Number(formData.alcoholPercentage),
            bottleImageUrl: formData.bottleImageUrl.trim() || "https://picsum.photos/seed/rakija/800/1000",
            isApproved: true,
            publicLabelDisabled: false,
            isArchivedByDistillery: false,
            averageRating: 0,
            scanCount: 0,
            createdAt: serverTimestamp()
        };
        if (formData.description.trim()) addData.description = formData.description.trim();
        if (formData.barcode.trim()) {
          const rawBarcode = formData.barcode.trim();
          addData.barcode = rawBarcode;
          addData.barcodeNormalized = normalizeBarcode(rawBarcode);
        }

        await addDoc(collection(db, 'products'), addData);
        setManualResult("Nova rakija uspešno dodata u bazu!");
      }
      setFormData({ name: "", type: "", description: "", alcoholPercentage: 40, bottleImageUrl: "", barcode: "" });
      fetchAdminProducts();
    } catch (error: unknown) {
      setManualResult("Greška pri unosu: " + ((error as { message?: string } | null)?.message || "Nepoznata greška."));
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'products', id));
      setProductToDelete(null);
      fetchAdminProducts();
    } catch(err) {
      console.error(err);
      setManualResult("Greška pri brisanju: Nemate dozvolu.");
      setProductToDelete(null);
    }
  };

  const startEditing = (p: ProductListItem) => {
    setEditingProductId(p.id);
    setFormData({
      name: p.name,
      type: p.type,
      description: p.description || "",
      alcoholPercentage: p.alcoholPercentage,
      bottleImageUrl: p.bottleImageUrl || "",
      barcode: p.barcode || ""
    });
    setManualResult("");
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="admin-input-framed min-h-[100dvh] bg-bg-base relative p-6 animate-in fade-in duration-500">
      <div className="absolute top-[-20%] left-[-20%] w-[300px] h-[300px] pointer-events-none" style={{ background: 'radial-gradient(circle, var(--color-gold-glow) 0%, transparent 70%)' }} />
      
      <div className="flex items-center gap-4 mb-8 relative z-10">
        <button 
          onClick={goBackSafe}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-bg-card border border-border-subtle text-text-primary hover:bg-gold-500/10 hover:text-gold-500 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-wide">Sistemski Admin</h1>
          <p className="text-sm text-text-secondary">Upravljanje podacima</p>
          {isSuperAdminUser && (
            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gold-500/90">
              Online sada: {onlineUsersCount ?? "—"}
            </p>
          )}
          <p className="text-[11px] text-text-secondary/90 mt-2 max-w-xl leading-relaxed">
            Gornji tabovi su vraćeni. U okviru taba Destilerije/Vinarije nalazi se kompletan profil aktivnog proizvođača.
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Sistemski admin"
        className="relative z-10 mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-border-subtle bg-bg-card-elevated p-1.5 sm:flex-wrap sm:overflow-visible"
      >
        {(
          [
            ['approvals', 'Promene za odobrenje', CheckCircle],
            ['distilleries', 'Destilerije/Vinarije', Building2],
            ['events', 'Događaji', BookOpen],
            ['moderation', 'Moderacija', ShieldAlert],
            ['licensing', 'Licence', Star],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`flex min-w-max shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide transition-all sm:min-w-0 sm:flex-1 sm:justify-center ${
              activeTab === id
                ? 'bg-gold-500 text-black shadow-[0_0_18px_rgba(212,175,55,0.28)]'
                : 'text-text-secondary hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-90" />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
      </div>

      {(activeTab === 'approvals' || activeTab === 'distilleries' || activeTab === 'licensing') && (
      <div className="bg-bg-card border border-gold-500/20 rounded-[24px] p-6 shadow-xl relative z-[40] mb-4 space-y-4 animate-in fade-in duration-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <Database className="w-5 h-5 text-gold-500" /> Pronađite i izaberite destileriju
            </h3>
            <p className="text-xs text-text-secondary">Prvo pronađite destileriju, kliknite na nju da bi postala aktivna.</p>
          </div>
        </div>

        <div className="relative" id="dist-search-container">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                <Search className="w-4 h-4" />
              </div>
              <input 
                type="text" 
                placeholder="Ukucaj naziv (npr. 'Žuta Osa' ili ID) za pretragu..." 
                value={distSearch}
                onFocus={() => setShowSearchResults(true)}
                onChange={(e) => {
                  setDistSearch(e.target.value);
                  setShowSearchResults(true);
                }}
                className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 pl-10 pr-4 text-white focus:border-gold-500 outline-none transition-all shadow-inner"
              />
              
              {showSearchResults && (distSearch || distilleries.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-bg-card-elevated border border-gold-500/30 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] z-[100] max-h-80 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-300 ring-1 ring-gold-500/20">
                  <div className="p-2 border-b border-border-subtle/30 bg-bg-card flex items-center justify-between">
                    <span className="text-[10px] font-bold text-text-secondary uppercase px-2">Rezultati pretrage</span>
                    <button onClick={() => setShowSearchResults(false)} className="text-xs text-gold-500 hover:underline px-2">Zatvori</button>
                  </div>
                  {(distSearch ? filteredDistilleries : distilleries).length > 0 ? (
                    (distSearch ? filteredDistilleries : distilleries).map(d => (
                      <button 
                        key={d.id}
                        onClick={() => selectDistillery(d.id)}
                        className={`w-full p-4 text-left hover:bg-gold-500/20 border-b border-border-subtle/30 last:border-0 transition-colors group flex items-center justify-between ${selectedDistilleryId === d.id ? 'bg-gold-500/10' : ''}`}
                      >
                        <div>
                          <p className={`text-sm font-bold ${selectedDistilleryId === d.id ? 'text-gold-500' : 'text-white'} group-hover:text-gold-500`}>{d.name}</p>
                          <p className="text-[10px] text-text-secondary">ID: {d.id} • {d.region}</p>
                        </div>
                        {selectedDistilleryId === d.id && <CheckCircle className="w-4 h-4 text-gold-500" />}
                      </button>
                    ))
                  ) : (
                    <div className="p-8 text-center text-xs text-text-secondary italic bg-bg-card">
                      Nema pronađenih destilerija za "{distSearch}"
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-[0_0_auto] md:min-w-[320px] flex items-center gap-3 bg-bg-base p-3 rounded-xl border border-gold-500/40 shadow-[0_0_15px_rgba(212,175,55,0.1)] relative">
              <div className="w-10 h-10 rounded-full bg-gold-500/20 flex items-center justify-center shrink-0 border border-gold-500/30">
                <Database className="w-5 h-5 text-gold-500 animate-pulse" />
              </div>
              <div className="min-w-0 pr-10">
                <p className="text-[9px] text-white/50 uppercase font-black tracking-widest">Aktivna Destilerija</p>
                <p className="text-sm font-black text-gold-500 truncate drop-shadow-sm">
                  {selectedDistilleryId === "all" ? "Pregled svih rakija" : (distilleries.find(d => d.id === selectedDistilleryId)?.name || "IZABERITE IZ PRETRAGE")}
                </p>
              </div>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {isSuperAdminUser && selectedDistilleryId !== "all" && (
                  <button 
                    onClick={() => setSelectedDistilleryId("all")}
                    title="Pogledaj sve proizvode"
                    className="p-1.5 rounded-lg bg-gold-500/10 text-gold-500 hover:bg-gold-500 hover:text-black transition-all border border-gold-500/20"
                  >
                    <Database className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!selectedDistillery) return;
                setBatchDistillery(selectedDistillery.name || "");
                setBatchEmail(selectedDistillery.email || "");
                setActiveTab("distilleries");
              }}
              disabled={!selectedDistillery}
              className="px-3 py-2 rounded-lg bg-gold-500 text-black text-xs font-black uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Pregled aktivne destilerije
            </button>
            {activeTab === 'distilleries' && (
              <button
                type="button"
                onClick={() => {
                  setEditingDistilleryId(null);
                  setDistilleryData({ id: "", name: "", region: "Beograd i okolina", website: "", email: "", description: "", logoUrl: "", pib: "", address: "", city: "", mapsUrl: "", trialEndsAt: "" });
                    clearGallerySlots();
                  setDistilleryTab('profil');
                  setManualResult("");
                }}
                className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-xs font-black uppercase tracking-wide"
              >
                Otvori novu destileriju
              </button>
            )}
            {selectedDistillery && (
              <span className="text-[10px] text-text-secondary">
                Fokusirano: proizvodi, licence i odobrenja za <span className="text-gold-500 font-bold">{selectedDistillery.name}</span>
              </span>
            )}
          </div>
          {activeTab === 'distilleries' && (
            <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-border-subtle">
              {([
                ["profil", "Profil i podaci"],
                ["pica", "Pića"],
                ["licence", "Licence"],
                ["ocene", "Ocene"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDistilleryTab(id)}
                  className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide border transition-colors ${
                    distilleryTab === id
                      ? "bg-gold-500 text-black border-gold-500"
                      : "border-border-subtle text-text-secondary hover:text-white hover:border-white/30"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {(activeTab === 'distilleries' && distilleryTab === 'pica') && (
      <div className="relative z-10 space-y-4 animate-in fade-in duration-200">
      <div className="bg-bg-card border border-border-subtle rounded-[24px] p-4 shadow-xl relative z-10 animate-in slide-in-from-bottom-2 duration-300">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => scrollToWorkspaceSection("workspace-profil")}
            className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[10px] font-black uppercase tracking-wide"
          >
            Profil
          </button>
          <button
            type="button"
            onClick={() => scrollToWorkspaceSection("workspace-logo")}
            className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[10px] font-black uppercase tracking-wide"
          >
            Logo / Fotke
          </button>
          <button
            type="button"
            onClick={() => scrollToWorkspaceSection("workspace-pica")}
            className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[10px] font-black uppercase tracking-wide"
          >
            Pića
          </button>
        </div>
      </div>
      <div id="workspace-pica" className="bg-bg-card border border-border-subtle rounded-[24px] p-6 shadow-xl relative z-10 space-y-6 animate-in slide-in-from-bottom-2 duration-300">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-gold-500">
              <Database className="w-5 h-5" />
              <h2 className="font-bold text-lg">Ručni unos pića (Digitalna Etiketa)</h2>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              Dodajte novo piće (rakija, vino...) za aktivnu destileriju/vinariju.
            </p>
          </div>
          {/* FORM DATA REMAINS UNCHANGED HERE... JUST MOVED INTO TAB */}
          <form onSubmit={handleManualAdd} className="space-y-4 pt-4 border-t border-border-subtle">

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-text-secondary uppercase">Naziv pića</label>
              <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="npr. MVP Zlatna Dunja" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-text-secondary uppercase">Tip (Kategorija)</label>
              <select 
                required 
                value={formData.type} 
                onChange={e=>setFormData({...formData, type: e.target.value})} 
                className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors cursor-pointer"
              >
                <option value="">Izaberi kategoriju...</option>
                {PRODUCT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="space-y-1">
            <label className="text-xs font-bold text-text-secondary uppercase">Detaljan opis (opciono)</label>
            <textarea value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors h-24 resize-none" placeholder="Unesite note ukusa, proces destilacije..."></textarea>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-text-secondary uppercase">Procenat alkohola (%)</label>
              <input required type="number" min="0" max="100" value={formData.alcoholPercentage} onChange={e=>setFormData({...formData, alcoholPercentage: Number(e.target.value)})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-text-secondary uppercase">Bar-kod (EAN/UPC)</label>
              <input type="text" value={formData.barcode} onChange={e=>setFormData({...formData, barcode: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="npr. 8601234567890" />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-text-secondary uppercase">Slika boce (Nalepi ili Unesi Link)</label>
            <button
              type="button"
              onClick={() => pasteImageFromClipboard("product")}
              className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[10px] font-black uppercase tracking-wide"
            >
              Zalepi sliku
            </button>
            
            {/* Image Preview / Paste Zone */}
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              id="imageUpload"
              onChange={async (e) => {
                if (e.target.files && e.target.files[0]) {
                  try {
                    const base64 = await processImageToDataURL(e.target.files[0], 400, 400, 0.8);
                    setFormData({ ...formData, bottleImageUrl: base64 });
                  } catch (err) {
                    console.error('Image selection failed', err);
                    alert("Greška pri dodavanju slike.");
                  }
                }
              }}
            />
            <label 
              htmlFor="imageUpload"
              tabIndex={0}
              className={`relative h-48 w-full rounded-xl border-2 border-dashed focus:outline-none focus:border-gold-500 focus:shadow-[0_0_15px_rgba(212,175,55,0.2)] ${formData.bottleImageUrl ? 'border-gold-500/50 bg-bg-base' : 'border-border-subtle bg-bg-card-elevated'} flex flex-col items-center justify-center overflow-hidden transition-all group cursor-pointer`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  document.getElementById('imageUpload')?.click();
                }
              }}
              onPaste={async (e) => {
                const items = e.clipboardData.items;
                for (let i = 0; i < items.length; i++) {
                  if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                      try {
                        const base64 = await processImageToDataURL(file, 400, 400, 0.8);
                        setFormData({ ...formData, bottleImageUrl: base64 });
                      } catch (err) {
                        console.error('Image paste failed', err);
                        alert("Greška pri kopiranju slike.");
                      }
                    }
                  }
                }
              }}
            >
              {formData.bottleImageUrl ? (
                <>
                  <img src={formData.bottleImageUrl} alt="Preview" className="h-full object-contain" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <p className="text-white text-sm font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Klikni ovde za novu sliku</p>
                  </div>
                </>
              ) : (
                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-bg-card rounded-full flex items-center justify-center mx-auto mb-3 shadow">
                    <Upload className="w-5 h-5 text-gold-500" />
                  </div>
                  <p className="text-white text-sm font-medium">Klikni ovde da izabereš sliku ili <kbd className="bg-bg-base px-2 py-0.5 rounded text-gold-500 font-mono text-xs">Ctrl+V</kbd> da je zalepiš</p>
                  <p className="text-xs text-text-secondary mt-1">Slika će biti automatski smanjena na format.</p>
                </div>
              )}
            </label>

            <div className="flex items-center gap-2">
              <div className="h-px bg-border-subtle flex-1" />
              <span className="text-xs text-text-secondary uppercase">Ili url</span>
              <div className="h-px bg-border-subtle flex-1" />
            </div>

            <input type="text" value={formData.bottleImageUrl} onChange={e=>setFormData({...formData, bottleImageUrl: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="https://..." />
          </div>

          {manualResult && (
            <div className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${manualResult.includes("Greška") ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
              <CheckCircle className="w-4 h-4" /> {manualResult}
            </div>
          )}

          <div className="flex gap-3">
            {editingProductId && (
              <button 
                type="button" 
                onClick={() => {
                  setEditingProductId(null);
                  setFormData({ name: "", type: "", description: "", alcoholPercentage: 40, bottleImageUrl: "", barcode: "" });
                }} 
                className="w-1/3 h-12 bg-bg-card-elevated text-text-secondary border border-border-subtle font-bold rounded-xl flex items-center justify-center hover:text-white transition-colors"
              >
                Otkaži
              </button>
            )}
            <button type="submit" disabled={isSavingManual} className={`${editingProductId ? 'w-2/3' : 'w-full'} h-12 bg-bg-base text-gold-500 border border-border-gold font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-gold-500 hover:text-black transition-colors disabled:opacity-50`}>
              {isSavingManual ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {editingProductId ? "Ažuriraj Podatke" : "Sačuvaj Rakiju"}
            </button>
          </div>
        </form>

        {/* ADMIN PRODUCTS TABLE */}
        <div className="pt-8 border-t border-border-subtle/50 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-gold-500" /> Registrovane rakije ({adminProducts.length})
          </h3>
          <div className="space-y-3">
            {adminProducts.map(prod => (
              <div key={prod.id} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <img 
                    src={prod.bottleImageUrl} 
                    alt={prod.name} 
                    className="w-12 h-12 object-cover rounded bg-bg-base shrink-0" 
                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/rakija/100/100'; }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                       <p className="text-sm font-bold text-white truncate">{prod.name}</p>
                       {prod.isApproved === false && (
                         <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 rounded text-[8px] font-black uppercase tracking-widest whitespace-nowrap">Na Odobrenju</span>
                       )}
                    </div>
                    <p className="text-xs text-text-secondary truncate">
                      {prod.type} • {prod.alcoholPercentage}% vol 
                      {prod.barcode && ` • BC: ${prod.barcode}`}
                    </p>
                    <p className="text-[10px] text-gold-500/50 truncate font-mono">{prod.distilleryId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {prod.isApproved === false && (
                    <button 
                      onClick={() => handleApproveProduct(prod.id)}
                      className="p-2 border border-yellow-500/30 rounded-lg text-yellow-500 hover:bg-yellow-500/10 transition-colors"
                      title="Odobri proizvod"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={() => openAdminLabelPreview(prod.id)} 
                    className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-white hover:border-white/50 transition-colors"
                    title="Vidi digitalnu etiketu (Simulacija skeniranja)"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button onClick={() => startEditing(prod)} className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-gold-500 hover:border-gold-500/50 transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setProductToDelete(prod.id)} className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-red-500 hover:border-red-500/50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {adminProducts.length === 0 && (
              <p className="text-sm text-text-secondary italic text-center py-4">Nema unetih pića.</p>
            )}
          </div>
        </div>
      </div>
      </div>
      )}

      {activeTab === 'approvals' && (
      <div className="relative z-10 space-y-4 animate-in fade-in duration-200">
        <div className="bg-bg-card border border-border-subtle rounded-[24px] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-lg text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-gold-500" />
                Promene za odobrenje ({selectedPendingApprovals.length})
              </h2>
              <p className="text-sm text-text-secondary">
                Ovde su novi ili izmenjeni artikli koji čekaju odobrenje za trenutno aktivnu destileriju.
              </p>
            </div>
            <button
              onClick={() => fetchPendingProductApprovals()}
              className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 transition-colors text-xs font-bold uppercase"
            >
              Osveži
            </button>
          </div>

          <div className="space-y-3">
            {selectedPendingApprovals.map((prod) => {
              const distName = distilleries.find((d) => d.id === prod.distilleryId)?.name || prod.distilleryId || "Nepoznato";
              return (
                <div key={prod.id} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <img
                      src={prod.bottleImageUrl || "https://picsum.photos/seed/rakija/100/100"}
                      alt={prod.name}
                      className="w-12 h-12 object-cover rounded bg-bg-base shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/rakija/100/100'; }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">{prod.name}</p>
                      <p className="text-xs text-text-secondary truncate">{prod.type} • {prod.alcoholPercentage || 0}% vol</p>
                      <p className="text-[10px] text-gold-500/70 truncate">{distName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApproveProduct(prod.id)}
                      className="px-3 py-2 border border-yellow-500/30 rounded-lg text-yellow-500 hover:bg-yellow-500/10 transition-colors text-[10px] font-black uppercase tracking-wide"
                    >
                      Odobri
                    </button>
                    <button
                      onClick={() => openAdminLabelPreview(prod.id)}
                      className="px-3 py-2 border border-border-subtle rounded-lg text-text-secondary hover:text-white hover:border-white/40 transition-colors text-[10px] font-black uppercase tracking-wide"
                    >
                      Pregled
                    </button>
                  </div>
                </div>
              );
            })}

            {selectedPendingApprovals.length === 0 && (
              <p className="text-sm text-text-secondary italic text-center py-6">
                Trenutno nema artikala na čekanju za odobrenje.
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {activeTab === 'distilleries' && distilleryTab !== 'pica' && (
        <div id="workspace-profil" className="bg-bg-card border border-border-subtle rounded-[24px] p-6 shadow-xl relative z-10 space-y-6 mt-4 animate-in slide-in-from-bottom-2 duration-300">
          <div className="space-y-2">
             <div className="flex items-center gap-2 text-gold-500">
                <Database className="w-5 h-5" />
                <h2 className="font-bold text-lg">{editingDistilleryId ? "Izmena Destilerije/Vinarije" : "Upravljanje Destilerijama/Vinarijama"}</h2>
             </div>
             <p className="text-sm text-text-secondary leading-relaxed">
                {editingDistilleryId ? `Ažurirate podatke za ${distilleryData.name}` : "Dodajte nove destilerije/vinarije u sistem ili obrišite postojeće."}
             </p>
          </div>
          {distilleryTab === 'profil' && (
          <>
          <form onSubmit={handleAddDistillery} className="space-y-4 pt-4 border-t border-border-subtle">
             {editingDistilleryId ? (
               <p className="text-[10px] text-text-secondary leading-relaxed">
                 Interni ID (u bazi i linkovima):{" "}
                 <code className="text-white/90 font-mono text-[11px]">{editingDistilleryId}</code>
                 <span className="text-text-secondary/80"> — dodeljuje se pri kreiranju i ne menja se.</span>
               </p>
             ) : (
               <p className="text-[10px] text-text-secondary leading-relaxed">
                 Jedinstveni ID dodeljuje se automatski pri čuvanju; prikazuje se samo u admin listi i u tehničkim linkovima, ne morate ga unositi.
               </p>
             )}
             <div className="space-y-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Naziv</label>
                <input required type="text" value={distilleryData.name} onChange={e=>setDistilleryData({...distilleryData, name: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="Puni naziv" />
             </div>
             
             <div className="space-y-1">
                <label className="text-xs font-bold text-text-secondary uppercase">PIB / broj PG</label>
                <input type="text" value={distilleryData.pib} onChange={e=>setDistilleryData({...distilleryData, pib: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="Unesite PIB ili broj gazdinstva" />
             </div>

             <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 col-span-1">
                   <label className="text-xs font-bold text-text-secondary uppercase">Region</label>
                   <select required value={distilleryData.region} onChange={e=>setDistilleryData({...distilleryData, region: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors cursor-pointer appearance-none">
                      <option value="Beograd i okolina">Beograd i okolina</option>
                      <option value="Vojvodina">Vojvodina</option>
                      <option value="Šumadija">Šumadija</option>
                      <option value="Zapadna Srbija">Zapadna Srbija</option>
                      <option value="Istočna Srbija">Istočna Srbija</option>
                      <option value="Južna Srbija">Južna Srbija</option>
                      <option value="Kosovo i Metohija">Kosovo i Metohija</option>
                      <option value="Ostalo">Ostalo (BiH, Hrvatska, Makedonija...)</option>
                      <option value="Inostranstvo">Inostranstvo</option>
                   </select>
                </div>
                <div className="space-y-1 col-span-1">
                   <label className="text-xs font-bold text-text-secondary uppercase">Mjesto</label>
                   <input type="text" value={distilleryData.city} onChange={e=>setDistilleryData({...distilleryData, city: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="Grad ili selo" />
                </div>
                <div className="space-y-1 col-span-1">
                   <label className="text-xs font-bold text-text-secondary uppercase">Adresa</label>
                   <input type="text" value={distilleryData.address} onChange={e=>setDistilleryData({...distilleryData, address: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="Ulica i broj" />
                </div>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                   <label className="text-xs font-bold text-text-secondary uppercase">Sajt (URL)</label>
                   <input type="text" value={distilleryData.website} onChange={e=>setDistilleryData({...distilleryData, website: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="https://..." />
                </div>
                <div className="space-y-1">
                   <label className="text-xs font-bold text-text-secondary uppercase">Email Kontakt</label>
                   <input type="email" value={distilleryData.email} onChange={e=>setDistilleryData({...distilleryData, email: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors" placeholder="kontakt@destilerija.rs" />
                </div>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Map link (opciono)</label>
                <input
                  type="text"
                  value={distilleryData.mapsUrl}
                  onChange={e=>setDistilleryData({...distilleryData, mapsUrl: e.target.value})}
                  className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors"
                  placeholder="https://maps.google.com/?q=..."
                />
                <p className="text-[10px] text-text-secondary">
                  Ako unesete map link, javni profil koristi ovu tačnu lokaciju umesto automatske pretrage po adresi.
                </p>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Opis (opciono)</label>
                <textarea value={distilleryData.description} onChange={e=>setDistilleryData({...distilleryData, description: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors h-20 resize-none" placeholder="Opis destilerije/vinarije..."></textarea>
             </div>

             <div className="space-y-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Kraj probnog perioda (datum)</label>
                <input
                  type="date"
                  value={distilleryData.trialEndsAt}
                  onChange={(e) => setDistilleryData({ ...distilleryData, trialEndsAt: e.target.value })}
                  className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors"
                />
                <p className="text-[10px] text-text-secondary leading-relaxed">
                  {editingDistilleryId
                    ? "Ako ostavite prazno, postojeći datum probnog perioda u bazi ostaje nepromenjen. Status „Sertifikovan proizvođač“ uključuje se zelenim dugmetom pored liste."
                    : "Ako ostavite prazno, automatski se postavlja probni period od 30 dana. Nova destilerija dobija probni nalog bez javnog sertifikata dok ga ne uključite dugmetom pored liste."}
                </p>
             </div>

             <div id="workspace-logo" className="space-y-3">
                <label className="text-xs font-bold text-text-secondary uppercase">Logo Destilerije/Vinarije</label>
                <button
                  type="button"
                  onClick={() => pasteImageFromClipboard("distilleryLogo")}
                  className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[10px] font-black uppercase tracking-wide"
                >
                  Zalepi sliku
                </button>
                <div className="relative">
                  <label className={`block w-full border-2 border-dashed rounded-[24px] cursor-pointer transition-all ${distilleryData.logoUrl ? 'border-gold-500 bg-gold-500/5 h-32' : 'border-border-subtle bg-bg-card-elevated hover:border-gold-500/50 p-6'}`}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const base64 = await processImageToDataURL(file, 400, 400, 0.8);
                          setDistilleryData({...distilleryData, logoUrl: base64});
                        }
                      }}
                    />
                    {distilleryData.logoUrl ? (
                      <div className="h-full w-full flex items-center justify-center p-2">
                        <img src={distilleryData.logoUrl} className="h-full object-contain rounded-lg" alt="Logo preview" />
                        <button 
                          type="button"
                          onClick={(e) => { e.preventDefault(); setDistilleryData({...distilleryData, logoUrl: ""}); }}
                          className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <ImageIcon className="w-8 h-8 text-gold-500 mx-auto mb-2 opacity-50" />
                        <p className="text-white text-xs font-bold">Ubaci logo ili zalepi (Ctrl+V)</p>
                        <p className="text-[10px] text-text-secondary mt-1">Logo će biti prikazan na sajtu i u aplikaciji</p>
                      </div>
                    )}
                  </label>
                </div>
                <input type="text" value={distilleryData.logoUrl} onChange={e=>setDistilleryData({...distilleryData, logoUrl: e.target.value})} className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-white focus:border-gold-500 transition-colors text-xs" placeholder="Logo URL (opciono)..." />
             </div>
             <div className="space-y-3">
               <label className="text-xs font-bold text-text-secondary uppercase">Galerija destilerije/vinarije (6 slika)</label>
               <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                 {galleryImageSlots.map((slot, index) => (
                   <div key={`gallery-slot-${index}`} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-2 space-y-1.5">
                     <p className="text-[9px] text-gold-500 font-black uppercase tracking-wide text-center">Slika {index + 1}</p>
                     <div className="relative aspect-square rounded-lg border border-white/10 bg-bg-base flex items-center justify-center overflow-hidden">
                       {slot ? (
                         <img src={slot} alt={`Galerija ${index + 1}`} className="w-full h-full object-contain p-1" />
                       ) : (
                         <span className="text-[9px] text-text-secondary">Nema slike</span>
                       )}
                       {slot && (
                         <button
                           type="button"
                           onClick={() => setGallerySlot(index, "")}
                           className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white text-[10px] font-black"
                           title="Obriši sliku"
                         >
                           ✕
                         </button>
                       )}
                     </div>
                     <div className="flex gap-2">
                       <button
                         type="button"
                         onClick={() => pasteGalleryImageFromClipboard(index)}
                         className="flex-1 px-2 py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[9px] font-black uppercase tracking-wide"
                       >
                         Zalepi
                       </button>
                       <label className="flex-1 px-2 py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:text-white hover:border-white/40 text-[9px] font-black uppercase tracking-wide text-center cursor-pointer">
                         Učitaj
                         <input
                           type="file"
                           accept="image/*"
                           className="hidden"
                           onChange={(e) => void handleGalleryFileSelect(index, e.target.files?.[0])}
                         />
                       </label>
                     </div>
                   </div>
                 ))}
               </div>
               <p className="text-[10px] text-text-secondary">
                 Ove slike će se prikazivati na javnoj stranici proizvođača u sekciji galerije.
               </p>
             </div>

             {activeTab === 'distilleries' && manualResult && (
                <div className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${manualResult.includes("Greška") ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                  <CheckCircle className="w-4 h-4" /> {manualResult}
                </div>
             )}

             <div className="flex gap-3">
               {editingDistilleryId && (
                 <button 
                  type="button"
                  onClick={() => {
                    setEditingDistilleryId(null);
                    setDistilleryData({ id: "", name: "", region: "Srbija", website: "", email: "", description: "", logoUrl: "", pib: "", address: "", city: "", mapsUrl: "", trialEndsAt: "" });
                    clearGallerySlots();
                  }}
                  className="w-1/3 h-12 bg-bg-card-elevated text-text-secondary border border-border-subtle font-bold rounded-xl"
                 >
                   Otkaži
                 </button>
               )}
               <button type="submit" disabled={isSavingManual} className={`${editingDistilleryId ? 'w-2/3' : 'w-full'} h-12 bg-bg-base text-gold-500 border border-border-gold font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-gold-500 hover:text-black transition-colors disabled:opacity-50`}>
                  {isSavingManual ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {editingDistilleryId ? "Ažuriraj Destileriju/Vinariju" : "Dodaj Destileriju/Vinariju"}
               </button>
             </div>
          </form>

          <div className="pt-8 border-t border-border-subtle/50 space-y-4">
             <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-gold-500" /> Registrovane destilerije ({distilleries.length})
             </h3>
             <div className="space-y-3">
                {selectedDistilleryList.map(dist => {
                   const distLicenses = licenses.filter(lic => lic.clientName === dist.name);
                   const activeLicenses = distLicenses.length;
                   const lastAccessAtRaw = dist.lastAppAccessAt;
                  const lastAccessDate = hasToDate(lastAccessAtRaw)
                    ? lastAccessAtRaw.toDate?.() || null
                    : (lastAccessAtRaw ? new Date(lastAccessAtRaw as string | number | Date) : null);
                   const soonestExpiry = distLicenses.reduce((soonest: Date | null, lic: LicenseItem) => {
                     if (!lic.expiresAt) return soonest;
                    const exp = hasToDate(lic.expiresAt)
                      ? lic.expiresAt.toDate?.() || new Date(0)
                      : new Date((lic.expiresAt || 0) as string | number | Date);
                     if (!soonest || exp < soonest) return exp;
                     return soonest;
                   }, null);
                   const isExpiringSoon = soonestExpiry && (soonestExpiry.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000);
                   const trialEndRaw = dist.trialEndsAt;
                  const trialEndDate = hasToDate(trialEndRaw)
                    ? trialEndRaw.toDate?.() || null
                     : trialEndRaw
                      ? new Date(trialEndRaw as string | number | Date)
                       : null;
                   const trialEndLabel =
                     trialEndDate && !Number.isNaN(trialEndDate.getTime())
                       ? trialEndDate.toLocaleDateString("sr-RS")
                       : null;

                   return (
                   <div key={dist.id} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                         <div className="flex items-center gap-2">
                           <p className="text-sm font-bold text-white truncate">{dist.name}</p>
                          {dist.isArchived && (
                            <span className="bg-red-500/10 text-red-400 text-[8px] font-semibold px-1.5 py-0.5 rounded border border-red-500/20 uppercase tracking-tighter">
                              Arhiva
                            </span>
                          )}
                           {dist.isVerified && (
                             <span className="bg-green-500/10 text-green-500 text-[8px] font-semibold px-1.5 py-0.5 rounded border border-green-500/20 uppercase tracking-tighter">
                               Sertifikovan Proizvođač
                             </span>
                           )}
                           {!dist.isVerified && (
                             <span className="bg-amber-500/10 text-amber-400 text-[8px] font-semibold px-1.5 py-0.5 rounded border border-amber-500/25 uppercase tracking-tighter">
                               Probni nalog
                             </span>
                           )}
                           {activeLicenses > 0 && (
                             <span className="bg-gold-500/10 text-gold-500 text-[8px] font-semibold px-1.5 py-0.5 rounded border border-gold-500/20">
                               {activeLicenses} {activeLicenses === 1 ? 'LICENCA' : 'LICENCE'}
                             </span>
                           )}
                         </div>
                         <p className="text-[10px] text-text-secondary truncate">ID: {dist.id} • {dist.region} {dist.email && `• ${dist.email}`}</p>
                         {!dist.isVerified && trialEndLabel && (
                           <p className="text-[9px] text-amber-500/90 mt-0.5 font-semibold">
                             Probni period do: {trialEndLabel}
                           </p>
                         )}
                         <p className="text-[9px] text-text-secondary mt-1">
                           Zadnji pristup aplikaciji:{" "}
                           <span className="text-white/90 font-semibold">
                             {lastAccessDate && !Number.isNaN(lastAccessDate.getTime())
                               ? lastAccessDate.toLocaleString('sr-RS')
                               : "Nema podataka"}
                           </span>
                         </p>
                         {soonestExpiry && (
                           <div className="flex items-center gap-2 mt-1">
                             <p className={`text-[9px] font-bold ${isExpiringSoon ? 'text-red-500 animate-pulse' : 'text-text-secondary'}`}>
                               {isExpiringSoon ? '!!! LICENCA ISTIČE: ' : 'Vazi do: '} 
                               {soonestExpiry.toLocaleDateString('sr-RS')}
                             </p>
                             {isExpiringSoon && (
                               <span className="bg-red-500/10 text-red-500 text-[8px] px-1 rounded border border-red-500/20 font-bold">HITNA OBNOVA</span>
                             )}
                           </div>
                         )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button 
                          onClick={() => generateDistilleryCertificate(dist)}
                          title="Digitalni Sertifikat (PDF)"
                          className="p-2 border border-blue-500/30 text-blue-500 rounded-lg hover:bg-blue-500/10 transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => generateDistilleryPromoCard(dist, "fair")}
                          title="Sajamski QR card (PDF)"
                          className="p-2 border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/10 transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => generateDistilleryPromoCard(dist, "table")}
                          title="Restoran sto-stalak QR (PDF)"
                          className="p-2 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/10 transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        {activeLicenses > 0 && (
                          <>
                            <button 
                              onClick={() => setAnalyticsDistillery(dist)}
                              title="Analitika i Izveštaji"
                              className="p-2 border border-blue-500/30 text-blue-500 rounded-lg hover:bg-blue-500/10 transition-colors"
                            >
                              <BarChart2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={async () => {
                                try {
                                  const { copied, openedMail } = await sendLicenseEmailDraft(
                                    dist.name,
                                    dist.email || "",
                                    distLicenses.map((l) => String(l.token || "")),
                                  );
                                  if (openedMail) {
                                    alert(
                                      copied
                                        ? `Mail draft za ${dist.email}. Tekst je i u clipboardu.`
                                        : `Mail draft za ${dist.email}. Clipboard nije uspeo — koristite PDF.`,
                                    );
                                  } else {
                                    alert(
                                      copied
                                        ? "Nema emaila u bazi — tekst sa licencama je u clipboardu."
                                        : "Nema emaila i kopiranje nije uspelo — koristite PDF.",
                                    );
                                  }
                                } catch (err: unknown) {
                                  alert(`Greška: ${(err as { message?: string } | null)?.message || "Pokušajte ponovo."}`);
                                }
                              }}
                              title="Mail draft + kopiranje u clipboard"
                              className="p-2 border border-gold-500/30 text-gold-500 rounded-lg hover:bg-gold-500/10 transition-colors"
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await copyLicensesToClipboard(
                                  dist.name,
                                  distLicenses.map((l) => String(l.token || "")),
                                  dist.email || undefined,
                                );
                                alert(ok ? "Tokeni i linkovi kopirani u clipboard." : "Kopiranje nije uspelo (proverite dozvolu browsera).");
                              }}
                              title="Samo kopiraj tokene i aktivacione linkove"
                              className="p-2 border border-white/20 text-text-secondary rounded-lg hover:bg-white/5 hover:text-gold-500 transition-colors"
                            >
                              <ClipboardCopy className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => generateLicensePDF(dist.name, distLicenses.map((l) => String(l.token || "")))}
                              title="Generiši PDF listu licenci"
                              className="p-2 border border-gold-500/30 text-gold-500 rounded-lg hover:bg-gold-500/10 transition-colors"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => handleToggleDistilleryArchive(dist)}
                          title={dist.isArchived ? "Vrati iz arhive" : "Arhiviraj destileriju"}
                          className={`p-2 border rounded-lg transition-colors ${dist.isArchived ? 'border-blue-500/40 text-blue-400 hover:bg-blue-500/10' : 'border-red-500/30 text-red-400 hover:bg-red-500/10'}`}
                        >
                          <Database className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => toggleVerification(dist.id, !!dist.isVerified)}
                          title={dist.isVerified ? "Oduzmi sertifikat" : "Dodeli sertifikat"}
                          className={`p-2 border rounded-lg transition-colors ${dist.isVerified ? 'border-green-500/50 text-green-500 hover:bg-green-500/10' : 'border-border-subtle text-text-secondary hover:text-gold-500 hover:border-gold-500/50'}`}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => startEditingDistillery(dist)} className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-gold-500 hover:border-gold-500/50 transition-colors">
                           <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDistilleryToDelete(dist.id)} className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-red-500 hover:border-red-500/50 transition-colors">
                           <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                   </div>
                   );
                })}
             </div>
          </div>
          </>
          )}
        </div>
      )}

      {activeTab === 'events' && (
        <div className="bg-bg-card border border-border-subtle rounded-[24px] p-6 shadow-xl relative z-10 space-y-6 mt-4 animate-in slide-in-from-bottom-2 duration-300">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-gold-500">
              <BookOpen className="w-5 h-5" />
              <h2 className="font-bold text-lg">Događaji i korisni linkovi</h2>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              Ovim sadržajem upravlja isključivo sistemski admin. U zajednici se prikazuju samo aktuelni događaji (današnji i budući).
            </p>
          </div>

          <div className="grid gap-6 pt-4 border-t border-border-subtle">
            <div className="grid lg:grid-cols-2 gap-4">
              <form onSubmit={handleSaveCommunityLink} className="card-soft p-4 space-y-3">
                <h3 className="text-sm font-black text-gold-500 uppercase tracking-wide">Korisni linkovi</h3>
                <input
                  type="text"
                  placeholder="Naziv linka (npr. Turistička organizacija)"
                  value={linkForm.label}
                  onChange={(e) => setLinkForm((p) => ({ ...p, label: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <input
                  type="url"
                  placeholder="https://..."
                  value={linkForm.url}
                  onChange={(e) => setLinkForm((p) => ({ ...p, url: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 rounded-xl bg-gold-500 text-black text-xs font-black uppercase tracking-wide">
                    {editingLinkId ? "Sačuvaj izmene" : "Dodaj link"}
                  </button>
                  {editingLinkId && (
                    <button
                      type="button"
                      onClick={() => { setEditingLinkId(null); setLinkForm({ label: "", url: "" }); }}
                      className="px-4 py-2 rounded-xl border border-white/15 text-text-secondary text-xs font-bold uppercase tracking-wide"
                    >
                      Otkaži
                    </button>
                  )}
                </div>
              </form>

              <form onSubmit={handleSaveCommunityEvent} className="card-soft p-4 space-y-3">
                <h3 className="text-sm font-black text-gold-500 uppercase tracking-wide">Manifestacije / Događaji</h3>
                <input
                  type="text"
                  placeholder="Naziv događaja"
                  value={eventForm.title}
                  onChange={(e) => setEventForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <input
                  type="date"
                  value={eventForm.eventDate}
                  onChange={(e) => setEventForm((p) => ({ ...p, eventDate: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <input
                  type="text"
                  placeholder="Lokacija (opciono)"
                  value={eventForm.location}
                  onChange={(e) => setEventForm((p) => ({ ...p, location: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <textarea
                  placeholder="Kratak opis događaja"
                  value={eventForm.description}
                  onChange={(e) => setEventForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm min-h-[84px]"
                />
                <input
                  type="url"
                  placeholder="Sajt događaja (opciono)"
                  value={eventForm.websiteUrl}
                  onChange={(e) => setEventForm((p) => ({ ...p, websiteUrl: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <input
                  type="url"
                  placeholder="Google mapa link (opciono)"
                  value={eventForm.mapsUrl}
                  onChange={(e) => setEventForm((p) => ({ ...p, mapsUrl: e.target.value }))}
                  className="w-full bg-bg-base border border-border-subtle rounded-xl py-3 px-3 text-white text-sm"
                />
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 rounded-xl bg-gold-500 text-black text-xs font-black uppercase tracking-wide">
                    {editingEventId ? "Sačuvaj izmene" : "Dodaj događaj"}
                  </button>
                  {editingEventId && (
                    <button
                      type="button"
                      onClick={() => { setEditingEventId(null); setEventForm({ title: "", eventDate: "", location: "", description: "", websiteUrl: "", mapsUrl: "" }); }}
                      className="px-4 py-2 rounded-xl border border-white/15 text-text-secondary text-xs font-bold uppercase tracking-wide"
                    >
                      Otkaži
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="card-soft p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-white">Aktivni korisni linkovi ({communityLinks.length})</h3>
                <div className="space-y-2">
                  {communityLinks.map((item) => (
                    <div key={item.id} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-bold truncate">{item.label}</p>
                        <p className="text-[11px] text-text-secondary truncate">{item.url}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => { setEditingLinkId(item.id); setLinkForm({ label: item.label || "", url: item.url || "" }); }}
                          className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-gold-500"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteCommunityLink(item.id)} className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {communityLinks.length === 0 && <p className="text-sm text-text-secondary italic py-4">Nema dodatih linkova.</p>}
                </div>
              </div>

              <div className="card-soft p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-white">Svi događaji ({communityEvents.length})</h3>
                <div className="space-y-2">
                  {communityEvents.map((ev) => (
                    <div key={ev.id} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-bold truncate">{ev.title || "Bez naziva"}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] text-gold-500">{ev.eventDate || "-"}</p>
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                            ev.eventDate && String(ev.eventDate) < new Date().toISOString().slice(0, 10)
                              ? "text-text-secondary border-white/20"
                              : "text-green-400 border-green-500/30 bg-green-500/10"
                          }`}>
                            {ev.eventDate && String(ev.eventDate) < new Date().toISOString().slice(0, 10) ? "Arhiva" : "Aktuelno"}
                          </span>
                        </div>
                        {ev.location && <p className="text-[11px] text-text-secondary truncate">{ev.location}</p>}
                        {ev.description && <p className="text-[11px] text-text-secondary mt-1 line-clamp-2">{ev.description}</p>}
                        {(ev.websiteUrl || ev.link) && (
                          <a href={ev.websiteUrl || ev.link} target="_blank" rel="noreferrer" className="text-[10px] text-gold-500 hover:underline mt-1 block truncate">
                            Sajt: {ev.websiteUrl || ev.link}
                          </a>
                        )}
                        {ev.mapsUrl && (
                          <a href={ev.mapsUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline mt-1 block truncate">
                            Mapa: {ev.mapsUrl}
                          </a>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setEditingEventId(ev.id);
                            setEventForm({
                              title: ev.title || "",
                              eventDate: ev.eventDate || "",
                              location: ev.location || "",
                              description: ev.description || "",
                              websiteUrl: ev.websiteUrl || ev.link || "",
                              mapsUrl: ev.mapsUrl || ""
                            });
                          }}
                          className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-gold-500"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteCommunityEvent(ev.id)} className="p-2 border border-border-subtle rounded-lg text-text-secondary hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {communityEvents.length === 0 && <p className="text-sm text-text-secondary italic py-4">Nema dodatih događaja.</p>}
                </div>
              </div>
            </div>

            <div className="card-soft p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-white">Predlozi korisnika ({eventProposals.length})</h3>
              <div className="space-y-2">
                {eventProposals.map(ev => (
                  <div key={ev.id} className="bg-bg-card-elevated border border-border-subtle rounded-xl p-4 flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-white font-bold truncate">{ev.name || "Bez naziva"}</h4>
                      <p className="text-xs text-text-secondary truncate mt-1">{ev.location}</p>
                      {ev.link && (
                        <a href={ev.link} target="_blank" rel="noreferrer" className="text-[10px] text-gold-500 hover:underline mt-1 block truncate">
                          {ev.link}
                        </a>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        if (window.confirm("Obriši ovaj predlog?")) {
                          await deleteDoc(doc(db, 'eventProposals', ev.id));
                          fetchEventProposals();
                        }
                      }}
                      className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {eventProposals.length === 0 && (
                  <p className="text-center text-text-secondary text-sm italic py-4">Nema novih prijava događaja.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {(activeTab === 'moderation' || (activeTab === 'distilleries' && distilleryTab === 'ocene')) && (
        <div className="bg-bg-card border border-border-subtle rounded-[24px] p-6 shadow-xl relative z-10 space-y-6 mt-4 animate-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-400">
                <ShieldAlert className="w-5 h-5" />
                <h2 className="font-bold text-lg">Moderacija & Antifraud</h2>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                Pratite aktivnosti i blokirajte "Indijance" koji kvare prosek.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <input 
                type="text" 
                placeholder="Traži po email-u/rakiji..." 
                value={modSearch}
                onChange={(e) => setModSearch(e.target.value)}
                className="w-full bg-bg-base border border-border-subtle rounded-xl py-2 pl-4 pr-10 text-xs text-white"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            </div>
          </div>
          
          <div className="grid gap-6">
            {/* PRIJAVLJENI SADRŽAJ */}
            {flaggedRatings.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-black text-red-500 uppercase tracking-widest flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> HITNE PRIJAVE ({flaggedRatings.length})
                </h3>
                <div className="grid gap-4">
                  {(activeTab === 'distilleries' ? selectedFlaggedRatings : flaggedRatings).map(rating => (
                    <RatingCard 
                      key={rating.id} 
                      rating={rating} 
                      onApprove={handleApproveRating} 
                      onDelete={handleDeleteRating}
                      onBlock={handleBlockUser}
                    onUnblock={handleUnblockUser}
                      isBlocked={blockedUsers.includes(rating.userId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* SVE RECENZIJE */}
            <div className="space-y-3">
              <h3 className="text-xs font-black text-gold-500 uppercase tracking-widest">
                Poslednje recenzije (Audit)
              </h3>
              <div className="grid gap-4">
                {(activeTab === 'distilleries' ? selectedDistilleryRatings : allRatings)
                  .filter(r => 
                    !modSearch || 
                    (r.reviewText || "").toLowerCase().includes(modSearch.toLowerCase()) ||
                    (r.productName || "").toLowerCase().includes(modSearch.toLowerCase()) ||
                    (r.userName || "").toLowerCase().includes(modSearch.toLowerCase()) ||
                    (r.userId || "").toLowerCase().includes(modSearch.toLowerCase())
                  )
                  .map(rating => (
                  <RatingCard 
                    key={rating.id} 
                    rating={rating} 
                    onApprove={() => {}} 
                    onDelete={handleDeleteRating}
                    onBlock={handleBlockUser}
                    onUnblock={handleUnblockUser}
                    isBlocked={blockedUsers.includes(rating.userId)}
                    showAudit={true}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {(activeTab === 'licensing' || (activeTab === 'distilleries' && distilleryTab === 'licence')) && (
        <div className="bg-bg-card border border-border-subtle rounded-[24px] p-6 shadow-xl relative z-10 space-y-6 mt-4 animate-in slide-in-from-bottom-2 duration-300">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-gold-500">
              <ShieldAlert className="w-5 h-5" />
              <h2 className="font-bold text-lg">Upravljanje Licencama</h2>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              Odaberite destileriju iz baze kako biste generisali nove licence. Neophodno je direktno asocirati licencu za Registrovanu Destileriju pre generisanja radi bolje statistike. (Pojedinačne, nepotpisane licence više nisu dozvoljene).
            </p>
          </div>
          
          <div className="pt-4 border-t border-border-subtle max-w-2xl">
            <div className="space-y-4 border border-gold-500/30 bg-gold-500/[0.04] rounded-2xl p-4">
               <h3 className="text-xs font-black text-gold-500 uppercase tracking-widest">Generator Licenci & Slanje</h3>
               <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                 <p className="text-[11px] text-amber-200 leading-relaxed">
                   Spark plan: otvara se <span className="font-semibold">mail draft</span> sa licencama.
                   Isti tekst (tokeni + aktivacioni linkovi) automatski ide u <span className="font-semibold">clipboard</span> — nalepite u Zoho ako draft skrati telo poruke.
                 </p>
               </div>
               <div className="space-y-3 relative">
                  <div className="relative">
                     <input 
                       type="text" 
                       placeholder="Pretraga po nazivu proizvođača (npr. MVP Destilerija ili Vinarija X)" 
                       value={batchDistillery}
                       onChange={(e) => {
                         setBatchDistillery(e.target.value);
                         setLastGeneratedBatchTokens([]);
                       }}
                       className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-sm text-white"
                     />
                     {batchDistillery && distilleries.filter(d => d.name.toLowerCase().includes(batchDistillery.toLowerCase())).length > 0 && 
                      distilleries.find(d => d.name === batchDistillery) === undefined && (
                       <div className="absolute top-full left-0 right-0 bg-bg-card-elevated border border-border-subtle rounded-xl mt-1 shadow-2xl z-50 max-h-40 overflow-y-auto">
                         {distilleries
                           .filter(d => d.name.toLowerCase().includes(batchDistillery.toLowerCase()))
                           .map(d => (
                             <button
                               key={d.id}
                               type="button"
                               onClick={() => {
                                 setBatchDistillery(d.name);
                                 setBatchEmail(d.email || "");
                                 setLastGeneratedBatchTokens([]);
                                 
                                 // Pokušaj da prepozna datume sa najnovije licence ovog klijenta,
                                 // kako bi dodatne licence trajale identično!
                                 const distLicenses = licenses.filter(l => l.clientName === d.name);
                                 if (distLicenses.length > 0) {
                                   const latest = distLicenses.sort((a,b) => {
                                      const timeA = toMillis(a.createdAt);
                                      const timeB = toMillis(b.createdAt);
                                      return timeB - timeA;
                                   })[0];
                                   
                                   if (latest.startDate) {
                                      const millis = toMillis(latest.startDate);
                                      if (millis) setBatchStartDate(new Date(millis).toISOString().split('T')[0]);
                                   }
                                   if (latest.expiresAt) {
                                      const millis = toMillis(latest.expiresAt);
                                      if (millis) setBatchEndDate(new Date(millis).toISOString().split('T')[0]);
                                   }
                                 } else {
                                   // Default ukoliko nema istorijat licenci
                                   setBatchStartDate(new Date().toISOString().split('T')[0]);
                                   const nextYear = new Date();
                                   nextYear.setFullYear(nextYear.getFullYear() + 1);
                                   setBatchEndDate(nextYear.toISOString().split('T')[0]);
                                 }
                               }}
                               className="w-full text-left p-3 text-xs text-text-secondary hover:bg-gold-500 hover:text-black transition-colors border-b border-border-subtle last:border-0"
                             >
                               {d.name} ({d.email || "bez mejla"})
                             </button>
                           ))}
                       </div>
                     )}
                  </div>
                  
                  {distilleries.find(d => d.name === batchDistillery) && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-3 border border-green-500/30 bg-green-500/5 p-4 rounded-xl">
                      {(() => {
                        const selectedDist = distilleries.find(d => d.name === batchDistillery);
                        const lastRaw = selectedDist?.lastAppAccessAt;
                        const lastDate = hasToDate(lastRaw)
                          ? lastRaw.toDate?.() || null
                          : (lastRaw ? new Date(lastRaw as string | number | Date) : null);
                        return (
                          <p className="text-[10px] text-text-secondary">
                            Zadnji pristup aplikaciji:{" "}
                            <span className="text-white font-semibold">
                              {lastDate && !Number.isNaN(lastDate.getTime()) ? lastDate.toLocaleString('sr-RS') : "Nema podataka"}
                            </span>
                          </p>
                        );
                      })()}
                      <p className="text-xs text-green-500 font-bold mb-2 flex justify-between">
                         <span>✓ Klijent selektovan</span>
                         <span>Trenutno licenci u bazi: {licenses.filter(l => l.clientName === batchDistillery).length}</span>
                      </p>
                      <input 
                        type="email" 
                        placeholder="Email adresa klijenta" 
                        value={batchEmail}
                        onChange={(e) => setBatchEmail(e.target.value)}
                        className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-sm text-white"
                      />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-text-secondary ml-1 block mb-1">Početak važenja</label>
                          <input 
                            type="date"
                            value={batchStartDate}
                            onChange={(e) => setBatchStartDate(e.target.value)}
                            className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-sm text-white"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-text-secondary ml-1 block mb-1">Kraj važenja</label>
                          <input 
                            type="date"
                            value={batchEndDate}
                            onChange={(e) => setBatchEndDate(e.target.value)}
                            className="w-full bg-bg-card-elevated border border-border-subtle rounded-xl p-3 text-sm text-white"
                          />
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <select 
                          value={batchCount}
                          onChange={(e) => setBatchCount(Number(e.target.value))}
                          className="bg-bg-card-elevated border border-border-subtle rounded-xl px-4 text-sm text-white"
                        >
                          {[1,2,3,4,5,6,7,8,9,10,15,20].map(n => <option key={n} value={n}>{n} Licenci</option>)}
                        </select>
                        <button
                          onClick={handleBatchLicenses}
                          disabled={isGeneratingLicense}
                          className="flex-1 py-3 bg-gold-500 text-black font-black uppercase text-xs rounded-xl hover:bg-gold-400 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(218,165,32,0.3)]"
                        >
                          {isGeneratingLicense ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                          {isGeneratingLicense ? "Generisanje..." : "Generiši novi paket i Pošalji"}
                        </button>
                      </div>
                    </div>
                  )}
               </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-black text-gold-500 uppercase tracking-widest">
                  Globalni log licenci
                </h3>
                <span className="text-[10px] text-text-secondary">
                  Aktivne licence u upotrebi: {selectedLicenses.filter((l) => (l.activatedDevices?.length || 0) > 0).length}
                </span>
              </div>
              <p className="text-[10px] text-text-secondary">
                Tabela prikazuje samo licence koje se trenutno koriste (imaju bar jedan aktivan uređaj).
              </p>
              <input
                type="text"
                value={licenseLogSearch}
                onChange={(e) => setLicenseLogSearch(e.target.value)}
                placeholder="Find: token, destilerija..."
                className="w-full bg-bg-card-elevated border border-white/10 rounded-lg p-2.5 text-xs text-white focus:border-gold-500"
              />
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-[11px]">
                  <thead className="bg-bg-card-elevated text-text-secondary uppercase">
                    <tr>
                      <th className="text-left p-2.5">Token</th>
                      <th className="text-left p-2.5">Destilerija</th>
                      <th className="text-left p-2.5">Uređaji</th>
                      <th className="text-left p-2.5">Poslednji log</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...selectedLicenses]
                      .filter((lic) => (lic.activatedDevices?.length || 0) > 0)
                      .filter((lic) => {
                        const q = licenseLogSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          String(lic.token || "").toLowerCase().includes(q) ||
                          String(lic.clientName || "").toLowerCase().includes(q)
                        );
                      })
                      .sort((a, b) => Math.max(toMillis(b.usedAt), toMillis(b.deactivatedAt), toMillis(b.createdAt)) - Math.max(toMillis(a.usedAt), toMillis(a.deactivatedAt), toMillis(a.createdAt)))
                      .map((lic) => {
                        const usedAt = toMillis(lic.usedAt);
                        const deactivatedAt = toMillis(lic.deactivatedAt);
                        const createdAt = toMillis(lic.createdAt);
                        const lastTs = Math.max(usedAt, deactivatedAt, createdAt);
                        const lastLabel =
                          lastTs === usedAt && usedAt > 0 ? `Aktivacija (${lic.lastActivatedBy || "n/a"})` :
                          lastTs === deactivatedAt && deactivatedAt > 0 ? `Odjava (${lic.lastDeactivatedBy || "n/a"})` :
                          "Kreiranje";
                        return (
                          <tr key={`used-${lic.id}`} className="border-t border-white/5 bg-black/20">
                            <td className="p-2.5 font-mono text-white">{lic.token || lic.id}</td>
                            <td className="p-2.5 text-gold-500">{lic.clientName || "Nepoznato"}</td>
                            <td className="p-2.5 text-white">{lic.activatedDevices?.length || 0} / {lic.maxDevices || 3}</td>
                            <td className="p-2.5 text-text-secondary">
                              {lastLabel} {lastTs > 0 ? `• ${new Date(lastTs).toLocaleString('sr-RS')}` : ""}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {selectedLicenses.filter((lic) => (lic.activatedDevices?.length || 0) > 0).length === 0 && (
                  <p className="text-center py-4 text-xs italic text-text-secondary">Nijedna licenca trenutno nije u upotrebi.</p>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-black text-text-secondary uppercase tracking-widest">Aktivne i iskoriscene licence</h3>
              <p className="text-[10px] text-text-secondary mt-1 max-w-2xl leading-relaxed">
                Ako ste generisali paket od više licenci, <strong className="text-white">svaka kartica ima svoj drugačiji</strong> <code className="text-gold-500">lic_…</code> token.
                Klijent mora aktivirati baš onaj koji piše na njegovoj stranici u PDF-u — ili neka koristi „Kopiraj aktivacioni link“ sa odgovarajuće kartice.
              </p>
            </div>
            {!selectedDistilleryName ? (
               <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed border-border-subtle rounded-xl bg-black/20">
                 <ShieldAlert className="w-8 h-8 text-gold-500/50 mb-3" />
                 <p className="text-sm font-bold text-white text-center">Nijedna aktivna destilerija nije selektovana.</p>
                 <p className="text-xs text-text-secondary text-center max-w-sm mt-2">
                   Izaberite aktivnu destileriju u vrhu stranice. Kada je izaberete, ovde se prikazuju samo njene licence.
                 </p>
               </div>
            ) : (
            <div className="grid gap-3">
              {[...selectedLicenses].sort((a,b) => {
                const timeA = toMillis(a.createdAt);
                const timeB = toMillis(b.createdAt);
                return timeB - timeA;
              }).map(lic => {
                const isLicenseUsed = (lic.activatedDevices?.length || 0) > 0 || lic.isUsed === true;
                return (
                <div key={lic.id} className={`p-4 rounded-xl border ${isLicenseUsed ? 'bg-black/20 border-border-subtle opacity-60' : 'bg-bg-card-elevated border-gold-500/30'} flex flex-col gap-3 transition-all`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs font-black text-white font-mono tracking-tighter">{lic.token}</p>
                      <p className="text-[10px] text-gold-500 font-bold uppercase">{lic.clientName || 'Pojedinačna'}</p>
                      <p className="text-[10px] text-text-secondary mt-1 uppercase">{lic.comment}</p>
                      <p className="text-[9px] text-text-secondary mt-1">
                        {lic.startDate && `Vazi od: ${new Date(toMillis(lic.startDate)).toLocaleDateString('sr-RS')}`}
                        {lic.expiresAt && ` do: ${new Date(toMillis(lic.expiresAt)).toLocaleDateString('sr-RS')}`}
                      </p>
                    </div>
                    <div className={`px-2 py-1 rounded text-[10px] font-black uppercase ${isLicenseUsed ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
                      {isLicenseUsed ? 'Iskorišćena' : 'Slobodna'}
                    </div>
                  </div>
                  
                  {!isLicenseUsed && (
                    <div className="pt-2 border-t border-white/5 flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                         <p className="text-[10px] text-text-secondary">Uređaji: <span className="text-gold-500 font-bold">{lic.activatedDevices?.length || 0} / {lic.maxDevices || 3}</span></p>
                         <button 
                           onClick={() => handleUpdateDeviceLimit(lic.id, lic.maxDevices || 3)}
                           className="text-[9px] text-gold-500 px-2 py-1 border border-gold-500/30 rounded-md hover:bg-gold-500 hover:text-black transition-all font-bold"
                         >
                            Dodaj uređaje (+)
                         </button>
                      </div>
                      <p className="text-[10px] text-text-secondary">Link za aktivaciju (QR kod):</p>
                      <div className="bg-white p-2 rounded-lg w-24 h-24 mx-auto">
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(window.location.origin + '/activate?token=' + lic.token)}`} 
                          alt="QR Code" 
                          className="w-full h-full"
                        />
                      </div>
                      <button 
                        onClick={() => {
                          const link = window.location.origin + '/activate?token=' + lic.token;
                          navigator.clipboard.writeText(link);
                          alert("Aktivacioni link kopiran!");
                        }}
                        className="text-[10px] text-gold-500 hover:underline text-center font-bold"
                      >
                        Kopiraj aktivacioni link
                      </button>
                    </div>
                  )}
                  
                  <div className="text-[10px] text-text-secondary space-y-1 pt-2 border-t border-white/5">
                    <p>
                      Vlasnik licence:{" "}
                      <span className="text-white font-semibold">{lic.clientName || "Nepoznato"}</span>
                    </p>
                    <p>
                      Aktivni uređaji:{" "}
                      <span className="text-gold-500 font-bold">{lic.activatedDevices?.length || 0} / {lic.maxDevices || 3}</span>
                    </p>
                    <p>
                      Zadnja aktivacija:{" "}
                      <span className="text-white font-mono">{lic.lastActivatedBy || "nema"}</span>
                      {" • "}
                      <span className="text-white">
                        {hasToDate(lic.usedAt)
                          ? lic.usedAt.toDate?.()?.toLocaleString('sr-RS')
                          : (lic.usedAt ? String(lic.usedAt) : "nema")}
                      </span>
                    </p>
                    <p>
                      Zadnja odjava:{" "}
                      <span className="text-white font-mono">{lic.lastDeactivatedBy || "nema"}</span>
                      {" • "}
                      <span className="text-white">
                        {hasToDate(lic.deactivatedAt)
                          ? lic.deactivatedAt.toDate?.()?.toLocaleString('sr-RS')
                          : (lic.deactivatedAt ? String(lic.deactivatedAt) : "nema")}
                      </span>
                    </p>
                  </div>
                  
                  {confirmDeleteLicenseId === lic.id ? (
                    <div className="flex justify-end gap-2 mt-2 border-t border-white/5 pt-2">
                       <button 
                         onClick={() => setConfirmDeleteLicenseId(null)}
                         className="px-2 py-1 text-[10px] text-text-secondary hover:text-white"
                       >
                         Odustani
                       </button>
                       <button 
                         onClick={async () => {
                           try {
                             await deleteDoc(doc(db, 'licenses', lic.id));
                             setConfirmDeleteLicenseId(null);
                             fetchLicenses();
                          } catch (e: unknown) {
                            alert("Greška pri brisanju: " + ((e as { message?: string } | null)?.message || "Nepoznata greška"));
                           }
                         }}
                         className="px-2 py-1 text-[10px] font-bold bg-red-500/20 text-red-500 rounded hover:bg-red-500 hover:text-white transition-colors"
                       >
                         Potvrdi brisanje
                       </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setConfirmDeleteLicenseId(lic.id)}
                      className="self-end text-red-500/50 hover:text-red-500 transition-colors mt-2"
                      title="Obriši licencu"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )})}
              {licenses.filter(lic => lic.clientName === batchDistillery).length === 0 && (
                <p className="text-center py-8 text-sm italic text-text-secondary border border-dashed border-border-subtle rounded-xl bg-black/20">Ova destilerija još uvek nema generisanih licenci.</p>
              )}
            </div>
            )}
          </div>
        </div>
      )}
      
      {analyticsDistillery && (
        <DistilleryAnalyticsModal 
          distillery={analyticsDistillery} 
          onClose={() => setAnalyticsDistillery(null)} 
        />
      )}

      {distilleryToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-bg-card border border-red-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative">
            <h3 className="text-xl font-bold text-white mb-2">Brisanje destilerije</h3>
            <p className="text-text-secondary text-sm mb-6 leading-relaxed">
              Oprez! Brisanjem destilerije <span className="text-white font-bold">trajno</span> brišete i sve rakije koje su povezane sa njom. Ova akcija je nepovratna.
            </p>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setDistilleryToDelete(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border-subtle text-white font-medium hover:bg-bg-card-elevated transition-colors"
              >
                Otkaži
              </button>
              <button 
                onClick={() => handleDeleteDistillery(distilleryToDelete)}
                disabled={isSavingManual}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold hover:bg-red-500 transition-colors shadow-[0_0_20px_rgba(220,38,38,0.4)] flex items-center justify-center gap-2"
              >
                {isSavingManual ? <Loader2 className="w-4 h-4 animate-spin" /> : "Obriši sve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-bg-card border border-border-subtle rounded-2xl p-6 max-w-sm w-full shadow-2xl relative">
            <h3 className="text-xl font-bold text-white mb-2">Brisanje rakije</h3>
            <p className="text-text-secondary text-sm mb-6">Da li ste sigurni da želite trajno da obrišete ovu rakiju iz sistema?</p>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setProductToDelete(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border-subtle text-white font-medium hover:bg-bg-card-elevated transition-colors"
              >
                Odustani
              </button>
              <button 
                onClick={() => handleDeleteProduct(productToDelete)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-400 transition-colors shadow-[0_0_15px_rgba(239,68,68,0.3)]"
              >
                Obriši trajno
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function RatingCard({
  rating,
  onApprove,
  onDelete,
  onBlock,
  onUnblock,
  isBlocked,
  showAudit = false,
}: {
  rating: RatingRow;
  onApprove: (id: string) => void;
  onDelete: (id: string) => void;
  onBlock: (id: string) => void;
  onUnblock: (id: string) => void;
  isBlocked: boolean;
  showAudit?: boolean;
}) {
  return (
    <div className={`bg-bg-card-elevated border border-white/5 rounded-2xl p-4 space-y-3 transition-opacity ${isBlocked ? 'opacity-50 ring-1 ring-red-500/20' : ''}`}>
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-gold-500 uppercase tracking-widest">{rating.productName || "Nepoznat proizvod"}</span>
            {rating.isFlagged && <Flag className="w-3 h-3 text-red-500" />}
            {isBlocked && <span className="text-[8px] bg-red-500 text-white px-1 rounded font-black italic">BAN</span>}
          </div>
          <div className="flex items-center gap-2 text-[9px] text-text-secondary font-mono">
            <span className="text-white/40">ID: {(rating.userId || "").slice(0, 8)}</span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span>{rating.userLocation || "Lokacija nepoznata"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gold-500/10 px-2 py-1 rounded-md border border-gold-500/20">
          <Star className="w-3 h-3 text-gold-500 fill-current" />
          <span className="text-xs font-black text-gold-500">{rating.rating}</span>
        </div>
      </div>
      
      {rating.reviewText && (
        <div className="p-3 bg-black/40 rounded-xl italic text-text-primary text-sm border border-white/5">
          "{rating.reviewText}"
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <div className="text-[9px] text-text-secondary">
          {rating.createdAt?.toDate?.()?.toLocaleString() || "Pre par trenutaka"}
        </div>
        <div className="flex gap-2">
          {rating.isFlagged && (
            <button 
              onClick={() => onApprove(rating.id)}
              className="px-3 py-1.5 bg-green-600/20 text-green-500 text-[10px] font-bold uppercase rounded-lg border border-green-500/30 hover:bg-green-600 hover:text-white transition-colors"
            >
              Odobri
            </button>
          )}
          {isBlocked ? (
             <button 
              onClick={() => onUnblock && onUnblock(rating.userId)}
              className="px-3 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold uppercase rounded-lg hover:bg-blue-600 hover:text-white transition-colors"
            >
              Odblokiraj
            </button>
          ) : (
            <button 
              onClick={() => onBlock(rating.userId)}
              disabled={!rating.userId || rating.userId === 'anonymous'}
              className="px-3 py-1.5 bg-red-600/10 text-red-500/50 border border-red-500/20 text-[10px] font-bold uppercase rounded-lg hover:bg-red-600 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Blokiraj User-a
            </button>
          )}
          <button 
            onClick={() => onDelete(rating.id)}
            className="px-3 py-1.5 bg-red-600/20 text-red-500 border border-red-500/30 text-[10px] font-bold uppercase rounded-lg hover:bg-red-600 hover:text-white transition-colors"
          >
            Obriši
          </button>
        </div>
      </div>
    </div>
  );
}
