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

test("claim price becomes the deal's contract value", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  // Robert Johnson is seeded in production (has a job) in the Roofing workspace.
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  // Enter the claim price (contract from the insurance scope).
  await expect(page.getByText("Claim Price")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await page.getByPlaceholder("$0").fill("30000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Claim price saved/)).toBeVisible({ timeout: 10000 });

  // It drives the Deal Financials contract value (was the $24,500 estimate).
  await expect(page.getByText("$30,000").first()).toBeVisible({ timeout: 10000 });
});
