import { test, expect, type Page } from "@playwright/test";

/**
 * Extra work on a solar deal, itemised.
 *
 * This replaced a single box labelled "Adders $". These specs hold the two
 * things that box could not do: say what the money is FOR, and keep a per-watt
 * charge honest when the roof turns out to hold a different array than the one
 * it was typed against.
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

/**
 * Priya Raman, whose deal is seeded at exactly 10.00 kW.
 *
 * A round system size is what makes a per-watt assertion readable: $0.05/W on
 * 10,000 W is $500, and a spec that has to divide to know what it expects is a
 * spec that agrees with a bug as readily as with the code.
 */
async function openDeal(page: Page): Promise<string> {
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

/** The financing step, quoting by hand as a loan so the purchase fields show. */
async function openFinancing(page: Page, leadId: string) {
  await page.goto(`/portal/leads/${leadId}/solar-proposal?step=financing`);
  await expect(page.getByRole("heading", { name: "Financing" })).toBeVisible({ timeout: 15000 });
  const byHand = page.getByRole("button", { name: "Loan", exact: true });
  if (await byHand.isVisible().catch(() => false)) await byHand.click();
  // By ROLE: the price ladder below has an "Adders" row too, so a bare text
  // match is two elements and a strict-mode failure.
  await expect(page.getByRole("heading", { name: "Adders", exact: true })).toBeVisible({
    timeout: 15000,
  });
}

/**
 * The base price, opened for editing.
 *
 * It reads as a plain figure until a rep clicks it: a laptop gets turned around
 * in somebody's kitchen, and a price with a spinner on it announces to the
 * homeowner that the number is negotiable.
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

/**
 * Clear whatever a previous run left on the deal.
 *
 * These specs share one seeded deal and each of them SAVES, so an absolute
 * assertion — "the final rate is $3.00/W" — is only true on an empty roof.
 * Waiting on the TOTAL disappearing rather than on the buttons: each removal
 * refreshes the panel, so the button list goes stale mid-loop and a visibility
 * check on a detached node reports whatever it saw last.
 */
async function clearAdders(page: Page) {
  const total = page.getByTestId("adder-total");
  for (let i = 0; i < 20; i++) {
    if (!(await total.isVisible().catch(() => false))) break;
    await page.getByRole("button", { name: /^Remove / }).first().click();
    await page.waitForTimeout(700);
  }
  await expect(total).toHaveCount(0);
}

test.describe(FLAG_ON ? "solar adders" : "solar adders (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  /**
   * The deal Priya is seeded on carries `adderTotalCents: 385000` and no lines
   * — a typed figure from before adders were itemised, which is the state every
   * deal already in production is in. It has to keep its money until somebody
   * itemises it, and the first line has to take the total over cleanly.
   */
  test("a deal priced before adders were itemised keeps its figure until it is", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const leadId = await openDeal(page);
    await openFinancing(page, leadId);
    await clearAdders(page);

    await (await baseprice(page)).fill("3.00");

    // No lines, and the seeded $3,850 is still in the price. Recomputing that
    // from an empty table would drop a homeowner's quote by the cost of their
    // panel upgrade, silently.
    await expect(page.getByTestId("adder-total")).toHaveCount(0);
    await expect(page.getByText(/entered before they were itemised/)).toBeVisible();
    // 10 kW at $3.00/W plus the seeded $3,850 of un-itemised adders.
    expect(dollars(await page.getByTestId("gross-ppw").innerText())).toBeCloseTo(3.39, 2);
    expect(dollars(await page.getByTestId("gross-total").innerText())).toBe(33850);
  });

  test("an adder is a named line, and it moves the gross price per watt", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const leadId = await openDeal(page);
    await openFinancing(page, leadId);
    await clearAdders(page);

    // A round rate so the ladder is readable: 10 kW at $3.00/W is $30,000.
    await (await baseprice(page)).fill("3.00");

    // Pick one off the catalogue rather than typing an amount. The label is
    // what makes the money answerable later.
    await pickAdder(page, /Main panel upgrade/);
    await expect(page.getByTestId("adder-total")).toBeVisible({ timeout: 15000 });

    // The line names itself, and the itemised total has taken over from the
    // typed one — the caveat about an un-itemised figure is gone.
    await expect(page.getByText(/entered before they were itemised/)).toHaveCount(0);
    const total = dollars(await page.getByTestId("adder-total").innerText());
    expect(total).toBe(3850);

    // And the gross rate is no longer the base rate. This is the whole point:
    // a rep quoting "$3.00 a watt" on a job carrying a panel upgrade is quoting
    // a number that is not what the job is worth.
    const final = dollars(await page.getByTestId("gross-ppw").innerText());
    expect(final).toBeGreaterThan(3);
    // Printed to the nearest cent per watt: $33,850 over 10 kW is $3.385/W and
    // shows as $3.39. The gross total is the figure with no rounding in it.
    expect(final).toBe(Math.round(((30000 + total) / 10000) * 100) / 100);
    expect(dollars(await page.getByTestId("gross-total").innerText())).toBe(30000 + total);

    // Removing it takes the money with it, rather than falling back to the
    // typed figure the lines replaced.
    await page.getByRole("button", { name: /^Remove / }).first().click();
    await expect(page.getByTestId("adder-total")).toHaveCount(0, { timeout: 15000 });
    await expect
      .poll(async () => dollars(await page.getByTestId("gross-ppw").innerText()), { timeout: 15000 })
      .toBeCloseTo(3, 2);
  });

  test("a per-watt adder follows the array instead of going stale", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    const leadId = await openDeal(page);

    // A catalogue adder priced per watt. The seed has none, so this spec makes
    // its own — and names it per run, because the catalogue is unique on
    // identity and these specs accumulate across runs.
    const name = `ZZ Steep roof ${Date.now().toString(36)}`;
    // The catalogue is one rail with the hardware and the adders in it, and one
    // panel: an adder is created with a name, then priced on its own tab.
    await page.goto("/portal/settings/solar-equipment");
    await page.getByRole("button", { name: "New item" }).click();
    await page.getByRole("radio", { name: "Adder" }).check();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText(`${name} added`)).toBeVisible({ timeout: 15000 });

    const adder = page.getByTestId("adder-panel");
    await adder.getByRole("tab", { name: "Pricing" }).click();
    await adder.getByRole("radio", { name: "Per Watt" }).check();
    // By role: two of the pricing radios carry "price" in their own description.
    await adder.getByRole("textbox", { name: "Price" }).fill("0.05");
    await adder.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`${name} saved`)).toBeVisible({ timeout: 15000 });

    await openFinancing(page, leadId);
    await clearAdders(page);
    await pickAdder(page, new RegExp(name));

    // 10 kW at $0.05/W is $500, and the line says so.
    await expect
      .poll(async () => dollars(await page.getByTestId("adder-total").innerText()), { timeout: 15000 })
      .toBe(500);

    // The rate travels with the line, not a resolved amount — so the badge
    // saying it follows the array is part of the contract, not decoration.
    await expect(page.getByText("follows the array")).toBeVisible();
  });
});
