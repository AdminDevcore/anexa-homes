import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("admin can switch report types, period, scope; downloads work", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports");

  // All three report types available for an owner
  await expect(page.getByRole("button", { name: "Operations", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Financial", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Payroll", exact: true })).toBeVisible();

  // Default = Operations
  await expect(page.getByRole("heading", { name: "Operations Report" })).toBeVisible();
  await expect(page.getByText("Closing rate")).toBeVisible();

  // Switch to Financial → URL + content change
  await page.getByRole("button", { name: "Financial", exact: true }).click();
  await page.waitForURL("**/reports?*type=financial*");
  await expect(page.getByRole("heading", { name: "Financial Report" })).toBeVisible();
  await expect(page.getByText("Left to collect")).toBeVisible();
  await expect(page.getByText("Commissions owed", { exact: true })).toBeVisible();
  // Commissions owed now combines generated + estimated, broken out per rep.
  await expect(page.getByText("generated + estimated").first()).toBeVisible();
  await expect(page.getByText("Commissions owed — locked-in vs. estimated")).toBeVisible();
  // Contractor payments broken out per contractor.
  await expect(page.getByText("Contractor payments by contractor (in period)")).toBeVisible();

  // Switch period to This month
  await page.getByRole("button", { name: "This month" }).click();
  await page.waitForURL("**period=month*");
  await expect(page.getByText(/This month · /)).toBeVisible();

  // Switch to Payroll
  await page.getByRole("button", { name: "Payroll", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payroll Report" })).toBeVisible();
  await expect(page.getByText("Total payroll")).toBeVisible();
  // Remaining estimated commission liability surfaced on Payroll.
  await expect(page.getByText("Est. commissions remaining")).toBeVisible();
  await expect(page.getByText("Estimated commissions by person")).toBeVisible();

  // PDF download link resolves to a PDF (HTTP 200, pdf content-type)
  const pdfHref = await page.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect(pdfHref).toContain("/portal/reports/pdf");
  const res = await page.request.get(pdfHref!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  await page.context().clearCookies();
});

test("a sales rep only sees the Operations report scoped to themselves", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/reports");

  await expect(page.getByRole("heading", { name: "Operations Report" })).toBeVisible();
  // No Financial / Payroll types for a rep
  await expect(page.getByRole("button", { name: "Financial", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Payroll", exact: true })).toHaveCount(0);
  // Scope is locked to "Me" (single option → no scope dropdown shown)
  await expect(page.locator('select')).toHaveCount(0);

  await page.context().clearCookies();
});
