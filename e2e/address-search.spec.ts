import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

// Seeded leads live at "100 Oak Street" … "109 Oak Street", Dallas TX 75201 —
// so a street number picks exactly one deal and the ZIP picks the whole set.

test("appointments: search finds a deal by street address and by ZIP", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads");

  const search = page.getByLabel("Search appointments");
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 15000 });

  // Street number + street: one house, and it is the right one. "105 Oak Street"
  // belongs to Linda Davis, whose name the query does not contain.
  await search.fill("105 Oak");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Linda Davis");

  // ZIP alone matches the whole seeded neighbourhood.
  await search.fill("75201");
  expect(await rows.count()).toBeGreaterThan(1);

  // City still works, and a real miss still misses.
  await search.fill("Dallas");
  expect(await rows.count()).toBeGreaterThan(1);
  await search.fill("Nowhereville");
  await expect(page.getByText("No appointments match")).toBeVisible();
});

test("pipeline: page search filters cards by an address the card never shows", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");

  const cards = page.locator('[data-testid="pipeline-card"]:visible');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });

  // Cards render the city, never the street — this only passes because the
  // address rides along in data-search-text.
  await page.getByLabel("Search this page").fill("108 Oak");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Kevin Taylor");

  await page.getByLabel("Search this page").fill("75201");
  expect(await cards.count()).toBeGreaterThan(1);
});
