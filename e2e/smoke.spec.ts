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
});
