import { test, expect, type Page } from "@playwright/test";

/**
 * A financing partner's logo.
 *
 * A screen full of identical bank glyphs told a rep nothing and told a customer
 * less. These specs hold the three things that make the mark trustworthy: a
 * lender with no logo still looks deliberate, an uploaded logo is actually
 * served back as an image, and the mark follows the lender onto the deal where
 * the money is quoted.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const PASSWORD = "Passw0rd!";

/** An 8×8 PNG. Real bytes, so sharp genuinely decodes and re-encodes it. */
const PNG_8x8 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNkYPhfz0AEYBxVSF+FjAxkAKZRhfRVyMhABmAaVQgAcO4H6Yd6WLcAAAAASUVORK5CYII=",
  "base64"
);

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

/**
 * Put one loan on a lender's rate sheet.
 *
 * The shelf shows PROGRAMMES, not partners — a lender with nothing on its sheet
 * has no card to carry a logo, and "the mark follows the lender to where the
 * money is quoted" is a claim about a quote, so there has to be something
 * quotable for it to be about.
 */
async function addLoan(page: Page, name: string, apr: string, months: string, fee: string) {
  // The panel is the partner, so assert whose it is before typing terms into it.
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
  await tab(page, "Rate sheet");
  await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
  await page.getByLabel("APR %", { exact: true }).fill(apr);
  await page.getByLabel("Term (months)", { exact: true }).fill(months);
  await page.getByLabel("Dealer fee %", { exact: true }).fill(fee);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });
  // Wait for the ROW, not just the toast: the toast fires before the panel's
  // refresh lands, and navigating away mid-refresh is how the next `goto`
  // ended up aborted.
  await expect(panel(page).getByText(`${apr}%`, { exact: false }).first()).toBeVisible({
    timeout: 15000,
  });
}

/**
 * The logo controls.
 *
 * No longer hidden behind a pencil: the mark is set on the partner's Details
 * tab, which is where the panel already opens, so this only has to make sure
 * the right partner is in front of us.
 */
async function openLogoControls(page: Page, name: string) {
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
  await tab(page, "Details");
  await expect(panel(page).getByText("Logo", { exact: true })).toBeVisible({ timeout: 15000 });
}

test.describe(FLAG_ON ? "solar lender logos" : "solar lender logos (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a lender with no logo wears its initials, not a generic bank icon", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Monogram");
    await addLender(page, name);

    // "ZZ Monogram <tag>" → the first letters of the first two words.
    await expect(panel(page).getByText("ZM", { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(panel(page).locator('img[src*="/api/solar/lender-logo"]')).toHaveCount(0);
  });

  test("an uploaded logo is stored, served back as a PNG, and can be removed", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Upload");
    await addLender(page, name);

    await openLogoControls(page, name);
    await page.getByLabel(`Logo file for ${name}`).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_8x8,
    });
    await expect(page.getByText("Logo updated")).toBeVisible({ timeout: 15000 });

    // The mark on the panel is now an image from our own route — never a
    // hotlink to the bank's site, which is what would rot in a sent proposal.
    const logo = panel(page).locator('img[src*="/api/solar/lender-logo"]').first();
    await expect(logo).toBeVisible({ timeout: 15000 });
    const src = await logo.getAttribute("src");
    expect(src).toContain("v="); // cache-busted on the logo's own timestamp

    // Serving it is what actually matters: a row pointing at bytes nobody can
    // fetch renders a broken image on the one page a customer reads.
    const served = await page.request.get(src!);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/png");
    expect((await served.body()).length).toBeGreaterThan(0);

    // Removing it falls back to the monogram rather than to an empty box.
    await openLogoControls(page, name);
    await panel(page).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Logo removed")).toBeVisible({ timeout: 15000 });
    await expect(panel(page).locator('img[src*="/api/solar/lender-logo"]')).toHaveCount(0);
    await expect(panel(page).getByText("ZU", { exact: true }).first()).toBeVisible();
  });

  test("the logo follows the lender to where the money is quoted", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("OnDeal");
    await addLender(page, name);

    await openLogoControls(page, name);
    await page.getByLabel(`Logo file for ${name}`).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_8x8,
    });
    await expect(page.getByText("Logo updated")).toBeVisible({ timeout: 15000 });

    // The shelf is programmes, so give this partner one to be quoted on.
    await addLoan(page, name, "5.99", "240", "20");

    await page.goto("/portal/leads?q=Priya");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    const dealUrl = page.url();

    // The proposal's Financing step, which is the ONE place a deal's lender is
    // chosen: the deal page used to carry a second picker for the same field
    // and now reports what the last proposal froze instead. Every programme is
    // a card naming its own lender — the shelf is one wrapped grid rather than
    // a landmark per partner — so this cannot drift onto another lender's mark.
    await page.goto(`${dealUrl}/solar-proposal?step=financing`);
    const card = page
      .getByRole("button", {
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · `),
      })
      .first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('img[src*="/api/solar/lender-logo"]').first()).toBeVisible({
      timeout: 15000,
    });
  });
});
