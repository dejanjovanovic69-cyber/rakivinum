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
});
