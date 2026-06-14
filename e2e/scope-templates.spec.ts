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

test("catalog page links to the two template pages", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/scope-template");
  await expect(page.getByRole("link", { name: "Cost Templates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Supplement Templates" })).toBeVisible();
});

test("create a cost template, it loads catalog items, price persists", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/scope-cost-templates");

  await page.getByRole("button", { name: /Create New Cost Template/i }).click();
  await page.getByPlaceholder(/2026 Crew Costs/i).fill("E2E Cost v1");
  await page.getByRole("button", { name: /^Create$/ }).click();

  // Redirected to the editor; it shows the template name and priced catalog rows.
  await page.waitForURL(/\/scope-cost-templates\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "E2E Cost v1" })).toBeVisible();
  const priceInput = page.locator('table input[type="number"]').first();
  await expect(priceInput).toBeVisible(); // catalog item snapshotted

  // Set a price, blur, reload → it persisted.
  await priceInput.fill("12.5");
  await priceInput.blur();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('table input[type="number"]').first()).toHaveValue("12.5");
});

test("a supplement template has reason / required evidence / notes columns", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/scope-supplement-templates");

  await page.getByRole("button", { name: /Create New Supplement Template/i }).click();
  await page.getByPlaceholder(/2026 Supplement Targets/i).fill("E2E Supp v1");
  await page.getByRole("button", { name: /^Create$/ }).click();

  await page.waitForURL(/\/scope-supplement-templates\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "E2E Supp v1" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Reason" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Required evidence" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
});
