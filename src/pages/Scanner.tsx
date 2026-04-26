import { QrCode, Camera, Loader2, MapPin, Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { db } from "../lib/firebase";
import { query, where, getDocs, collection, limit } from "firebase/firestore";
import { fetchPublicProductByBarcodeLookup, fetchPublicProducts, fetchScannerProductById } from "../lib/dataService";
import { extractActivateTokenFromInput } from '../lib/extractActivateToken';
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import { logProductScan } from "../lib/logProductScan";
import { meterDbRead } from "../lib/requestMeter";
import { CACHE_TTL } from "../lib/cachePolicy";

type PendingRatingEntry = {
  id: string;
  name: string;
  timestamp: number;
};

type ProductLookupData = {
  name?: unknown;
  distilleryId?: string;
  type?: string;
  isArchivedByDistillery?: boolean;
  publicLabelDisabled?: boolean;
  barcode?: unknown;
  barcodeNormalized?: unknown;
};

type DetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<DetectorResult[]>;
};
type BarcodeDetectorStatic = {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

export default function Scanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const detectLoopRef = useRef<number | null>(null);
  const lastDetectAtRef = useRef(0);
  const scanLockRef = useRef(false);
  const normalizeBarcode = (value: unknown) => String(value || "").replace(/\D/g, "");
  const safeText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      const city = typeof o.city === "string" ? o.city.trim() : "";
      const address = typeof o.address === "string" ? o.address.trim() : "";
      if (city || address) return [city, address].filter(Boolean).join(", ");
    }
    return "";
  };
  const updatePendingQueue = (entry: PendingRatingEntry) => {
    localStorage.setItem('rakivinum_pending_rating', JSON.stringify(entry));
    try {
      const queueRaw = localStorage.getItem('rakivinum_pending_ratings') || '[]';
      const queue = JSON.parse(queueRaw);
      const safeQueue: PendingRatingEntry[] = Array.isArray(queue)
        ? queue.filter((x): x is PendingRatingEntry => !!x && typeof x.id === "string" && typeof x.name === "string" && typeof x.timestamp === "number")
        : [];
      const withoutSame = safeQueue.filter((x) => x.id !== entry.id);
      withoutSame.unshift(entry);
      localStorage.setItem('rakivinum_pending_ratings', JSON.stringify(withoutSame.slice(0, 20)));
      window.dispatchEvent(new Event('rakivinum_pending_ratings_changed'));
    } catch (e) {
      console.error("Failed to update pending ratings queue", e);
    }
  };


  useEffect(() => {
    const checkBarcodeSupport = async () => {
      try {
        const detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorStatic }).BarcodeDetector;
        if (!detector?.getSupportedFormats) {
          setScannerHint("Vaš browser može biti ograničen za klasične barkodove. QR obično radi pouzdano.");
          return;
        }
        const supported: string[] = await detector.getSupportedFormats();
        const hasLinear = supported.some((f) => ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"].includes(String(f)));
        if (!hasLinear) {
          setScannerHint("Na ovom uređaju/browseru linearni barkod možda nije podržan. Probajte noviji Chrome na telefonu.");
        }
      } catch {
        // Best effort hint only.
      }
    };
    checkBarcodeSupport();
  }, []);

  useEffect(() => {
    const startScanner = async () => {
      if (!videoRef.current) return;

      try {
        const constraints = {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            advanced: [{ focusMode: "continuous" }, { torch: false }] as unknown as MediaTrackConstraintSet[],
          },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
        mediaStreamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorStatic }).BarcodeDetector;
        if (Detector) {
          detectorRef.current = new Detector({
            formats: ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"],
          });

          const detectLoop = async () => {
            if (!videoRef.current || !detectorRef.current) return;
            detectLoopRef.current = requestAnimationFrame(detectLoop);
            if (scanLockRef.current) return;

            const now = performance.now();
            if (now - lastDetectAtRef.current < 20) return;
            lastDetectAtRef.current = now;

            try {
              const results = await detectorRef.current.detect(videoRef.current);
              const first = results?.[0];
              const value = String(first?.rawValue || "").trim();
              if (value) {
                scanLockRef.current = true;
                void handleScanSuccess(value).finally(() => {
                  setTimeout(() => (scanLockRef.current = false), 220);
                });
              }
            } catch (err) {
              // ignore per-frame detector errors
            }
          };

          detectLoopRef.current = requestAnimationFrame(detectLoop);
          return;
        }

        // Fallback for older browsers without BarcodeDetector.
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
        ]);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 10,
        });
        readerRef.current = reader;

        const decodeCb = (result: { getText: () => string } | null, err: unknown) => {
          if (result && !scanLockRef.current) {
            scanLockRef.current = true;
            void handleScanSuccess(result.getText()).finally(() => {
              setTimeout(() => {
                scanLockRef.current = false;
              }, 220);
            });
            return;
          }
          if (err && !(err instanceof NotFoundException)) {
            console.warn("ZXing decode warning:", err);
          }
        };

        const readerWithConstraints = reader as BrowserMultiFormatReader & {
          decodeFromConstraints?: (
            constraints: MediaStreamConstraints,
            videoElement: HTMLVideoElement,
            callback: (result: { getText: () => string } | null, err: unknown) => void
          ) => Promise<void>;
        };

        if (typeof readerWithConstraints.decodeFromConstraints === "function") {
          await readerWithConstraints.decodeFromConstraints(constraints, videoRef.current, decodeCb);
        } else {
          const devices = await BrowserMultiFormatReader.listVideoInputDevices();
          const preferred =
            devices.find((d) => /back|rear|environment|zadnja/i.test(d.label || "")) ||
            devices[0];
          if (!preferred?.deviceId) {
            setError("Kamera nije pronađena na uređaju.");
            return;
          }
          await reader.decodeFromVideoDevice(preferred.deviceId, videoRef.current, decodeCb);
        }
      } catch (e) {
        console.error("ZXing scanner init error:", e);
        setError("Kamera nije dostupna. Proverite dozvolu kamere u browseru i osvežite stranicu.");
      }
    };

    startScanner();

    return () => {
      try {
        if (detectLoopRef.current) {
          cancelAnimationFrame(detectLoopRef.current);
        }
        const r = readerRef.current as BrowserMultiFormatReader & { reset?: () => void };
        r?.reset?.();
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore cleanup issues
      }
    };
  }, []);

  const handleScanSuccess = async (scannedText: string) => {
    if (!scannedText || typeof scannedText !== "string") {
      setError("QR kod je očitan, ali format nije podržan. Pokušajte ponovo.");
      return;
    }
    if (isScanning) return; // Prevent double trigger
    setIsScanning(true);
    setError(null);

    const st = scannedText.trim();
    const licenseTok = extractActivateTokenFromInput(st);
    if (
      licenseTok &&
      (st.includes('/activate') || st.includes('token=') || /^lic_/i.test(licenseTok))
    ) {
      navigate(`/activate?token=${encodeURIComponent(licenseTok)}`);
      setIsScanning(false);
      return;
    }

    try {
      // In a real app, the QR code might be a full URL (e.g. https://app.com/label/123)
      let productId = scannedText;
      if (scannedText.includes('/label/')) {
        const parts = scannedText.split('/label/');
        const rawPart = parts[parts.length - 1] || "";
        productId = rawPart.split(/[?#]/)[0] || rawPart;
      }
      productId = decodeURIComponent(String(productId || "").trim());

      // Check if product exists by ID first (Worker-first when edge returns public item; else jedan getDoc)
      const productRow = await fetchScannerProductById(productId);

      let finalProductId = "";
      let finalProductData: ProductLookupData | null = null;

      if (productRow) {
        finalProductId = productRow.id;
        finalProductData = productRow as ProductLookupData;
      } else {
        const scannedBarcode = normalizeBarcode(scannedText);

        const edgeBarcodeHit = await fetchPublicProductByBarcodeLookup(scannedBarcode, st);
        if (edgeBarcodeHit) {
          finalProductId = edgeBarcodeHit.id;
          finalProductData = edgeBarcodeHit as ProductLookupData;
        }

        // Preferred lookup: normalized barcode (fast + format-safe)
        if (!finalProductId && scannedBarcode) {
          const qNorm = query(collection(db, "products"), where("barcodeNormalized", "==", scannedBarcode), limit(5));
          const normSnap = await getDocs(qNorm);
          meterDbRead("scanner:barcode_normalized_lookup", normSnap.size);
          if (!normSnap.empty) {
            finalProductId = normSnap.docs[0].id;
            finalProductData = normSnap.docs[0].data();
          }
        }

        // Fallback A: some records keep digits in raw `barcode` field.
        if (!finalProductId && scannedBarcode) {
          const qDigits = query(collection(db, "products"), where("barcode", "==", scannedBarcode), limit(5));
          const digitsSnap = await getDocs(qDigits);
          meterDbRead("scanner:barcode_digits_lookup", digitsSnap.size);
          if (!digitsSnap.empty) {
            finalProductId = digitsSnap.docs[0].id;
            finalProductData = digitsSnap.docs[0].data();
          }
        }

        // Fallback B: exact raw text match (legacy records / QR payloads).
        // Skip when raw text is the same as digit-only barcode to avoid duplicate query.
        if (!finalProductId && (!scannedBarcode || st !== scannedBarcode)) {
          const q = query(collection(db, "products"), where("barcode", "==", st), limit(5));
          const querySnapshot = await getDocs(q);
          meterDbRead("scanner:barcode_raw_lookup", querySnapshot.size);
          
          if (!querySnapshot.empty) {
            finalProductId = querySnapshot.docs[0].id;
            finalProductData = querySnapshot.docs[0].data();
          }
        }

        if (!finalProductId) {
          // Robust fallback: normalize barcode and match client-side.
          // Handles values like "860-123 4567890", numeric Firestore fields, etc.
          if (scannedBarcode) {
            const catalog = await fetchPublicProducts({
              limitCount: 900,
              cacheKey: "rakivinum_cache_scanner_barcode_fallback_v1",
              ttlMs: CACHE_TTL.PRODUCTS_6H,
            });
            const hit = catalog.find((row) => {
              const data = row as ProductLookupData;
              return normalizeBarcode(data.barcodeNormalized || data.barcode) === scannedBarcode;
            });
            if (hit?.id) {
              finalProductId = hit.id;
              finalProductData = hit as ProductLookupData;
            }
          }
        }
      }

      if (!finalProductId) {
        setError("Proizvod nije pronađen u sistemu.");
        setIsScanning(false);
        return;
      }
      if (finalProductData?.isArchivedByDistillery) {
        setError("Ovaj proizvod je trenutno nedostupan.");
        setIsScanning(false);
        return;
      }
      if (finalProductData?.publicLabelDisabled === true) {
        setError("Javni pristup ovoj etiketi je isključen od strane proizvođača.");
        setIsScanning(false);
        return;
      }

      // Navigate immediately for fast UX; logging runs in background.
      const pName = safeText(finalProductData?.name) || "Piće";
      const pendingEntry = {
        id: finalProductId,
        name: pName,
        timestamp: Date.now()
      };
      updatePendingQueue(pendingEntry);
      setIsScanning(false);
      const returnTo = `${location.pathname}${location.search}`;
      try {
        sessionStorage.setItem("rakivinum_last_label_return_v1", returnTo);
      } catch {
        // ignore storage errors
      }
      navigate(`/label/${finalProductId}?rt=${encodeURIComponent(returnTo)}`, {
        state: { fromInAppScanner: true, returnTo },
      });
      void logProductScan(finalProductId, finalProductData, "barcode_scan");
    } catch (err: unknown) {
      console.error("Scan processing error", err);
      setError("Greška pri obradi skeniranja.");
      setIsScanning(false);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 space-y-8 animate-in fade-in duration-500 relative">
      <div className="absolute top-[-20%] right-[-30%] w-[400px] h-[400px] pointer-events-none" style={{ background: 'radial-gradient(circle, var(--color-gold-glow) 0%, transparent 70%)' }} />
      
      <div className="text-center space-y-2 relative z-10">
        <h2 className="font-serif italic text-3xl text-gold-400 tracking-wider">Skeniraj Rakiju ili Vino</h2>
        <p className="text-text-secondary text-sm px-4">Uperi kameru u QR kod ili klasičan bar-kod na boci.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-400 text-xs flex items-center gap-3 animate-in fade-in zoom-in-95 relative z-20 mx-6">
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
            <X className="w-4 h-4" />
          </div>
          <p className="font-medium">{error}</p>
        </div>
      )}

      <div className="relative w-72 h-72 border-2 border-gold-500/20 rounded-[40px] flex items-center justify-center group z-10 bg-bg-card shadow-2xl overflow-hidden card-elevated">
        <span className="absolute -top-1 -left-1 w-12 h-12 border-t-2 border-l-2 border-gold-500 rounded-tl-[40px] opacity-70 z-20 pointer-events-none"></span>
        <span className="absolute -top-1 -right-1 w-12 h-12 border-t-2 border-r-2 border-gold-500 rounded-tr-[40px] opacity-70 z-20 pointer-events-none"></span>
        <span className="absolute -bottom-1 -left-1 w-12 h-12 border-b-2 border-l-2 border-gold-500 rounded-bl-[40px] opacity-70 z-20 pointer-events-none"></span>
        <span className="absolute -bottom-1 -right-1 w-12 h-12 border-b-2 border-r-2 border-gold-500 rounded-br-[40px] opacity-70 z-20 pointer-events-none"></span>
        
        <div className="w-full h-full bg-bg-base rounded-[36px] flex flex-col items-center justify-center relative overflow-hidden">
           
           {!isScanning ? (
             <div className="w-full h-full absolute inset-0">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                style={{ filter: "brightness(0.96) contrast(1.15) saturate(1.02)" }}
                muted
                playsInline
                autoPlay
              />
               <div className="absolute inset-0 z-10 border-[16px] border-bg-base rounded-[36px] pointer-events-none" />
             </div>
           ) : (
             <div className="flex flex-col items-center gap-3 text-gold-500 animate-pulse z-20">
               <Loader2 className="w-10 h-10 animate-spin" />
               <p className="text-xs font-bold tracking-widest uppercase">Povezivanje...</p>
             </div>
           )}

           {/* Animated scanning line overlay */}
           {!isScanning && (
             <div className={`absolute top-0 w-full h-[2px] bg-gold-400 shadow-[0_0_15px_3px_rgba(212,175,55,0.6)] animate-[scan_3s_ease-in-out_infinite] z-20 pointer-events-none`} />
           )}
        </div>
      </div>

      {scannerHint && (
        <p className="text-[11px] text-yellow-400/80 text-center max-w-xs -mt-4">{scannerHint}</p>
      )}

      <style>{`
        @keyframes scan {
          0% { top: 10%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 90%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
