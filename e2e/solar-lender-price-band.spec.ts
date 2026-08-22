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

async function addLender(page: Page, name: string) {
  await page.goto("/portal/settings/solar-lenders");
  await expect(page.getByRole("heading", { name: "Lenders", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15000 });
}

/**
 * One lender's card. Scoped, never `.first()` on the page: specs accumulate
 * lenders across runs, so a page-wide match reaches whichever partner sorts
 * first — which is how an assertion passes against the wrong lender.
 */
function cardFor(page: Page, name: string) {
  return page.locator("div.rounded-xl.bg-card").filter({ hasText: name });
}

/**
 * The card while it is being edited.
 *
 * In edit mode the name lives in an input VALUE and `hasText` reads text
 * content, so the by-name filter would slide onto the rate-sheet card below.
 * Anchoring on a field only this panel has keeps it on the right one.
 */
function editingCard(page: Page) {
  return page
    .locator("div.rounded-xl.bg-card")
    .filter({ has: page.getByLabel(/^Min base \$\/W/) });
}

async function openEditor(page: Page, name: string) {
  await cardFor(page, name).first()
    .getByRole("button", { name: "Edit name, links and credit instructions" })
    .click();
  await expect(page.getByLabel(/^Min base \$\/W/)).toBeVisible({ timeout: 15000 });
}

async function addLoan(page: Page, name: string, fee: string) {
  await cardFor(page, name).last().getByRole("button", { name: "Loan", exact: true }).click();
  await page.getByLabel("APR %", { exact: true }).fill("5.99");
  await page.getByLabel("Term (months)", { exact: true }).fill("240");
  await page.getByLabel("Dealer fee %", { exact: true }).fill(fee);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });
}

test.describe(FLAG_ON ? "a lender's price band" : "a lender's price band (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a floor is saved, shown on the card, and can be taken off again", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Floor");
    await addLender(page, name);

    // A new lender has neither end set, and says nothing about either — a row
    // of dashes on every uncapped partner teaches nobody anything.
    await expect(cardFor(page, name).first().getByText("Min base $/W")).toHaveCount(0);

    await openEditor(page, name);
    await page.getByLabel(/^Min base \$\/W/).fill("2.75");
    await editingCard(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15000 });

    const card = cardFor(page, name).first();
    await expect(card.getByText("Min base $/W")).toBeVisible({ timeout: 15000 });
    await expect(card.getByText("$2.75/W", { exact: true })).toBeVisible();

    // It survives a reload — the point of a setting is that it is stored, not
    // that the form remembers what was typed into it a moment ago.
    await page.reload();
    await expect(cardFor(page, name).first().getByText("$2.75/W", { exact: true })).toBeVisible({ timeout: 15000 });

    // Blank clears it. A floor that cannot be removed is a floor nobody sets.
    await openEditor(page, name);
    await page.getByLabel(/^Min base \$\/W/).fill("");
    await editingCard(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15000 });
    await expect(cardFor(page, name).first().getByText("Min base $/W")).toHaveCount(0);
  });

  test("a typo is named, not swallowed", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Typo");
    await addLender(page, name);

    // 275 cents typed as if it were dollars. Accepted, it would set a floor of
    // $275/W and block every deal on this partner for ever.
    await openEditor(page, name);
    await page.getByLabel(/^Min base \$\/W/).fill("275");
    await editingCard(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Min base \$\/W has to be a price/)).toBeVisible({ timeout: 15000 });
  });

  test("the editor says what a capped partner can actually leave you", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Capped");
    await addLender(page, name);
    await addLoan(page, name, "65");

    // A ceiling of $5.50/W on a 65% programme leaves $1.93/W and no more,
    // whatever base a rep types — so a $3.00 floor here would block every deal
    // on this partner with nothing on screen having warned anybody.
    await openEditor(page, name);
    await page.getByLabel(/^Max final \$\/W/).fill("5.50");
    await editingCard(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15000 });

    await openEditor(page, name);
    await expect(editingCard(page).getByText(/leave at most \$1\.93\/W/)).toBeVisible({ timeout: 15000 });
  });
});
