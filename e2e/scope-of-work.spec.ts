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

  // Seeded totals: insurance $13,530.00, profit $3,570.00 (26.4%)
  await expect(page.getByText("$13,530.00").first()).toBeVisible();
  // Cost + profit visible to management
  await expect(page.getByRole("columnheader", { name: "Cost $/u" })).toBeVisible();
  await expect(page.getByText("$3,570.00").first()).toBeVisible();
  await expect(page.getByText(/26\.\d%/).first()).toBeVisible();

  await page.context().clearCookies();
});

test("sales rep sees the scope but NOT cost or profit", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await openDeal(page, "Linda");

  await page.getByRole("button", { name: "Scope of Work" }).click();

  // Insurance side is visible (totals render as text)
  await expect(page.getByText("$13,530.00").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Insurance", exact: true })).toBeVisible();
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
