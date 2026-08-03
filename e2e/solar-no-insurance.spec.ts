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
    await expect(page.getByText("4 · Contracts & documents")).toBeVisible();
  });


  test("the cockpit surfaces the lifecycle, the money and the paperwork", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // 1 · Stage bar across the whole 25-stage lifecycle.
    const bar = page.getByTestId("deal-stage-bar");
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

    // 3 · The property hero and the lender's own terms, both on the Overview.
    await expect(page.getByRole("heading", { name: "Property" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Homeowner Information" })).toBeVisible();
    await expect(page.getByText("Financing & lender")).toBeVisible();
    await expect(page.getByText("GoodLeap").first()).toBeVisible();

    // 4 · Feed with its three channels.
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByPlaceholder(/Use @Name to notify/)).toBeVisible();

    // 5 · Quick actions.
    await expect(page.getByText("Edit design", { exact: true })).toBeVisible();
    await expect(page.getByText("Upload files", { exact: true })).toBeVisible();

    // Deferred items are labelled, not silently missing. "Satellite roof
    // render" is deliberately NOT among them any more — the real property view
    // shipped and is the hero asserted above.
    await expect(page.getByText("Satellite roof render")).toHaveCount(0);
    await expect(page.getByText("Project AI assistant")).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();

    // 6 · Document folders moved to the Proposal tab, beside the files they
    // describe, so they are hidden until that tab is opened.
    for (const folder of ["Contract", "Utility Bill", "Engineering Plan Sets"]) {
      await expect(page.getByText(folder, { exact: true })).toBeHidden();
    }
    await page.getByRole("button", { name: "Proposal", exact: true }).click();
    for (const folder of ["Contract", "Utility Bill", "Engineering Plan Sets", "Permits", "Internal Documents"]) {
      await expect(page.getByText(folder, { exact: true })).toBeVisible();
    }
  });

  test("the summary row answers stage, financier, size and rep without scrolling", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    const cards = page.getByTestId("deal-summary-cards");
    await expect(cards).toBeVisible({ timeout: 15000 });
    await expect(cards.getByText("Current stage")).toBeVisible();
    await expect(cards.getByText("Financier")).toBeVisible();
    // The APPROVED lender, not the newer decline — the seed has both.
    await expect(cards.getByText("GoodLeap")).toBeVisible();
    await expect(cards.getByText("Sunlight Financial")).toHaveCount(0);
    await expect(cards.getByText("System size")).toBeVisible();
    await expect(cards.getByText("10.00 kW")).toBeVisible();
    await expect(cards.getByText("Sales rep")).toBeVisible();

    // No project on this deal, so there is no project manager to name — the
    // card is absent rather than rendered empty.
    await expect(cards.getByText("Project manager")).toHaveCount(0);
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

    const bar = page.getByTestId("deal-stage-bar");
    await expect(bar).toBeVisible({ timeout: 15000 });
    await bar.getByText("Permit Approved", { exact: true }).click();
    await expect(page.getByText(/Stage updated/)).toBeVisible({ timeout: 15000 });

    // Reload and confirm it actually stuck, rather than trusting the toast.
    await page.reload();
    await expect(page.getByText("Permit Approved").first()).toBeVisible({ timeout: 15000 });
  });


  test("a coordinator can set and edit payment milestones", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    await expect(page.getByText("Commission milestones")).toBeVisible({ timeout: 15000 });

    // M3 is seeded unpaid with a future date — edit the amount and mark it paid.
    await page.getByRole("button", { name: /Edit M3/ }).click();
    // Scope to the form: other tabs stay mounted (hidden), so a bare
    // input[type=number] selector can silently fill the wrong field.
    const form = page.getByTestId("milestone-form");
    await expect(form).toBeVisible({ timeout: 15000 });
    await form.getByLabel("Amount").fill("2500");
    await form.getByLabel("Paid").check();
    await form.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText(/Milestone saved/)).toBeVisible({ timeout: 15000 });

    // It round-trips: the new amount and a paid stamp survive a reload.
    await page.reload();
    await expect(page.getByText("$2,500")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/paid \d/).first()).toBeVisible();

    // Put it back so the panel reads sensibly for the next walkthrough.
    await page.getByRole("button", { name: /Edit M3/ }).click();
    const form2 = page.getByTestId("milestone-form");
    await form2.getByLabel("Amount").fill("900");
    await form2.getByLabel("Paid").uncheck();
    await form2.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText(/Milestone saved/)).toBeVisible({ timeout: 15000 });
  });

  test("an unset financier slot reads as not-set rather than being hidden", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    // All three slots always render, so an incomplete schedule is visible as
    // incomplete instead of silently absent.
    await expect(page.getByText("Financier payments")).toBeVisible({ timeout: 15000 });
    for (const label of ["1st payment", "2nd payment", "3rd payment"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("the lender's own loan figures round-trip and are loan-only", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // Seeded values reach the read-only summary on the Overview. `exact` is
    // load-bearing: tab content stays mounted, so a loose "Down payment" also
    // matches the "Down payment $" input label over in the Proposal tab.
    await expect(page.getByText("Down payment", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("$5,000", { exact: true })).toBeVisible();
    await expect(page.getByText("$274/mo")).toBeVisible();

    // Edit them where the sibling financing fields are edited.
    await page.getByRole("button", { name: "Proposal", exact: true }).click();
    await expect(page.getByText("Approved loan terms")).toBeVisible();
    await page.getByLabel("Down payment $").fill("7500");
    await page.getByLabel("Monthly payment $").fill("259.40");
    await page.getByRole("button", { name: "Save financing" }).click();
    // Wait for the action to actually land. Reloading straight off the click
    // races it and re-renders the OLD row.
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });

    // …and they persist. This is the whole point of storing rather than
    // deriving: the number shown is the number that was entered.
    await page.reload();
    await expect(page.getByText("$7,500", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("$259/mo")).toBeVisible();

    // Switching to Cash removes the block entirely — a cash deal is paid in
    // full, so it has neither a down payment nor a lender's monthly.
    // Matched by its blurb: a bare "Cash" also hits the Summary sidebar's
    // product toggle, which is a different control for the same field.
    await page.getByRole("button", { name: "Proposal", exact: true }).click();
    await page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }).click();
    await expect(page.getByText("Approved loan terms")).toBeHidden();
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
