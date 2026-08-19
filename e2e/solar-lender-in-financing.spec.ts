import { test, expect, type Page } from "@playwright/test";

/**
 * Picking the lender where the terms are quoted.
 *
 * The lender lives on the design because it gates the approved-vendor list, and
 * it used to be settable ONLY from the deal's Operations card. A rep standing
 * in the Financing step therefore saw "no lender chosen, open the deal" and had
 * to leave the builder to unlock the screen they were on — which is why every
 * design in production reached the proposal with no lender at all. These specs
 * hold the picker in the Financing step, and hold the two controls to one field.
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
 * One lender's card. Scoped, never `.first()`: specs accumulate lenders across
 * runs, so a page-wide match reaches whichever partner sorts first — which is
 * how a product lands on the wrong lender and the spec still passes.
 */
function cardFor(page: Page, name: string) {
  return page.locator("div.rounded-xl.bg-card").filter({ hasText: name });
}

/** Open a solar deal and return its id. */
async function openSolarDeal(page: Page) {
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

test.describe(FLAG_ON ? "solar lender in the financing step" : "solar lender in the financing step (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a PPA is quoted from the sheet without leaving the builder", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("PPA");
    await addLender(page, name);
    await cardFor(page, name).last().getByRole("button", { name: "PPA", exact: true }).click();
    await page.getByLabel("$/kWh", { exact: true }).fill("0.145");
    await page.getByLabel("Escalator %/yr", { exact: true }).fill("2.9");
    await page.getByLabel("Term (years)", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(cardFor(page, name).last().getByText(/25 yr/)).toBeVisible({ timeout: 15000 });

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await page.getByRole("button", { name: /PPA.*per kWh produced/ }).click();

    // The whole point: the lender is chosen HERE, and the sheet follows it.
    await page.getByLabel("Lender", { exact: true }).selectOption({ label: name });
    await expect(page.getByText(`Financing through ${name}.`)).toBeVisible({ timeout: 15000 });

    const picker = page.getByLabel(`${name} product`);
    await expect(picker).toBeVisible({ timeout: 15000 });
    await picker.selectOption({ label: "25 yr · esc 2.9% · $0.145/kWh" });
    await page.getByRole("button", { name: "Save financing" }).click();
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });

    // Reload rather than trust the optimistic state — the lender is written to
    // the design by its own action, and a lost write looks identical on screen.
    await page.reload();
    await page.getByRole("button", { name: /PPA.*per kWh produced/ }).click();
    await expect(page.locator("select").filter({ hasText: name }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel(`${name} product`)).toBeVisible({ timeout: 15000 });
  });

  test("one field, two controls: the deal reads back what financing chose", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Shared");
    await addLender(page, name);

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await page.getByRole("button", { name: /Loan.*dealer fee/ }).click();
    await page.getByLabel("Lender", { exact: true }).selectOption({ label: name });
    await expect(page.getByText(`Financing through ${name}.`)).toBeVisible({ timeout: 15000 });

    // The Operations card on the deal is the same field, so it must agree.
    await page.goto(`/portal/leads/${leadId}`);
    await expect(page.locator("#solar-lender option:checked")).toHaveText(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      { timeout: 15000 }
    );
  });

  test("with no lender on the deal, the sheet stays hidden rather than lying", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await page.getByRole("button", { name: /Lease.*escalator/ }).click();
    await page.getByLabel("Lender", { exact: true }).selectOption("");
    await expect(page.getByText("Lender cleared.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel(/ product$/)).toHaveCount(0);

    // Cash has no lender by definition, so it does not ask for one.
    await page.getByRole("button", { name: /Cash.*no dealer fee/ }).click();
    await expect(page.getByLabel("Lender", { exact: true })).toHaveCount(0);
  });
});
