import type { FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

/**
 * Firebase App Check — dokazuje da zahtev dolazi iz TVOJE aplikacije, a ne iz skripte.
 *
 * Zašto je potreban i pored `firestore.rules`: pravila odgovaraju na pitanje „sme li ovaj
 * korisnik ovo?“, a App Check na pitanje „dolazi li ovo uopšte iz moje aplikacije?“.
 * Javni Firebase konfig (apiKey, projectId) je po dizajnu vidljiv u bandlu, pa bez App
 * Check-a svako može da otvori konzolu i gađa Firestore direktno — u granicama pravila,
 * ali koliko god puta hoće. Pravila ograniče KOLIKO po upitu; App Check ograniči KO uopšte
 * može da pošalje upit.
 *
 * Cloudflare Worker koristi service account (admin pristup) i NE prolazi kroz App Check
 * ni kroz pravila — javni katalog radi normalno bez obzira na ovo.
 *
 * Podešavanje: `docs/APP-CHECK-UPUTSTVO.md`.
 */

const SITE_KEY = String(import.meta.env.VITE_APPCHECK_RECAPTCHA_SITE_KEY || "").trim();
const DEBUG_TOKEN = String(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || "").trim();

let started = false;

/**
 * Mora da se pozove ODMAH posle `initializeApp`, a PRE prvog korišćenja Firestore-a/Auth-a —
 * inače prvi upiti odu bez App Check tokena i biće odbijeni kada uključiš enforcement.
 *
 * Namerno je „tiho“ kada `VITE_APPCHECK_RECAPTCHA_SITE_KEY` nije postavljen: dok ne
 * registruješ sajt u Firebase konzoli, aplikacija radi kao i do sada.
 */
export function initAppCheck(app: FirebaseApp): void {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  if (!SITE_KEY) {
    console.warn(
      "[AppCheck] VITE_APPCHECK_RECAPTCHA_SITE_KEY nije postavljen — App Check je ISKLJUČEN. " +
        "Baza je zaštićena samo firestore.rules. Uputstvo: docs/APP-CHECK-UPUTSTVO.md",
    );
    return;
  }

  try {
    /**
     * Debug token mora da se postavi PRE `initializeAppCheck`. U dev-u bez zadatog tokena
     * `true` znači: SDK ispiše sveže generisan token u konzolu, koji zatim ručno dodaš u
     * Firebase → App Check → Manage debug tokens. Bez toga lokalni dev ne prolazi enforcement.
     */
    if (import.meta.env.DEV || DEBUG_TOKEN) {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean })
        .FIREBASE_APPCHECK_DEBUG_TOKEN = DEBUG_TOKEN || true;
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });

    console.info("[AppCheck] aktivan (reCAPTCHA v3).");
  } catch (err) {
    /**
     * Nikad ne rušimo aplikaciju zbog App Check-a. Ako inicijalizacija padne (npr. reCAPTCHA
     * skripta blokirana ad-blockerom), upiti će biti odbijeni tek kada uključiš enforcement —
     * a dotad je jedina posledica ovo upozorenje.
     */
    console.warn("[AppCheck] inicijalizacija nije uspela:", err);
  }
}
