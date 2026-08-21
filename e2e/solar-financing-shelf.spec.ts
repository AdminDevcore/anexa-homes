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

async function addLender(page: Page, name: string) {
  await page.goto("/portal/settings/solar-lenders");
  await expect(page.getByRole("heading", { name: "Lenders", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15000 });
}

/**
 * One lender's card. Scoped, never `.first()`: specs accumulate lenders across
 * runs, so a page-wide match reaches whichever partner sorts first — which is
 * how a product lands on the wrong lender and the spec still passes.
 */
function cardFor(page: Page, name: string) {
  return page.locator("div.rounded-xl.bg-card").filter({ hasText: name });
}

/** Add one loan programme to a lender's rate sheet. */
async function addLoan(page: Page, name: string, apr: string, months: string, fee: string) {
  await cardFor(page, name).last().getByRole("button", { name: "Loan", exact: true }).click();
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
  await expect(page.getByLabel("Target net $/W")).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Target net $/W").fill(dollars);
  await page.getByRole("button", { name: "Save solar settings" }).click();
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 15000 });
}

/**
 * One cell of the comparison, by row and by which column it belongs to.
 *
 * Addressed by COLUMN rather than by position: the shortlist opens holding
 * whatever the deal already quotes, so a seeded deal contributes a column these
 * specs never asked for and `nth(0)` silently reads the wrong programme.
 */
async function compareCell(page: Page, rowKey: string, column: RegExp) {
  const headers = await page.locator("table thead th").allInnerTexts();
  const idx = headers.findIndex((h) => column.test(h));
  expect(idx, `no column matching ${column} in ${JSON.stringify(headers)}`).toBeGreaterThan(0);
  // The header row leads with a blank corner; the body rows lead with a
  // rowheader, so the first <td> lines up with the SECOND <th>.
  return page.getByTestId(`compare-${rowKey}`).locator("td").nth(idx - 1).innerText();
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
    const shelf = page.getByRole("region", { name });
    const cheapFee = shelf.getByRole("button", { name: /25 yr · 4\.99% · fee 18%/ });
    const dearFee = shelf.getByRole("button", { name: /20 yr · 3\.99% · fee 34%/ });
    await expect(cheapFee).toBeVisible({ timeout: 15000 });
    await expect(dearFee).toBeVisible();

    await cheapFee.click();
    await dearFee.click();
    await expect(page.getByTestId("compare-sticker")).toBeVisible({ timeout: 15000 });

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

    await page.getByRole("region", { name }).getByRole("button", { name: /15 yr · 6\.49% · fee 22%/ }).click();
    await page.getByRole("button", { name: `Quote this: ${name} 15 yr · 6.49% · fee 22%` }).click();
    await expect(page.getByText(`Quoting ${name}`)).toBeVisible({ timeout: 15000 });

    // The terms the server is about to write are on screen BEFORE the save, so
    // the boxes never disagree with the card above them.
    await expect(page.getByLabel("APR %", { exact: true })).toHaveValue("6.49");
    await expect(page.getByLabel("Term (months)", { exact: true })).toHaveValue("180");
    await expect(page.getByLabel("Dealer fee %", { exact: true })).toHaveValue("22");

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
    await expect(
      page.getByRole("region", { name }).getByRole("button", { name: /Quoted.*15 yr · 6\.49% · fee 22%/ })
    ).toBeVisible({ timeout: 15000 });
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
    await page.getByRole("region", { name }).getByRole("button", { name: /20 yr · 0% · fee 38%/ }).click();
    await expect(page.getByTestId("compare-contract-price")).toBeVisible({ timeout: 15000 });

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
    await page.getByLabel("Base $/W").fill("3.00");
    await page.getByRole("button", { name: /Main panel upgrade/ }).click();
    await expect
      .poll(async () => dollars(await page.getByTestId("gross-total").innerText()), { timeout: 15000 })
      .toBe(33850);

    await page.getByRole("button", { name: /Cash.*No lender, so no dealer fee/ }).click();
    await page.getByRole("region", { name }).getByRole("button", { name: /20 yr · 0% · fee 25%/ }).click();
    await expect(page.getByTestId("compare-contract-price")).toBeVisible({ timeout: 15000 });

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
    await cardFor(page, name).last().getByRole("button", { name: "Lease", exact: true }).click();
    await page.getByLabel("$/kW per month", { exact: true }).fill("12.40");
    await page.getByLabel("Escalator %/yr", { exact: true }).fill("2.9");
    await page.getByLabel("Term (years)", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    const shelf = page.getByRole("region", { name });
    await shelf.getByRole("button", { name: /25 yr · 4\.49% · fee 20%/ }).click();
    await shelf.getByRole("button", { name: /25 yr · esc 2\.9% · \$12\.40\/kW-mo/ }).click();
    await expect(page.getByTestId("compare-total-paid")).toBeVisible({ timeout: 15000 });

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
    await cardFor(page, name).last().getByRole("button", { name: "Lease", exact: true }).click();
    await page.getByLabel("$/kW per month", { exact: true }).fill("11.80");
    await page.getByLabel("Escalator %/yr", { exact: true }).fill("1.9");
    await page.getByLabel("Term (years)", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Product added")).toBeVisible({ timeout: 15000 });

    const leadId = await openSolarDeal(page);
    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);

    const shelf = page.getByRole("region", { name });
    await shelf.getByRole("button", { name: /25 yr · esc 1\.9% · \$11\.80\/kW-mo/ }).click();
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
