import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("reports render with charts and export CSV", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/reports");
  await expect(page.getByText("Sales by Rep (Revenue)")).toBeVisible();
  await expect(page.getByText("Appointments by Source")).toBeVisible();
  await expect(page.getByText("Closing Rate")).toBeVisible();

  const res = await page.request.get("/portal/reports/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain("Sales by Rep");
});

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
