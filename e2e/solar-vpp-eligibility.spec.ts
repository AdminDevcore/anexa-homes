import { test, expect, type Page } from "@playwright/test";

/**
 * A VPP is not offered to everyone who buys a battery.
 *
 * The programme's money — "$500 a year for the battery" — was recorded with
 * nothing beside it about who could actually claim it, so a rep read the figure
 * off the screen and promised it to a homeowner on a lease with the wrong
 * hardware. The conditions now sit with the money, and the deal is judged
 * against them where the rep reads it.
 *
 * NOTHING HERE BLOCKS ANYTHING. That is the point of the last assertion: an
 * ineligible deal still quotes, still generates, and never mentions any of this
 * on the customer's document.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const PASSWORD = "Passw0rd!";
const PROVIDER = "VPP Test Utility";

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

/** The provider's row in the rail, addressed by name. */
const providerRow = (page: Page) =>
  page.getByRole("navigation", { name: "Energy providers" }).getByRole("button", { name: PROVIDER });

/** The open provider's panel — one is mounted at a time. */
const panel = (page: Page) => page.getByTestId("provider-panel");

test.describe(FLAG_ON ? "who a VPP programme is open to" : "who a VPP programme is open to (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("records the conditions with the money, and reads them back on a deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await toSolar(page);

    // ── The office records what the programme actually runs on ──────────────
    await page.goto("/portal/settings/solar-providers");
    await page.getByRole("button", { name: "New provider" }).click();
    await page.getByLabel("Name", { exact: true }).fill(PROVIDER);
    await page.getByRole("button", { name: "Add provider" }).click();
    await expect(providerRow(page)).toBeVisible({ timeout: 15000 });

    // Before anybody fills it in, a provider says nothing is recorded rather
    // than rendering blank — a blank line on this screen reads as "they do not".
    await expect(providerRow(page)).toContainText("nothing recorded");

    // ── The programme, on the panel's own tab ───────────────────────────────
    await providerRow(page).click();
    await panel(page).getByRole("tab", { name: "Battery programme" }).click();
    await panel(page).getByRole("radio", { name: "Yes" }).check();
    // By role: the tab panel itself is labelled "Battery programme".
    await panel(page).getByRole("textbox", { name: "Programme" }).fill("Renew Home");

    // Each list is EMPTY BY DEFAULT AND MEANS ANY, and says so in its own words.
    await expect(panel(page).getByText("Ways of paying that qualify")).toContainText("Any");

    await panel(page).getByRole("button", { name: "Loan", exact: true }).click();
    await panel(page).getByRole("button", { name: /Tesla Powerwall 3/ }).click();
    await panel(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`${PROVIDER} saved`)).toBeVisible({ timeout: 15000 });

    // ── The rail row now carries the conditions ─────────────────────────────
    await expect(providerRow(page)).toContainText("VPP · Renew Home", { timeout: 15000 });

    // Reopened, the ticks are where they were left, not a blank form.
    await page.reload();
    await providerRow(page).click();
    await panel(page).getByRole("tab", { name: "Battery programme" }).click();
    await expect(panel(page).getByText("Ways of paying that qualify")).not.toContainText("Any");
    await expect(panel(page).getByRole("button", { name: /Tesla Powerwall 3/ })).toContainText(
      "Tesla Powerwall 3"
    );

    // ── The rep reads it back the moment they pick the provider ─────────────
    await page.goto("/portal/leads?q=Marcus");
    await page.locator('table a[href^="/portal/leads/"]').first().click();
    await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
    const leadId = page.url().split("/").pop()!;

    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=energy`);
    await page.selectOption("#utility-provider", PROVIDER);

    const note = page.locator("div").filter({ hasText: /^VPP · Renew Home/ }).last();
    await expect(note).toContainText("Needs Loan");
    await expect(note).toContainText("Tesla Powerwall 3");

    // A design with no battery on it has not FAILED the battery test — nobody
    // has taken it. Telling a rep their customer does not qualify for a
    // programme they have not designed for yet is how the line stops being read.
    await expect(note).toContainText("Can't tell yet");

    // Keep the provider on the design, so the verdict below is read from what
    // was saved rather than from a selection still sitting in the browser.
    await page.getByRole("button", { name: "Save energy" }).click();
    await expect(page.getByText("Energy saved")).toBeVisible({ timeout: 15000 });

    // ── Put the wrong battery on the design ────────────────────────────────
    // The whole reason the lists exist: the rep picks hardware the programme
    // does not enrol, and the money they were about to quote is not theirs.
    await page.goto(`/portal/leads/${leadId}/solar-proposal/design`);
    await page.selectOption("#equip-battery", { label: "Enphase IQ Battery 5P · 5000 W" });
    // The picker disables itself while the pick is in flight and re-enables on
    // the refreshed props. Waiting for that, rather than for a fixed delay,
    // keeps the next navigation from racing the save it depends on.
    await expect(page.locator("#equip-battery")).toBeEnabled({ timeout: 15000 });
    await expect(page.locator("#equip-battery option:checked")).toContainText("IQ Battery 5P");

    await page.goto(`/portal/leads/${leadId}/solar-proposal?step=energy`);
    const after = page.locator("div").filter({ hasText: /^VPP · Renew Home/ }).last();
    await expect(after).toContainText("Not eligible", { timeout: 15000 });
    // It NAMES the battery. "This battery does not qualify" tells a rep nothing
    // they can act on; the model number on the design tells them what to change.
    await expect(after).toContainText("IQ Battery 5P");

    // And none of it stops anything: the step still saves.
    await expect(page.getByRole("button", { name: "Save energy" })).toBeEnabled();
  });
});
