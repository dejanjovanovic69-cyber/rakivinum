/**
 * Rakivinum — dnevna provera zdravlja (pravila + Worker + App Check).
 *
 *   node scripts/health-check.mjs
 *
 * Ne dira ništa, samo čita. Izlazni kod 1 ako nešto nije u redu.
 *
 * NAPOMENA: odnos verified/unverified za App Check je u Firebase konzoli
 * (App Check → APIs → Cloud Firestore) i ova skripta ga NE vidi — za to treba
 * service account sa pristupom Cloud Monitoring-u. Ovde se proverava samo da li
 * je App Check uopšte aktivan na produkciji.
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, limit } from "firebase/firestore";

const EDGE = process.env.EDGE_BASE || "https://rakivinum-api.dejanjovanovic69.workers.dev";
const SITE = process.env.SITE_BASE || "https://rakivinum.com";

const cfg = JSON.parse(readFileSync(new URL("../firebase-applet-config.json", import.meta.url), "utf8"));
const db = getFirestore(initializeApp(cfg), cfg.firestoreDatabaseId);

let bad = 0;
const ok = (m) => console.log("  ok    " + m);
const err = (m) => { console.log("  PAZI  " + m); bad += 1; };

console.log("=== 1) Firestore pravila ===");
for (const c of ["ratings", "licenses", "products", "distilleries", "club_memberships", "users", "scans"]) {
  try {
    const s = await getDocs(collection(db, c));
    err(`${c}: dump cele kolekcije PROLAZI (${s.size} dok.) — pravila su se vratila na staro`);
  } catch {
    ok(`${c}: dump blokiran`);
  }
}
try {
  await getDocs(query(collection(db, "licenses"), limit(1)));
  err("licenses: lista citljiva anonimno — tokeni su izlozeni");
} catch {
  ok("licenses: lista samo za admina");
}
/**
 * PROBE_LIMIT je namerno mali. Ranije je ovde stajalo limit(200), pa je SVAKO
 * pokretanje ove skripte citalo ceo katalog (41 + 7 = 48 dokumenata) — i to se
 * nije videlo u zbiru ispod, jer taj zbir broji samo Workera. Provera odgovara
 * na pitanje „da li aplikacijski upit uopste prolazi kroz pravila“, a za to je
 * dovoljno par redova; tacan broj stavki ionako daje Worker.
 */
const PROBE_LIMIT = 3;
for (const c of ["products", "distilleries"]) {
  try {
    const s = await getDocs(query(collection(db, c), limit(PROBE_LIMIT)));
    if (s.size === 0) {
      err(`${c}: aplikacijski upit prolazi ali ne vraca nista — katalog je prazan?`);
    } else {
      ok(`${c}: aplikacijski upit radi (uzorak ${s.size}/${PROBE_LIMIT})`);
    }
  } catch (e) {
    err(`${c}: aplikacijski upit PUKAO (${e.code || e.message}) — sajt je polomljen`);
  }
}

console.log("\n=== 2) Worker (edge) ===");
const endpoints = [
  "/api/public/home-bundle",
  "/api/public/products?limit=200",
  "/api/public/distilleries?limit=200",
];
let totalReads = 0;
for (const p of endpoints) {
  try {
    const res = await fetch(EDGE + p, { headers: { accept: "application/json" } });
    const cache = res.headers.get("x-cache-status") || "-";
    const reads = res.headers.get("x-firestore-reads");
    if (reads === null) {
      err(`${p}: nema x-firestore-reads — Worker je stara verzija, nema atribucije potrosnje`);
      continue;
    }
    totalReads += Number(reads) || 0;
    if (!res.ok) err(`${p}: HTTP ${res.status}`);
    else ok(`${p}  cache=${cache} reads=${reads}`);
  } catch (e) {
    err(`${p}: nedostupan (${e.message})`);
  }
}
console.log(`  ukupno procitano dokumenata u ovoj proveri: ${totalReads} (Worker) + do ${2 * PROBE_LIMIT} (direktne probe iznad)`);

console.log("\n=== 3) App Check na produkciji ===");
try {
  /**
   * Site key ne mora da bude u entry bundle-u: Vite ga smesti u onaj chunk u koji je
   * zavrsio `src/lib/appCheck.ts` (kod nas `assets/firebase-*.js`), a taj chunk nije
   * naveden u index.html. Zato se lista svih fajlova cita iz precache manifesta u sw.js.
   */
  const sw = await (await fetch(SITE + "/sw.js?cb=" + Math.random().toString(36).slice(2))).text();
  const chunks = [...new Set((sw.match(/assets\/[A-Za-z0-9._-]+\.js/g) || []))];
  if (!chunks.length) {
    err("ne mogu da procitam listu bundle-ova iz sw.js");
  } else {
    // Trazi se tacno reCAPTCHA site key kao string literal (40 znakova, pocinje sa "6L"),
    // a ne bilo koji "6L..." niz — inace minifikovani kod ume da da lazan pogodak.
    const KEY_RE = /["'`]6L[A-Za-z0-9_-]{38}["'`]/;
    // Najverovatniji chunk-ovi prvi, da se u dobrom slucaju ne skida ceo build.
    chunks.sort((a, b) => rank(a) - rank(b));
    let found = null;
    for (const c of chunks) {
      const js = await (await fetch(`${SITE}/${c}`)).text();
      const m = js.match(KEY_RE);
      if (m) { found = { chunk: c, key: m[0].slice(1, -1) }; break; }
    }
    if (found) ok(`App Check site key je u build-u (${found.chunk}, ${found.key.slice(0, 12)}...)`);
    else console.log(`  info  App Check jos NIJE ukljucen (site key nije ni u jednom od ${chunks.length} chunk-ova) — docs/APP-CHECK-UPUTSTVO.md`);
  }
} catch (e) {
  err("provera produkcije nije uspela: " + e.message);
}

function rank(p) {
  if (/\/firebase/.test(p)) return 0;
  if (/\/index-/.test(p)) return 1;
  if (/\/App-/.test(p)) return 2;
  return 3;
}

console.log(bad === 0 ? "\nSVE U REDU." : `\nPROBLEMA: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
