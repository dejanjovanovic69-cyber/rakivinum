import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate } from "react-router-dom";
import MobileLayout from "./components/layout/MobileLayout";
import React, { Suspense, lazy, useEffect, useState, useCallback } from "react";
import AgeGate, { hasAgeGateConsent } from "./components/AgeGate";
import { auth } from "./lib/firebase";
import { ShieldAlert, QrCode } from "lucide-react";
import NotificationSystem from "./components/NotificationSystem";
import PwaManager from "./components/PwaManager";
import { isSuperuserEmail } from "./lib/authz";
import { extractActivateTokenFromInput, isLicensedLocalStorage } from "./lib/extractActivateToken";
import { initPresenceTracking } from "./lib/presence";
import { DiagnosticRouteGate } from "./lib/routeDiagnostics";
import { isQuotaSaverActive } from "./lib/quotaSaver";
import { getSavedReadsToday } from "./lib/requestMeter";

const Home = lazy(() => import("./pages/Home"));
const Workshop = lazy(() => import("./pages/Workshop"));
const Scanner = lazy(() => import("./pages/Scanner"));
const Community = lazy(() => import("./pages/Community"));
const Menu = lazy(() => import("./pages/Menu"));
const MojaRiznica = lazy(() => import("./pages/MojaRiznica"));
const Label = lazy(() => import("./pages/Label"));
const Admin = lazy(() => import("./pages/Admin"));
const Distillery = lazy(() => import("./pages/Distillery"));
const DistilleryDashboard = lazy(() => import("./pages/DistilleryDashboard"));
const ProductAnalytics = lazy(() => import("./pages/ProductAnalytics"));
const AdminAudit = lazy(() => import("./pages/AdminAudit"));
const Activate = lazy(() => import("./pages/Activate"));
const MyClubs = lazy(() => import("./pages/MyClubs"));
const Distilleries = lazy(() => import("./pages/Distilleries"));
const TonightRecommendations = lazy(() => import("./pages/TonightRecommendations"));
const PublicRiznica = lazy(() => import("./pages/PublicRiznica"));

// Initialize Visitor ID immediately before anything renders
if (typeof window !== 'undefined' && !localStorage.getItem('rakivinum_visitor_id')) {
  const newVisitorId = 'v_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('rakivinum_visitor_id', newVisitorId);
}

// The LicenseGuard now acts as a "soft" gate only for specific premium routes
function LicenseGuard({ children }: { children: React.ReactNode }) {
  const [isLicensed, setIsLicensed] = useState<boolean | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteErr, setPasteErr] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkLicense = () => {
      // Super admin is always licensed
      if (isSuperuserEmail(auth.currentUser?.email)) {
        setIsLicensed(true);
        return;
      }

      setIsLicensed(isLicensedLocalStorage());
    };

    checkLicense();
    window.addEventListener('storage', checkLicense);
    window.addEventListener('rakivinum_license_changed', checkLicense);
    const unsub = auth.onAuthStateChanged(checkLicense);

    return () => {
      window.removeEventListener('storage', checkLicense);
      window.removeEventListener('rakivinum_license_changed', checkLicense);
      unsub();
    };
  }, []);

  const goActivateFromPaste = () => {
    setPasteErr(null);
    const token = extractActivateTokenFromInput(paste);
    if (!token) {
      setPasteErr("Nije prepoznat token. Nalepite pun link (…/activate?token=…) ili sam token (lic_…).");
      return;
    }
    navigate(`/activate?token=${encodeURIComponent(token)}`);
  };

  if (isLicensed === null) return null;

  if (!isLicensed) {
    return (
      <div className="min-h-screen bg-bg-base text-white flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-gold-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-gold-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-sm w-full card-soft card-elevated border border-border-subtle rounded-[32px] p-8 shadow-2xl relative z-10 space-y-5 text-center">
          <div className="w-20 h-20 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto border border-gold-500/15">
            <ShieldAlert className="w-10 h-10 text-gold-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-black uppercase tracking-tight italic text-white">Premium pristup</h1>
            <p className="text-text-secondary text-sm leading-relaxed">
              Otključajte licencu: nalepite link iz PDF-a / mejla, ili skenirajte QR na tabu „Skeniraj“ (telefon). Na računaru najlakše je nalepiti link ispod.
            </p>
          </div>

          <div className="space-y-3 text-left">
            <label className="block eyebrow-label text-gold-500/90">Link ili token</label>
            <textarea
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                setPasteErr(null);
              }}
              rows={4}
              placeholder="https://…/activate?token=lic_…"
              className="w-full rounded-xl border border-white/10 bg-bg-base p-3 text-sm text-white placeholder:text-text-secondary/50 focus:border-gold-500/50 focus:outline-none resize-y min-h-[88px] focus-visible:ring-2 focus-visible:ring-gold-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
              autoComplete="off"
            />
            {pasteErr && <p className="text-xs text-red-400 leading-snug">{pasteErr}</p>}
            <button
              type="button"
              onClick={goActivateFromPaste}
              className="w-full py-4 btn-primary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            >
              Nastavi aktivaciju
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-bg-card/40 p-4 flex items-start gap-3 text-left">
            <QrCode className="w-6 h-6 text-gold-500 shrink-0 mt-0.5" aria-hidden />
            <p className="text-xs text-text-secondary leading-snug font-medium">
              Alternativa: tab „Skeniraj“ — QR sa licence vodi direktno na aktivaciju.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => navigate("/scan")}
              className="w-full py-2.5 btn-tertiary text-[11px] normal-case font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            >
              Otvori skener
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full py-2 btn-tertiary text-[11px] normal-case font-medium opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            >
              Nazad na besplatni sadržaj
            </button>
          </div>

          <div className="pt-2 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 text-gold-500/50">
              <span className="w-8 h-[1px] bg-current" aria-hidden />
              <span className="ui-pill text-gold-500/70 tracking-[0.14em]">Rakivinum Mreža</span>
              <span className="w-8 h-[1px] bg-current" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function readQuotaBadgeOptIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("rakivinum_show_quota_badge") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const [ageOk, setAgeOk] = useState(hasAgeGateConsent);
  const [quotaSaverOn, setQuotaSaverOn] = useState(() => isQuotaSaverActive());
  const [savedReadsToday, setSavedReadsToday] = useState(() => getSavedReadsToday());
  const onAgeConfirmed = useCallback(() => setAgeOk(true), []);

  useEffect(() => {
    return initPresenceTracking();
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      setQuotaSaverOn(isQuotaSaverActive());
      setSavedReadsToday(getSavedReadsToday());
    }, 5000);
    return () => window.clearInterval(id);
  }, []);
  /**
   * Bedz je INTERNI pokazatelj potrosnje, ne informacija za korisnika: „Saved: 0 today“
   * krajnjem korisniku ne znaci nista, a stoji preko donje navigacije (prekriva
   * „Radionica“ i „Meni“). Zato se u produkciji vidi samo uz izricit prekidac:
   *   localStorage.setItem("rakivinum_show_quota_badge", "1")
   */
  const showQuotaBadge = import.meta.env.DEV || (quotaSaverOn && readQuotaBadgeOptIn());
  const savedPretty = savedReadsToday >= 1000 ? `${(savedReadsToday / 1000).toFixed(1)}k` : String(savedReadsToday);

  if (!ageOk) {
    return <AgeGate onConfirmed={onAgeConfirmed} />;
  }

  const routeFallback = (
    <div className="min-h-screen bg-bg-base flex items-center justify-center text-text-secondary text-sm">
      Učitavanje...
    </div>
  );

  return (
    <Router>
      <NotificationSystem />
      <PwaManager />
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path="/activate" element={<DiagnosticRouteGate><Activate /></DiagnosticRouteGate>} />
          <Route path="/admin" element={<DiagnosticRouteGate><Admin /></DiagnosticRouteGate>} />

          {/* PUBLIC ROUTES - NO BURDEN (VITE_DISABLED_ROUTES isključuje pojedine putanje bez menjanja koda) */}
          <Route path="/" element={<MobileLayout />}>
            <Route index element={<DiagnosticRouteGate><Home /></DiagnosticRouteGate>} />
            <Route path="scan" element={<DiagnosticRouteGate><Scanner /></DiagnosticRouteGate>} />
            <Route path="radionica" element={<DiagnosticRouteGate><Workshop /></DiagnosticRouteGate>} />
            <Route path="community" element={<DiagnosticRouteGate><Community /></DiagnosticRouteGate>} />
            <Route path="menu" element={<DiagnosticRouteGate><Menu /></DiagnosticRouteGate>} />
            <Route path="my-clubs" element={<DiagnosticRouteGate><MyClubs /></DiagnosticRouteGate>} />
            <Route path="distilleries" element={<DiagnosticRouteGate><Distilleries /></DiagnosticRouteGate>} />
            <Route path="collection" element={<Navigate to="/moja-riznica" replace />} />
            <Route path="moja-riznica" element={<DiagnosticRouteGate><MojaRiznica /></DiagnosticRouteGate>} />
          </Route>

          {/* Public Full screen routes */}
          <Route path="/label/:id" element={<DiagnosticRouteGate><Label /></DiagnosticRouteGate>} />
          <Route path="/distillery/:id" element={<DiagnosticRouteGate><Distillery /></DiagnosticRouteGate>} />
          <Route path="/tonight" element={<DiagnosticRouteGate><TonightRecommendations /></DiagnosticRouteGate>} />
          <Route path="/riznica/:uid" element={<DiagnosticRouteGate><PublicRiznica /></DiagnosticRouteGate>} />
          <Route path="/public/riznica/:uid" element={<DiagnosticRouteGate><PublicRiznica /></DiagnosticRouteGate>} />

          {/* Professional/B2B routes */}
          <Route
            path="/distillery-dashboard"
            element={
              <DiagnosticRouteGate>
                <LicenseGuard>
                  <DistilleryDashboard />
                </LicenseGuard>
              </DiagnosticRouteGate>
            }
          />
          <Route
            path="/product-analytics/:id"
            element={
              <DiagnosticRouteGate>
                <LicenseGuard>
                  <ProductAnalytics />
                </LicenseGuard>
              </DiagnosticRouteGate>
            }
          />
          <Route
            path="/admin-audit"
            element={
              <DiagnosticRouteGate>
                <LicenseGuard>
                  <AdminAudit />
                </LicenseGuard>
              </DiagnosticRouteGate>
            }
          />
        </Routes>
      </Suspense>
      {showQuotaBadge && (
        <div className="pointer-events-none fixed bottom-24 right-3 z-[120] rounded-full border border-gold-500/30 bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-gold-300">
          Saved: {savedPretty} today
        </div>
      )}
    </Router>
  );
}
