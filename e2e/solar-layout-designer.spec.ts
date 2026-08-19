import { test, expect, type Page } from "@playwright/test";

/**
 * The designer's contract, end to end: what a rep draws on the roof is what the
 * deal is sized from, and it survives a reload.
 *
 * The module count used to be typed into a box. How many panels fit a roof is
 * something you find out by putting them on it, so the box is gone and this is
 * what replaced it.
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
 * Drawing an array rewrites the deal's module count and system size, and
 * solar-no-insurance.spec.ts pins Priya's deal at exactly 10.00 kW. This spec
 * gets a deal of its own that it is free to change.
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

test.describe(FLAG_ON ? "the panel layout designer" : "the panel layout designer (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("the design step no longer asks for what nobody decides there", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    // What still drives every number on the proposal.
    await expect(page.getByLabel("Annual usage (kWh)")).toBeVisible();
    await expect(page.getByLabel("Average monthly bill ($)")).toBeVisible();

    // Interconnection paperwork, a shading figure typed from memory, and
    // equipment nobody has ordered yet.
    for (const gone of [
      "Utility account #",
      "Meter #",
      "Rate plan / tariff",
      "Net metering programme",
      "TSRF %",
      "Module quantity",
    ]) {
      await expect(page.getByLabel(gone)).toHaveCount(0);
    }
  });

  test("drawing an array sizes the system, and survives a reload", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    const canvas = page.getByTestId("layout-canvas");
    await expect(canvas).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("panel-count")).toHaveText(/0 panels/);

    // Scroll it into view BEFORE measuring: page.mouse works in viewport
    // coordinates and does not scroll, so a canvas below the fold silently
    // receives the drag at a point that is not on it.
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;

    // Drag a rectangle on the roof. The imagery itself is a blank tile here —
    // the E2E Maps key is deliberately invalid — but the geometry does not
    // depend on the picture, only on the zoom and latitude behind it.
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.65, { steps: 12 });
    await page.mouse.up();

    await expect(page.getByTestId("panel-count")).not.toHaveText(/^0 panels/);
    const drawn = (await page.getByTestId("panel-count").textContent())!.trim();

    await page.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText(/panels? saved/)).toBeVisible({ timeout: 15000 });

    // The count is the deal's module quantity now, so it has to come back from
    // the database rather than from component state.
    await page.reload();
    await expect(page.getByTestId("panel-count")).toHaveText(drawn, { timeout: 15000 });
    await expect(page.getByText(/drawn on the roof below/)).toBeVisible();
  });
});
