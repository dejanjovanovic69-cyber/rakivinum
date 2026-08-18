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
for (const [c, n] of [["products", 200], ["distilleries", 200]]) {
  try {
    const s = await getDocs(query(collection(db, c), limit(n)));
    ok(`${c}: aplikacijski upit radi (${s.size})`);
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
console.log(`  ukupno procitano dokumenata u ovoj proveri: ${totalReads}`);

console.log("\n=== 3) App Check na produkciji ===");
try {
  const html = await (await fetch(SITE + "/?cb=" + Math.random().toString(36).slice(2))).text();
  const bundle = (html.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0];
  if (!bundle) {
    err("ne mogu da nadjem glavni bundle u HTML-u");
  } else {
    const js = await (await fetch(`${SITE}/${bundle}`)).text();
    // site key zavrsi u bundlu tek kad je VITE_APPCHECK_RECAPTCHA_SITE_KEY postavljen
    const hasKey = /VITE_APPCHECK|6L[A-Za-z0-9_-]{30,}/.test(js);
    if (hasKey) ok(`App Check site key je u build-u (${bundle})`);
    else console.log(`  info  App Check jos NIJE ukljucen (nema site key u ${bundle}) — docs/APP-CHECK-UPUTSTVO.md`);
  }
} catch (e) {
  err("provera produkcije nije uspela: " + e.message);
}

console.log(bad === 0 ? "\nSVE U REDU." : `\nPROBLEMA: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
