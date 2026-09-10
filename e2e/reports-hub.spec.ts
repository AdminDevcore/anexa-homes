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
    "Overdue Jobs",
    // Contractor Pay is deliberately not here any more — it is its own sidebar
    // item now. The dedicated test below asserts the hub has no card for it.
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

test("overdue-jobs report opens, toggles due-soon, and exports", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports");
  // Card and page both read "Overdue Jobs" now — "Delinquency / Follow-up" said
  // what the query does, not what the reader is looking for. The route keeps
  // its /delinquency slug.
  await page.getByRole("link", { name: /Overdue Jobs/ }).click();
  await page.waitForURL("**/portal/reports/delinquency**");

  await expect(page.getByRole("heading", { name: "Overdue Jobs" })).toBeVisible();
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

// Contractor Pay left the hub for its own sidebar item, taking the payout
// report with it. The old URL is still asked for here on purpose: the report
// has been bookmarked and its PDFs mailed for months, so the redirect is part
// of the feature, not a courtesy.
test("contractor pay report moved to its own page, old URL redirects", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/reports/contractor-pay?period=quarter");

  await expect(page).toHaveURL(/\/portal\/contractor-pay\/payouts\?/);
  // The query string travels: a saved link to "this quarter" still lands there.
  await expect(page).toHaveURL(/period=quarter/);

  await expect(page.getByRole("heading", { name: "Contractor Pay" })).toBeVisible();
  await expect(page.getByText("Paid to contractors")).toBeVisible();
  await expect(page.getByText("Pay by contractor")).toBeVisible();

  const csvHref = await page.getByRole("link", { name: /CSV/ }).getAttribute("href");
  expect(csvHref).toContain("/portal/contractor-pay/payouts/export");
  const csv = await page.request.get(csvHref!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  // The hub no longer carries a CARD for it — two things called Contractor Pay
  // in two places is what the move was for. It does not carry a sidebar row
  // either any more: Contractor Pay is the second tab on Commissions, reached
  // from there.
  await page.goto("/portal/reports");
  await expect(page.getByRole("heading", { name: "Contractor Pay", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Contractor Pay" })).toHaveCount(0);
  await expect(page.locator('aside a[href="/portal/commissions"]')).toBeVisible();

  await page.context().clearCookies();
});

test("a user without Report access is redirected from the hub", async ({ page }) => {
  // Only super_admin + accounting hold the Report resource in the RBAC matrix.
  // `admin` is the one worth naming: it holds Settings, Payroll and Invoice and
  // still must not reach Reports, so a well-meant "admins can do everything"
  // edit to the matrix fails here rather than in front of the company's numbers.
  for (const email of ["rep@anexahomes.com", "admin@anexahomes.com"]) {
    await login(page, email);
    await page.goto("/portal/reports");
    await page.waitForURL("**/portal/dashboard**");
    await expect(page.getByRole("heading", { name: "Reports", exact: true })).toHaveCount(0);
    await page.context().clearCookies();
  }
});
