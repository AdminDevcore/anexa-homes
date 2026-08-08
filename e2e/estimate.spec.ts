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

async function openDeal(page: Page, query: string) {
  await page.goto(`/portal/leads?q=${query}`);
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
}

/** The slide switcher is a tablist, and the deal page is heavy enough that a
 *  click can land before hydration and go nowhere — so retry until it takes. */
async function openSlide(page: Page, name: string) {
  const tab = page.getByRole("tab", { name });
  await expect(tab).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

test("estimate: price a job line by line and push the total to the proposal", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Kevin");
  await openSlide(page, "Estimate");

  // Nothing priced yet.
  await expect(page.getByText(/Nothing priced yet/)).toBeVisible();

  // A one-off line, typed by hand.
  await page.getByRole("button", { name: "Add line" }).click();
  const row = page.locator("tr", { has: page.getByLabel("Price per unit") }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByLabel("Description").fill("Full roof replacement");
  await row.getByLabel("Description").blur();
  await row.getByLabel("Quantity").fill("25");
  await row.getByLabel("Quantity").blur();
  await row.getByLabel("Price per unit").fill("450");
  await row.getByLabel("Price per unit").blur();

  // 25 × $450 = $11,250, and that is the customer total with no discount.
  await expect(page.getByText("$11,250").first()).toBeVisible({ timeout: 10000 });

  // A discount comes off the subtotal.
  await page.getByLabel("Discount").fill("250");
  await page.getByLabel("Discount").blur();
  await expect(page.getByText("$11,000").first()).toBeVisible({ timeout: 10000 });

  // On a CASH deal the total becomes the price the proposal quotes. Flip the
  // deal type first — the seed deal is an insurance claim, which prices off the
  // deductible and has no project price to set.
  await page.getByRole("button", { name: /Cash/ }).first().click();
  await expect(page.getByText("Switched to cash deal")).toBeVisible({ timeout: 15000 });
  await openSlide(page, "Estimate");
  await page.getByRole("button", { name: "Use as proposal price" }).click();
  await expect(page.getByText(/Proposal price set to \$11,000/)).toBeVisible({ timeout: 15000 });

  // And the proposal builder opens with that price already in it.
  await page.goto(`${page.url().split("?")[0]}/presentation`);
  await page.getByRole("button", { name: "2 · Details" }).click();
  await expect(page.locator('input[value="11000"]')).toBeVisible({ timeout: 15000 });
});

test("estimate: the catalog picker adds several lines at once", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Sarah");
  await openSlide(page, "Estimate");

  await page.getByRole("button", { name: "Add from catalog" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const items = dialog.locator("li label");
  const count = await items.count();
  test.skip(count < 2, "seed catalog has fewer than two items");

  await items.nth(0).click();
  await items.nth(1).click();
  await dialog.getByRole("button", { name: "Add 2 lines" }).click();

  // Both land on the sheet as editable rows.
  await expect(page.getByLabel("Price per unit")).toHaveCount(2, { timeout: 15000 });
});

test("estimate: a sales rep prices the job but never sees our cost", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/leads");
  const anyDeal = page.locator('table a[href^="/portal/leads/"]').first();
  await expect(anyDeal).toBeVisible({ timeout: 15000 });
  await anyDeal.click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await openSlide(page, "Estimate");

  // They can build the estimate...
  const panel = page.locator('[data-deal-slide="estimate"]');
  await expect(panel.getByRole("button", { name: "Add line" })).toBeVisible();
  // ...but cost and margin are absent from the panel entirely, not merely dimmed.
  // Scoped to the slide: the Scope tab's own copy mentions "our cost per line",
  // and Playwright's string matching is case-insensitive substring.
  await expect(panel.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
  await expect(panel.getByText("Our cost", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Gross profit", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Margin", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Cost prices", { exact: true })).toHaveCount(0);
});
