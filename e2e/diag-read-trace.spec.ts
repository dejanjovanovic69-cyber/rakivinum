import { test, expect, type Page } from "@playwright/test";

/**
 * Dijagnostika potrošnje: meri šta JEDAN ulazak stvarno pošalje ka Workeru i Firestore-u.
 *
 * Ne ide uz obični `npm run test:e2e` — gađa produkciju. Pokretanje:
 *   DIAG_READ_TRACE=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-read-trace --workers=1
 *
 * Zbir `x-firestore-reads` iz izveštaja uporedi sa Firebase → Firestore → Usage za isti
 * minut. Ako je konzola bitno veća, read-ovi NE dolaze iz aplikacije.
 */

const ENABLED = process.env.DIAG_READ_TRACE === "1";
const SITE = process.env.DIAG_SITE || "https://rakivinum.com";
const PRODUCT_ID = process.env.DIAG_PRODUCT_ID || "xMpj0JXh945cy0hZMh3I";

test.skip(!ENABLED, "postavi DIAG_READ_TRACE=1 da bi se pokrenulo (gađa produkciju)");
test.use({ serviceWorkers: "block" });

/** Presretanje u stranici — hvata i ono što bi service worker sakrio od page event-ova. */
const PATCH = `
window.__hits = [];
const of = window.fetch;
window.fetch = function (...a) {
  try {
    const u = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || "";
    if (/firestore\\.googleapis\\.com|workers\\.dev/.test(u)) window.__hits.push({ kind: "fetch", url: String(u) });
  } catch (e) {}
  return of.apply(this, a);
};
const oo = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (m, u, ...r) {
  try {
    if (/firestore\\.googleapis\\.com|workers\\.dev/.test(String(u))) window.__hits.push({ kind: "xhr:" + m, url: String(u) });
  } catch (e) {}
  return oo.call(this, m, u, ...r);
};
`;

type Hit = { kind: string; url: string };

/**
 * Age gate zaključava CELU aplikaciju (`App.tsx`: `if (!ageOk) return <AgeGate/>`).
 * Mora se sačekati da se dugme pojavi — provera `count()` odmah posle `goto` vraća 0
 * jer React još nije hidrirao, klik se preskoči i merenje lažno pokaže nula zahteva.
 */
async function passGate(p: Page) {
  const btn = p.locator("button", { hasText: /18\+/ }).first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  await btn.click();
}

/** Home pušta mrežni refresh tek na interakciji ILI posle 10 s (`Home.tsx` boot-safe gate). */
async function nudge(p: Page, ms = 15_000) {
  await p.mouse.move(200, 300);
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(ms);
}

async function report(p: Page, label: string) {
  const hits: Hit[] = (await p.evaluate(() => (window as unknown as { __hits: Hit[] }).__hits)) || [];
  const fs = hits.filter((h) => h.url.includes("firestore.googleapis.com"));
  const edge = hits.filter((h) => !h.url.includes("firestore.googleapis.com"));

  console.log(`\n########## ${label} ##########`);
  console.log(`Firestore direktno iz pregledaca: ${fs.length} poziva`);
  const a = new Map<string, number>();
  for (const h of fs) {
    const k = `${h.kind} ${h.url.split("?")[0].replace("https://firestore.googleapis.com", "")}`;
    a.set(k, (a.get(k) || 0) + 1);
  }
  for (const [k, n] of a) console.log(`   x${String(n).padStart(3)}  ${k.slice(0, 140)}`);

  console.log(`Edge (Worker): ${edge.length} poziva`);
  const b = new Map<string, number>();
  for (const h of edge) {
    const k = h.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    b.set(k, (b.get(k) || 0) + 1);
  }
  for (const [k, n] of b) console.log(`   x${String(n).padStart(3)}  ${k}`);
}

test("A: samo pocetna", async ({ page }) => {
  await page.addInitScript(PATCH);
  await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
  await passGate(page);
  await nudge(page);
  await report(page, "A: SAMO POCETNA");
  expect(true).toBe(true);
});

test("B: etiketa", async ({ page }) => {
  await page.addInitScript(PATCH);
  await page.goto(`${SITE}/label/${PRODUCT_ID}`, { waitUntil: "load", timeout: 60_000 });
  await passGate(page);
  await nudge(page);
  await report(page, "B: ETIKETA");
  expect(true).toBe(true);
});

test("C: pocetna -> community -> destilerije", async ({ page }) => {
  await page.addInitScript(PATCH);
  await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
  await passGate(page);
  await nudge(page);
  await page.goto(SITE + "/community", { waitUntil: "load", timeout: 60_000 });
  await nudge(page, 12_000);
  await page.goto(SITE + "/distilleries", { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(12_000);
  await report(page, "C: TRI STRANICE");
  expect(true).toBe(true);
});
