import { test, expect, type Page } from "@playwright/test";

const SITE = "http://127.0.0.1:3111";
test.use({ serviceWorkers: "block" });

type Stats = { total: number; byPath: Record<string, number>; calls: Array<{ kind: string; path: string; docs: number }> };

async function gate(p: Page) {
  const b = p.locator("button", { hasText: /18\+/ }).first();
  await b.waitFor({ state: "visible", timeout: 40_000 });
  await b.click();
}

async function dump(p: Page, label: string) {
  const s = (await p.evaluate(() => (window as unknown as { __rvReads?: Stats }).__rvReads)) || {
    total: 0,
    byPath: {},
    calls: [],
  };
  console.log(`\n########## ${label} ##########`);
  console.log(`  KLIJENTSKI Firestore read-ovi (dokumenata): ${s.total}`);
  const entries = Object.entries(s.byPath).sort((a, b) => b[1] - a[1]);
  for (const [path, n] of entries) console.log(`     ${String(n).padStart(4)}  ${path}`);
  if (!entries.length) console.log("     (nijedan)");
  return s.total;
}

test("gost: pocetna + 3 etikete", async ({ page }) => {
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[rvReads]") || /permission|denied/i.test(t)) console.log("   " + t.slice(0, 160));
  });
  await page.goto(SITE + "/", { waitUntil: "load", timeout: 90_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(13_000);
  await dump(page, "GOST — samo pocetna");

  for (const id of ["xMpj0JXh945cy0hZMh3I", "86I3PQHk0wgJr7MkV1Nh", "Y3ywmIhFwtWDY0QOjiNr"]) {
    await page.goto(`${SITE}/label/${id}`, { waitUntil: "load", timeout: 90_000 });
    await page.mouse.click(200, 300);
    await page.waitForTimeout(8_000);
  }
  const total = await dump(page, "GOST — pocetna + 3 etikete (kumulativno po strani)");
  console.log(`\n  NAPOMENA: svaka navigacija je pun reload, pa se brojac resetuje; gornji broj je samo poslednja strana.`);
  expect(total).toBeGreaterThanOrEqual(0);
});

test("gost: SPA navigacija bez reload-a (realnije)", async ({ page }) => {
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[rvReads]")) console.log("   " + t.slice(0, 160));
  });
  await page.goto(SITE + "/", { waitUntil: "load", timeout: 90_000 });
  await gate(page);
  await page.mouse.click(200, 300);
  await page.waitForTimeout(12_000);

  // klik kroz aplikaciju, bez punog reload-a — ovako korisnik stvarno koristi sajt
  for (const path of ["/community", "/distilleries", "/my-clubs", "/moja-riznica"]) {
    await page.evaluate((p) => window.history.pushState({}, "", p), path);
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await page.waitForTimeout(7_000);
  }
  await dump(page, "GOST — SPA obilazak 5 stranica, jedna sesija");
  expect(true).toBe(true);
});
