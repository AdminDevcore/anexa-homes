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

test("pipeline: Filters narrows the board by rep, survives a reload, and clears", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");

  const cards = page.locator('[data-testid="pipeline-card"]');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });
  const total = await cards.count();

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Rep" }).click();
  // The list opens on "Any rep"; the next option is the first real rep.
  const option = page.getByRole("option").nth(1);
  const repName = (await option.locator("[data-option-label]").innerText()).trim();
  await option.click();
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(/[?&]rep=/);
  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove filter Rep: ${repName}` })).toBeVisible();

  const narrowed = await cards.count();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThanOrEqual(total);
  for (const card of await cards.all()) await expect(card).toContainText(repName);

  // The filter is in the URL, so a reload (or Back from a deal) keeps it.
  await page.reload();
  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible({ timeout: 15000 });
  await expect(cards).toHaveCount(narrowed);

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(cards).toHaveCount(total);
  await expect(page).not.toHaveURL(/[?&]rep=/);
});
