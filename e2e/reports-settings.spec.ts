import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

// Reports used to be one page of charts here, exported from a single
// /portal/reports/export. It is a card hub now — every report is its own page
// with its own export — and `admin` no longer holds the Report resource at all.
// All three of those changes are covered by e2e/reports-hub.spec.ts, which owns
// reports outright; what is left in this file is settings.

test("admin can customize pipeline stages", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/pipeline");
  await expect(page.getByText("Pipeline Stages")).toBeVisible();
  await expect(page.getByText("New Appointment")).toBeVisible();

  await page.getByRole("button", { name: /Add Stage/ }).click();
  const unique = `QA Stage ${Date.now() % 100000}`;
  await page.getByPlaceholder(/Adjuster Meeting/).fill(unique);
  await page.getByRole("button", { name: /^Add$/ }).click();
  await expect(page.getByText(unique)).toBeVisible({ timeout: 10000 });
});

test("admin can open all settings sections", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  for (const path of [
    "/portal/settings/fields",
    "/portal/settings/branding",
    "/portal/settings/roles",
    "/portal/settings/commissions",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
  }
  await expect(page.getByText(/Commission Rules/).first()).toBeVisible();
});

test("sales rep cannot access settings", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/settings");
  await expect(page).not.toHaveURL(/\/portal\/settings$/);
  await page.goto("/portal/settings/branding");
  await expect(page).not.toHaveURL(/\/portal\/settings\/branding/);
});
