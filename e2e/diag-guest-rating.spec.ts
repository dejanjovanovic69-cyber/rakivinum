import { test, expect, type Page } from "@playwright/test";

/**
 * Poslednja neproverena stvar iz docs/FIRESTORE-PIK-NALAZ-2026-08-18.md (sekcija 7, korak 2):
 * ocenjivanje kao NEPRIJAVLJEN GOST na /label/:id — najrizičnije pravilo posle hardeningа,
 * jer traži i `isValidRatingCreate` (create u `ratings`) i `isRatingAggregateBump`
 * (update `products.averageRating` + `ratingCount` u istoj transakciji).
 *
 * PAŽNJA: ovaj test STVARNO UPISUJE u produkcijsku bazu — jedna ocena „Gost“ bez recenzije.
 * Zato je pod prekidačem i nikad ne ide u redovni run:
 *
 *   DIAG_GUEST_RATING=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-guest-rating --workers=1
 *
 * Pravilo „jedan glas dnevno“ se drži u localStorage po visitorId-u, pa svež browser
 * kontekst (Playwright uvek daje svež) uvek sme da glasa.
 */

const SITE = process.env.DIAG_SITE || "https://rakivinum.com";
const PRODUCT_ID = process.env.DIAG_PRODUCT_ID || "xMpj0JXh945cy0hZMh3I";

test.skip(process.env.DIAG_GUEST_RATING !== "1", "postavi DIAG_GUEST_RATING=1 (UPISUJE u produkciju)");
test.use({ serviceWorkers: "block" });

function watchDenied(p: Page, bag: string[]) {
  p.on("console", (m) => {
    const t = m.text();
    if (/permission[- ]denied|insufficient permissions|Missing or/i.test(t)) bag.push(`[${m.type()}] ${t.slice(0, 300)}`);
  });
  p.on("pageerror", (e) => bag.push("PAGEERROR " + String(e).slice(0, 300)));
}

async function passAgeGate(p: Page) {
  const b = p.locator("button", { hasText: /18\+/ }).first();
  await b.waitFor({ state: "visible", timeout: 30_000 });
  await b.click();
}

test("gost moze da oceni proizvod (create ratings + bump agregata)", async ({ page }) => {
  const denied: string[] = [];
  watchDenied(page, denied);

  await page.goto(`${SITE}/label/${PRODUCT_ID}`, { waitUntil: "load", timeout: 60_000 });
  await passAgeGate(page);
  await page.waitForTimeout(12_000); // Home/Label puštaju mrežni refresh sa zakašnjenjem

  const openRating = page.locator("button", { hasText: /^Oceni proizvod$/ }).first();
  await openRating.waitFor({ state: "visible", timeout: 30_000 });
  await openRating.click();

  const modal = page.locator("h3", { hasText: "Oceni Proizvod" });
  await modal.waitFor({ state: "visible", timeout: 15_000 });

  // Senzorske ocene ostaju na podrazumevanih 4/5 → prosek 4.0. Recenzija ostaje prazna
  // (reviewText: null) da test ostavi najmanji možući trag u javnom feed-u.
  const submit = page.locator("button", { hasText: /^Snimi ocenu$/ }).first();
  await submit.click();

  // Uspeh = modal „Ocena je uspešno sačuvana“. Ako pravila odbiju upis, ovaj modal
  // se nikad ne pojavi i u `denied` stoji permission-denied.
  const ok = page.locator("h3", { hasText: "Ocena je uspešno sačuvana" });
  await ok.waitFor({ state: "visible", timeout: 45_000 });

  const body = await page.locator("body").innerText();
  const avg = body.match(/DNA ocena\s+([0-9.]+)/)?.[1];
  console.log("UPISANA OCENA:", avg ?? "(nije procitana iz teksta)");
  console.log("PERMISSION-DENIED:", denied.length ? denied.join("\n  ") : "nema");

  expect(denied, "nijedan permission-denied ne sme da se pojavi").toEqual([]);
});
