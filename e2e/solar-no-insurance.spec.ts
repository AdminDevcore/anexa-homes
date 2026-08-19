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
    // Gate on the stage bar, not on a section heading. Two sections were both
    // titled "Operations" (the install one is "Installation" now), and the
    // strict-mode violation that caused meant every leak assertion below
    // silently never ran. A testid cannot rot the same way.
    await expect(page.getByTestId("deal-stage-bar")).toBeVisible({ timeout: 15000 });

    // The deal is one page, so every panel is already rendered — assert on the
    // whole document and a leak anywhere on it fails this.
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

    // The sidebar labels it "Financing" and states which product this is. It no
    // longer SETS it: the product is chosen in the proposal, beside the term and
    // escalator it belongs with.
    await expect(page.getByText("Financing", { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Loan", { exact: true }).first()).toBeVisible();
    for (const product of ["Cash", "Loan", "Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: product, exact: true })).toHaveCount(0);
    }

    // All four are offered where they are picked.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });
    await page.getByRole("button", { name: "4 · Financing" }).click();
    for (const product of ["Cash", "Loan", "Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${product}`) }).first()).toBeVisible();
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

  test("the close flow is one ordered run of steps in the proposal builder", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // Nothing is behind a tab any more — the deal is a single page.
    await expect(page.getByRole("button", { name: "Proposal", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);

    // The design, its financing and generation are the proposal's INPUTS and
    // moved into the builder with it. On a deal with NO proposal yet there is
    // no Proposal card either — it duplicated the Summary's Build Proposal
    // button, and one screen must not carry two doors onto the same builder.
    // The card comes back once a proposal exists, to show its versions.
    // The heading, not any text: f9f76e7 added a "Proposal" document folder
    // whose tile label matches the same string.
    await expect(
      page.getByRole("heading", { name: "Proposal", exact: true })
    ).toHaveCount(0);
    await expect(page.getByText("4 · Contracts & documents")).toBeVisible();
    await expect(page.getByLabel("Module quantity")).toHaveCount(0);

    // The whole close flow is one click away, in order.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });
    await expect(page.getByRole("button", { name: "1 · Customer" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "2 · Energy" })).toBeVisible();
    await expect(page.getByRole("button", { name: "3 · System design" })).toBeVisible();
    await expect(page.getByRole("button", { name: "4 · Financing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "5 · Generate & send" })).toBeVisible();
    await page.goBack();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

    // …and there is no pill row above it. Every pill was a second door onto a
    // control that already sits with the thing it acts on: the design fields in
    // card 1, the proposal in card 3, uploads in card 4, follow-ups in the feed.
    // "Invite homeowner" is absent for a harder reason — this product has no
    // customer-facing portal, so offering the invite promised something that
    // does not exist. Its server action is deleted, not just unlinked.
    for (const pill of ["No proposal yet", "View proposal", "Edit design", "Upload files", "Invite homeowner", "Homeowner invited"]) {
      await expect(page.getByText(pill, { exact: true })).toHaveCount(0);
    }
  });


  test("the cockpit surfaces the lifecycle, the money and the paperwork", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // 1 · Stage bar across the whole 25-stage lifecycle.
    const bar = page.getByTestId("deal-stage-bar");
    await expect(bar).toBeVisible({ timeout: 15000 });
    // Two lines: where the deal is, and what is next. Twenty-five stage labels
    // on the page were a wall; they live in the header's Move dropdown now.
    await expect(bar.getByText("Permit Submitted")).toBeVisible();
    await expect(bar.getByText(/Step \d+ of 25/)).toBeVisible();
    await expect(bar.getByText(/Next:/)).toBeVisible();
    // The full list is one click away, and it is the whole pipeline.
    await page.getByTestId("deal-stage-actions").getByRole("button", { name: /Move/ }).click();
    await expect(page.getByRole("menuitem", { name: /New Lead/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Utility PTO/ })).toBeVisible();
    await page.keyboard.press("Escape");

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

    // 4 · One feed, no channels. Internal / External / Customer split the
    // stream three ways to describe one audience: everything here is staff-only,
    // because there is no customer portal for the other two to reach.
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByPlaceholder(/Use @Name to notify/)).toBeVisible();
    // Scoped to the feed. Page-wide, "Customer" also matches the Operations
    // card's who-are-we-waiting-on picker, which is a different control that
    // should exist — the unscoped version failed on it.
    const feed = page.getByTestId("solar-activity-feed");
    for (const chip of ["Internal", "External", "Customer"]) {
      await expect(feed.getByRole("button", { name: chip, exact: true })).toHaveCount(0);
    }

    // 5 · No "coming soon" placeholders anywhere on a deal. The Project AI
    // assistant card advertised work from another programme in the space
    // working tools use.
    await expect(page.getByText("Project AI assistant")).toHaveCount(0);
    await expect(page.getByText("Coming soon")).toHaveCount(0);
    await expect(page.getByText("Satellite roof render")).toHaveCount(0);

    // 6 · Document folders sit beside the files they describe, further down the
    // same page.
    // "Internal Documents" is deliberately gone: f56373c dropped the
    // internal/external split along with the customer-visibility fiction.
    for (const folder of ["Contract", "Utility Bill", "Engineering Plan Sets", "Permits", "Interconnection"]) {
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

  test("the feed is one staff-only stream, unbadged", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    // The seeded posts are all present regardless of the channel they were
    // written under — collapsing the UI must not hide history.
    await expect(page.getByText(/Plan set submitted to the city/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/is there anything you need from me/)).toBeVisible();
    // And the composer says once what the badges used to say on every row.
    await expect(page.getByText(/Staff only — notes never leave the portal/)).toBeVisible();
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
    await page.getByTestId("deal-stage-actions").getByRole("button", { name: /Move/ }).click();
    await page.getByRole("menuitem", { name: /Permit Approved/ }).click();
    await expect(page.getByText(/Stage updated/)).toBeVisible({ timeout: 15000 });

    // Reload and confirm it actually stuck, rather than trusting the toast.
    await page.reload();
    await expect(page.getByText("Permit Approved").first()).toBeVisible({ timeout: 15000 });
  });


  test("a coordinator can set and edit payment milestones", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    await expect(page.getByText("Commission milestones")).toBeVisible({ timeout: 15000 });

    // M2 (PTO granted) is seeded unpaid with a future date — edit the amount
    // and mark it paid.
    await page.getByRole("button", { name: /Edit M2/ }).click();
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
    await page.getByRole("button", { name: /Edit M2/ }).click();
    const form2 = page.getByTestId("milestone-form");
    await form2.getByLabel("Amount").fill("900");
    await form2.getByLabel("Paid").uncheck();
    await form2.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText(/Milestone saved/)).toBeVisible({ timeout: 15000 });
  });

  test("an unset financier slot reads as not-set rather than being hidden", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    // Both slots always render, so an incomplete schedule is visible as
    // incomplete instead of silently absent. There is no third slot: the money
    // arrives on install complete and on PTO, and nothing pays before that.
    await expect(page.getByText("Financier payments")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("3rd payment")).toHaveCount(0);
    for (const label of ["1st payment", "2nd payment"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("the lender's own loan figures round-trip and are loan-only", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // Seeded values reach the read-only summary near the top of the page.
    // `exact` is load-bearing: a loose "Down payment" also matches the
    // "Down payment $" input label in the financing card further down.
    await expect(page.getByText("Down payment", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("$5,000", { exact: true })).toBeVisible();
    await expect(page.getByText("$274/mo")).toBeVisible();

    // Edit them where the sibling financing fields are edited — step 2 of the
    // builder. The deal REPORTS these figures; only the proposal sets them.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });
    await page.getByRole("button", { name: "4 · Financing" }).click();

    await expect(page.getByText("Approved loan terms")).toBeVisible();
    await page.getByLabel("Down payment $").fill("7500");
    await page.getByLabel("Monthly payment $").fill("259.40");
    await page.getByRole("button", { name: "Save financing" }).click();
    // Wait for the action to actually land. Navigating straight off the click
    // races it and re-renders the OLD row.
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });

    // …and they persist, back on the deal. This is the whole point of storing
    // rather than deriving: the number shown is the number that was entered.
    await page.goBack();
    await page.reload();
    await expect(page.getByText("$7,500", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("$259/mo")).toBeVisible();

    // Switching to Cash removes the block entirely — a cash deal is paid in
    // full, so it has neither a down payment nor a lender's monthly. Matched by
    // its blurb because the four product cards each lead with a bare label.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });
    await page.getByRole("button", { name: "4 · Financing" }).click();
    await expect(page.getByText("Approved loan terms")).toBeVisible();
    await page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }).click();
    await expect(page.getByText("Approved loan terms")).toBeHidden();
  });

  test("the new-appointment form drops Estimated value on solar, keeps it on roofing", async ({ page }) => {
    // A solar deal is priced off the system design, never off a dollar guess at
    // intake — so the field has no business on the solar form. Roofing quotes
    // one on the spot and keeps it.
    await login(page, "admin@anexahomes.com");
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Solar" }).click();
    await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
    await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });

    await page.goto("/portal/leads/new");
    // Wait on the submit button, not the "Pipeline" heading — the sidebar has a
    // Pipeline link, so that text matches before the form has rendered at all.
    await expect(page.getByRole("button", { name: /Create Appointment/ })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Estimated value (USD)")).toHaveCount(0);

    // Same form, roofing workspace: the field is back.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Roofing" }).click();
    await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
    await page.goto("/portal/leads/new");
    await expect(page.getByText("Estimated value (USD)")).toBeVisible({ timeout: 15000 });
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
