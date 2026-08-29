import { test, expect, type Page } from "@playwright/test";

/**
 * A deal can sell a battery with no panels.
 *
 * Two tests, and the SECOND is the one that protects money already in the
 * pipeline: "Solar + Storage" was promised to be byte-identical to what reps
 * quote today, and that promise is only worth what a test says it is.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const step = (page: Page, name: string | RegExp) =>
  page.getByRole("navigation", { name: "Proposal steps" }).getByRole("button", { name });

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openSolarBuilder(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const id = page.url().split("/").pop()!;
  await page.goto(`/portal/leads/${id}/solar-proposal`);
  await expect(page.getByLabel("First name")).toBeVisible({ timeout: 15000 });
  return id;
}

/**
 * The three-way question at the top of step 1.
 *
 * Matched by a PREFIX, not exactly: each option's accessible name is its label
 * followed by its one-line blurb ("Solar + Storage Panels with a battery."),
 * and an exact match finds nothing. Anchored at the start so "Solar" cannot
 * also match "Solar + Storage".
 */
const quoting = (page: Page, label: string) =>
  page
    .getByRole("radiogroup", { name: "What are we quoting?" })
    .getByRole("radio", { name: new RegExp("^" + label.replace(/[+]/g, "\\$&")) });

test.describe(FLAG_ON ? "storage-only proposals" : "storage-only proposals (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("a rep can quote a battery with no panels", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarBuilder(page);

    // Step 1 opens with the question, above the customer's name.
    await expect(page.getByText("What are we quoting?")).toBeVisible();
    await quoting(page, "Storage only").click();
    await expect(quoting(page, "Storage only")).toHaveAttribute("aria-checked", "true");

    // Step three renames itself and REPLACES the designer. The roof is not
    // hidden — there is no roof.
    await expect(step(page, "Storage")).toBeVisible({ timeout: 15000 });
    await expect(step(page, "System design")).toHaveCount(0);

    await step(page, "Storage").click();
    // Exact: "Battery" also substring-matches the financing step's
    // "Base $ per battery" box, which is mounted the whole time.
    await expect(page.getByLabel("Battery", { exact: true })).toBeVisible({ timeout: 15000 });
    // The designer's own controls are gone with it.
    await expect(page.getByLabel("Imagery detail")).toHaveCount(0);

    // Pick a battery and a count; capacity and runtime are DERIVED and appear
    // without anybody typing them.
    const battery = page.getByLabel("Battery", { exact: true });
    await battery.selectOption({ index: 1 });
    await expect(page.getByText(/kWh of usable storage/)).toBeVisible({ timeout: 15000 });

    await page.getByLabel("How many").selectOption("2");
    // Exact: "Essentials" is also a prefix of "Essentials + AC".
    await expect(page.getByText("Essentials", { exact: true })).toBeVisible();
    await expect(page.getByText("Whole home", { exact: true })).toBeVisible();
    // Runtime is DERIVED — nobody typed these.
    await expect(page.getByText(/hrs$/).first()).toBeVisible();

    // Financing prices per BATTERY, not per watt.
    await step(page, "Financing").click();
    await expect(page.getByLabel("Base $ per battery", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /base price per watt/ })).toHaveCount(0);

    await page.getByLabel("Base $ per battery", { exact: true }).fill("13000");
    await page.getByLabel("Base $ per battery", { exact: true }).blur();
    await expect(page.getByText("Customer signs")).toBeVisible();
  });

  test("a solar + storage deal keeps the document it always had", async ({ page }) => {
    // THE REGRESSION GUARD. `pv` and `pv_storage` take the identical code path;
    // this is what says so. Anything that starts branching on the difference
    // breaks here rather than on a deal somebody is selling.
    await login(page, "admin@anexahomes.com");
    await openSolarBuilder(page);

    await quoting(page, "Solar + Storage").click();
    await expect(quoting(page, "Solar + Storage")).toHaveAttribute("aria-checked", "true");

    // Step three is still the designer, under its own name.
    await expect(step(page, "System design")).toBeVisible({ timeout: 15000 });
    await expect(step(page, "Storage")).toHaveCount(0);

    // And financing still prices per watt.
    await step(page, "Financing").click();
    await expect(page.getByRole("button", { name: /base price per watt/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByLabel("Base $ per battery", { exact: true })).toHaveCount(0);

    // Switching to plain Solar changes nothing about any of it — the two are
    // one code path, and only the rep's vocabulary differs.
    await step(page, "Customer").click();
    await quoting(page, "Solar Panels only").click();
    await expect(step(page, "System design")).toBeVisible({ timeout: 15000 });
    await step(page, "Financing").click();
    await expect(page.getByRole("button", { name: /base price per watt/ })).toBeVisible();
  });
});
