import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * Claim status is a company-customizable list, set from the deal Summary.
 *
 * The two halves have to be checked together: a status invented in Settings is
 * worthless if the deal's picker doesn't offer it, and the picker is worthless
 * if what it writes doesn't survive a reload.
 */
test("a custom claim status reaches the deal picker and sticks", async ({ page }) => {
  await login(page, "owner@anexahomes.com");

  // ── Settings: the built-ins are there, and a new one can be invented ──
  await page.goto("/portal/settings/claim-statuses");
  await expect(page.getByRole("heading", { name: "Claim Statuses" })).toBeVisible({ timeout: 15000 });
  // "Scope Received" is flagged, because deleting it closes the Scope of Work tab.
  await expect(page.getByText("Opens scope").first()).toBeVisible();

  await page.getByPlaceholder("e.g. Depreciation released").fill("Depreciation Released");
  await page.getByRole("button", { name: "Add status" }).click();
  await expect(page.locator('input[value="Depreciation Released"]')).toBeVisible({ timeout: 10000 });

  // ── Deal page: the picker offers the office's own list ──
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const dealUrl = page.url();

  const picker = page.getByRole("combobox", { name: "Claim Status" });
  await expect(picker).toBeVisible({ timeout: 15000 });
  await picker.click();
  await expect(page.getByRole("option", { name: "Not Filed" })).toBeVisible();
  await page.getByRole("option", { name: "Depreciation Released" }).click();
  await expect(page.getByText("Claim: Depreciation Released").first()).toBeVisible({ timeout: 15000 });

  // ── It persisted, not just painted optimistically ──
  await page.goto(dealUrl);
  await expect(page.getByRole("combobox", { name: "Claim Status" })).toContainText(
    "Depreciation Released",
    { timeout: 15000 }
  );
});
