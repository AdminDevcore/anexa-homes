import { test, expect, type Page } from "@playwright/test";

/**
 * Workspace switcher + vertical isolation, end to end.
 *
 * Replaces the old industry.spec.ts, which tested the switcher that commit
 * 8fa44b3 deleted and had been red on the baseline ever since.
 *
 * The multi-vertical experience lives behind SOLAR_VERTICAL_ENABLED. With the
 * flag off there is exactly one workspace and nothing to switch, so the
 * switcher tests skip rather than fail — a permanently-red test is just cover.
 *
 *   pnpm e2e                              → flag off, switcher tests skip
 *   SOLAR_VERTICAL_ENABLED=1 pnpm e2e     → flag on, full coverage
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

async function switchTo(page: Page, workspace: "Roofing" | "Solar") {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: workspace }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  // The page header carries "<Role> · <Workspace> workspace". The empty-state
  // hint can also mention the workspace by name, so anchor on the header.
  await expect(
    page.getByText(new RegExp(`· ${workspace} workspace`))
  ).toBeVisible({ timeout: 15000 });
}

test.describe("workspace switcher", () => {
  test.skip(!FLAG_ON, "multi-vertical is behind SOLAR_VERTICAL_ENABLED");

  test("switching workspaces isolates the deal flow", async ({ page }) => {
    await login(page, "manager@anexahomes.com");

    // Roofing (the default) has the seeded appointments.
    await page.goto("/portal/leads");
    await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible({ timeout: 15000 });
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);

    await switchTo(page, "Solar");

    // Solar is its own workspace: it shows its OWN deals and not one roofing
    // deal leaks in. (Stronger than asserting emptiness — an empty list would
    // also "pass" if the query were simply broken.)
    await page.goto("/portal/leads");
    await expect(page.getByRole("cell", { name: /Priya Raman/ })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("cell", { name: /Robert Johnson/ })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: /Linda Davis/ })).toHaveCount(0);

    // …and it has its own canonical NTP → PTO pipeline, not roofing's.
    await page.goto("/portal/pipeline");
    await expect(page.getByText("Solar Pipeline")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("NTP Submitted")).toBeVisible();
    await expect(page.getByText("Utility PTO")).toBeVisible();
    await expect(page.getByText("Permit Redline — Action Required")).toBeVisible();
    // Roofing's insurance stages must not leak in.
    await expect(page.getByText("Adjuster Meeting Scheduled")).toHaveCount(0);
    await expect(page.getByText("Supplement Needed")).toHaveCount(0);

    // Switching back restores roofing: a real toggle, not a one-way door.
    await switchTo(page, "Roofing");
    await page.goto("/portal/leads");
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
  });

  test("editing one workspace's settings never touches the other", async ({ page }) => {
    await login(page, "admin@anexahomes.com");

    // Capture roofing's inspection outcomes.
    await page.goto("/portal/settings/inspection-outcomes");
    const firstRow = page.getByRole("textbox").first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const roofingBefore = await page.getByRole("textbox").evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value)
    );
    expect(roofingBefore.length).toBeGreaterThan(0);

    // Rename the first outcome while in SOLAR.
    await switchTo(page, "Solar");
    await page.goto("/portal/settings/inspection-outcomes");
    const solarFirst = page.getByRole("textbox").first();
    await expect(solarFirst).toBeVisible({ timeout: 15000 });
    await solarFirst.fill("SOLAR ONLY OUTCOME");
    await solarFirst.blur();
    await page.waitForTimeout(1500); // debounced autosave

    // Roofing's list must be byte-for-byte what it was.
    await switchTo(page, "Roofing");
    await page.goto("/portal/settings/inspection-outcomes");
    await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 15000 });
    const roofingAfter = await page.getByRole("textbox").evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value)
    );
    expect(roofingAfter).toEqual(roofingBefore);
    expect(roofingAfter).not.toContain("SOLAR ONLY OUTCOME");
  });

  test("Operations reports how long the deal spent in each stage", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await switchTo(page, "Solar");

    await page.goto("/portal/leads?q=Priya");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

    await page.getByRole("tab", { name: "Operations" }).click();

    // The headline: how long this job has been running, start to now.
    await expect(page.getByText("Elapsed so far")).toBeVisible({ timeout: 15000 });

    // The stage it is sitting in, still counting. The seeded deal entered
    // Permit Submitted 12 days ago and has not moved since.
    await expect(page.getByText("Permit Submitted").first()).toBeVisible();
    await expect(page.getByText(/12 days/).first()).toBeVisible();
    await expect(page.getByText(/\u2192 now/).first()).toBeVisible();

    // The chase/SLA controls this tab used to carry are gone: the tab answers
    // "where did the time go", nothing else.
    await expect(page.getByRole("button", { name: /Log follow-up/ })).toHaveCount(0);
    await expect(page.getByText("Site findings")).toHaveCount(0);
  });

  test("a proposal cannot be generated from an invalid design", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await switchTo(page, "Solar");
    await page.goto("/portal/leads?q=Priya");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

    // The design lives in the proposal builder now, not on the deal.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });

    // The seeded deal is complete, so break it: annual usage is the anchor for
    // offset, and without it the offset figure is meaningless. This is the
    // exact fault that produces five-figure offsets on real competitor
    // proposals, so it must block generation.
    //
    // Usage lives on the Energy step, which owns it — the design step is the
    // roof now.
    await page.getByRole("button", { name: /2 · Energy/ }).click();
    const usage = page.getByLabel("Annual usage (kWh)");
    await expect(usage).toBeVisible({ timeout: 15000 });
    await usage.fill("");
    await page.getByRole("button", { name: /Save energy/ }).click();
    await expect(page.getByText(/Energy saved/)).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: /5 · Review & send/ }).click();
    await page.getByRole("button", { name: /Check it is ready/ }).click();
    await expect(page.getByText(/Blocked/)).toBeVisible({ timeout: 15000 });
    // The blocking issue itself, not step 1's "Annual usage (kWh)" label — that
    // is still in the DOM (steps are hidden, not unmounted) and would match a
    // loose /annual usage/i while sitting invisible on another step.
    await expect(page.getByText(/Offset cannot be calculated without it/i)).toBeVisible();

    // Restore it so later specs see a complete deal.
    await page.getByRole("button", { name: /2 · Energy/ }).click();
    await usage.fill("14000");
    await page.getByRole("button", { name: /Save energy/ }).click();
    await expect(page.getByText(/Energy saved/)).toBeVisible({ timeout: 15000 });
  });
});

test("a user granted one workspace gets no switcher", async ({ page }) => {
  // Installer is seeded roofing-only. True whether the flag is on or off: with
  // the flag off nobody has a second workspace at all.
  await login(page, "installer@anexahomes.com");
  await page.goto("/portal/dashboard");
  await expect(page.getByText(/· Roofing workspace/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Switch workspace" })).toHaveCount(0);
});
