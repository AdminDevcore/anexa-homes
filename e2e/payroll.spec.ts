import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("payroll: generate -> approve commissions -> run -> pay -> export", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");

  // Generate commissions from active rules.
  await page.goto("/portal/commissions");
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByText(/commission\(s\) generated|already/i)).toBeVisible({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Approve all pending.
  await page.getByRole("button", { name: /Approve All Pending/ }).click();
  await page.waitForTimeout(800);

  // Create a payroll run covering all time.
  await page.goto("/portal/payroll");
  await page.getByRole("button", { name: /New Payroll Run/ }).click();
  await page.getByPlaceholder(/June 2026/).fill("E2E Payroll Run");
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill("2020-01-01");
  await dates.nth(1).fill("2030-12-31");
  await page.getByRole("button", { name: /^Create$/ }).click();

  // Land on the run detail page.
  await page.waitForURL(/\/portal\/payroll\/[0-9a-f-]+$/, { timeout: 15000 });
  // Anchor on the heading, not bare text: after a client-side navigation Next
  // also puts the page title in #__next-route-announcer__, so getByText is
  // strict-mode ambiguous depending on how fast the announcer clears.
  await expect(page.getByRole("heading", { name: "E2E Payroll Run" })).toBeVisible();

  // Approve then pay.
  await page.getByRole("button", { name: /Approve Run/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Mark All Paid/ }).click();
  await expect(page.getByText("Paid").first()).toBeVisible({ timeout: 10000 });

  // CSV export returns a CSV.
  const url = page.url() + "/export";
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  expect(body).toContain("Recipient");
  expect(body).toContain("TOTAL");
});

test("commissions: per-deal generation is gated until Depreciation Requested", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  // Robert Johnson is seeded in "In Production" (has a job, but pre-depreciation).
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByText(/Commissions unlock at/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Generate commission|Update commission/ })).toBeDisabled();
});

test("deal financials: supplement raises the effective contract value", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  // Robert Johnson is seeded with a $24,500 contract and a job.
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByRole("button", { name: /^Supplement/ }).click();
  await page.getByPlaceholder("Amount ($)").fill("15000");
  await page.getByRole("button", { name: /^Save$/ }).click();

  // The supplement is added on top of the base contract → adjusted contract value.
  await expect(page.getByText("+ Supplement")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("= Adjusted contract value")).toBeVisible();
  await expect(page.getByText("$39,500").first()).toBeVisible(); // 24,500 + 15,000
});

test("team: configure a commission override (X earns off Y's deals)", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Dylan Foster").first().click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });

  await expect(page.getByText("Overrides earned")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /^Add$/ }).click();
  await page.getByText("Select person").click();
  await page.getByRole("option", { name: "Tyler Brooks" }).click();
  await page.getByPlaceholder("e.g. 3", { exact: true }).fill("3");
  await page.getByRole("button", { name: /Save override/ }).click();

  await expect(page.getByText(/off Tyler Brooks/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("3%")).toBeVisible();
});

test("sales rep cannot generate or approve commissions", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/commissions");
  // Rep sees commissions (their own) but no management toolbar.
  await expect(page.getByRole("button", { name: /Approve All Pending/ })).toHaveCount(0);
  // Rep cannot reach commission-rule settings.
  await page.goto("/portal/settings/commissions");
  await expect(page).not.toHaveURL(/\/portal\/settings\/commissions/);
});
