/**
 * Provera Firestore pravila iz ugla ANONIMNOG posetioca.
 *
 *   node scripts/firestore-rules-check.mjs
 *
 * Koristi javni Firebase konfig iz `firebase-applet-config.json` — isti onaj koji je
 * vidljiv svakome ko otvori DevTools na sajtu. Poenta i jeste da se vidi šta stranac može.
 *
 * Ništa ne upisuje: „napadi“ u drugom delu MORAJU biti odbijeni, pa odbijanje znači da
 * nijedan dokument nije nastao. Ako neki prođe, to je rupa i skripta izlazi sa kodom 1.
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, doc, addDoc, updateDoc, getDocs,
  query, limit, serverTimestamp, Timestamp,
} from "firebase/firestore";

const cfg = JSON.parse(readFileSync(new URL("../firebase-applet-config.json", import.meta.url), "utf8"));
const db = getFirestore(initializeApp(cfg), cfg.firestoreDatabaseId);

let holes = 0;

console.log("=== 1) DUMP CELE KOLEKCIJE (list bez limita) — sve mora biti blokirano ===");
for (const c of ["ratings", "licenses", "products", "distilleries", "club_memberships", "guest_saved_items", "users", "scans"]) {
  try {
    const s = await getDocs(collection(db, c));
    console.log(`  RUPA  ${c.padEnd(20)} procitano ${s.size} dokumenata`);
    holes += 1;
  } catch (e) {
    console.log(`  ok    ${c.padEnd(20)} blokirano (${e.code || e.message})`);
  }
}

console.log("\n=== 2) UPITI KOJE APLIKACIJA KORISTI — moraju da rade ===");
for (const [c, n] of [["products", 200], ["distilleries", 200], ["ratings", 200]]) {
  try {
    const s = await getDocs(query(collection(db, c), limit(n)));
    console.log(`  ok    ${c.padEnd(20)} limit(${n}) -> ${s.size}`);
  } catch (e) {
    console.log(`  PUKLO ${c.padEnd(20)} limit(${n}) (${e.code || e.message})  <-- aplikacija ce se polomiti`);
    holes += 1;
  }
}
try {
  await getDocs(query(collection(db, "licenses"), limit(1)));
  console.log("  RUPA  licenses             lista je citljiva anonimno");
  holes += 1;
} catch {
  console.log("  ok    licenses             lista blokirana (samo admin)");
}

console.log("\n=== 3) NAPADI — svi moraju biti odbijeni (odbijanje = nista nije upisano) ===");
const first = await getDocs(query(collection(db, "products"), limit(1)));
const pid = first.docs[0]?.id;
if (!pid) {
  console.log("  (nema proizvoda za test)");
} else {
  const attacks = [
    ["lazna prosecna ocena 5.0 / 99999 glasova", () => updateDoc(doc(db, "products", pid), { averageRating: 5, ratingCount: 99999 })],
    ["ocena van opsega (rating=99)", () => addDoc(collection(db, "ratings"), { productId: pid, rating: 99, reviewText: "x", isFlagged: false, createdAt: serverTimestamp(), userId: null })],
    ["podmetnut datum ocene", () => addDoc(collection(db, "ratings"), { productId: pid, rating: 5, reviewText: "x", isFlagged: false, createdAt: Timestamp.fromDate(new Date(2020, 0, 1)), userId: null })],
    ["ocena sa tudjim userId", () => addDoc(collection(db, "ratings"), { productId: pid, rating: 5, reviewText: "x", isFlagged: false, createdAt: serverTimestamp(), userId: "tudji-uid-123" })],
    ["sken sa izmisljenim source", () => addDoc(collection(db, "scans"), { productId: pid, timestamp: serverTimestamp(), source: "hack", userId: null })],
    ["izmena naziva proizvoda", () => updateDoc(doc(db, "products", pid), { name: "HAKOVANO" })],
  ];
  for (const [name, fn] of attacks) {
    try { await fn(); console.log(`  RUPA  ${name} — PROSLO`); holes += 1; }
    catch (e) { console.log(`  ok    ${name} (${e.code || e.message})`); }
  }
}

console.log(holes === 0 ? "\nSVE U REDU — nijedna rupa." : `\nPRONADJENO PROBLEMA: ${holes}`);
process.exit(holes === 0 ? 0 : 1);
