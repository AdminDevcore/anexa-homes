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

  const meter = bar.getByRole("progressbar");
  const before = Number(await meter.getAttribute("aria-valuenow"));

  await advance.click();
  await expect(bar.getByText(target, { exact: true }).first()).toBeVisible({ timeout: 10000 });
  // …and it is now the current stage, not the next one.
  await expect(bar.getByText(`Next: ${target}`)).toHaveCount(0);
  // The production bar tracks the move rather than being decorative.
  await expect
    .poll(async () => Number(await meter.getAttribute("aria-valuenow")), { timeout: 10000 })
    .toBeGreaterThan(before);
});

test("advance never offers the cancelled stage", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page);

  // Jump straight to the last stage a deal can be advanced INTO. Cancelled sits
  // after it in the pipeline, so if Advance walked the raw stage list this is
  // exactly where it would offer to move the deal to Cancelled.
  await page.getByTestId("deal-stage-actions").getByRole("button", { name: "Move" }).click();
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

/**
 * The third way a stage changes: dragging the card across the pipeline board.
 * dnd-kit's PointerSensor has a 6px activation distance, so this has to be a
 * real mouse gesture — Playwright's dragTo fires too coarse a sequence.
 */
test("dragging a card on the pipeline board moves the deal to that stage", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/pipeline");

  const columns = page.getByTestId("pipeline-column");
  await expect(columns.first()).toBeVisible({ timeout: 15000 });

  // Source = the first column holding a card; target = the one beside it, so
  // both are on screen once the source is scrolled to.
  const total = await columns.count();
  let srcIdx = -1;
  for (let i = 0; i < total; i++) {
    if ((await columns.nth(i).getByTestId("pipeline-card").count()) > 0) {
      srcIdx = i;
      break;
    }
  }
  expect(srcIdx, "no card on the board to drag").toBeGreaterThanOrEqual(0);
  await columns.nth(srcIdx).scrollIntoViewIfNeeded();

  const card = columns.nth(srcIdx).getByTestId("pipeline-card").first();
  const name = (await card.locator("p").first().innerText()).trim();
  const target = columns.nth(srcIdx + 1);
  const dropzone = target.getByTestId("pipeline-dropzone");

  const handle = card.getByLabel("Drag to move stage");
  const from = await handle.boundingBox();
  const to = await dropzone.boundingBox();
  if (!from || !to) throw new Error("could not measure the drag endpoints");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Clear the 6px activation distance before heading for the column.
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();

  await expect(target.getByTestId("pipeline-card").filter({ hasText: name })).toBeVisible({
    timeout: 10000,
  });
  // The optimistic move rolls back on failure, so a surviving card is not proof
  // on its own — the server has to have confirmed it.
  await expect(page.getByText("Appointment moved")).toBeVisible({ timeout: 10000 });
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
