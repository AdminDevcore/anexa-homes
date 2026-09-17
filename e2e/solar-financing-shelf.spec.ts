import { test, expect, type Page } from "@playwright/test";

/**
 * Shopping the rate sheets, on the screen where the terms are quoted.
 *
 * The financing step used to open on four abstract product TYPES, with the
 * lender and its programme two dropdowns behind them. A rep could look at
 * exactly one offer at a time and no screen anywhere answered "which of these
 * is cheaper" — which is also why every solar design in production reached the
 * proposal with no lender attached at all.
 *
 * These specs hold the shelf: every lender's programmes on the step, several
 * shortlisted at once, one basis under all of them, and quoting one moving the
 * deal onto that lender.
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

async function toSolar(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

/** Named per run, so specs never collide on the case-insensitive unique name. */
function lenderName(tag: string) {
  return `ZZ ${tag} ${Date.now().toString(36)}`;
}

/**
 * Add a partner, and land on its panel.
 *
 * The screen is a list and a panel now: adding a lender opens it, so every step
 * after this one is scoped to `panel(page)` rather than to a card filtered by
 * name out of a grid.
 */
async function addLender(page: Page, name: string) {
  await page.goto("/portal/settings/solar-lenders");
  await expect(page.getByRole("heading", { name: "Lenders", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "New lender" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add lender" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
}

/**
 * The open partner's panel.
 *
 * Only one is mounted, so this is unambiguous — which is the point of the
 * rebuild. Specs accumulate lenders across runs, and the old grid needed a name
 * filter over every card to keep an assertion off whichever partner happened to
 * sort first.
 */
function panel(page: Page) {
  return page.getByTestId("lender-panel");
}

/** Move the panel to one of its tabs. */
async function tab(page: Page, name: string) {
  await panel(page).getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

/** Add one loan programme to a lender's rate sheet. */
async function addLoan(page: Page, name: string, apr: string, months: string, fee: string) {
  // The panel is the partner, so assert whose it is before typing terms into it.
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15000 });
  await tab(page, "Rate sheet");
  await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
  await page.getByLabel("APR %", { exact: true }).fill(apr);
  await page.getByLabel("Term (months)", { exact: true }).fill(months);
  await page.getByLabel("Dealer fee %", { exact: true }).fill(fee);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });
}

/**
 * Set what the company keeps per watt.
 *
 * Load-bearing for the comparison: with a net target each programme's sticker
 * is derived from its OWN dealer fee, which is what makes a dearer lender show
 * up as a dearer system. Without one every column is quoted at the same typed
 * price — correct, and useless to compare.
 */
async function setNetTarget(page: Page, dollars: string) {
  await page.goto("/portal/settings/solar");
  // Solar settings are tabbed now, and the screen has one Save.
  await page.getByRole("tab", { name: "Pricing" }).click();
  // By ROLE, not getByLabel: the "why" popover beside the label is a button
  // whose own accessible name contains the same words.
  const box = page.getByRole("textbox", { name: "Target net $/W" });
  await expect(box).toBeVisible({ timeout: 15000 });
  await box.fill(dollars);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 15000 });
}

/**
 * One figure of the comparison, by which offer it belongs to and which line it
 * is.
 *
 * Addressed by COLUMN rather than by position: the shortlist opens holding
 * whatever the deal already quotes, so a seeded deal contributes a column these
 * specs never asked for and `nth(0)` silently reads the wrong programme.
 *
 * The comparison is a card per offer now rather than a table, so a column is
 * found by reading each card's own text instead of a shared header row.
 */
async function compareCell(page: Page, rowKey: string, column: RegExp) {
  const cols = page.getByTestId("compare-col");
  await expect(cols.first()).toBeVisible({ timeout: 15000 });
  const texts = await cols.allInnerTexts();
  const idx = texts.findIndex((t) => column.test(t));
  expect(idx, `no compare column matching ${column} in ${JSON.stringify(texts)}`).toBeGreaterThanOrEqual(0);
  return cols.nth(idx).getByTestId(`compare-${rowKey}`).innerText();
}

/**
 * One programme on the shelf, scoped to the lender that publishes it.
 *
 * The shelf used to be a landmark per partner. It is one wrapped grid now — so
 * that a rep sees cash and every lender's programmes at once instead of three
 * sideways scrollers — and the card carries its own lender in its accessible
 * name, which is what keeps "25 yr · 3.99% · fee 28%" from matching two
 * partners who happen to publish the same terms.
 */
function offerCard(page: Page, lender: string, terms: RegExp) {
  return page.getByRole("button", {
    name: new RegExp(`^${lender.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · .*${terms.source}`),
  });
}

/**
 * The base price, opened for editing.
 *
 * It reads as a plain figure until a rep clicks it — a laptop gets turned
 * around in somebody's kitchen, and a price with a spinner on it announces to
 * the homeowner that the number is negotiable.
 */
async function baseprice(page: Page) {
  const box = page.getByLabel("Base $/W", { exact: true });
  if (!(await box.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /^Edit the base price per watt/ }).click();
    await expect(box).toBeVisible({ timeout: 15000 });
  }
  return box;
}

/**
 * Put one catalogue adder on the deal through the picker.
 *
 * Every adder used to be a chip laid out in the panel, which a spec could click
 * directly. They live behind one button now — a catalogue of forty chips is a
 * paragraph of pills sitting between a rep and the price of the system.
 */
async function pickAdder(page: Page, label: RegExp) {
  await page.getByRole("button", { name: /Choose adders/ }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible({ timeout: 15000 });
  await picker.getByRole("checkbox", { name: label }).click();
  await picker.getByRole("button", { name: /^Add to the quote/ }).click();
  await expect(picker).toBeHidden({ timeout: 15000 });
}

const dollars = (text: string) => Number(text.replace(/[^0-9.]/g, ""));

/** Open a solar deal and return its id. */
async function openSolarDeal(page: Page) {
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

test.describe(FLAG_ON ? "solar financing shelf" : "solar financing shelf (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("two programmes compare side by side, and the dearer fee costs more", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    await setNetTarget(page, "2.80");
    const name = lenderName("Shelf");
    await addLender(page, name);
    await addLoan(page, name, "4.99", "300", "18");
    await addLoan(page, name, "3.99", "240", "34");

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    // Both are on the shelf without opening anything — that is the point.
    // Scoped per lender: specs accumulate partners across runs, and two of
    // them can publish programmes whose terms read exactly the same.
    const cheapFee = offerCard(page, name, /25 yr · 4\.99% · fee 18%/);
    const dearFee = offerCard(page, name, /20 yr · 3\.99% · fee 34%/);
    await expect(cheapFee).toBeVisible({ timeout: 15000 });
    await expect(dearFee).toBeVisible();

    await cheapFee.click();
    await dearFee.click();
    await expect(page.getByTestId("compare-sticker").first()).toBeVisible({ timeout: 15000 });

    // Same system, same adders, so the only thing moving the sticker is the
    // lender's cut. A comparison that did not show that would be decoration.
    const cheap = dollars(await compareCell(page, "sticker", /4\.99% · fee 18%/));
    const dear = dollars(await compareCell(page, "sticker", /3\.99% · fee 34%/));
    expect(dear).toBeGreaterThan(cheap);
  });

  test("quoting a card moves the deal onto that lender", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Quote");
    await addLender(page, name);
    await addLoan(page, name, "6.49", "180", "22");

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    await offerCard(page, name, /15 yr · 6\.49% · fee 22%/).click();
    await page.getByRole("button", { name: `Quote this: ${name} 15 yr · 6.49% · fee 22%` }).click();
    await expect(page.getByText(`Quoting ${name}`)).toBeVisible({ timeout: 15000 });

    // The terms the server is about to write are on screen BEFORE the save, so
    // what gets quoted can never disagree with the card above it.
    //
    // They are STATED, not editable. This used to type into an APR / term /
    // dealer-fee form, which 4e94a8d ("Nobody was ever going to type in that
    // approval") deleted along with the rest of the "Approved loan terms" card
    // on 2026-08-26 — across every solar deal on the system not one of those
    // boxes had ever been filled in. The terms belong to the lender's rate sheet,
    // and a rep retyping them is exactly the hand-quoting escape that the
    // "there is no hand-quoting escape" test below exists to forbid. Asserting
    // the boxes were the older, weaker check — it proved the values were
    // present, not that they were the sheet's.
    await expect(page.getByText(/6\.49% APR · 180 months · 22% dealer fee/)).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "Save financing" }).click();
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });

    // A reload still shows which card is quoted.
    //
    // The deal's System info slide used to carry a second control for the same
    // field and this checked the two agreed. That picker is gone on purpose —
    // 297a4c6 made the slide REPORT the frozen proposal rather than offer to
    // edit it, because one field with two owners is how a deal ends up
    // disagreeing with the document the homeowner signed. What is left to prove
    // here is that the choice persisted, which the badge below says.
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await expect(offerCard(page, name, /15 yr · 6\.49% · fee 22%.*Quoted/)).toBeVisible({
      timeout: 15000,
    });
  });

  /**
   * A tick is what the customer's proposal offers, so it has to outlive the
   * screen. It used to be browser state only, while generation put cash and
   * every lender on the menu anyway — "Pay in full" and Amos on a PPA proposal
   * whose rep had ticked neither.
   */
  test("a ticked card is saved on the deal, because the proposal offers it", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Tick");
    await addLender(page, name);
    await addLoan(page, name, "5.49", "240", "20");
    await addLoan(page, name, "4.49", "300", "26");

    const leadId = await openSolarDeal(page);
    const financing = `/portal/leads/${leadId}/solar-proposal?step=financing`;
    await page.goto(financing);

    // Quote and save first, so the deal has a finance row for the tick to land on.
    await offerCard(page, name, /20 yr · 5\.49% · fee 20%/).click();
    await page.getByRole("button", { name: `Quote this: ${name} 20 yr · 5.49% · fee 20%` }).click();
    await expect(page.getByText(`Quoting ${name}`)).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Save financing" }).click();
    await expect(page.getByText("Financing saved")).toBeVisible({ timeout: 15000 });

    /** Click a card and wait for the server action that saves the tick. */
    const toggle = async (terms: RegExp) => {
      const saved = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.request().headers()["next-action"] != null
      );
      await offerCard(page, name, terms).click();
      await saved;
    };

    const other = /25 yr · 4\.49% · fee 26%/;
    await toggle(other);
    await page.goto(financing);
    await expect(offerCard(page, name, other)).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });

    // And unticking is saved too — it is how a rep takes an option off the menu.
    await toggle(other);
    await page.goto(financing);
    await expect(offerCard(page, name, other)).toHaveAttribute("aria-pressed", "false", { timeout: 15000 });
  });

  test("cash is a column of the comparison, not a mode hidden behind it", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    await setNetTarget(page, "2.80");
    const name = lenderName("Cash");
    await addLender(page, name);
    await addLoan(page, name, "0", "240", "38");

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    await page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }).click();
    await offerCard(page, name, /20 yr · 0% · fee 38%/).click();
    await expect(page.getByTestId("compare-contract-price").first()).toBeVisible({ timeout: 15000 });

    // The single most useful number on the screen: what the fee costs the
    // customer. Cash carries none, so its contract price has to be the lower.
    const paidCash = dollars(await compareCell(page, "contract-price", /^No lender/));
    const financed = dollars(await compareCell(page, "contract-price", /0% · fee 38%/));
    expect(paidCash).toBeLessThan(financed);
  });

  /**
   * The defect this exists for: the dealer fee used to be charged on the system
   * alone, and the adders were bolted onto the contract afterwards at face
   * value. A lender keeps its percentage of everything it advances — the panel
   * upgrade included — so that arrangement gave the fee on every adder away out
   * of company margin, silently, on every job carrying extra work.
   *
   * Read off the comparison rather than a single card, because the two columns
   * price the SAME base and the SAME adders and differ only by the fee. That
   * makes the assertion a ratio, which no amount of rounding can fake.
   */
  test("the dealer fee is charged on the adders too, not just the system", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    await setNetTarget(page, "3.00");
    const name = lenderName("Adderfee");
    await addLender(page, name);
    await addLoan(page, name, "0", "240", "25");

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await expect(page.getByRole("heading", { name: "Adders", exact: true })).toBeVisible({
      timeout: 15000,
    });

    // These specs share one seeded deal and each of them saves, so the adders
    // have to be taken back to a known state before one is added.
    const adderTotal = page.getByTestId("adder-total");
    for (let i = 0; i < 20; i++) {
      if (!(await adderTotal.isVisible().catch(() => false))) break;
      await page.getByRole("button", { name: /^Remove / }).first().click();
      await page.waitForTimeout(700);
    }
    await expect(adderTotal).toHaveCount(0);

    // $3.00/W on Priya's seeded 10 kW, plus $3,850 of extra work: $33,850 is
    // what Anexa keeps whichever way the customer pays for it.
    await (await baseprice(page)).fill("3.00");
    await pickAdder(page, /Main panel upgrade/);
    await expect
      .poll(async () => dollars(await page.getByTestId("gross-total").innerText()), { timeout: 15000 })
      .toBe(33850);

    await page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }).click();
    await offerCard(page, name, /20 yr · 0% · fee 25%/).click();
    await expect(page.getByTestId("compare-contract-price").first()).toBeVisible({ timeout: 15000 });

    const paidCash = dollars(await compareCell(page, "contract-price", /^No lender/));
    const financed = dollars(await compareCell(page, "contract-price", /0% · fee 25%/));

    // Cash carries no fee, so it pays the gross exactly.
    expect(paidCash).toBe(33850);
    // And the financed column grosses the WHOLE job up by 25% — $45,133, not
    // the $43,850 you get by feeing the array and leaving the upgrade alone.
    // The tolerance is the sticker rate rounding to a whole cent per watt.
    expect(Math.abs(financed - 33850 / 0.75)).toBeLessThan(100);
  });

  test("a lease is never badged the winner against a purchase", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Mixed");
    await addLender(page, name);
    await addLoan(page, name, "4.49", "300", "20");
    await tab(page, "Rate sheet");
    await panel(page).getByRole("button", { name: "Lease", exact: true }).click();
    await page.getByLabel("$/kW per month", { exact: true }).fill("12.40");
    await page.getByLabel("Escalator %/yr", { exact: true }).fill("2.9");
    await page.getByLabel("Term (years)", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    await offerCard(page, name, /25 yr · 4\.49% · fee 20%/).click();
    await offerCard(page, name, /25 yr · esc 2\.9% · \$12\.40\/kW-mo/).click();
    await expect(page.getByTestId("compare-total-paid").first()).toBeVisible({ timeout: 15000 });

    // At the end of one the customer owns an array and at the end of the other
    // they own nothing, so the smaller total is not the better deal and is not
    // labelled as one.
    await expect(page.getByText("Lowest total")).toHaveCount(0);
    await expect(page.getByText(/buys electricity, not the array/)).toBeVisible();
  });

  test("a quoted lease carries the rate sheet's terms, with no boxes to retype them in", async ({ page }) => {
    // The step used to end in four loose inputs — a lease's monthly, its
    // escalator, its term and a PPA's $/kWh — that a rep could type anything
    // into. Every one of them is published by the lender and arrives with the
    // programme, so the boxes could only ever disagree with the sheet the
    // customer is actually signed onto.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const name = lenderName("Lease terms");
    await addLender(page, name);
    await tab(page, "Rate sheet");
    await panel(page).getByRole("button", { name: "Lease", exact: true }).click();
    await page.getByLabel("$/kW per month", { exact: true }).fill("11.80");
    await page.getByLabel("Escalator %/yr", { exact: true }).fill("1.9");
    await page.getByLabel("Term (years)", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    await offerCard(page, name, /25 yr · esc 1\.9% · \$11\.80\/kW-mo/).click();
    await page.getByRole("button", { name: new RegExp(`Quote this: ${name}`) }).click();
    await expect(page.getByText(/Quoting .*Save to keep it/)).toBeVisible({ timeout: 15000 });

    // The deal is on a lease now, and there is still nowhere on the step to
    // retype what the lease costs.
    await expect(page.getByLabel("Escalator %/yr")).toHaveCount(0);
    await expect(page.getByLabel("Term (years)")).toHaveCount(0);
    await expect(page.getByLabel("Monthly $", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("$/kWh", { exact: true })).toHaveCount(0);
  });

  test("there is no hand-quoting escape — the rate sheets are the only way in", async ({ page }) => {
    // This used to be the opposite test: a "Not on a rate sheet? Quote by hand"
    // row let a rep type a loan, lease or PPA the company had no terms for.
    // It was removed deliberately. A quote now has to come off a programme
    // somebody entered, so what the customer signs is always terms the company
    // actually holds.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
    await expect(page.getByRole("button", { name: "Save financing" })).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("Not on a rate sheet?")).toHaveCount(0);
    for (const p of ["Loan", "Lease", "PPA"]) {
      await expect(page.getByRole("button", { name: p, exact: true })).toHaveCount(0);
    }
  });

  test("cash is quotable with no rate sheets loaded at all", async ({ page }) => {
    // Removing the hand-quote row made the empty state load-bearing: it used to
    // REPLACE the comparison, so a company with no programmes saw a banner and
    // nothing else — and with no chips left either, the step would have offered
    // no way to quote anything. Cash needs no lender, so its column stays.
    await login(page, "owner@anexahomes.com");
    await toSolar(page);

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    await expect(
      page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }),
    ).toBeVisible({ timeout: 15000 });
  });
});
