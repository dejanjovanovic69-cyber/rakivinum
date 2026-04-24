import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FirebaseError } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, db } from "../lib/firebase";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Loader2, CheckCircle, ShieldAlert, Rocket } from "lucide-react";
import { extractActivateTokenFromInput, normalizeLicenseToken } from "../lib/extractActivateToken";

function getFirebaseErrorDetails(err: unknown): { code: string; message: string } {
  if (err instanceof FirebaseError) {
    return { code: err.code, message: err.message };
  }
  if (err && typeof err === "object" && "code" in err) {
    const o = err as { code?: string; message?: string };
    return { code: String(o.code ?? "unknown"), message: String(o.message ?? "") };
  }
  if (err instanceof Error) {
    return { code: "error", message: err.message };
  }
  return { code: "unknown", message: String(err) };
}

function formatActivationFailure(err: unknown): string {
  const { code, message } = getFirebaseErrorDetails(err);
  if (code === "unavailable" || code === "deadline-exceeded") {
    return `Privremeno nedostupno (${code}). Probajte ponovo. Detalj: ${message}`;
  }
  if (code.startsWith("functions/")) {
    return message || `Greška funkcije (${code}).`;
  }
  if (code === "permission-denied") {
    return `${message} — Na localhostu skoro uvek: Google Cloud → Credentials (https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0889534325) → Browser key = apiKey iz firebase-applet-config → Application restrictions: None ili http://localhost:3000/* i http://127.0.0.1:3000/*`;
  }
  return `Greška (${code}). ${message || "Bez dodatnog opisa."}`;
}

export default function Activate() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [retryAttempt, setRetryAttempt] = useState(0);

  const runActivation = useCallback(
    async (rawToken: string) => {
      const tokenStr = normalizeLicenseToken(rawToken);
      setStatus("loading");
      setMessage("");

      try {
        const docRef = doc(db, "licenses", tokenStr);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          setStatus("error");
          setMessage(
            "Ovaj token nije u bazi (možda stari PDF ili druga licenca iz paketa). U Admin → Licence otvori listu i koristi „Kopiraj aktivacioni link“ za tačan token. Paket od 3 = tri različita lic_.",
          );
          setManualInput((m) => m || tokenStr);
          return;
        }

        const data = docSnap.data();

        if (data.expiresAt) {
          const expiryDate = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
          if (expiryDate < new Date()) {
            setStatus("error");
            setMessage("Ova licenca je istekla. Molimo kontaktirajte administratora za produženje.");
            setManualInput((m) => m || tokenStr);
            return;
          }
        }

        const vid =
          localStorage.getItem("rakivinum_visitor_id") || `dev-${Math.random().toString(36).substr(2, 9)}`;
        if (!localStorage.getItem("rakivinum_visitor_id")) {
          localStorage.setItem("rakivinum_visitor_id", vid);
        }

        const activatedDevices = data.activatedDevices || [];
        const maxDevices = data.maxDevices || 3;
        const isAlreadyActivatedOnThisDevice = activatedDevices.includes(vid);

        if (!isAlreadyActivatedOnThisDevice && activatedDevices.length >= maxDevices) {
          setStatus("error");
          setMessage(
            `Dostigli ste limit od ${maxDevices} uređaja za ovu licencu. Odjavite jedan uređaj ili kontaktirajte podršku.`,
          );
          setManualInput((m) => m || tokenStr);
          return;
        }

        const updatedDevices = isAlreadyActivatedOnThisDevice ? activatedDevices : [...activatedDevices, vid];

        const writeViaClient = () =>
          updateDoc(docRef, {
            token: tokenStr,
            clientName: data.clientName ?? "",
            ...(typeof data.type === "string" ? { type: data.type } : {}),
            maxDevices: data.maxDevices ?? 3,
            // "Iskorišćena" means at least one device has used the license.
            isUsed: updatedDevices.length > 0,
            activatedDevices: updatedDevices,
            lastActivatedBy: vid,
            usedAt: serverTimestamp(),
          });

        try {
          const fn = getFunctions(app, "us-central1");
          const activateLicense = httpsCallable(fn, "activateLicense");
          await activateLicense({ token: tokenStr, visitorId: vid });
        } catch (fnErr) {
          const fc = getFirebaseErrorDetails(fnErr).code;
          // Funkcija nije deployovana (Spark plan) ili privremena greška — probaj direktan Firestore upis.
          if (
            fc === "functions/not-found" ||
            fc === "functions/internal" ||
            fc === "functions/unavailable" ||
            fc === "functions/deadline-exceeded" ||
            fc === "functions/unknown"
          ) {
            await writeViaClient();
          } else {
            throw fnErr;
          }
        }

        localStorage.setItem("rakivinum_licensed", "true");
        localStorage.setItem("rakivinum_license_token", tokenStr);
        window.dispatchEvent(new Event("rakivinum_license_changed"));

        setStatus("success");
        setMessage("Aplikacija je uspešno aktivirana! Dobrodošli u digitalni svet rakije i vina.");

        setTimeout(() => {
          navigate("/");
        }, 3000);
      } catch (err) {
        const details = getFirebaseErrorDetails(err);
        console.error("Activation error:", details.code, details.message, err);
        setStatus("error");
        setMessage(formatActivationFailure(err));
        setManualInput((m) => m || tokenStr);
      }
    },
    [navigate],
  );

  useEffect(() => {
    if (!token) {
      setStatus("idle");
      setMessage("");
      return;
    }
    void runActivation(token);
  }, [token, retryAttempt, runActivation]);

  const applyManualToken = () => {
    const t = extractActivateTokenFromInput(manualInput);
    if (!t) {
      setMessage("Nalepite pun link (…/activate?token=…) ili token koji počinje sa lic_.");
      setStatus("error");
      return;
    }
    navigate(`/activate?token=${encodeURIComponent(t)}`, { replace: true });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-bg-base text-white flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-gold-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-gold-500/10 blur-[120px] rounded-full" />

        <div className="max-w-sm w-full card-soft card-elevated border border-border-subtle rounded-[32px] p-8 shadow-2xl relative z-10 space-y-5">
          <h1 className="text-xl font-black uppercase tracking-tight italic text-center">Aktivacija licence</h1>
          <p className="text-text-secondary text-sm leading-relaxed text-center">
            Nalepite link iz PDF-a ili mejla, ili sam token. Na računaru ne morate skenirati QR.
          </p>
          <textarea
            value={manualInput}
            onChange={(e) => {
              setManualInput(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            rows={4}
            placeholder="https://…/activate?token=lic_…"
            className="w-full rounded-xl border border-white/10 bg-bg-base p-3 text-sm text-white placeholder:text-text-secondary/50 focus:border-gold-500/50 focus:outline-none resize-y focus-visible:ring-2 focus-visible:ring-gold-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            autoComplete="off"
          />
          {status === "error" && message && (
            <p className="text-xs text-red-400 leading-relaxed whitespace-pre-line">{message}</p>
          )}
          <button
            type="button"
            onClick={applyManualToken}
            className="w-full py-4 btn-primary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
          >
            Aktiviraj
          </button>
          <button
            type="button"
            onClick={() => navigate("/scan")}
            className="w-full py-2.5 btn-tertiary text-[11px] normal-case font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
          >
            Imam QR — otvori skener
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-full py-2 btn-tertiary text-[11px] normal-case font-medium opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
          >
            Nazad na početnu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base text-white flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-gold-500/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-gold-500/10 blur-[120px] rounded-full" />

      <div className="max-w-sm w-full card-soft card-elevated border border-border-subtle rounded-[32px] p-8 shadow-2xl relative z-10 text-center space-y-6">
        <div className="flex justify-center">
          {status === "loading" && (
            <div className="w-20 h-20 bg-gold-500/10 rounded-full flex items-center justify-center motion-safe:animate-pulse">
              <Loader2 className="w-10 h-10 text-gold-500 animate-spin motion-reduce:animate-none" />
            </div>
          )}
          {status === "success" && (
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center animate-in zoom-in duration-500">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
          )}
          {status === "error" && (
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center animate-in zoom-in duration-500">
              <ShieldAlert className="w-10 h-10 text-red-500" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-tight italic">
            {status === "loading" ? "Aktivacija..." : status === "success" ? "Uspeh!" : "Greška"}
          </h1>
          <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-line">{message}</p>
        </div>

        {status === "error" && (
          <div className="space-y-3 text-left pt-2 border-t border-white/10">
            <label className="block eyebrow-label text-gold-500/90">Ispravi link ili token</label>
            <textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-white/10 bg-bg-base p-3 text-xs text-white focus:border-gold-500/50 focus:outline-none resize-y font-mono focus-visible:ring-2 focus-visible:ring-gold-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => {
                const t = extractActivateTokenFromInput(manualInput) || token || "";
                if (!t) {
                  setMessage("Ne mogu da prepoznam token. Ostavite ceo URL sa ?token= ili samo lic_…");
                  return;
                }
                navigate(`/activate?token=${encodeURIComponent(t)}`, { replace: true });
              }}
              className="w-full py-3 btn-primary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            >
              Ponovi sa ovim tekstom
            </button>
            <button
              type="button"
              onClick={() => setRetryAttempt((a) => a + 1)}
              className="w-full py-2.5 btn-tertiary text-[11px] normal-case font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            >
              Ponovi isti token (osveži zahtev)
            </button>
            <button
              type="button"
              onClick={() => navigate("/activate", { replace: true })}
              className="w-full py-2 btn-tertiary text-xs normal-case font-medium text-gold-500/90 border-gold-500/20 hover:border-gold-500/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
            >
              Nova aktivacija (prazan unos)
            </button>
          </div>
        )}

        {status === "success" && (
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-full py-4 btn-primary flex items-center justify-center gap-2 group text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
          >
            Pokreni aplikaciju
            <Rocket className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </button>
        )}

        <div className="pt-4 flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 text-gold-500/50">
            <span className="w-8 h-[1px] bg-current" />
            <span className="ui-pill text-gold-500/70 tracking-[0.14em]">Rakivinum Mreža</span>
            <span className="w-8 h-[1px] bg-current" />
          </div>
        </div>
      </div>
    </div>
  );
}
