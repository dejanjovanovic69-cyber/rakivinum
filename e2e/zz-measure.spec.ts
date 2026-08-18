import { test, expect, type Page } from "@playwright/test";

const SITE = "https://rakivinum.com";
test.use({ serviceWorkers: "block" });

type Hit = { url: string; cache: string; reads: number; status: number };

function attach(p: Page, hits: Hit[]) {
  p.on("response", (res) => {
    const u = res.url();
    if (!/workers\.dev|firestore\.googleapis\.com/.test(u)) return;
    hits.push({
      url: u.replace(/^https?:\/\/[^/]+/, ""),
      cache: res.headers()["x-cache-status"] || "-",
      reads: Number(res.headers()["x-firestore-reads"] ?? -1),
      status: res.status(),
    });
  });
}

async function gate(p: Page) {
  const b = p.locator("button", { hasText: /18\+/ }).first();
  await b.waitFor({ state: "visible", timeout: 30_000 });
  await b.click();
}

function report(label: string, hits: Hit[]) {
  console.log(`\n########## ${label} ##########`);
  let total = 0;
  let unknown = 0;
  for (const h of hits) {
    if (h.reads >= 0) total += h.reads;
    else unknown += 1;
    console.log(`  reads=${String(h.reads).padStart(4)}  cache=${h.cache.padEnd(11)} ${h.url.slice(0, 80)}`);
  }
  console.log(`  ---`);
  console.log(`  UKUPNO Firestore dokumenata preko Workera: ${total}`);
  console.log(`  zahteva bez x-firestore-reads (direktan Firestore iz pregledaca): ${unknown}`);
}

test("scenario: pocetna + 3 etikete, prazan kes", async ({ page }) => {
  const hits: Hit[] = [];
  attach(page, hits);

  await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(13_000);

  // tri razlicita proizvoda = tri razlicita kljuca kesa
  const ids = ["xMpj0JXh945cy0hZMh3I", "86I3PQHk0wgJr7MkV1Nh", "Y3ywmIhFwtWDY0QOjiNr"];
  for (const id of ids) {
    await page.goto(`${SITE}/label/${id}`, { waitUntil: "load", timeout: 60_000 });
    await page.mouse.click(200, 300);
    await page.waitForTimeout(9_000);
  }

  report("POCETNA + 3 ETIKETE", hits);
  expect(true).toBe(true);
});

test("scenario: obilazak stranica", async ({ page }) => {
  const hits: Hit[] = [];
  attach(page, hits);

  await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(12_000);
  for (const path of ["/community", "/distilleries", "/moja-riznica", "/my-clubs"]) {
    await page.goto(SITE + path, { waitUntil: "load", timeout: 60_000 });
    await page.mouse.click(200, 300);
    await page.waitForTimeout(9_000);
  }

  report("OBILAZAK STRANICA", hits);
  expect(true).toBe(true);
});
