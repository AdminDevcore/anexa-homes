import { test, expect, type Page } from "@playwright/test";

/**
 * The two stage moves people actually make: forward one step, and dead.
 *
 * Both are exercised on a real deal rather than against the action directly,
 * because the interesting behaviour is in what the bar offers — Advance must
 * name the next LIVE stage (never walking a deal into Cancelled), and Cancel
 * must exist only once a pipeline says which stage means dead.
 */

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** Open the first deal in the pipeline list. */
async function openDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByTestId("deal-stage-bar")).toBeVisible();
}

test("advance moves the deal to the stage named on the button", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page);

  const bar = page.getByTestId("deal-stage-bar");
  const advance = page.getByTestId("deal-stage-advance");
  // The button is labelled with where it lands, so that label is the assertion.
  const target = (await advance.innerText()).trim();
  expect(target).not.toBe("");

  await advance.click();
  await expect(bar.getByText(target, { exact: true }).first()).toBeVisible({ timeout: 10000 });
  // …and it is now the current stage, not the next one.
  await expect(bar.getByText(`Next: ${target}`)).toHaveCount(0);
});

test("advance never offers the cancelled stage", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page);

  // Jump straight to the last stage a deal can be advanced INTO. Cancelled sits
  // after it in the pipeline, so if Advance walked the raw stage list this is
  // exactly where it would offer to move the deal to Cancelled.
  // Scoped to the bar: the deal page has another "Change" elsewhere.
  await page.getByTestId("deal-stage-bar").getByRole("button", { name: "Change" }).click();
  const items = page.getByRole("menuitem");
  const count = await items.count();
  await expect(items.nth(count - 1)).toHaveText(/Cancelled/);
  await items.nth(count - 2).click();

  const bar = page.getByTestId("deal-stage-bar");
  await expect(bar.getByText("Final stage")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("deal-stage-advance")).toHaveCount(0);
  // Still killable from the last live stage.
  await expect(page.getByTestId("deal-cancel")).toBeVisible();
});

test("cancelling requires a reason and lands the deal on the cancelled stage", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page);

  await page.getByTestId("deal-cancel").click();
  const confirm = page.getByTestId("deal-cancel-confirm");
  // No reason, no cancel — a deal dies with an explanation or not at all.
  await expect(confirm).toBeDisabled();

  const reason = `Homeowner went with another contractor ${Date.now() % 100000}`;
  await page.getByTestId("deal-cancel-reason").fill(reason);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const bar = page.getByTestId("deal-stage-bar");
  await expect(bar.getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 10000 });
  // Both actions retire once the deal is dead.
  await expect(page.getByTestId("deal-stage-advance")).toHaveCount(0);
  await expect(page.getByTestId("deal-cancel")).toHaveCount(0);
  // The reason is kept on the deal, not just in the toast.
  await expect(page.getByText(`Deal cancelled — ${reason}`)).toBeVisible({ timeout: 10000 });
});
