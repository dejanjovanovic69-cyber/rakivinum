import { test, expect } from "@playwright/test";

/**
 * Provera da je App Check STVARNO aktivan na produkciji (ne samo da je kod deploy-ovan).
 *
 *   DIAG_APPCHECK=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-appcheck --workers=1
 *
 * Tri nezavisna dokaza, jer svaki pojedinačno može da prevari:
 *   1. konzola ispisuje `[AppCheck] aktivan`
 *   2. učitava se reCAPTCHA skripta (google.com/recaptcha ili recaptcha.net)
 *   3. ide poziv ka `firebaseappcheck.googleapis.com` (razmena za App Check token)
 *
 * Dokaz 3 je najvažniji: bez njega SDK nije dobio token i enforcement bi oborio sajt.
 */

const ENABLED = process.env.DIAG_APPCHECK === "1";
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
  }

  expect(disabled, "App Check je iskljucen — site key nije usao u build").toBe(false);
  expect(recaptcha.length, "reCAPTCHA skripta se nije ucitala").toBeGreaterThan(0);
  expect(tokenExchange.length, "nema razmene za App Check token — enforcement bi oborio sajt").toBeGreaterThan(0);
});
