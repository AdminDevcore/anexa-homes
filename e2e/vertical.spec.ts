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

    // Solar is its own workspace — not one roofing deal leaks in.
    await page.goto("/portal/leads");
    await expect(page.getByText("No appointments found")).toBeVisible({ timeout: 15000 });

    // …and it has its own pipeline, not roofing's.
    await page.goto("/portal/pipeline");
    await expect(page.getByText("Solar Pipeline")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("PTO / Activated")).toBeVisible();
    await expect(page.getByText("Adjuster Meeting Scheduled")).toHaveCount(0);

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
});

test("a user granted one workspace gets no switcher", async ({ page }) => {
  // Installer is seeded roofing-only. True whether the flag is on or off: with
  // the flag off nobody has a second workspace at all.
  await login(page, "installer@anexahomes.com");
  await page.goto("/portal/dashboard");
  await expect(page.getByText(/· Roofing workspace/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Switch workspace" })).toHaveCount(0);
});
