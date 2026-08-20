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

    // Financing carries the terms the customer signs: the product, and the
    // terms that come with it. The seeded deal is a loan, so the escalator is
    // correctly absent until a lease is picked — which is the point of keeping
    // these together rather than out on the deal.
    //
    // "Lease" exact: the offer cards lead with their own terms, so the bare
    // word is the quote-by-hand chip and nothing else.
    await page.getByRole("button", { name: "4 · Financing" }).click();
    await expect(page.getByLabel("Gross $/W")).toBeVisible();
    await expect(page.getByLabel("Escalator %/yr")).toHaveCount(0);
    await page.getByRole("button", { name: "Lease", exact: true }).click();
    await expect(page.getByLabel("Escalator %/yr")).toBeVisible();
    await expect(page.getByLabel("Term (years)")).toBeVisible();

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
    await expect(page.getByRole("button", { name: "Lease", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "2 · Energy" }).click();

    await expect(usage).toHaveValue("17250");
  });

  test("the financing product is set in the builder and only stated on the deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const id = await openSolarDeal(page);

    // No four-way picker in the Summary any more — the deal states the product.
    await expect(page.getByRole("button", { name: "PPA", exact: true })).toHaveCount(0);

    await page.goto(`/portal/leads/${id}/solar-proposal`);
    await page.getByRole("button", { name: "4 · Financing" }).click();
    await page.getByRole("button", { name: "Lease", exact: true }).click();
    await page.getByRole("button", { name: "Save financing" }).click();
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });

    // …and the deal reports it.
    await page.goto(`/portal/leads/${id}`);
    await expect(page.getByText("Lease", { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // Put it back so later specs see the seeded loan deal.
    await page.goto(`/portal/leads/${id}/solar-proposal`);
    await page.getByRole("button", { name: "4 · Financing" }).click();
    await page.getByRole("button", { name: "Loan", exact: true }).click();
    await page.getByRole("button", { name: "Save financing" }).click();
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });
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
