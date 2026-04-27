import { test, expect, type Page } from "@playwright/test";

async function acceptAgeGateIfShown(page: Page) {
  const yes = page.getByRole("button", { name: /Da, imam 18\+/ });
  await yes.click({ timeout: 15_000 }).catch(() => {});
}

/**
 * Javni smoke: ne zahteva login. Pokreće lokalni Vite (playwright.config webServer)
 * ili koristi PLAYWRIGHT_BASE_URL + PLAYWRIGHT_SKIP_WEBSERVER=1 za staging/prod.
 */
test.describe("public routes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await acceptAgeGateIfShown(page);
  });

  test("home renders shell", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Rakivinum", exact: true })).toBeAttached({
      timeout: 20_000,
    });
  });

  test("community utisci: no endless buradi spinner", async ({ page }) => {
    await page.goto("/community");
    await expect(page.getByRole("heading", { name: /Utisci zajednice/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText("Osluškujemo tajne buradi")).toBeHidden({ timeout: 25_000 });
  });

  test("community reviews tab deep link", async ({ page }) => {
    await page.goto("/community?tab=reviews");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /Utisci zajednice/i })).toBeVisible({ timeout: 25_000 });
  });

  test("distilleries catalog heading", async ({ page }) => {
    await page.goto("/distilleries");
    await expect(page.getByRole("heading", { name: /Destilerije/i })).toBeVisible({
      timeout: 25_000,
    });
  });

  test("community compare tab deep link", async ({ page }) => {
    await page.goto("/community?tab=compare");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /Uporedi 2 artikla/i })).toBeVisible({ timeout: 25_000 });
  });

  test("community compare tab applies lq and rq from URL", async ({ page }) => {
    await page.goto("/community?tab=compare&lq=left-compare-smoke&rq=right-compare-smoke");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    const compareInputs = page.getByPlaceholder("Pretraži naziv...");
    await expect(compareInputs.first()).toHaveValue("left-compare-smoke", { timeout: 25_000 });
    await expect(compareInputs.nth(1)).toHaveValue("right-compare-smoke", { timeout: 25_000 });
  });

  test("community compare tab applies cf from URL", async ({ page }) => {
    await page.goto("/community?tab=compare&cf=sljivovica");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /Uporedi 2 artikla/i })).toBeVisible({ timeout: 25_000 });
    const sljChip = page.getByRole("button", { name: "Šljivovice" });
    await expect(sljChip).toBeVisible({ timeout: 25_000 });
    await expect(sljChip).toHaveClass(/bg-gold-500/);
  });

  test("community events tab deep link", async ({ page }) => {
    await page.goto("/community?tab=events");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /Manifestacije i događaji/i })).toBeVisible({
      timeout: 25_000,
    });
  });

  test("community producers tab deep link", async ({ page }) => {
    await page.goto("/community?tab=producers");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /Rakijski i vinski putevi/i })).toBeVisible({ timeout: 25_000 });
  });

  test("community tops tab deep link", async ({ page }) => {
    await page.goto("/community?tab=tops");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Top 10 Rakija/i)).toBeVisible({ timeout: 25_000 });
  });

  test("community search tab deep link", async ({ page }) => {
    await page.goto("/community?tab=search");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByPlaceholder(/Pretraži proizvode/i)).toBeVisible({ timeout: 25_000 });
  });

  test("community search tab applies q from URL", async ({ page }) => {
    await page.goto("/community?tab=search&q=rakija-smoke");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByPlaceholder(/Pretraži proizvode/i)).toHaveValue("rakija-smoke", { timeout: 25_000 });
  });

  test("community search tab applies pf from URL", async ({ page }) => {
    await page.goto("/community?tab=search&pf=sljivovica");
    await expect(page.getByRole("heading", { name: /Zajednica/i })).toBeVisible({ timeout: 25_000 });
    const sljFilter = page.getByRole("button", { name: "Šljivovica" });
    await expect(sljFilter).toBeVisible({ timeout: 25_000 });
    await expect(sljFilter).toHaveClass(/bg-gold-500/);
  });

  test("collection route: guest empty or archive shell", async ({ page }) => {
    await page.goto("/collection");
    const guestEmpty = page.getByRole("heading", { name: /Kolekcija čeka/i });
    const archive = page.getByRole("heading", { name: /Arhiva/i });
    await expect(guestEmpty.or(archive)).toBeVisible({ timeout: 35_000 });
  });

  test("menu shows identity heading", async ({ page }) => {
    await page.goto("/menu");
    await expect(page.getByRole("heading", { name: /Gost|Korisnik/i })).toBeVisible({ timeout: 25_000 });
  });

  test("scanner shell heading", async ({ page }) => {
    await page.goto("/scan");
    await expect(page.getByRole("heading", { name: /Skeniraj Rakiju ili Vino/i })).toBeVisible({ timeout: 25_000 });
  });

  test("workshop radionica shell heading", async ({ page }) => {
    await page.goto("/radionica");
    await expect(page.getByRole("heading", { name: /Radionica/i })).toBeVisible({ timeout: 25_000 });
  });

  test("my clubs shell heading", async ({ page }) => {
    await page.goto("/my-clubs");
    await expect(page.getByRole("heading", { name: /Moji klubovi/i })).toBeVisible({ timeout: 25_000 });
  });

  test("activate page without token shows licence form", async ({ page }) => {
    await page.goto("/activate");
    await expect(page.getByRole("heading", { name: /Aktivacija licence/i })).toBeVisible({ timeout: 25_000 });
  });

  test("label page resolves missing product state", async ({ page }) => {
    await page.goto("/label/e2e-missing-product-id-00000");
    const notInDb = page.getByRole("heading", { name: /Proizvod nije u bazi/i });
    const quota = page.getByRole("heading", { name: /Privremeno nedostupno/i });
    const archived = page.getByRole("heading", { name: /Proizvod nije dostupan/i });
    const qrOff = page.getByRole("heading", { name: /Javni pristup je isključen/i });
    await expect(notInDb.or(quota).or(archived).or(qrOff)).toBeVisible({ timeout: 35_000 });
  });

  test("distillery page shows unavailable for bogus id", async ({ page }) => {
    await page.goto("/distillery/e2e-missing-distillery-00000");
    await expect(page.getByText(/Proizvođač nije dostupan/i)).toBeVisible({ timeout: 35_000 });
  });
});
