/**
 * Provera da li reCAPTCHA SECRET key odgovara SITE key-u koji je u produkcijskom build-u.
 *
 * Zasto ovako: App Check na 403 uvek kaze samo "App attestation failed", bez razloga —
 * pa se pogresan secret ne razlikuje od niskog reCAPTCHA skora. Google-ov `siteverify`
 * te dve stvari razdvaja: neslaganje secret-a vraca `invalid-input-secret` NEZAVISNO
 * od skora, pa provera radi i iz automatizovanog pregledaca.
 *
 * Secret se NE prosledjuje kao argument (zavrsio bi u istoriji komandi). Cita se iz:
 *   1. promenljive okruzenja RECAPTCHA_SECRET, ili
 *   2. fajla .env.recaptcha-secret u korenu repoa (pokriven .gitignore-om preko `.env*`)
 *
 * Pokretanje:  node scripts/recaptcha-secret-check.mjs
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";

const SITE = process.env.DIAG_SITE || "https://rakivinum.com";
const SECRET_FILE = new URL("../.env.recaptcha-secret", import.meta.url);

function readSecret() {
  if (process.env.RECAPTCHA_SECRET) return process.env.RECAPTCHA_SECRET.trim();
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
  return "";
}

const secret = readSecret();
if (!secret) {
  console.error("Nema secret-a. Postavi RECAPTCHA_SECRET ili napravi .env.recaptcha-secret");
  process.exit(2);
}

// Site key se cita iz ZIVOG build-a, da se proverava tacno ono sto je na produkciji.
const swText = await (await fetch(`${SITE}/sw.js?cb=${Math.random().toString(36).slice(2)}`)).text();
const chunks = [...new Set(swText.match(/assets\/[A-Za-z0-9._-]+\.js/g) || [])]
  .sort((a, b) => (/\/firebase/.test(b) ? 1 : 0) - (/\/firebase/.test(a) ? 1 : 0));

let siteKey = "";
for (const c of chunks) {
  const m = (await (await fetch(`${SITE}/${c}`)).text()).match(/["'`](6L[A-Za-z0-9_-]{38})["'`]/);
  if (m) { siteKey = m[1]; break; }
}
if (!siteKey) {
  console.error("Site key nije nadjen u build-u — App Check nije ni ukljucen.");
  process.exit(2);
}
console.log("site key iz build-a:", siteKey.slice(0, 12) + "...");
console.log("secret:            ", secret.slice(0, 12) + "... (duzina " + secret.length + ")");

// Svez v3 token, istim putem kojim ga pravi App Check (nevidljiv widget + execute).
const b = await chromium.launch();
const page = await (await b.newContext({ serviceWorkers: "block" })).newPage();
await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
try { await page.locator("button", { hasText: /18\+/ }).first().click({ timeout: 20_000 }); } catch { /* gate se ne mora pojaviti */ }
await page.waitForTimeout(5000);

const token = await page.evaluate(
  (key) =>
    new Promise((res, rej) => {
      if (!window.grecaptcha) return rej(new Error("grecaptcha nije ucitana"));
      const div = document.createElement("div");
      div.style.display = "none";
      document.body.appendChild(div);
      window.grecaptcha.ready(() => {
        const wid = window.grecaptcha.render(div, { sitekey: key, size: "invisible" });
        window.grecaptcha.execute(wid, { action: "fire_app_check" }).then(res, rej);
      });
    }),
  siteKey,
);
await b.close();

const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ secret, response: token }),
});
const j = await r.json();
const codes = j["error-codes"] || [];

console.log("\nsiteverify odgovor:", JSON.stringify(j));
console.log("");

if (codes.includes("invalid-input-secret")) {
  console.log("REZULTAT: SECRET NE VALJA — ne odgovara ovom site key-u.");
  console.log("Uzmi secret iz ISTOG para kao site key gore i zameni ga u Firebase konzoli.");
  process.exit(1);
}
if (codes.includes("invalid-input-response") || codes.includes("timeout-or-duplicate")) {
  console.log("REZULTAT: token je istekao ili je vec iskoriscen — pokreni ponovo.");
  process.exit(1);
}
if (j.success === true) {
  console.log(`REZULTAT: SECRET ODGOVARA site key-u. (skor ${j.score}, hostname ${j.hostname})`);
  if (typeof j.score === "number" && j.score < 0.5) {
    console.log("Nizak skor je ocekivan — token je pravio automatizovan pregledac; to NE utice na ovu proveru.");
  }
  process.exit(0);
}
console.log("REZULTAT: neodredjeno —", codes.length ? codes.join(", ") : "bez error-codes");
process.exit(1);
