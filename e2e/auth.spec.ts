import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function logout(page: Page) {
  await page.context().clearCookies();
}

test("public homepage renders hero + CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Restoring Roofs");
  await expect(page.getByRole("link", { name: /Request Free Roof Inspection/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Team Login/i }).first()).toBeVisible();
});

test("unauthenticated portal access redirects to login", async ({ page }) => {
  await page.goto("/portal/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("super admin lands on dashboard and sees company-wide leads", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await expect(page).toHaveURL(/\/portal\/dashboard/);
  await expect(page.getByText("Total Appointments")).toBeVisible();
  await page.goto("/portal/leads");
  // Seed creates 10 leads; admin should see them all (e.g. Johnson).
  await expect(page.getByRole("cell", { name: /Johnson/ }).first()).toBeVisible();
  await logout(page);
});

test("sales rep can reach dashboard and pipeline", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await expect(page).toHaveURL(/\/portal\/dashboard/);
  await expect(page.getByText(/Welcome back, Tyler/)).toBeVisible();
  await page.goto("/portal/pipeline");
  await expect(page.getByText("Roofing Pipeline")).toBeVisible();
  await logout(page);
});

test("customer is isolated to their own portal", async ({ page }) => {
  await login(page, "customer@anexahomes.com");
  await expect(page).toHaveURL(/\/portal\/customer/);
  await expect(page.getByText(/Welcome, Robert/)).toBeVisible();

  // Customer must NOT be able to view the company leads list.
  await page.goto("/portal/leads");
  await expect(page).not.toHaveURL(/\/portal\/leads$/);
  await logout(page);
});

test("accounting can view payroll, sales rep cannot", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");
  await page.goto("/portal/payroll");
  await expect(page).toHaveURL(/\/portal\/payroll/);
  await expect(page.getByText(/Payroll & Accounting/)).toBeVisible();
  await logout(page);

  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/payroll");
  // Rep lacks Payroll read -> redirected to dashboard.
  await expect(page).not.toHaveURL(/\/portal\/payroll/);
  await logout(page);
});
