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

/**
 * One step in the builder's rail.
 *
 * Scoped to the rail rather than matched across the page: the step card's
 * footer carries "← System design" and "Review & send →" buttons whose names
 * are the same words, so a bare `getByRole("button", { name: "Financing" })`
 * is two elements the moment the rep is standing on the step before it.
 */
const step = (page: Page, name: string | RegExp) =>
  page.getByRole("navigation", { name: "Proposal steps" }).getByRole("button", { name });

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function toSolar(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  // Wait for the dashboard to actually RENDER as Solar before navigating on.
  // Without this the next goto() races the workspace cookie and loads the
  // roofing list, whose deals then 404 in a solar context.
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

async function openSolarDeal(page: Page) {
  await toSolar(page);
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

    // They are picked in the builder — but off the rate sheets, not from a
    // fixed list of four. The hand-quote row that used to offer Loan/Lease/PPA
    // as bare chips is gone, so a rep cannot put a deal on terms the company
    // holds no programme for. Cash is the one that is always there: it needs no
    // lender and no sheet.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });
    await step(page, "Financing").click();
    await expect(
      page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Not on a rate sheet?")).toHaveCount(0);
    for (const product of ["Loan", "Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: product, exact: true })).toHaveCount(0);
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
    await expect(step(page, "Customer")).toBeVisible({ timeout: 15000 });
    await expect(step(page, "Energy")).toBeVisible();
    await expect(step(page, "System design")).toBeVisible();
    await expect(step(page, "Financing")).toBeVisible();
    await expect(step(page, "Review & send")).toBeVisible();
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
    // The step COUNT is not pinned: the solar pipeline gains stages as the
    // business adds them, and a hard 25 here fails on a pipeline edit that has
    // nothing to do with the bar.
    await expect(bar.getByText(/Step \d+ of \d+/)).toBeVisible();
    await expect(bar.getByText(/Next:/)).toBeVisible();
    // The full list is one click away, and it is the whole pipeline.
    await page.getByTestId("deal-stage-actions").getByRole("button", { name: /Move/ }).click();
    await expect(page.getByRole("menuitem", { name: /New Lead/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Utility PTO/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // 2 · Money panel, including the PPW decomposition and both schedules.
    await expect(page.getByText("Pricing breakdown")).toBeVisible();
    // The ladder in the order the business says it: base, plus adders, is what
    // the job sells for.
    const ladder = page.getByTestId("pricing-breakdown");
    for (const label of ["Base price", "Adders", "Final price"]) {
      await expect(ladder.getByText(label, { exact: true })).toBeVisible();
    }
    // THE LENDER'S CUT IS NOT PUBLISHED HERE, and the gross it is measured
    // against is gone with it — final minus gross is the fee, so a ladder that
    // dropped only the labelled row would still have printed the number.
    await expect(ladder.getByText(/Dealer fee/)).toHaveCount(0);
    await expect(ladder.getByText(/Gross/)).toHaveCount(0);
    // Nor on the lender's own terms, the other half of the same slide.
    await expect(page.getByText(/Dealer fee/)).toHaveCount(0);
    // One commission line, not a four-slot schedule: the rep is paid in full,
    // once, and the financier's own funding is the pipeline stage.
    await expect(page.getByText("Rep commission")).toBeVisible();
    await expect(page.getByText(/Pays on M1 funding|Due .* pays on/)).toBeVisible();
    await expect(page.getByText("Financier payments")).toHaveCount(0);

    // 3 · The property hero and the lender's own terms, both on the Overview.
    await expect(page.getByRole("heading", { name: "Property" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Homeowner Information" })).toBeVisible();
    await expect(page.getByText("Financing & lender")).toBeVisible();
    await expect(page.getByText("GoodLeap").first()).toBeVisible();

    // 4 · One feed, no channels. Internal / External / Customer split the
    // stream three ways to describe one audience: everything here is staff-only,
    // because there is no customer portal for the other two to reach.
    //
    // The feed is the second slide of the System & financing switcher now, not
    // a card of its own, so it has to be asked for. Everything asserted above
    // this line lives on the first slide, which is why none of it needed a
    // click: the money IS what the deal opens on.
    const slides = page.getByTestId("deal-slides");
    await expect(slides.getByRole("tab", { name: "System & financing" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await slides.getByRole("tab", { name: "Activity" }).click();
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

  test("the summary row answers stage, size, financing and rep without scrolling", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    const cards = page.getByTestId("deal-summary-cards");
    await expect(cards).toBeVisible({ timeout: 15000 });
    // Exactly four, in this order. The count is the assertion that matters:
    // solar's header is fixed, so a fifth card is as much a regression as a
    // missing one.
    await expect(cards.locator("> div")).toHaveCount(4);
    for (const label of ["Current stage", "System size", "Financing", "Sales rep"]) {
      await expect(cards.getByText(label, { exact: true })).toBeVisible();
    }
    // The APPROVED lender, not the newer decline — the seed has both.
    await expect(cards.getByText("GoodLeap")).toBeVisible();
    // …and the PRODUCT beside it. A partner's name alone does not say whether
    // the customer is buying the system or renting it.
    await expect(cards.getByText("Loan · Approved", { exact: true })).toBeVisible();
    await expect(cards.getByText("Sunlight Financial")).toHaveCount(0);
    await expect(cards.getByText("10.00 kW")).toBeVisible();

    // The project manager is NOT a fifth card — it would appear only once a
    // job exists and push the row from four tiles to five. It reads beside the
    // job number on the Installation slide instead.
    await expect(cards.getByText("Project manager")).toHaveCount(0);
  });

  test("an undecided deal keeps all four slots and shows a placeholder in each", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    // This spec's OWN deal, brand new: no design, no lender, no rep. That is
    // the state the fixed four exists for.
    await toSolar(page);
    await page.goto("/portal/leads/new");
    await page.locator("input").first().fill("Blank");
    await page.locator("input").nth(1).fill(`Header ${Date.now()}`);
    await page.getByRole("button", { name: /Create Appointment/ }).click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

    const cards = page.getByTestId("deal-summary-cards");
    await expect(cards).toBeVisible({ timeout: 15000 });
    await expect(cards.locator("> div")).toHaveCount(4);
    // Three of the four have no answer yet, and say so rather than vanishing.
    await expect(cards.locator("> div[data-empty]")).toHaveCount(3);
    for (const hint of ["Not designed yet", "No lender selected", "Unassigned"]) {
      await expect(cards.getByText(hint, { exact: true })).toBeVisible();
    }
  });

  test("the feed is one staff-only stream, unbadged", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    // The feed shares a switcher with System & financing, so open its slide
    // first. Everything below is about what the feed CONTAINS; the slide is
    // just how you get to it.
    await page
      .getByTestId("deal-slides")
      .getByRole("tab", { name: "Activity" })
      .click();
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


  test("a coordinator can set the rep's commission, and it pays once", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);
    await expect(page.getByText("Rep commission")).toBeVisible({ timeout: 15000 });

    // ONE slot. The M1/M2 tranches and the two financier draws that used to sit
    // beside it described a payment plan this business does not run: the rep is
    // paid out in full, one time, on the lender's M1 funding.
    for (const gone of ["Commission milestones", "Financier payments", "1st payment", "2nd payment"]) {
      await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
    }

    await page.getByRole("button", { name: /Edit commission/ }).click();
    // Scope to the form: other tabs stay mounted (hidden), so a bare
    // input[type=number] selector can silently fill the wrong field.
    const form = page.getByTestId("commission-form");
    await expect(form).toBeVisible({ timeout: 15000 });
    await form.getByLabel("Amount").fill("2500");
    // The tick is the FUNDING gate, not the rep's payment: it records the
    // lender's draw landing and is what releases the deal to payroll. The rep's
    // own payment is stamped on the Commissions page, and the two used to share
    // one control labelled "Paid".
    await form.getByLabel("Funding received").check();
    await form.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText(/Commission saved/)).toBeVisible({ timeout: 15000 });

    // It round-trips: the new amount and the funding stamp survive a reload.
    await page.reload();
    await expect(page.getByText("$2,500")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Funding recorded \d/).first()).toBeVisible();

    // Put it back so the panel reads sensibly for the next walkthrough.
    await page.getByRole("button", { name: /Edit commission/ }).click();
    const form2 = page.getByTestId("commission-form");
    await form2.getByLabel("Amount").fill("3900");
    await form2.getByLabel("Funding received").uncheck();
    await form2.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText(/Commission saved/)).toBeVisible({ timeout: 15000 });
  });

  test("the lender's figures are reported on the deal, never typed on the builder", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarDeal(page);

    // The deal REPORTS what the row holds — a seeded down payment and monthly
    // still read out here, which is the whole point of storing rather than
    // deriving.
    await expect(page.getByText("Down payment", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("$5,000", { exact: true })).toBeVisible();
    await expect(page.getByText("$274/mo")).toBeVisible();

    // And nothing on the builder asks a rep to key them in. An "Approved loan
    // terms" card used to sit on the Financing step with five boxes; the three
    // that came off the rate sheet were overwritten on save whatever was typed,
    // and the two that did not — the down payment and the lender's own monthly
    // — were never once filled in. The terms are a statement on the quoted
    // programme now.
    await page.getByRole("link", { name: /Build Proposal/ }).first().click();
    await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });
    await step(page, "Financing").click();

    // Anchored on the step's own Save, not on the quoted strip: this seeded
    // deal has no programme quoted, so the strip is not rendered — and waiting
    // on something absent would pass this test for the wrong reason.
    await expect(page.getByRole("button", { name: "Save financing" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Approved loan terms")).toHaveCount(0);
    await expect(page.getByLabel("Down payment $")).toHaveCount(0);
    await expect(page.getByLabel("Monthly payment $")).toHaveCount(0);
  });

  test("the new-appointment form is a solar form on solar and a roofing one on roofing", async ({ page }) => {
    // A solar deal is priced off the system design, never off a dollar guess at
    // intake — so the field has no business on the solar form. Roofing quotes
    // one on the spot and keeps it.
    //
    // Deal type goes the same way: insurance-vs-cash is a roofing question, and
    // WHICH way a solar job is paid for (cash, loan, lease, PPA) is settled on
    // the proposal's Financing step once there is a system to price. Asking it
    // at the door left an answer on the deal contradicting the product.
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
    await expect(page.getByText("Deal type")).toHaveCount(0);

    // What solar gains instead: the two people on a door-to-door deal, and the
    // utility read off the meter while the rep is standing at it.
    await expect(page.getByText("Setter", { exact: true })).toBeVisible();
    await expect(page.getByText("Sales rep", { exact: true })).toBeVisible();
    await expect(page.getByText("Utility provider", { exact: true })).toBeVisible();

    // Stage is shown, not asked: a new appointment always enters at the front
    // of the pipeline, and the server derives that from the appointment date
    // whatever a picker said. There is no stage combobox on the create form —
    // only Source, Sales rep, Setter, Priority and the required custom field.
    await expect(page.getByText("Select stage")).toHaveCount(0);
    await expect(page.getByRole("combobox").filter({ hasText: /New Appointment/ })).toHaveCount(0);
    await expect(page.getByTestId("lead-entry-stage")).toHaveText("New Appointment");

    // Same form, roofing workspace: the fields are back, and solar's are not.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Roofing" }).click();
    await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
    await page.goto("/portal/leads/new");
    await expect(page.getByText("Estimated value (USD)")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Deal type")).toBeVisible();
    await expect(page.getByText("Assigned rep", { exact: true })).toBeVisible();
    await expect(page.getByText("Setter", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Utility provider", { exact: true })).toHaveCount(0);
  });

  test("roofing keeps every one of those concepts", async ({ page }) => {
    // The mirror assertion: this is a strip for SOLAR, not a deletion.
    await login(page, "admin@anexahomes.com");
    await page.goto("/portal/leads?q=Robert");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    // Wait for the deal itself, not just the URL: under `next dev` the route
    // compiles on first hit and <main> is empty for a second or two, so reading
    // innerText straight after the navigation reads the sidebar and nothing else.
    await expect(page.getByRole("heading", { name: "Homeowner Information" })).toBeVisible({
      timeout: 20000,
    });

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("deal type");
    // Roofing still has its claim machinery.
    expect(body.includes("claim") || body.includes("insurance")).toBe(true);
  });
});
