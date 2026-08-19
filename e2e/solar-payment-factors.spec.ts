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

async function addLender(page: Page, name: string) {
  await page.goto("/portal/settings/solar-lenders");
  await expect(page.getByRole("heading", { name: "Lenders", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15000 });
}

/**
 * One lender's card, and one lender's rate sheet.
 *
 * Scoped, never `.first()`: specs accumulate lenders across runs, so a
 * page-wide match reaches whichever partner happens to sort first — which is
 * how a product lands on the wrong lender and the spec still passes.
 */
function cardFor(page: Page, name: string) {
  return page.locator("div.rounded-xl.bg-card").filter({ hasText: name });
}

test.describe(FLAG_ON ? "solar payment factors" : "solar payment factors (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a loan product records both factors and the paydown", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Factors");
    await addLender(page, name);

    // The rate sheet card is the one under "Rate sheets", not the lender card.
    await cardFor(page, name).last().getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByLabel("APR %", { exact: true }).fill("3.99");
    await page.getByLabel("Term (months)", { exact: true }).fill("300");
    await page.getByLabel("Dealer fee %", { exact: true }).fill("28");
    await page.getByLabel("PMT factor — with paydown", { exact: true }).fill("0.005712");
    await page.getByLabel("PMT factor — without paydown", { exact: true }).fill("0.008140");
    await page.getByLabel("Paydown %", { exact: true }).fill("30");
    await page.getByLabel("Paydown due by month", { exact: true }).fill("18");
    await page.getByRole("button", { name: "Add product" }).click();

    const sheet = cardFor(page, name).last();
    await expect(sheet.getByText("25 yr · 3.99% · fee 28%")).toBeVisible({ timeout: 15000 });
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

    await cardFor(page, name).last().getByRole("button", { name: "Loan", exact: true }).click();
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

    await cardFor(page, name).last().getByRole("button", { name: "Loan", exact: true }).click();
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

    const card = cardFor(page, name).first();
    await card.getByRole("button", { name: "Edit name, links and credit instructions" }).click();
    await page.getByLabel("Dealer portal — where your team runs credit").fill("https://portal.example.com/dealer");
    await page.getByLabel("Customer application link — the proposal's Qualify button").fill("https://apply.example.com/abc");
    await page.getByLabel("How to run credit with this partner").fill("Soft pull first, then submit.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const saved = cardFor(page, name).first();
    await expect(saved.getByRole("link", { name: /Dealer portal/ })).toBeVisible({ timeout: 15000 });
    await expect(saved.getByRole("link", { name: /Customer application/ })).toBeVisible();
  });

  test("a link that is not http is refused", async ({ page }) => {
    // An unchecked string here becomes an href on a page a homeowner opens.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("BadLink");
    await addLender(page, name);

    await cardFor(page, name).first()
      .getByRole("button", { name: "Edit name, links and credit instructions" }).click();
    await page.getByLabel("Customer application link — the proposal's Qualify button").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/must start with http/)).toBeVisible({ timeout: 15000 });
  });

  test("the deal quotes from the factor, and shows both payments", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Deal");
    await addLender(page, name);
    await cardFor(page, name).last().getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByLabel("APR %", { exact: true }).fill("3.99");
    await page.getByLabel("Term (months)", { exact: true }).fill("300");
    await page.getByLabel("Dealer fee %", { exact: true }).fill("28");
    await page.getByLabel("PMT factor — with paydown", { exact: true }).fill("0.005712");
    await page.getByLabel("PMT factor — without paydown", { exact: true }).fill("0.008140");
    await page.getByLabel("Paydown %", { exact: true }).fill("30");
    await page.getByLabel("Paydown due by month", { exact: true }).fill("18");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(cardFor(page, name).last().getByText(/factor 0\.005712/)).toBeVisible({ timeout: 15000 });

    // Put the deal on that lender — the rate sheet follows the lender, so an
    // unattached deal correctly offers nothing.
    await page.goto("/portal/leads?q=Priya");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    const leadId = page.url().split("/").pop()!;
    await page.getByLabel("Lender / approved-vendor list").selectOption({ label: name });
    await page.getByRole("button", { name: "Save build details" }).click();
    // Wait for the SAVE, not a stopwatch: reloading before the action lands
    // reads back the old design and looks like a lost write.
    await expect(page.getByText("Build details saved")).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.locator("#solar-lender option:checked")).toHaveText(name, { timeout: 15000 });

    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await page.getByRole("button", { name: /Loan.*dealer fee/ }).click();

    const picker = page.getByLabel(/product$/);
    await expect(picker).toBeVisible({ timeout: 15000 });
    await picker.selectOption({ label: "25 yr · 3.99% · fee 28%" });

    // Both payments, never just the flattering one, and the higher of the two
    // has to actually be higher.
    await expect(page.getByText("With paydown")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Without paydown")).toBeVisible();
    await expect(page.getByText(/Paydown due by month 18/)).toBeVisible();

    // The seeded deal already carries a lender's approved figure, so that one
    // is the headline and the sheet sits beneath it. Clear the approval and the
    // headline falls to the FACTOR — not to our amortisation, which is the
    // whole point of storing factors.
    await expect(page.getByText(/own figure from the approval/)).toBeVisible();
    await page.getByLabel("Monthly payment $", { exact: true }).fill("");
    await expect(page.getByText(/rate sheet's payment factor/)).toBeVisible({ timeout: 15000 });
  });
});
