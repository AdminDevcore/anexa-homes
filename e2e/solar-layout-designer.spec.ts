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

/**
 * Pick a tool, THEN measure the canvas.
 *
 * In that order on purpose. `page.mouse` works in viewport coordinates and
 * does not scroll, and clicking a toolbar button above the fold scrolls the
 * page under it — so a box measured before the click points at whatever has
 * slid into that spot since. The drag then lands on nothing and the count
 * stays 0, which reads as "the tool is broken" rather than "the test is".
 */
async function pickTool(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const canvas = page.getByTestId("layout-canvas");
  await canvas.scrollIntoViewIfNeeded();
  return (await canvas.boundingBox())!;
}

/**
 * How many panels are on the roof right now.
 *
 * The specs in this file share one deal and each of them SAVES, so the roof a
 * test opens is whatever the test before it left. Assertions are therefore
 * deltas, never absolutes — "0 panels" is only true for whichever test happens
 * to run first, and pinning it makes the suite order-dependent.
 */
async function panelsOnRoof(page: Page): Promise<number> {
  const text = (await page.getByTestId("panel-count").textContent())!;
  return parseInt(text.trim(), 10);
}

test.describe(FLAG_ON ? "the panel layout designer" : "the panel layout designer (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("the design step no longer asks for what nobody decides there", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    // The design step is the roof now.
    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });

    // Interconnection paperwork, a shading figure typed from memory, and
    // equipment nobody has ordered yet: gone from the app entirely.
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

    // Usage and the bill still EXIST — they moved to the Energy step, which owns
    // them. Every step stays mounted and is hidden with display:none, so the
    // assertion here is that they are not on this one, not that they are absent.
    for (const moved of ["Annual usage (kWh)", "Average monthly bill ($)"]) {
      await expect(page.getByLabel(moved)).not.toBeVisible();
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

  test("a single panel can be placed, slid and nudged", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });

    const before = await panelsOnRoof(page);

    // ONE panel, placed by clicking. The whole reason this tool grew a
    // per-panel mode: a rectangle drag cannot put a module beside a vent.
    const box = await pickTool(page, "Add panel");
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    expect(await panelsOnRoof(page)).toBe(before + 1);
    await expect(page.getByText("Selected panel")).toBeVisible();

    // Placing it selects it, so the arrow keys have something to move. The
    // count must not change — a nudge that duplicates or drops a panel is a
    // nudge that silently reprices the deal.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    expect(await panelsOnRoof(page)).toBe(before + 1);

    await page.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText(/panels? saved/)).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId("panel-count")).toBeVisible({ timeout: 15000 });
    expect(await panelsOnRoof(page)).toBe(before + 1);
  });

  test("pulling one panel out of an array keeps the count the same", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });

    const drawBox = await pickTool(page, "Draw array");
    await page.mouse.move(drawBox.x + drawBox.width * 0.3, drawBox.y + drawBox.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(drawBox.x + drawBox.width * 0.6, drawBox.y + drawBox.height * 0.6, { steps: 12 });
    await page.mouse.up();
    const drawn = await panelsOnRoof(page);
    expect(drawn).toBeGreaterThan(0);

    // Grab a module out of the middle of the grid and drag it clear. It leaves
    // the array and becomes its own panel; the total is untouched, because the
    // hole it came from is knocked out at the same moment.
    const box = await pickTool(page, "Move panel");
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 10 });
    await page.mouse.up();

    expect(await panelsOnRoof(page)).toBe(drawn);
    await expect(page.getByText("Selected panel")).toBeVisible();
  });

  test("which way the roof faces changes the production, and is asked for", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });

    const box = await pickTool(page, "Draw array");
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 12 });
    await page.mouse.up();

    // An array nobody has described is chased for its orientation rather than
    // quietly priced as though it faced south.
    await expect(page.getByText(/no facing or pitch set/)).toBeVisible();

    // South at a 6/12 pitch: as good as this site gets. Asserted on the
    // SELECTED array's own line rather than on the roof-wide warning, which
    // stays up while any OTHER array left by an earlier spec is still
    // undescribed.
    await page.getByLabel("Facing (azimuth)").fill("180");
    await page.getByLabel("Roof pitch").selectOption("6");
    await expect(page.getByText(/Facing S \(180°\) at 26\.6°/)).toBeVisible();
    const south = parseInt((await page.getByTestId("orientation-factor").textContent())!, 10);

    // Turn the same array to face north and the number has to fall. This is
    // the whole point of the model: identical panels, different roof.
    await page.getByLabel("Facing (azimuth)").fill("0");
    await expect(page.getByText(/Facing N \(0°\) at 26\.6°/)).toBeVisible();
    const north = parseInt((await page.getByTestId("orientation-factor").textContent())!, 10);
    expect(north).toBeLessThan(south);

    // And it survives the round trip through the database, because the
    // production the customer is quoted is computed server-side from it.
    await page.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText(/panels? saved/)).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByTestId("orientation-factor")).toBeVisible({ timeout: 15000 });
    const reloaded = parseInt((await page.getByTestId("orientation-factor").textContent())!, 10);
    expect(reloaded).toBe(north);
  });
});
