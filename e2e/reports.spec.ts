import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("admin sees one master report with all sections; period + downloads work", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports");

  // Single combined report — no type toggle.
  await expect(page.getByRole("heading", { name: "Company Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Operations", exact: true })).toHaveCount(0);

  // Executive scorecard on top + all detail sections for an owner.
  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible();
  await expect(page.getByText("Revenue contracted")).toBeVisible();
  await expect(page.getByText("Signed backlog")).toBeVisible();
  // Trend deltas render on the scorecard.
  await expect(page.getByText("vs prev").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Financial Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payroll Report" })).toBeVisible();
  // A signature metric from each section is present on the one page.
  // (Closing rate / Left to collect also appear in the Executive Summary, hence .first().)
  await expect(page.getByText("Closing rate").first()).toBeVisible();
  await expect(page.getByText("Left to collect").first()).toBeVisible();
  await expect(page.getByText("Total payroll")).toBeVisible();

  // Switch period to This month → URL + header update.
  await page.getByRole("button", { name: "This month" }).click();
  await page.waitForURL("**period=month*");
  await expect(page.getByText(/This month · /)).toBeVisible();

  // One combined PDF download (HTTP 200, pdf content-type).
  const pdfHref = await page.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect(pdfHref).toContain("/portal/reports/pdf");
  expect(pdfHref).not.toContain("type=");
  const res = await page.request.get(pdfHref!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  await page.context().clearCookies();
});

test("a sales rep sees only the Operations section, scoped to themselves", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/reports");

  await expect(page.getByRole("heading", { name: "Company Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations Report" })).toBeVisible();
  // No executive scorecard or financial / payroll sections for a rep.
  await expect(page.getByRole("heading", { name: "Executive Summary" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Financial Report" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Payroll Report" })).toHaveCount(0);
  // Scope locked to "Me" → no scope dropdown.
  await expect(page.locator("select")).toHaveCount(0);

  await page.context().clearCookies();
});
