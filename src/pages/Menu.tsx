import { Settings, Moon, Bell, Shield, Wallet, Book, LogOut, Database, BarChart3, ShieldAlert, X, Bookmark, QrCode, Award, Lock, Users, Globe } from "lucide-react";
import React, { useEffect, useState } from "react";
import { app, auth, db } from "../lib/firebase";
import { getFirebaseRedirectResultOnce } from "../lib/firebaseRedirectResult";
import { collection, query, where, getDocs, limit, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { isSuperuserEmail } from "../lib/authz";
import { normalizeLicenseToken } from "../lib/extractActivateToken";
import { shouldRunRefresh } from "../lib/refreshGate";
import { CACHE_TTL, REFRESH_INTERVAL } from "../lib/cachePolicy";
import { fetchCommunityLinks, fetchPublicClubMembershipsByVisitorId, fetchPublicDistilleriesByIds } from "../lib/dataService";
import {
  ACHIEVEMENT_EVENT_NAME,
  BADGE_DEFS,
  getAchievementSummary,
  getBadgeColorClass,
  type BadgeDef,
  type BadgeRarity,
  type UnlockedBadge,
} from "../lib/achievements";

const BADGE_RARITY_SR: Record<BadgeRarity, string> = {
  bronze: "Bronza",
  silver: "Srebro",
  gold: "Zlato",
  emerald: "Smaragd",
  ruby: "Rubin",
  obsidian: "Opsidijan",
};

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type DistilleryOwnershipRow = {
  isArchived?: boolean;
  ownerId?: string;
};

type PendingRatingQueueItem = {
  id: string;
  timestamp?: number;
};

type LicenseDoc = {
  activatedDevices?: string[];
};

/** Zvanična višebojna „G“ (bez spoljne zavisnosti). */
function GoogleGIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function BadgeCatalogRow({
  def,
  unlocked,
  catalogOnly,
}: {
  def: BadgeDef;
  unlocked?: UnlockedBadge;
  /** Uputstvo: uvek „pun“ prikaz bedža bez statusa zaključano/otključano. */
  catalogOnly?: boolean;
}) {
  const locked = !catalogOnly && !unlocked;
  return (
    <div
      className={`bg-bg-card border border-white/10 rounded-xl p-3 flex gap-3 items-start ${locked ? "opacity-[0.72]" : ""}`}
    >
      <div
        className={`shrink-0 w-[52px] h-[52px] rounded-2xl border-2 flex items-center justify-center shadow-inner ${getBadgeColorClass(def.rarity)} ${
          locked ? "grayscale-[0.35] opacity-90" : ""
        }`}
        aria-hidden
      >
        {locked ? <Lock className="w-5 h-5 opacity-90" strokeWidth={2.2} /> : <Award className="w-6 h-6 opacity-95" strokeWidth={2.2} />}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-nowrap items-center gap-x-2 min-w-0">
          <span className="text-white font-bold text-xs min-w-0 flex-1 truncate">{def.name}</span>
          <span
            className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border whitespace-nowrap ${getBadgeColorClass(def.rarity)}`}
          >
            {BADGE_RARITY_SR[def.rarity]}
          </span>
          {!catalogOnly &&
            (locked ? (
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-white/35 whitespace-nowrap">Zaključano</span>
            ) : (
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-emerald-400/90 whitespace-nowrap">Otključano</span>
            ))}
        </div>
        <p className="text-gold-500 text-[11px] font-bold leading-tight">Titula: {def.title}</p>
        <p className="text-[11px] text-text-secondary leading-relaxed">{def.description}</p>
        {!catalogOnly && unlocked && (
          <p className="text-[10px] text-white/50 mt-1">
            Otključano: {new Date(unlocked.unlockedAt).toLocaleDateString("sr-RS")}
          </p>
        )}
      </div>
    </div>
  );
}

/** StrictMode / double effect would show two alerts for one redirect failure */
let menuRedirectAuthErrorShown = false;

export default function Menu() {
  const EMERGENCY_READ_FREEZE = false;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isNotifEnabled, setIsNotifEnabled] = useState(true);
  const [distilleryId, setDistilleryId] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEventLike | null>(null);
  const [modalContent, setModalContent] = useState<{ title: string, content?: React.ReactNode, kind?: "guide" } | null>(null);
  const [guideTab, setGuideTab] = useState<"guide" | "badges">("guide");
  const [pendingRatingsCount, setPendingRatingsCount] = useState(0);
  const [achievementSummary, setAchievementSummary] = useState(() => getAchievementSummary());
  /** Klubovi vezani za uređaj (visitorId) — važi i za gosta i za prijavljenog korisnika. */
  const [joinedClubsMenu, setJoinedClubsMenu] = useState<{ id: string; name: string }[]>([]);
  const [joinedClubsMenuReady, setJoinedClubsMenuReady] = useState(false);
  const [helpLinks, setHelpLinks] = useState<{ id: string; label: string; url: string }[]>([]);
  const [helpLinksReady, setHelpLinksReady] = useState(false);
  const navigate = useNavigate();
  const getFnErrorCode = (err: unknown) => String((err as { code?: unknown } | null)?.code || "");

  const handleInstallApp = () => {
    window.dispatchEvent(new CustomEvent('rakivinum_trigger_install'));
  };

  const markDistilleryAccess = async (distId: string, currentUser: User) => {
    try {
      await updateDoc(doc(db, "distilleries", distId), {
        lastAppAccessAt: serverTimestamp(),
        lastAppAccessByUid: currentUser.uid,
        lastAppAccessByEmail: (currentUser.email || "").toLowerCase(),
      });
    } catch (e) {
      console.warn("Failed to update last app access", e);
    }
  };

  useEffect(() => {
    // Keep auth session persistent across reloads and redirects
    setPersistence(auth, browserLocalPersistence).catch((err) =>
      console.error("Auth persistence error:", err)
    );

    // Check for redirect result on mount (single-flight — see firebaseRedirectResult.ts)
    getFirebaseRedirectResultOnce()
      .then((result) => {
        if (result?.user) {
          console.log("Redirect login successful");
          setUser(result.user);
        }
      })
      .catch((error) => {
        console.error("Redirect Login Error details:", error);
        if (menuRedirectAuthErrorShown) return;
        menuRedirectAuthErrorShown = true;
        if (error.code === 'auth/unauthorized-domain') {
          showDomainError(error.message);
        } else {
          alert(`Greška prijave (${error.code || "unknown"}): ${error.message || "Pokušajte ponovo."}`);
        }
      });

    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (EMERGENCY_READ_FREEZE) {
        setDistilleryId(null);
        return;
      }
      if (currentUser) {
        localStorage.setItem("rakivinum_last_login_email", currentUser.email || "");
      } else {
        localStorage.removeItem("rakivinum_last_login_email");
        setDistilleryId(null);
      }
      setLoading(false);

      if (currentUser) {
        try {
          const qByOwner = query(
            collection(db, "distilleries"),
            where("ownerId", "==", currentUser.uid),
            limit(1),
          );
          const ownerSnap = await getDocs(qByOwner);
          if (!ownerSnap.empty) {
            const ownerDoc = ownerSnap.docs[0];
            const ownerData = ownerDoc.data() as DistilleryOwnershipRow;
            if (ownerData?.isArchived) {
              setDistilleryId(null);
              return;
            }
            const dId = ownerDoc.id;
            setDistilleryId(dId);
            void markDistilleryAccess(dId, currentUser);
            return;
          }

          const email = (currentUser.email || "").trim().toLowerCase();
          if (email) {
            const qByEmail = query(
              collection(db, "distilleries"),
              where("email", "==", email),
              limit(1),
            );
            const emailSnap = await getDocs(qByEmail);
            if (!emailSnap.empty) {
              const distDoc = emailSnap.docs[0];
              const distData = distDoc.data() as DistilleryOwnershipRow;
              if (distData?.isArchived) {
                setDistilleryId(null);
                return;
              }
              setDistilleryId(distDoc.id);
              void markDistilleryAccess(distDoc.id, currentUser);

              // Poveži ownerId sa Google nalogom; ispravi i pogrešan ownerId (npr. ostao od admina pri starom čuvanju).
              const currentOwner = distData?.ownerId;
              if (!currentOwner || currentOwner !== currentUser.uid) {
                try {
                  await updateDoc(doc(db, "distilleries", distDoc.id), { ownerId: currentUser.uid });
                } catch (e) {
                  console.warn("Failed to auto-link distillery owner by email fallback", e);
                }
              }
              return;
            }
          }

          setDistilleryId(null);
        } catch (error) {
          console.error("Error finding user distillery:", error);
          setDistilleryId(null);
        }
      }
    });
    return unsub;
  }, [EMERGENCY_READ_FREEZE]);

  useEffect(() => {
    let mounted = true;
    const loadHelpLinks = async () => {
      try {
        const rows = await fetchCommunityLinks({
          limitCount: 80,
          cacheKey: "rakivinum_cache_menu_help_links_v1",
          ttlMs: CACHE_TTL.COMMUNITY_EVENTS_6H,
        });
        if (mounted) {
          setHelpLinks(
            rows.map((x) => ({
              id: String(x.id),
              label: String(x.label || "Link"),
              url: String(x.url),
            })),
          );
        }
      } catch {
        if (mounted) setHelpLinks([]);
      } finally {
        if (mounted) setHelpLinksReady(true);
      }
    };
    void loadHelpLinks();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const syncAchievements = () => setAchievementSummary(getAchievementSummary());
    syncAchievements();
    window.addEventListener("focus", syncAchievements);
    window.addEventListener("storage", syncAchievements);
    window.addEventListener(ACHIEVEMENT_EVENT_NAME, syncAchievements as EventListener);
    return () => {
      window.removeEventListener("focus", syncAchievements);
      window.removeEventListener("storage", syncAchievements);
      window.removeEventListener(ACHIEVEMENT_EVENT_NAME, syncAchievements as EventListener);
    };
  }, []);

  useEffect(() => {
    const visitorId = localStorage.getItem("rakivinum_visitor_id");
    if (!visitorId) {
      setJoinedClubsMenu([]);
      setJoinedClubsMenuReady(true);
      return;
    }

    const storageKey = `clubs_${visitorId}`;

    const mergeIdsFromFirestore = (firestoreIds: string[]) => {
      let localJoined: string[] = [];
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
        localJoined = Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === "string") : [];
      } catch {
        localJoined = [];
      }
      return Array.from(new Set([...firestoreIds, ...localJoined])).filter(Boolean);
    };

    const resolveClubRows = async (ids: string[]) => {
      const distilleryRows = await fetchPublicDistilleriesByIds(ids);
      const byId = new Map<string, DistilleryOwnershipRow & { name?: string }>(
        distilleryRows.map((row) => [String(row.id), row as DistilleryOwnershipRow & { name?: string }]),
      );

      const rows = ids
        .map((id) => {
          const data = byId.get(String(id));
          if (!data || data.isArchived) return null;
          const name = String(data.name || "").trim() || "Klub";
          return { id, name };
        })
        .filter((r): r is { id: string; name: string } => r !== null);

      setJoinedClubsMenu(rows);
      setJoinedClubsMenuReady(true);
    };

    const refreshJoinedClubs = async () => {
      try {
        const memberships = await fetchPublicClubMembershipsByVisitorId(visitorId, 40);
        const fromFs = memberships
          .map((m) => m.distilleryId)
          .filter((x): x is string => typeof x === "string" && x.length > 0);
        const merged = mergeIdsFromFirestore(fromFs);
        await resolveClubRows(merged);
      } catch (err) {
        console.warn("Menu: club_memberships refresh", err);
        const merged = mergeIdsFromFirestore([]);
        await resolveClubRows(merged);
      }
    };

    void refreshJoinedClubs();
    const onFocusRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (!shouldRunRefresh("menu:focus-joined-clubs", REFRESH_INTERVAL.USER_LIGHT_1H)) return;
      void refreshJoinedClubs();
    };
    const onVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      onFocusRefresh();
    };
    window.addEventListener("focus", onFocusRefresh);
    document.addEventListener("visibilitychange", onVisibilityRefresh);

    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      document.removeEventListener("visibilitychange", onVisibilityRefresh);
    };
  }, []);

  useEffect(() => {
    const syncPendingCount = () => {
      try {
        const raw = localStorage.getItem("rakivinum_pending_ratings") || "[]";
        const parsed = JSON.parse(raw);
        const now = Date.now();
        const seen = new Set<string>();
        const safeQueue = (Array.isArray(parsed) ? parsed : [])
          .filter((x): x is PendingRatingQueueItem => !!x && typeof (x as PendingRatingQueueItem).id === "string" && (x as PendingRatingQueueItem).id.trim().length > 0)
          .filter((x) => {
            const ts = Number(x?.timestamp || 0);
            // auto-clean stale reminders older than 14 days
            return !Number.isNaN(ts) && ts > 0 && now - ts <= 14 * 24 * 60 * 60 * 1000;
          })
          .filter((x) => {
            if (seen.has(x.id)) return false;
            seen.add(x.id);
            return true;
          });

        if (JSON.stringify(safeQueue) !== JSON.stringify(parsed)) {
          localStorage.setItem("rakivinum_pending_ratings", JSON.stringify(safeQueue));
        }
        if (safeQueue[0]) {
          localStorage.setItem("rakivinum_pending_rating", JSON.stringify(safeQueue[0]));
        } else {
          localStorage.removeItem("rakivinum_pending_rating");
        }

        setPendingRatingsCount(safeQueue.length);
      } catch {
        setPendingRatingsCount(0);
      }
    };

    syncPendingCount();
    window.addEventListener("storage", syncPendingCount);
    window.addEventListener("focus", syncPendingCount);
    window.addEventListener("rakivinum_pending_ratings_changed", syncPendingCount as EventListener);
    return () => {
      window.removeEventListener("storage", syncPendingCount);
      window.removeEventListener("focus", syncPendingCount);
      window.removeEventListener("rakivinum_pending_ratings_changed", syncPendingCount as EventListener);
    };
  }, []);

  const showDomainError = (rawError?: string) => {
    const currentDomain = window.location.hostname;
    setModalContent({
      title: "Sigurnosna Blokada Motora",
      content: (
        <div className="space-y-4">
          <div className="bg-red-500/10 p-4 rounded-xl border border-red-500/20">
             <p className="text-[10px] text-red-500 font-black uppercase tracking-widest mb-2 italic flex items-center gap-2">
               <ShieldAlert className="w-3 h-3" /> Kritična Greška 403:
             </p>
             <p className="text-[11px] text-text-secondary leading-relaxed">
               Google blokira prijavu jer ovaj domen nije na listi ovlašćenih. Da bi popravili ovo, morate dodati domen u Firebase konzolu.
             </p>
          </div>
          
          <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-3">
            <p className="text-[10px] text-text-secondary uppercase tracking-widest text-center">Domen koji trebate dodati:</p>
            <div className="flex gap-2">
              <code className="flex-1 p-2 bg-black rounded text-[10px] text-gold-500 break-all font-mono text-center select-all">
                {currentDomain}
              </code>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(currentDomain);
                  alert("Kopirano! Sada ga dodajte u Firebase Console.");
                }}
                className="px-3 bg-gold-500 text-black text-[10px] font-black rounded-lg uppercase"
              >
                Kopiraj
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] text-white font-bold uppercase italic">Koraci za popravku:</p>
            <ol className="text-[10px] text-text-secondary space-y-2 list-decimal pl-4">
              <li>Uđite u <strong>Firebase Console</strong></li>
              <li>Authentication &rarr; Settings &rarr; <strong>Authorized Domains</strong></li>
              <li>Kliknite <strong>Add Domain</strong> i zalepite gornji tekst</li>
              <li>Sačekajte 60 sekundi i osvežite ovu stranicu</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button 
              onClick={() => {
                const provider = googleProvider();
                signInWithRedirect(auth, provider).catch((e) => alert('Greška: ' + e.message));
              }}
              className="py-3 bg-gold-500/20 hover:bg-gold-500/30 text-gold-500 rounded-xl text-[10px] font-black transition-all border border-gold-500/30 uppercase"
            >
              Pokušaj ALTERNATIVNI Login (Redirect)
            </button>
          </div>
        </div>
      )
    });
  };

  const googleProvider = () => {
    const provider = new GoogleAuthProvider();
    auth.languageCode = 'sr';
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  };

  /**
   * Uvek prvo popup: na mobilnom Chrome-u redirect često ostavi korisnika kao „gost“ posle Google-a,
   * a popup isti nalog završi pouzdanije. Ako pregledač blokira popup, tek onda redirect — korisnik ne bira.
   */
  const popupBlockedCodes = new Set([
    'auth/popup-blocked',
    'auth/operation-not-supported-in-this-environment',
  ]);

  const handleLogin = async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
      const provider = googleProvider();

      try {
        await signInWithPopup(auth, provider);
        return;
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string } | null;
        if (popupBlockedCodes.has(err?.code || "")) {
          await signInWithRedirect(auth, googleProvider());
          return;
        }
        if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-requested') {
          return;
        }
        if (err?.code === 'auth/unauthorized-domain') {
          showDomainError(err.message);
          return;
        }
        throw e;
      }
    } catch (error: unknown) {
      console.error('Login Error:', error);
      const err = error as { code?: string; message?: string } | null;

      if (err?.code === 'auth/unauthorized-domain') {
        showDomainError(err.message);
        return;
      }

      alert(`Greška: ${err?.message || 'Pokušajte ponovo.'}`);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const isAdmin = isSuperuserEmail(user?.email);
  const currentLicenseToken = normalizeLicenseToken(localStorage.getItem("rakivinum_license_token") || "");
  const hasActiveLicense = localStorage.getItem("rakivinum_licensed") === "true" && !!currentLicenseToken;

  const handleMyDistillery = () => {
    if (distilleryId) {
      navigate(`/distillery/${distilleryId}`);
    } else {
      alert("Niste povezani ni sa jednom destilerijom. Kontaktirajte administratora za dodelu vlasništva.");
    }
  };

  const handleProClick = () => {
    setModalContent({
      title: "Rakija Master PRO",
      content: (
        <div className="space-y-4">
          <p className="text-[11px] text-amber-200/90 leading-relaxed border border-amber-500/25 bg-amber-500/10 rounded-xl p-3">
            <strong className="text-gold-400">Važno:</strong> Ova opcija vidi se samo ako ste na Google
            nalogu koji je <strong>vlasnik destilerije u sistemu</strong>. PRO nije automatski od mejla —
            treba vam <strong>licenca</strong> (<code className="text-gold-300">lic_…</code>) od
            administratora (PDF / mejl).
          </p>
          <p className="text-sm text-text-secondary">Uz licencu dobijate napredne alate:</p>
          <ul className="space-y-2">
            {[
              "Neograničen broj digitalnih etiketa",
              "Napredna analitika prodaje i skeniranja",
              "QR kodovi za štampu visoke rezolucije",
              "Ekskluzivni uvid u demografiju skeniranja",
              "Premium bedž na profilu"
            ].map((text, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-white">
                <div className="w-1.5 h-1.5 bg-gold-500 rounded-full" />
                {text}
              </li>
            ))}
          </ul>
          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={() => {
                setModalContent(null);
                navigate("/activate");
              }}
              className="w-full py-3 bg-gold-500 text-black font-black uppercase tracking-widest rounded-xl text-xs active:scale-95 transition-all"
            >
              Unesi licencu (aktivacija)
            </button>
            <p className="text-[10px] text-center text-text-secondary leading-snug">
              Posle aktivacije: Meni → prijavi se → „Dashboard za destilerije“ za PRO sadržaj.
            </p>
            <p className="text-[10px] text-center text-text-secondary/80 mt-2 italic">Probni period 30 dana — uskoro detalji u vašem regionu</p>
          </div>
        </div>
      )
    });
  };

  const handleLicenseCenter = () => {
    setModalContent({
      title: "Licenca",
      content: (
        <div className="space-y-4">
          {hasActiveLicense ? (
            <>
              <div className="p-3 rounded-xl border border-green-500/20 bg-green-500/10 text-xs text-green-300">
                Aktivna licenca na ovom uređaju.
              </div>
              <div className="p-3 rounded-xl border border-white/10 bg-white/5 text-[11px] text-text-secondary leading-relaxed">
                Ako želite da istu licencu iskoristite na drugom uređaju, prvo odjavite ovaj uređaj.
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const token = normalizeLicenseToken(localStorage.getItem("rakivinum_license_token") || "");
                    const visitorId = localStorage.getItem("rakivinum_visitor_id") || "";
                    if (!token || !visitorId) {
                      alert("Nedostaje token ili ID uređaja.");
                      return;
                    }
                    const licenseRef = doc(db, "licenses", token);

                    const runClientFallback = async () => {
                      const snap = await getDocs(query(collection(db, "licenses"), where("token", "==", token), limit(1)));
                      const targetDoc = snap.empty ? null : snap.docs[0];
                      const ref = targetDoc ? doc(db, "licenses", targetDoc.id) : licenseRef;
                      const data = targetDoc?.data() as LicenseDoc | undefined;
                      const current = Array.isArray(data?.activatedDevices) ? data.activatedDevices : [];
                      const updated = current.filter((x: string) => x !== visitorId);
                      await updateDoc(ref, {
                        activatedDevices: updated,
                        isUsed: updated.length > 0,
                        lastDeactivatedBy: visitorId,
                        updatedAt: serverTimestamp(),
                      });
                    };

                    try {
                      const fn = getFunctions(app, "us-central1");
                      const deactivate = httpsCallable(fn, "deactivateLicenseDevice");
                      await deactivate({ token, visitorId });
                    } catch (fnErr: unknown) {
                      const code = getFnErrorCode(fnErr);
                      const infraFailure = [
                        "functions/not-found",
                        "functions/internal",
                        "functions/unavailable",
                        "functions/deadline-exceeded",
                        "functions/unknown",
                      ].some((c) => code.includes(c));
                      if (!infraFailure) throw fnErr;
                      await runClientFallback();
                    }

                    localStorage.removeItem("rakivinum_licensed");
                    localStorage.removeItem("rakivinum_license_token");
                    localStorage.removeItem("rakija_licensed");
                    window.dispatchEvent(new Event("rakivinum_license_changed"));
                    setModalContent(null);
                    alert("Uređaj je uspešno odjavljen sa licence.");
                  } catch (e: unknown) {
                    console.error("Deactivate license error:", e);
                    alert(`Neuspešna odjava licence: ${(e as { message?: string } | null)?.message || "Pokušajte ponovo."}`);
                  }
                }}
                className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-xl text-xs font-black uppercase tracking-widest border border-red-500/30"
              >
                Odjavi ovaj uređaj sa licence
              </button>
            </>
          ) : (
            <div className="p-3 rounded-xl border border-white/10 bg-white/5 text-[11px] text-text-secondary leading-relaxed">
              Nemate aktivnu licencu na ovom uređaju.
            </div>
          )}

          <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-200 leading-relaxed">
            Ako izgubite uređaj, javite se administratoru da ručno odjavi taj uređaj sa licence.
          </div>
        </div>
      ),
    });
  };

  const openAchievements = () => {
    const unlockedById = new Map(achievementSummary.badges.map((b) => [b.id, b]));
    const unlockedCount = achievementSummary.badges.length;
    const totalCount = BADGE_DEFS.length;
    const defsForModal = [...BADGE_DEFS].sort((a, b) => {
      const aU = unlockedById.has(a.id);
      const bU = unlockedById.has(b.id);
      if (aU !== bU) return aU ? -1 : 1;
      return 0;
    });

    setModalContent({
      title: "Bedževi i titule",
      content: (
        <div className="space-y-4">
          <div className="rounded-xl border border-gold-500/20 bg-gold-500/10 p-3">
            <p className="text-[10px] uppercase tracking-widest text-gold-500 font-black">Aktivna titula</p>
            <p className="text-sm text-white font-bold">{achievementSummary.activeTitle || "Gost"}</p>
            <p className="text-[11px] text-text-secondary mt-1">
              Skenovi: {achievementSummary.stats.scansTotal} • Ocene: {achievementSummary.stats.ratingsTotal} • Klub max:{" "}
              {achievementSummary.stats.clubsJoinedPeak}
            </p>
            <p className="text-[10px] text-gold-500/90 font-bold mt-2 pt-2 border-t border-gold-500/15">
              Napredak bedževa: {unlockedCount} / {totalCount}
            </p>
          </div>

          <p className="text-[10px] text-text-secondary leading-relaxed">
            Svi bedževi su ispod — otključani su na vrhu liste. Otključani su označeni zlatno-zelenom oznakom i datumom; zaključani prikazuju katanac dok ne ispunite uslov.
          </p>

          <div className="space-y-2 max-h-[48dvh] overflow-y-auto pr-1">
            {defsForModal.map((def) => (
              <BadgeCatalogRow key={def.id} def={def} unlocked={unlockedById.get(def.id)} />
            ))}
          </div>

          {unlockedCount === 0 && (
            <p className="text-xs text-text-secondary italic text-center px-1">
              Još nema otključanih bedževa. Skeniraj, ocenjuj i priključuj se klubovima da napreduješ.
            </p>
          )}
        </div>
      ),
    });
  };

  const openUsefulLinks = () => {
    setModalContent({
      title: "Korisni linkovi",
      content: (
        <div className="space-y-3">
          {!helpLinksReady ? (
            <p className="text-sm text-text-secondary italic text-center py-4">Učitavanje linkova…</p>
          ) : helpLinks.length === 0 ? (
            <p className="text-sm text-text-secondary italic text-center py-4">Trenutno nema dostupnih linkova.</p>
          ) : (
            <div className="space-y-2">
              {helpLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-bg-card/40 px-3 py-3 text-sm text-white hover:border-gold-500/35 hover:text-gold-500 transition-colors"
                >
                  <span className="truncate">{link.label}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Otvori</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ),
    });
  };

  const renderGuideContent = () => (
    <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setGuideTab("guide")}
          className={`py-2 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-colors ${
            guideTab === "guide"
              ? "bg-gold-500 text-black border-gold-500"
              : "bg-bg-card text-text-secondary border-white/10 hover:text-white"
          }`}
        >
          Uputstvo
        </button>
        <button
          type="button"
          onClick={() => setGuideTab("badges")}
          className={`py-2 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-colors ${
            guideTab === "badges"
              ? "bg-gold-500 text-black border-gold-500"
              : "bg-bg-card text-text-secondary border-white/10 hover:text-white"
          }`}
        >
          Titule i bedževi
        </button>
      </div>

      {guideTab === "guide" ? (
        <div className="space-y-4">
          <p><strong className="text-gold-500">1. Skeniranje:</strong> Usmjerite kameru na QR kod na boci rakije kako biste otvorili Digitalnu Etiketu i videli senzorni profil i poreklo.</p>
          <p><strong className="text-gold-500">2. Ocenjivanje:</strong> Nakon skeniranja, kliknite na "Oceni" da biste podelili svoje utiske sa zajednicom.</p>
          <p><strong className="text-gold-500">3. Radionica:</strong> Koristite alate za razblaživanje i prvenac za preciznu pripremu vašeg destilata.</p>
          <p><strong className="text-gold-500">4. Kolekcija:</strong> Sačuvajte omiljene rakije klikom na ikonu obeleživača kako biste im uvek mogli pristupiti.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[10px] text-text-secondary leading-relaxed px-0.5">
            Ispod je prikaz kako bedž izgleda u aplikaciji (boja i okvir po retkosti). Kada ga otključate, pojavljuje se u meniju „Bedževi i titule“.
          </p>
          {BADGE_DEFS.map((b) => (
            <BadgeCatalogRow key={b.id} def={b} catalogOnly />
          ))}
        </div>
      )}
    </div>
  );

  const groups = [
    {
      title: "PREMIUM & NALOG",
      items: [
        {
          icon: Users,
          label: "Moji klubovi",
          variant: "default" as const,
          ...(joinedClubsMenu.length > 0 ? { value: String(joinedClubsMenu.length) } : {}),
          action: () => navigate("/my-clubs"),
        },
        ...(user
          ? [
              { icon: Bookmark, label: "Moja Kolekcija", variant: "default", value: "Sačuvano", action: () => navigate("/collection") },
              ...(pendingRatingsCount > 0
                ? [{ icon: Bell, label: "Za ocenu sutra", variant: "gold", value: String(pendingRatingsCount), action: () => navigate("/collection") }]
                : []),
              ...(distilleryId
                ? [
                    {
                      icon: BarChart3,
                      label: "Dashboard za destilerije / vinarije",
                      variant: "gold" as const,
                      value: "PRO",
                      action: () => navigate("/distillery-dashboard"),
                    },
                    { icon: Shield, label: "Moja Destilerija/Vinarija", variant: "default" as const, action: handleMyDistillery },
                  ]
                : []),
              { icon: Wallet, label: "Licenca", variant: hasActiveLicense ? "gold" : "default", value: hasActiveLicense ? "AKTIVNA" : "Nije aktivna", action: handleLicenseCenter },
              ...(isAdmin ? [{ icon: ShieldAlert, label: "Sigurnosni Audit", variant: "danger", value: "ADMIN", action: () => navigate("/admin-audit") }] : []),
            ]
          : []),
        { icon: Award, label: "Bedževi i titule", variant: "gold", value: String(achievementSummary.badges.length), action: openAchievements },
      ]
    },
    {
      title: "PODEŠAVANJA",
      items: [
        { icon: Bell, label: "Obaveštenja", variant: "default", type: "toggle", on: isNotifEnabled, action: () => setIsNotifEnabled(!isNotifEnabled) },
        { icon: QrCode, label: "Instaliraj Aplikaciju", variant: "gold", action: handleInstallApp },
        // Hidden option for seeding data for platform admins or testing (show if logged in)
        ...(isAdmin ? [{ icon: Database, label: "Sistemski Admin", variant: "default", action: () => navigate('/admin') }] : []),
      ]
    },
    {
      title: "INFORMACIJE",
      items: [
        {
          icon: Globe,
          label: "Korisni linkovi",
          variant: "default",
          action: openUsefulLinks,
        },
        { 
          icon: Book, 
          label: "Uputstvo za upotrebu", 
          variant: "default", 
          action: () => {
            setGuideTab("guide");
            setModalContent({
              title: "Uputstvo za upotrebu",
              kind: "guide",
            });
          }
        },
        user
          ? { icon: LogOut, label: "Odjavi se", variant: "danger", action: handleLogout }
          : {
              icon: GoogleGIcon,
              brandIcon: true,
              label: "Prijavi se sa Google",
              variant: "gold",
              action: handleLogin,
              subtitle:
                "Prijavom se na nalogu čuvaju bedževi, kolekcija i ocene. U zajednici i na etiketama i dalje nastupate kao Gost — drugi korisnici ne vide vaše ime niti mejl.",
            },
      ]
    }
  ];

  if (loading) {
    return <div className="p-4 pt-12 text-center text-text-secondary">Učitavanje profila...</div>;
  }

  return (
    <div className="p-4 space-y-6 animate-in fade-in duration-300">
      
      {user ? (
        <div className="flex items-center gap-4 mb-4">
          <img 
            src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}&background=D4AF37&color=000`} 
            alt="Profil" 
            className="w-16 h-16 rounded-full bg-bg-card-elevated border-2 border-gold-500/50 object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{user.displayName || "Korisnik"}</h2>
            <p className="text-gold-500 text-sm truncate">{user.email}</p>
            <p className="text-[11px] text-text-secondary mt-1">Titula: {achievementSummary.activeTitle || "Gost"}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full bg-bg-card-elevated border-2 border-white/15 flex items-center justify-center text-2xl">
            👤
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Gost</h2>
            <p className="text-text-secondary text-sm">Prijavi se Google nalogom (nema zasebne lozinke za Rakivinum)</p>
            <p className="text-[11px] text-text-secondary mt-1">Titula: {achievementSummary.activeTitle || "Gost"}</p>
          </div>
        </div>
      )}

      {joinedClubsMenuReady ? (
        <div className="mb-2 rounded-2xl border border-white/10 bg-bg-card/40 px-4 py-3 space-y-2">
          <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Članstvo u klubovima</p>
          {joinedClubsMenu.length === 0 ? (
            <p className="text-[11px] text-text-secondary/90 leading-relaxed">
              Još nisi u klubu. Otvori profil destilerije i pridruži se; članstvo se vezuje za ovaj uređaj i kada nisi prijavljen Google nalogom.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-text-secondary/80 leading-snug">
                Član si u {joinedClubsMenu.length === 1 ? "jednom klubu" : `${joinedClubsMenu.length} kluba`}:
              </p>
              <ul className="flex flex-wrap gap-2">
                {joinedClubsMenu.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/distillery/${c.id}`)}
                      className="max-w-[200px] truncate rounded-xl border border-gold-500/25 bg-gold-500/10 px-3 py-1.5 text-left text-[11px] font-medium text-gold-200 hover:bg-gold-500/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
              {joinedClubsMenu.length > 6 ? (
                <button
                  type="button"
                  onClick={() => navigate("/my-clubs")}
                  className="text-[10px] font-bold text-gold-500/90 uppercase tracking-wider"
                >
                  + još {joinedClubsMenu.length - 6} → Moji klubovi
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate("/my-clubs")}
                  className="text-[10px] font-bold text-white/50 uppercase tracking-wider hover:text-white/80"
                >
                  Detalji i nagrade →
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-2 h-16 rounded-2xl border border-white/5 bg-bg-card/20 animate-pulse" aria-hidden />
      )}

      <div className="space-y-6">
        {groups.map((group, i) => (
          <div key={i} className="space-y-2">
            <h3 className="text-[10px] font-bold text-text-secondary uppercase mx-2 tracking-widest">{group.title}</h3>
            <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/10">
              {group.items.map((item, j) => (
                <button
                  key={j}
                  onClick={item.action}
                  className={`w-full flex items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-bg-card-hover ${item.variant === "danger" ? "text-red-400" : "text-text-primary"}`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <item.icon
                      className={
                        "brandIcon" in item && item.brandIcon
                          ? "w-5 h-5 shrink-0 mt-0.5"
                          : `w-5 h-5 shrink-0 mt-0.5 ${item.variant === "gold" ? "text-gold-500" : item.variant === "danger" ? "text-red-400" : "text-text-secondary"}`
                      }
                    />
                    <div className="min-w-0">
                      <span className="font-medium text-sm">{item.label}</span>
                      {"subtitle" in item && item.subtitle ? (
                        <p className="text-[10px] text-text-secondary leading-relaxed mt-1.5 font-normal">{item.subtitle}</p>
                      ) : null}
                    </div>
                  </div>
                  
                  {item.value && (
                    <span className="text-xs text-gold-500 bg-gold-500/10 px-2 py-1 rounded-md">{item.value}</span>
                  )}
                  
                  {item.type === 'toggle' && (
                    <div className={`w-10 h-6 rounded-full p-1 transition-colors ${item.on ? 'bg-gold-500' : 'bg-white/15'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${item.on ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* GLOBAL MENU MODAL */}
      {modalContent && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-card-elevated border border-border-gold rounded-[32px] w-full max-w-sm p-8 space-y-6 animate-in zoom-in-95 duration-300 relative max-h-[88dvh] overflow-y-auto card-elevated">
            <button
              type="button"
              onClick={() => setModalContent(null)}
              className="absolute top-6 right-6 p-2 hover:bg-white/5 rounded-full text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold font-serif text-gold-500 italic">{modalContent.title}</h3>
            {modalContent.kind === "guide" ? renderGuideContent() : modalContent.content}
            <button
              type="button"
              onClick={() => setModalContent(null)}
              className="w-full py-4 btn-tertiary text-xs"
            >
              Zatvori
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
