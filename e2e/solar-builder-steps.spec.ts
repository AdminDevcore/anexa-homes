import { test, expect, type Page } from "@playwright/test";

/**
 * The builder in the order a call actually goes: who are we quoting, what do
 * they use, then what fits their roof.
 *
 * The consumption arithmetic is the part worth pinning end to end. A rep can
 * enter what a customer knows — the bill and the rate — and get usage out, and
 * that usage has to survive the round trip to the database.
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

/**
 * Marcus Webb, not Priya Raman.
 *
 * This spec writes to the deal, and solar-no-insurance.spec.ts pins Priya's at
 * exactly 10.00 kW. Same reason solar-layout-designer.spec.ts uses him.
 */
async function openDesignerDeal(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
  await page.goto("/portal/leads?q=Marcus");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

test.describe(FLAG_ON ? "the proposal builder's steps" : "the proposal builder's steps (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("opens on the customer, in the order a call goes", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal`);

    for (const label of [/1 · Customer/, /2 · Energy/, /3 · System design/, /4 · Financing/, /5 · Review/]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    // Step 1 shows who we are quoting, editable in place.
    await expect(page.getByLabel("First name")).toHaveValue(/Marcus/);
    await expect(page.getByLabel("Co-signer name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save customer details" })).toBeVisible();
  });

  test("a bill and a rate give usage, and it survives a reload", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=energy`);

    await page.getByRole("radio", { name: "From their bill" }).check();
    await page.getByLabel("Average monthly bill ($)").fill("200");
    await page.getByLabel("Rate ($/kWh)").fill("0.20");

    // $200 ÷ $0.20 = 1,000 kWh a month.
    await expect(page.getByTestId("energy-summary")).toContainText("12,000 kWh/yr");

    await page.getByRole("button", { name: "Save energy" }).click();
    await expect(page.getByText(/Energy saved/)).toBeVisible({ timeout: 15000 });

    // The figure has to come back from the database, not from component state.
    await page.reload();
    await expect(page.getByTestId("energy-summary")).toContainText("12,000 kWh/yr");
  });

  test("usage entered directly shows the rate as calculated", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=energy`);

    await page.getByRole("radio", { name: "From their usage" }).check();
    await page.getByLabel("Annual usage (kWh)").fill("14000");
    await page.getByLabel("Average monthly bill ($)").fill("180");

    // 18,000c × 12 ÷ 14,000 kWh = 154 mills.
    await expect(page.getByTestId("energy-summary")).toContainText("14,000 kWh/yr");
    await expect(page.getByTestId("energy-summary")).toContainText("$0.154/kWh");
    await expect(page.getByTestId("energy-summary")).toContainText("calculated");
  });
});
