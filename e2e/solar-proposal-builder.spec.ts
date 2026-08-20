import { test, expect, type Page } from "@playwright/test";

/**
 * Solar closes the way roofing does: one emphasized "Build Proposal" button in
 * the Summary, and a builder that owns the system design, the financing and
 * generation.
 *
 * The financing product used to be settable from the Summary card AND from the
 * proposal — two controls writing one field, with the escalator and term the
 * customer actually signs stranded away from the quote. The Summary now only
 * states the product.
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

async function openSolarDeal(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

test.describe(FLAG_ON ? "solar proposal builder" : "solar proposal builder (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("the Summary button opens a builder holding every step", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // The Summary card ends with the same terminal action roofing has.
    const build = page.getByRole("link", { name: /Build Proposal/ }).first();
    await expect(build).toBeVisible({ timeout: 15000 });
    await build.click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });

    await expect(page.getByRole("heading", { name: "Build Proposal" })).toBeVisible();

    // Step 1 is open, and it is the customer — check who we are quoting before
    // quoting them.
    await expect(page.getByLabel("First name")).toBeVisible({ timeout: 15000 });

    // Financing carries the terms the customer signs. The seeded deal is a
    // loan, so the purchase inputs are the ones on screen and the lease/PPA
    // escalator is correctly absent.
    //
    // The product is no longer switchable by hand here: quoting is picking a
    // programme off a lender's rate sheet, and a lease shows its escalator
    // because the lease OFFER was quoted, not because a chip was clicked. See
    // "a lease is never badged the winner" in solar-financing-shelf.spec.ts,
    // which sets up a real lease product and quotes it.
    await page.getByRole("button", { name: "4 · Financing" }).click();
    await expect(page.getByLabel("Gross $/W")).toBeVisible();
    await expect(page.getByLabel("Escalator %/yr")).toHaveCount(0);
    await expect(page.getByText("Not on a rate sheet?")).toHaveCount(0);

    // And the last step generates.
    await page.getByRole("button", { name: "5 · Review & send" }).click();
    await expect(page.getByRole("button", { name: /Check it is ready/ })).toBeVisible();
  });

  test("an unsaved entry survives a trip to another step", async ({ page }) => {
    // The steps are hidden, never unmounted. Unmounting one to show another
    // would silently bin what a rep had typed but not yet saved.
    await login(page, "admin@anexahomes.com");
    const id = await openSolarDeal(page);
    await page.goto(`/portal/leads/${id}/solar-proposal?step=energy`);

    const usage = page.getByLabel("Annual usage (kWh)");
    await expect(usage).toBeVisible({ timeout: 15000 });
    await usage.fill("17250");

    await page.getByRole("button", { name: "4 · Financing" }).click();
    // Any stable landmark of the financing step will do; this one is not
    // conditional on which product is quoted.
    await expect(page.getByRole("button", { name: "Save financing" })).toBeVisible();
    await page.getByRole("button", { name: "2 · Energy" }).click();

    await expect(usage).toHaveValue("17250");
  });

  test("the deal states the financing product and offers no way to change it", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const id = await openSolarDeal(page);

    // No four-way picker in the Summary — the deal states the product, the
    // builder decides it.
    for (const p of ["Cash", "Loan", "Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: p, exact: true })).toHaveCount(0);
    }

    // Nor is there one in the builder any more. The product now follows the
    // programme quoted off a rate sheet, so a rep cannot put a deal on a lease
    // the company has no terms for.
    await page.goto(`/portal/leads/${id}/solar-proposal`);
    await page.getByRole("button", { name: "4 · Financing" }).click();
    await expect(page.getByRole("button", { name: "Save financing" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Not on a rate sheet?")).toHaveCount(0);
    for (const p of ["Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: p, exact: true })).toHaveCount(0);
    }
  });

  test("a roofing deal sent to the solar builder lands in its own", async ({ page }) => {
    // Stale links and hand-typed paths have to go somewhere sensible rather
    // than render an empty solar design form over a roofing job.
    await login(page, "admin@anexahomes.com");
    await page.goto("/portal/leads");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    const id = page.url().split("/").pop()!;

    await page.goto(`/portal/leads/${id}/solar-proposal`);
    await page.waitForURL(/\/presentation$/, { timeout: 15000 });
  });
});
