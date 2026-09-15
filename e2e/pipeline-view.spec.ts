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

/**
 * Builds "Rep is any of <first rep>" in the filter builder and applies it.
 * Returns the rep's name and how many cards the board narrowed to.
 */
async function filterByFirstRep(page: Page) {
  const cards = page.locator('[data-testid="pipeline-card"]');
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Field" }).click();
  await page.getByRole("option", { name: "Rep", exact: true }).click();

  await page.getByRole("button", { name: /^Values/ }).click();
  const picker = page.getByTestId("value-picker");
  const repName = (await picker.locator("[data-option-label]").first().innerText()).trim();
  await picker.getByRole("checkbox").first().click();
  await page.keyboard.press("Escape"); // closes the value list, not the builder
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible();
  const narrowed = await cards.count();
  return { repName, narrowed };
}

/**
 * Opens the Views menu once any previous menu has finished closing, and returns
 * only when the new one is open. A click on the trigger while the last menu is
 * still animating shut is swallowed — measured: no menu open after reopening
 * straight after picking a view, one open after waiting.
 */
async function openViewsMenu(page: Page, name: string | RegExp) {
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", typeof name === "string" ? { name, exact: true } : { name }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

test("pipeline: the filter builder narrows by rep, offers custom fields, and survives a reload", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");

  const cards = page.locator('[data-testid="pipeline-card"]');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });
  const total = await cards.count();

  // The company's own fields (the seeded "Damage Type") sit beside the built-in ones.
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Field" }).click();
  await expect(page.getByRole("option", { name: "Damage Type" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const { repName, narrowed } = await filterByFirstRep(page);
  await expect(page).toHaveURL(/[?&]f=/);
  await expect(page.getByRole("button", { name: `Remove filter Rep is any of ${repName}` })).toBeVisible();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThanOrEqual(total);
  for (const card of await cards.all()) await expect(card).toContainText(repName);

  // The filter is in the URL, so a reload (or Back from a deal) keeps it.
  await page.reload();
  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible({ timeout: 15000 });
  await expect(cards).toHaveCount(narrowed);

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(cards).toHaveCount(total);
  await expect(page).not.toHaveURL(/[?&]f=/);
});

test("pipeline: a shared saved view reopens its filters and can be deleted", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");

  const cards = page.locator('[data-testid="pipeline-card"]');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });
  const total = await cards.count();
  const { narrowed } = await filterByFirstRep(page);

  await openViewsMenu(page, "Views");
  await page.getByRole("menuitem", { name: "Save current filters as a new view…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("E2E rep view");
  await dialog.getByRole("checkbox", { name: /Share with the whole team/ }).click();
  await dialog.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByRole("button", { name: /^Views \(E2E rep view/ })).toBeVisible({ timeout: 15000 });

  // Off again, then back on from the menu.
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(cards).toHaveCount(total);
  await openViewsMenu(page, "Views");
  await page.getByRole("menuitem", { name: /E2E rep view/ }).click();
  await expect(cards).toHaveCount(narrowed);

  await openViewsMenu(page, /^Views \(E2E rep view/);
  await page.getByRole("menuitem", { name: /Delete “E2E rep view”/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Views", exact: true })).toBeVisible({ timeout: 15000 });
  await openViewsMenu(page, "Views");
  await expect(page.getByRole("menuitem", { name: /E2E rep view/ })).toHaveCount(0);
});

test("pipeline: switching and to or widens the board to deals matching either row", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");

  const cards = page.locator('[data-testid="pipeline-card"]');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });

  // Row 1: the first rep on the list. Row 2: the second.
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const rows = page.getByTestId("filter-condition");
  for (const row of [0, 1]) {
    if (row === 1) await page.getByRole("button", { name: "Add condition" }).click();
    await rows.nth(row).getByRole("combobox", { name: "Field" }).click();
    await page.getByRole("option", { name: "Rep", exact: true }).click();
    await rows.nth(row).getByRole("button", { name: /^Values/ }).click();
    await page.getByTestId("value-picker").getByRole("checkbox").nth(row).click();
    await page.keyboard.press("Escape"); // closes the value list, not the builder
  }

  // A deal has one rep, so "and" across two different reps matches nothing…
  await expect(page.getByText(/^0 of \d+ deals? match$/)).toBeVisible();

  // …and "or" matches the deals of either.
  await rows.nth(1).getByRole("combobox", { name: "And or" }).click();
  await page.getByRole("option", { name: "or", exact: true }).click();
  await expect(page.getByText("Show deals where any condition is true")).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/[?&]m=any/);
  await expect(page.getByText("Any of", { exact: true })).toBeVisible();
  const either = await cards.count();
  expect(either).toBeGreaterThan(0);

  // The mode rides in the URL with the rows.
  await page.reload();
  await expect(page.getByText("Any of", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(cards).toHaveCount(either);
});
