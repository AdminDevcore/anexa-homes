import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openDeal(page: Page, query: string) {
  await page.goto(`/portal/leads?q=${query}`);
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");
}

test("manager sees Scope of Work with profit + margin on a scope-received deal", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page, "Linda");

  await page.getByRole("button", { name: "Scope of Work" }).click();

  // Seeded insurance RCV $13,530.00. Profit pool = RCV − cost − 10% overhead.
  // Old gross margin was $3,570 (26.4%); after the $1,353 overhead the pool is
  // $2,217.00 (16.4%).
  await expect(page.getByText("$13,530.00").first()).toBeVisible();
  // Cost + profit visible to management
  await expect(page.getByRole("columnheader", { name: "Cost $/u" })).toBeVisible();
  await expect(page.getByText("$2,217.00").first()).toBeVisible();
  await expect(page.getByText(/16\.\d%/).first()).toBeVisible();

  await page.context().clearCookies();
});

test("sales rep sees the scope but NOT cost or profit", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await openDeal(page, "Linda");

  await page.getByRole("button", { name: "Scope of Work" }).click();

  // Insurance side is visible (totals render as text)
  await expect(page.getByText("$13,530.00").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Insurance RCV" })).toBeVisible();
  // Cost & profit are stripped for reps
  await expect(page.getByRole("columnheader", { name: "Cost $/u" })).toHaveCount(0);
  await expect(page.getByText("Profit", { exact: true })).toHaveCount(0);

  await page.context().clearCookies();
});

test("no Scope of Work tab before Scope Received", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await openDeal(page, "David"); // David Kim — appointment_set stage

  await expect(page.getByRole("button", { name: "Scope of Work" })).toHaveCount(0);

  await page.context().clearCookies();
});

test("scope panel exposes cost/supplement template pickers + load-from-catalog", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await openDeal(page, "Linda");
  await page.getByRole("button", { name: "Scope of Work" }).click();

  // New template-driven controls + columns are present.
  await expect(page.getByText("Cost template").first()).toBeVisible();
  await expect(page.getByText("Supplement template").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Load from catalog/i })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Insurance RCV" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Supplement" })).toBeVisible();

  // Loading the catalog adds lines (catalog items become scope rows).
  const rowsBefore = await page.locator("table tbody tr").count();
  await page.getByRole("button", { name: /Load from catalog/i }).click();
  await expect.poll(async () => page.locator("table tbody tr").count()).toBeGreaterThan(rowsBefore);

  await page.context().clearCookies();
});
