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
 * The same card while it is being edited.
 *
 * A separate locator on purpose: in edit mode the lender's name lives in an
 * input VALUE, and `hasText` reads text content, not values — so the by-name
 * filter silently slides onto the rate-sheet card, which has the name as a
 * heading and none of these buttons. Anchoring on the file input's aria-label
 * keeps it on the one card being edited.
 */
function editingCardFor(page: Page, name: string) {
  return page
    .locator("div.rounded-xl.bg-card")
    .filter({ has: page.getByLabel(`Logo file for ${name}`) });
}

/** Open the logo controls, which live inside the card's edit panel. */
async function openLogoControls(page: Page, name: string) {
  await cardFor(page, name).first()
    .getByRole("button", { name: "Edit name, links and credit instructions" })
    .click();
  await expect(page.getByText("Logo", { exact: true })).toBeVisible({ timeout: 15000 });
}

test.describe(FLAG_ON ? "solar lender logos" : "solar lender logos (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a lender with no logo wears its initials, not a generic bank icon", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const name = lenderName("Monogram");
    await addLender(page, name);

    const card = cardFor(page, name).first();
    // "ZZ Monogram <tag>" → the first letters of the first two words.
    await expect(card.getByText("ZM", { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(card.locator('img[src*="/api/solar/lender-logo"]')).toHaveCount(0);
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
    // Uploading leaves the edit panel open, so close it and read the card as a
    // person would see it — a preview inside the form proves less.
    await editingCardFor(page, name).getByRole("button", { name: "Cancel" }).click();

    // The mark on the card is now an image from our own route — never a
    // hotlink to the bank's site, which is what would rot in a sent proposal.
    const logo = cardFor(page, name).first().locator('img[src*="/api/solar/lender-logo"]').first();
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
    await editingCardFor(page, name).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Logo removed")).toBeVisible({ timeout: 15000 });
    await editingCardFor(page, name).getByRole("button", { name: "Cancel" }).click();
    await expect(cardFor(page, name).first().locator('img[src*="/api/solar/lender-logo"]')).toHaveCount(0);
    await expect(cardFor(page, name).first().getByText("ZU", { exact: true }).first()).toBeVisible();
  });

  test("the logo follows the lender onto the deal where the money is quoted", async ({ page }) => {
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

    await page.goto("/portal/leads?q=Priya");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    // Asserted on the deal's own lender control rather than the builder's:
    // the two set the same field, and this one is not being rebuilt underneath
    // the spec. Beside the select, because a native <option> holds no image.
    const picker = page.getByLabel("Lender / approved-vendor list");
    await expect(picker).toBeVisible({ timeout: 15000 });
    await picker.selectOption({ label: name });

    const mark = page.locator('img[src*="/api/solar/lender-logo"]');
    await expect(mark.first()).toBeVisible({ timeout: 15000 });

    // And it survives the save — the mark has to be read back from the deal,
    // not just left over from the click that chose it.
    await page.getByRole("button", { name: "Save build details" }).click();
    await expect(page.getByText("Build details saved")).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.locator("#solar-lender option:checked")).toHaveText(name, { timeout: 15000 });
    await expect(page.locator('img[src*="/api/solar/lender-logo"]').first()).toBeVisible({
      timeout: 15000,
    });
  });
});
