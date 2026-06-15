import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("admin opens the Financial section from the hub; period + downloads work", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports");

  // Hub of report cards — sections are now their own buttons.
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Financial/ }).click();
  await page.waitForURL("**/portal/reports/financial**");

  await expect(page.getByRole("heading", { name: "Financial", exact: true })).toBeVisible();
  await expect(page.getByText("Revenue collected").first()).toBeVisible();
  await expect(page.getByText("Commissions owed", { exact: true })).toBeVisible();

  // Switch period to This month → URL + header update.
  await page.getByRole("button", { name: "This month" }).click();
  await page.waitForURL("**/portal/reports/financial?*period=month*");
  await expect(page.getByText(/This month · /)).toBeVisible();

  // Section PDF download (HTTP 200, pdf content-type).
  const pdfHref = await page.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect(pdfHref).toContain("/portal/reports/financial/pdf");
  const res = await page.request.get(pdfHref!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  await page.context().clearCookies();
});

test("a sales rep has no Report access and is redirected away", async ({ page }) => {
  // Per the RBAC matrix only super_admin + accounting hold the Report resource,
  // so a rep is bounced from any report section back to the dashboard.
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/reports/financial");
  await page.waitForURL("**/portal/dashboard**");
  await expect(page.getByRole("heading", { name: "Financial", exact: true })).toHaveCount(0);

  await page.context().clearCookies();
});
