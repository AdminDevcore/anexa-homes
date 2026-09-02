import { test, expect, type Page } from "@playwright/test";

/**
 * The two ends of a partner's pricing.
 *
 * A lender card carries a ceiling on what the CUSTOMER signs and a floor under
 * what the COMPANY keeps. They are separate numbers about separate people, and
 * the mistake either one exists to prevent is silent: a partner quoted three
 * times what it funds, or a deal discounted down to nothing.
 *
 * These specs hold the settings round-trip — a floor is saved, shown on the
 * card, and cleared again — and the sentence that stops somebody setting a
 * floor no deal on that partner can ever reach. What the floor DOES to a deal
 * is unit-tested exhaustively in solar-money.test.ts, against maths rather
 * than against a browser.
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

/** Both ends of the band live on the partner's Pricing tab. */
async function openPricing(page: Page, name: string) {
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
  await tab(page, "Pricing");
  await expect(page.getByLabel(/^Min base \$\/W/)).toBeVisible({ timeout: 15000 });
}

/** The one Save at the bottom of the panel, which commits every tab at once. */
async function save(page: Page) {
  await panel(page).getByRole("button", { name: "Save changes" }).click();
}

async function addLoan(page: Page, name: string, fee: string) {
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
  await tab(page, "Rate sheet");
  await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
  await page.getByLabel("APR %", { exact: true }).fill("5.99");
  await page.getByLabel("Term (months)", { exact: true }).fill("240");
  await page.getByLabel("Dealer fee %", { exact: true }).fill(fee);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });
}

test.describe(FLAG_ON ? "a lender's price band" : "a lender's price band (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a floor is saved, shown on the panel, and can be taken off again", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Floor");
    await addLender(page, name);

    // A new lender has neither end set, and the header says nothing about
    // either — a row of dashes on every uncapped partner teaches nobody
    // anything.
    await expect(panel(page).getByText(/^Floor \$/)).toHaveCount(0);

    await openPricing(page, name);
    await page.getByLabel(/^Min base \$\/W/).fill("2.75");
    await save(page);
    await expect(page.getByText(`${name} saved`)).toBeVisible({ timeout: 15000 });

    // The header carries it, so a floor is visible without opening Pricing.
    await expect(panel(page).getByText("Floor $2.75/W")).toBeVisible({ timeout: 15000 });

    // It survives a reload — the point of a setting is that it is stored, not
    // that the form remembers what was typed into it a moment ago. The panel
    // reopens on the same partner because the URL carries which one it was.
    await page.reload();
    await expect(panel(page).getByText("Floor $2.75/W")).toBeVisible({ timeout: 15000 });

    // Blank clears it. A floor that cannot be removed is a floor nobody sets.
    await openPricing(page, name);
    await page.getByLabel(/^Min base \$\/W/).fill("");
    await save(page);
    await expect(page.getByText(`${name} saved`)).toBeVisible({ timeout: 15000 });
    await expect(panel(page).getByText(/^Floor \$/)).toHaveCount(0);
  });

  test("a typo is named, not swallowed", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Typo");
    await addLender(page, name);

    // 275 cents typed as if it were dollars. Accepted, it would set a floor of
    // $275/W and block every deal on this partner for ever.
    await openPricing(page, name);
    await page.getByLabel(/^Min base \$\/W/).fill("275");
    await save(page);
    await expect(page.getByText(/Min base \$\/W has to be a price/)).toBeVisible({ timeout: 15000 });
  });

  test("the pricing tab says what a capped partner can actually leave you", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Capped");
    await addLender(page, name);
    await addLoan(page, name, "65");

    // A ceiling of $5.50/W on a 65% programme leaves $1.93/W and no more,
    // whatever base a rep types — so a $3.00 floor here would block every deal
    // on this partner with nothing on screen having warned anybody.
    await openPricing(page, name);
    // The figure only exists once the partner is told it publishes one; the
    // box is not there on "prices the normal way", which is every other lender.
    await panel(page).getByRole("radio", { name: /Maximum \$\/W/ }).click();
    await page.getByLabel(/^Final \$\/W/).fill("5.50");
    await save(page);
    await expect(page.getByText(`${name} saved`)).toBeVisible({ timeout: 15000 });

    await openPricing(page, name);
    await expect(panel(page).getByText(/leave at most \$1\.93\/W/)).toBeVisible({ timeout: 15000 });
  });
});
