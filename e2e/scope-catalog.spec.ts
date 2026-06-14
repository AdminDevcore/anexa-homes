import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("scope catalog: seeded, searchable, filterable, no pricing", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/scope-template");

  await expect(page.getByRole("heading", { name: "Scope of Work Catalog" })).toBeVisible();

  // Seeded restoration items across trades — and NO price columns.
  await expect(page.locator('input[value="Drip edge"]')).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Common" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Supplement" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Active" })).toBeVisible();
  await expect(page.getByText(/insurance price/i)).toHaveCount(0);

  // Items span many trades (not just roofing)
  await expect(page.locator('input[value="Water extraction"]')).toBeVisible();
  await expect(page.locator('input[value="Standing seam metal roofing"]')).toBeVisible();

  // Search narrows the list
  await page.getByPlaceholder("Search line items…").fill("solar");
  await expect(page.locator('input[value="Solar panel detach and reset"]')).toBeVisible();
  await expect(page.locator('input[value="Drip edge"]')).toHaveCount(0);

  await page.context().clearCookies();
});

test("scope catalog: add a new line item", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/scope-template");

  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByPlaceholder("e.g. Drip edge").fill("Custom test item");
  await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();

  await expect(page.locator('input[value="Custom test item"]')).toBeVisible({ timeout: 10000 });

  await page.context().clearCookies();
});
