import { test, expect, type Page } from "@playwright/test";

/**
 * Payment factors, and the credit routing that turns a lender into something a
 * rep can close on.
 *
 * A solar rate sheet quotes a PAYMENT FACTOR — monthly = amount financed ×
 * factor — not an APR the dealer is expected to amortise, and the two do not
 * agree. These specs cover the whole path: the factors go in under Settings,
 * the deal quotes from them, and both payments are shown so a customer sees
 * what happens if the paydown is never made.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function toSolar(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

/** Named per run, so specs never collide on the case-insensitive unique name. */
function lenderName(tag: string) {
  return `ZZ ${tag} ${Date.now().toString(36)}`;
}

/**
 * Add a partner, and land on its panel.
 *
 * The screen is a list and a panel now: adding a lender opens it, so every step
 * after this one is scoped to `panel(page)` rather than to a card filtered by
 * name out of a grid.
 */
async function addLender(page: Page, name: string) {
  await page.goto("/portal/settings/solar-lenders");
  await expect(page.getByRole("heading", { name: "Lenders", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "New lender" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add lender" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
}

/**
 * The open partner's panel.
 *
 * Only one is mounted, so this is unambiguous — which is the point of the
 * rebuild. Specs accumulate lenders across runs, and the old grid needed a name
 * filter over every card to keep an assertion off whichever partner happened to
 * sort first.
 */
function panel(page: Page) {
  return page.getByTestId("lender-panel");
}

/** Move the panel to one of its tabs. */
async function tab(page: Page, name: string) {
  await panel(page).getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

test.describe(FLAG_ON ? "solar payment factors" : "solar payment factors (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a loan product records both factors and the paydown", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Factors");
    await addLender(page, name);

    // Terms live on the partner's own Rate sheet tab now, not in a section a
    // screenful below its card.
    await tab(page, "Rate sheet");
    await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByLabel("APR %", { exact: true }).fill("3.99");
    await page.getByLabel("Term (months)", { exact: true }).fill("300");
    await page.getByLabel("Dealer fee %", { exact: true }).fill("28");
    await page.getByLabel("PMT factor — with paydown", { exact: true }).fill("0.005712");
    await page.getByLabel("PMT factor — without paydown", { exact: true }).fill("0.008140");
    await page.getByLabel("Paydown %", { exact: true }).fill("30");
    await page.getByLabel("Paydown due by month", { exact: true }).fill("18");
    await page.getByRole("button", { name: "Add product" }).click();

    // `exact`, because the row's Edit button carries the same terms as its
    // screen-reader name — "Edit 25 yr · 3.99% · fee 28%" — and a substring
    // match resolves to both.
    const sheet = panel(page);
    await expect(sheet.getByText("25 yr · 3.99% · fee 28%", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(sheet.getByText(/factor 0\.005712 \/ 0\.008140/)).toBeVisible();
    await expect(sheet.getByText(/30% by mo 18/)).toBeVisible();
  });

  test("the factor without the paydown cannot be the cheaper one", async ({ page }) => {
    // Inverted, the pair quotes a customer a REWARD for never paying the credit
    // down. The server refuses rather than storing it.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Inverted");
    await addLender(page, name);

    await tab(page, "Rate sheet");
    await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByLabel("APR %", { exact: true }).fill("4.99");
    await page.getByLabel("Term (months)", { exact: true }).fill("240");
    await page.getByLabel("Dealer fee %", { exact: true }).fill("18");
    await page.getByLabel("PMT factor — with paydown", { exact: true }).fill("0.009000");
    await page.getByLabel("PMT factor — without paydown", { exact: true }).fill("0.005000");
    await page.getByRole("button", { name: "Add product" }).click();

    await expect(page.getByText(/should be the higher of the two/)).toBeVisible({ timeout: 15000 });
  });

  test("a paydown needs both halves, or neither", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Halfway");
    await addLender(page, name);

    await tab(page, "Rate sheet");
    await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByLabel("APR %", { exact: true }).fill("4.99");
    await page.getByLabel("Term (months)", { exact: true }).fill("240");
    await page.getByLabel("Dealer fee %", { exact: true }).fill("18");
    await page.getByLabel("Paydown %", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Add product" }).click();

    await expect(page.getByText(/needs both a percentage and the month/)).toBeVisible({ timeout: 15000 });
  });

  test("the dealer portal and the customer application stay separate fields", async ({ page }) => {
    // One "link" field used for both is how a dealer portal ends up in front of
    // a homeowner. Only the customer link ever reaches a proposal.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Links");
    await addLender(page, name);

    // Both boxes are on the partner's Details tab, which is where the panel
    // opens — no pencil, no separate edit mode.
    await page.getByLabel("Dealer portal — where your team runs credit").fill("https://portal.example.com/dealer");
    await page.getByLabel("Customer application link — the proposal's Qualify button").fill("https://apply.example.com/abc");
    await page.getByLabel("How to run credit with this partner").fill("Soft pull first, then submit.");
    await panel(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`${name} saved`)).toBeVisible({ timeout: 15000 });

    // Saved, they become the two links in the panel's header — still two, and
    // still labelled for two different audiences.
    await expect(panel(page).getByRole("link", { name: /Dealer portal/ })).toBeVisible({ timeout: 15000 });
    await expect(panel(page).getByRole("link", { name: /^Application/ })).toBeVisible();
  });

  test("a link that is not http is refused", async ({ page }) => {
    // An unchecked string here becomes an href on a page a homeowner opens.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("BadLink");
    await addLender(page, name);

    await page.getByLabel("Customer application link — the proposal's Qualify button").fill("javascript:alert(1)");
    await panel(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/must start with http/)).toBeVisible({ timeout: 15000 });
  });

  test("the deal quotes from the factor, and shows both payments", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Deal");
    await addLender(page, name);
    await tab(page, "Rate sheet");
    await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByLabel("APR %", { exact: true }).fill("3.99");
    await page.getByLabel("Term (months)", { exact: true }).fill("300");
    await page.getByLabel("Dealer fee %", { exact: true }).fill("28");
    await page.getByLabel("PMT factor — with paydown", { exact: true }).fill("0.005712");
    await page.getByLabel("PMT factor — without paydown", { exact: true }).fill("0.008140");
    await page.getByLabel("Paydown %", { exact: true }).fill("30");
    await page.getByLabel("Paydown due by month", { exact: true }).fill("18");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(panel(page).getByText(/factor 0\.005712/)).toBeVisible({ timeout: 15000 });

    // Quote the deal on it, straight off the shelf — the whole rate sheet is on
    // the financing step now, so this no longer needs a trip to the deal page.
    await page.goto("/portal/leads?q=Priya");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    const leadId = page.url().split("/").pop()!;

    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    // Scoped to THIS lender: earlier specs in this file publish programmes whose
    // terms read identically, and a page-wide match reaches whichever partner
    // happens to sort first. The shelf is one wrapped grid rather than a
    // landmark per partner now, so the lender is matched inside the card's own
    // accessible name.
    const card = page.getByRole("button", {
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · .*25 yr · 3\\.99% · fee 28%`),
    });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
    await page.getByRole("button", { name: `Quote this: ${name} 25 yr · 3.99% · fee 28%` }).click();

    // The deal follows the card: quoting it moves the design onto that lender.
    await expect(page.getByText(`Quoting ${name}`)).toBeVisible({ timeout: 15000 });

    // Both payments, never just the flattering one, and the higher of the two
    // has to actually be higher.
    await expect(page.getByText("With paydown")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Without paydown")).toBeVisible();
    await expect(page.getByText(/Paydown due by month 18/)).toBeVisible();

    // An approval belongs to the programme it was run on, so quoting a
    // different one CLEARS it rather than carrying another lender's figure
    // across. With the box empty the headline is the FACTOR — not our
    // amortisation, which is the whole point of storing factors.
    await expect(page.getByLabel("Monthly payment $", { exact: true })).toHaveValue("");
    await expect(page.getByText(/rate sheet's payment factor/)).toBeVisible({ timeout: 15000 });

    // Type one in and it outranks the sheet again, as the lender's own number.
    await page.getByLabel("Monthly payment $", { exact: true }).fill("259.40");
    await expect(page.getByText(/own figure from the approval/)).toBeVisible({ timeout: 15000 });
  });
});
