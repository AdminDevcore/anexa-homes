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

test("pipeline: Kanban/List toggle shows deals as a table that opens the deal", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");
  await expect(page.getByRole("button", { name: "Kanban" })).toBeVisible();

  await page.getByRole("button", { name: "List" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10000 });

  // A row links to the deal (lead) detail.
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
});
