import { test, expect, type Page } from "@playwright/test";

/**
 * A Solar deal must render ZERO roofing / insurance UI.
 *
 * Phase 4's strip was incomplete and a smoke test caught it: the claim
 * worksheet, the Insurance-vs-Cash deal-type toggle and roofing appointment
 * outcomes ("Hail Damage", "Adjuster Needed") were all still reachable on a
 * solar deal. This spec is the regression net — it asserts on the *absence* of
 * every one of those concepts, so a future change that reintroduces one fails
 * here rather than in front of a customer.
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

async function openSolarDeal(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  // Wait for the dashboard to actually RENDER as Solar before navigating on.
  // Without this the next goto() races the workspace cookie and loads the
  // roofing list, whose deals then 404 in a solar context.
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
  // By name, not by position: another spec creates a second solar deal, and
  // "the first row" silently becomes the wrong deal.
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
}

test.describe("a solar deal shows no insurance or roofing concepts", () => {
  test.skip(!FLAG_ON, "multi-vertical is behind SOLAR_VERTICAL_ENABLED");

  test("no claim, adjuster, deductible, RCV/ACV or supplement anywhere on the deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible({ timeout: 15000 });

    // Walk every tab so hidden panels are exercised too, then assert on the
    // whole rendered document — a leak in any tab fails this.
    for (const tab of ["Overview", "Proposal", "Operations"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await page.waitForTimeout(150);
    }

    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const term of [
      "insurance",
      "claim",
      "adjuster",
      "deductible",
      "depreciation",
      "supplement",
      "carrier",
      "policy number",
      "rcv",
      "acv",
      "hail",
      "storm damage",
      "scope of work",
      // Part A: roofing vocabulary, not just insurance concepts.
      "back to appointments",
      "run appointment",
      "set inspection outcome",
      "inspection outcome",
      "appointment date",
    ]) {
      expect(body, `"${term}" leaked onto a solar deal`).not.toContain(term);
    }
  });

  test("deal type is the financing product, not insurance-vs-cash", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // The sidebar labels it "Financing" and offers the four products.
    await expect(page.getByText("Financing", { exact: true }).first()).toBeVisible({ timeout: 15000 });
    for (const product of ["Cash", "Loan", "Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: product, exact: true }).first()).toBeVisible();
    }
    // And the roofing toggle's wording is nowhere to be seen.
    await expect(page.getByRole("button", { name: "Insurance", exact: true })).toHaveCount(0);
  });

  test("appointment outcomes are solar outcomes, not storm-damage ones", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    const run = page.getByRole("button", { name: /Run appointment|Record outcome|Appointment/ }).first();
    if (await run.isVisible().catch(() => false)) {
      await run.click();
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain("hail damage");
      expect(body).not.toContain("adjuster needed");
      expect(body).not.toContain("retail roof");
    }
  });

  test("the Proposal tab is a single hub, not scattered tabs", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // One Proposal tab…
    await expect(page.getByRole("button", { name: "Proposal", exact: true })).toBeVisible({ timeout: 15000 });
    // …and no separate System Design / Financing / Documents tabs.
    await expect(page.getByRole("button", { name: "System Design", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Documents", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Proposal", exact: true }).click();
    // The whole close flow is here, in order.
    await expect(page.getByText("1 · System Design")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("2 · Financing")).toBeVisible();
    await expect(page.getByText("3 · Generate & send")).toBeVisible();
    await expect(page.getByText("4 · Welcome call")).toBeVisible();
    await expect(page.getByText("5 · Contracts & documents")).toBeVisible();
  });


  test("the cockpit surfaces the lifecycle, the money and the paperwork", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // 1 · Stage bar across the whole 25-stage lifecycle.
    const bar = page.getByTestId("solar-stage-bar");
    await expect(bar).toBeVisible({ timeout: 15000 });
    await expect(bar.getByText("New Lead")).toBeVisible();
    await expect(bar.getByText("Utility PTO")).toBeVisible();
    await expect(bar.getByText("System Activated / Monitoring")).toBeVisible();

    // 2 · Money panel, including the PPW decomposition and both schedules.
    await expect(page.getByText("Pricing breakdown")).toBeVisible();
    for (const label of ["Base PPW", "Adder PPW", "Dealer fees", "Final PPW"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Commission milestones")).toBeVisible();
    await expect(page.getByText("Financier payments")).toBeVisible();
    await expect(page.getByText("M1", { exact: true })).toBeVisible();
    await expect(page.getByText("1st payment", { exact: true })).toBeVisible();

    // 3 · Document folders with counts.
    for (const folder of ["Contract", "Utility Bill", "Engineering Plan Sets", "Permits", "Internal Documents"]) {
      await expect(page.getByText(folder, { exact: true })).toBeVisible();
    }

    // 4 · Feed with its three channels.
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByPlaceholder(/Use @Name to notify/)).toBeVisible();

    // 5 · Quick actions.
    await expect(page.getByText("Edit design", { exact: true })).toBeVisible();
    await expect(page.getByText("Upload files", { exact: true })).toBeVisible();

    // Deferred items are labelled, not silently missing.
    await expect(page.getByText("Satellite roof render")).toBeVisible();
    await expect(page.getByText("Project AI assistant")).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();
  });

  test("internal feed posts are marked as staff-only", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    // The seeded internal note is present and badged Internal, so nobody can
    // mistake it for something the homeowner can read.
    await expect(page.getByText(/Plan set submitted to the city/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Internal").first()).toBeVisible();
  });

  test("moving a stage from the bar actually moves the deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Solar" }).click();
    await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
    await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });

    // Create a THROWAWAY deal rather than moving the shared seeded one. The
    // suite runs against a single database, and an earlier attempt at this test
    // moved Priya out of her blocked stage and broke the follow-up spec — twice.
    // Isolation beats a restore step that can silently no-op.
    await page.goto("/portal/leads/new");
    const last = `StageMove${Date.now() % 100000}`;
    const inputs = page.locator("form input");
    await inputs.nth(0).fill("Test");
    await inputs.nth(1).fill(last);
    await page.locator('input[type="datetime-local"]').fill("2026-08-20T10:00");
    await page.getByRole("button", { name: /Create Appointment/ }).click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

    const bar = page.getByTestId("solar-stage-bar");
    await expect(bar).toBeVisible({ timeout: 15000 });
    await bar.getByText("Permit Approved", { exact: true }).click();
    await expect(page.getByText(/Stage updated/)).toBeVisible({ timeout: 15000 });

    // Reload and confirm it actually stuck, rather than trusting the toast.
    await page.reload();
    await expect(page.getByText("Permit Approved").first()).toBeVisible({ timeout: 15000 });
  });

  test("roofing keeps every one of those concepts", async ({ page }) => {
    // The mirror assertion: this is a strip for SOLAR, not a deletion.
    await login(page, "admin@anexahomes.com");
    await page.goto("/portal/leads?q=Robert");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("deal type");
    // Roofing still has its claim machinery.
    expect(body.includes("claim") || body.includes("insurance")).toBe(true);
  });
});
