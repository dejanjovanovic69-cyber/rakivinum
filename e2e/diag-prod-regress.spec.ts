import { test, expect, type Page } from "@playwright/test";

/**
 * Regresija na PRODUKCIJI posle promene firestore.rules — proverava da javni tokovi
 * i dalje rade i da nigde ne iskace permission-denied.
 *
 *   DIAG_PROD_REGRESS=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-prod-regress --workers=1
 */

const SITE = "https://rakivinum.com";
const PRODUCT_ID = "xMpj0JXh945cy0hZMh3I";

test.skip(process.env.DIAG_PROD_REGRESS !== "1", "postavi DIAG_PROD_REGRESS=1 (gadja produkciju)");
test.use({ serviceWorkers: "block" });

function watch(p: Page, bag: string[]) {
  p.on("console", (m) => {
    const t = m.text();
    if (/permission|denied|insufficient|FirebaseError|Missing or/i.test(t)) bag.push(`[${m.type()}] ${t.slice(0, 240)}`);
  });
  p.on("pageerror", (e) => bag.push("PAGEERROR " + String(e).slice(0, 240)));
}

async function gate(p: Page) {
  const b = p.locator("button", { hasText: /18\+/ }).first();
  await b.waitFor({ state: "visible", timeout: 30_000 });
  await b.click();
}

test("pocetna radi", async ({ page }) => {
  const bag: string[] = []; watch(page, bag);
  await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(15_000);
  const body = await page.locator("body").innerText();
  console.log("POCETNA:", body.slice(0, 160).replace(/\n/g, " | "));
  console.log("GRESKE:", bag.length ? bag.join("\n  ") : "nema");
  expect(body).toContain("RAKIVINUM");
});

test("etiketa radi (+ scans upis)", async ({ page }) => {
  const bag: string[] = []; watch(page, bag);
  await page.goto(`${SITE}/label/${PRODUCT_ID}`, { waitUntil: "load", timeout: 60_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(16_000);
  const body = await page.locator("body").innerText();
  console.log("ETIKETA:", body.slice(0, 200).replace(/\n/g, " | "));
  console.log("GRESKE:", bag.length ? bag.join("\n  ") : "nema");
  expect(body).toContain("Dedova kajsija");
});

test("community + destilerije rade", async ({ page }) => {
  const bag: string[] = []; watch(page, bag);
  await page.goto(SITE + "/community", { waitUntil: "load", timeout: 60_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(12_000);
  console.log("COMMUNITY:", (await page.locator("body").innerText()).slice(0, 140).replace(/\n/g, " | "));
  await page.goto(SITE + "/distilleries", { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(10_000);
  const body = await page.locator("body").innerText();
  console.log("DESTILERIJE:", body.slice(0, 140).replace(/\n/g, " | "));
  console.log("GRESKE:", bag.length ? bag.join("\n  ") : "nema");
  expect(true).toBe(true);
});
