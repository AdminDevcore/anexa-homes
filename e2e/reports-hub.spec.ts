import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("owner sees all report cards on the hub", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports");

  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  // Company-Report sections are now their own buttons, alongside the standalone reports.
  // Assert on the card headings (sidebar nav links like "Payroll" share their text).
  for (const name of [
    "Executive Summary",
    "Operations",
    "Financial",
    "Payroll",
    "Job Profitability",
    "Delinquency / Follow-up",
    "Contractor Pay",
  ]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  await page.context().clearCookies();
});

test("a Company-Report section opens and exports CSV", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports/operations");

  await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
  await expect(page.getByText("Appointments").first()).toBeVisible();

  const csvHref = await page.getByRole("link", { name: /CSV/ }).getAttribute("href");
  expect(csvHref).toContain("/portal/reports/operations/export");
  const csv = await page.request.get(csvHref!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  await page.context().clearCookies();
});

test("delinquency report opens, toggles due-soon, and exports", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports");
  await page.getByRole("link", { name: /Delinquency \/ Follow-up/ }).click();
  await page.waitForURL("**/portal/reports/delinquency**");

  await expect(page.getByRole("heading", { name: "Delinquency / Follow-up" })).toBeVisible();
  await expect(page.getByText("Deals tracked")).toBeVisible();

  // Include-due-soon toggle updates the URL.
  await page.getByRole("button", { name: "Include due soon" }).click();
  await page.waitForURL("**due=1*");

  // CSV export returns 200 / text-csv.
  const csvHref = await page.getByRole("link", { name: /CSV/ }).getAttribute("href");
  expect(csvHref).toContain("/portal/reports/delinquency/export");
  const csv = await page.request.get(csvHref!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  // PDF export returns 200 / pdf.
  const pdfHref = await page.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect(pdfHref).toContain("/portal/reports/delinquency/pdf");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  await page.context().clearCookies();
});

test("contractor pay report opens and exports", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports/contractor-pay");

  await expect(page.getByRole("heading", { name: "Contractor Pay" })).toBeVisible();
  await expect(page.getByText("Paid to contractors")).toBeVisible();
  await expect(page.getByText("Pay by contractor")).toBeVisible();

  const csvHref = await page.getByRole("link", { name: /CSV/ }).getAttribute("href");
  expect(csvHref).toContain("/portal/reports/contractor-pay/export");
  const csv = await page.request.get(csvHref!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  await page.context().clearCookies();
});

test("a sales rep without Report access is redirected from the hub", async ({ page }) => {
  // Only super_admin + accounting hold the Report resource in the RBAC matrix.
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/reports");
  await page.waitForURL("**/portal/dashboard**");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toHaveCount(0);

  await page.context().clearCookies();
});
