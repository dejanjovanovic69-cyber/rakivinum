import { test, expect } from "@playwright/test";

/**
 * Provera App Check-a.
 *
 *   DIAG_APPCHECK=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-appcheck --workers=1
 *
 * VAŽNO — zašto razmena tokena NIJE tvrdi uslov na produkciji:
 * reCAPTCHA v3 je pravljena da obori automatizovan pregledač. U Playwright-u
 * `grecaptcha.execute()` ne vrati token (ni ne padne — samo visi), pa SDK nikad
 * ne stigne do `firebaseappcheck.googleapis.com`. To je očekivano i NE znači da je
 * App Check pokvaren; kod pravog korisnika reCAPTCHA se razreši normalno.
 *
 * Zato se ovde tvrdo proverava samo ono što automatizacija POUZDANO može:
 *   1. konzola ispisuje `[AppCheck] aktivan` (site key je ušao u build)
 *   2. učitava se reCAPTCHA skripta
 * Razmena tokena se ISPISUJE kao nalaz, ali ruši test tek uz DIAG_APPCHECK_STRICT=1.
 *
 * Kako STVARNO dokazati razmenu (dve mogućnosti):
 *   a) lokalno, preko debug tokena — App Check tada zaobilazi reCAPTCHA:
 *        - dodaj VITE_APPCHECK_RECAPTCHA_SITE_KEY u .env.local, pa `npm run dev`
 *        - u konzoli pregledača piše `App Check debug token: <uuid>`
 *        - upiši ga u Firebase → App Check → aplikacija → Manage debug tokens
 *        - pa: DIAG_APPCHECK=1 DIAG_APPCHECK_STRICT=1 DIAG_SITE=http://localhost:3000 ...
 *   b) na produkciji — Firebase konzola → App Check → Metrics, gde se posle par sati
 *      saobraćaj pravih korisnika vidi kao `verified`. To je i merilo za enforcement.
 */

const ENABLED = process.env.DIAG_APPCHECK === "1";
const STRICT = process.env.DIAG_APPCHECK_STRICT === "1";
const SITE = process.env.DIAG_SITE || "https://rakivinum.com";

test.skip(!ENABLED, "postavi DIAG_APPCHECK=1 (gađa produkciju)");
test.use({ serviceWorkers: "block" });

test("App Check je aktivan na produkciji", async ({ page }) => {
  const logs: string[] = [];
  const net: string[] = [];

  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/recaptcha|firebaseappcheck\.googleapis\.com/.test(u)) net.push(u.slice(0, 120));
  });

  await page.goto(SITE + "/", { waitUntil: "load", timeout: 60_000 });
  const btn = page.locator("button", { hasText: /18\+/ }).first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  await btn.click();
  await page.mouse.click(200, 300);
  await page.waitForTimeout(15_000);

  const appCheckLogs = logs.filter((l) => l.includes("[AppCheck]"));
  const recaptcha = net.filter((u) => /recaptcha/.test(u));
  const tokenExchange = net.filter((u) => u.includes("firebaseappcheck.googleapis.com"));

  console.log("\n=== App Check ===");
  console.log("konzola:", appCheckLogs.length ? appCheckLogs.join(" | ") : "(nema [AppCheck] poruka)");
  console.log("reCAPTCHA zahteva:", recaptcha.length);
  console.log("token exchange zahteva:", tokenExchange.length);
  tokenExchange.forEach((u) => console.log("   ", u));

  const disabled = appCheckLogs.some((l) => l.includes("ISKLJUČEN"));
  if (disabled) {
    console.log("\nApp Check je ISKLJUČEN — VITE_APPCHECK_RECAPTCHA_SITE_KEY nije u build-u.");
    console.log("Postavi ga u .env.production, pa `npm run build && npm run cf:pages:deploy`.");
  } else if (tokenExchange.length === 0) {
    console.log(
      "\nNema razmene tokena — očekivano u automatizovanom pregledaču (reCAPTCHA v3 ga obara).\n" +
        "Za pravi dokaz vidi komentar na vrhu ovog fajla (debug token lokalno, ili Metrics u konzoli).",
    );
  }

  expect(disabled, "App Check je iskljucen — site key nije usao u build").toBe(false);
  expect(recaptcha.length, "reCAPTCHA skripta se nije ucitala").toBeGreaterThan(0);
  if (STRICT) {
    expect(tokenExchange.length, "nema razmene za App Check token (DIAG_APPCHECK_STRICT=1)").toBeGreaterThan(0);
  }
});
