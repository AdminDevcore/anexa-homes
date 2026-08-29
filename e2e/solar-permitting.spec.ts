import { test, expect, type Page } from "@playwright/test";

/**
 * Permitting & AHJ, on the deal — not on the lead form.
 *
 * Every one of these facts arrives AFTER the sale, from whoever walks the job
 * through the jurisdiction and the utility. They were briefly reachable only as
 * lead custom fields, which asked the wrong person for them at the wrong moment
 * — a rep opening a new lead has no permit number and no AHJ contact.
 *
 * The round trip is the point: what ops types here is what a permit or PTO
 * document autofills from, so it has to come back from the database.
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

/** Marcus Webb — the deal the other writing specs use, for the same reason. */
async function openDesignerDeal(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
  await page.goto("/portal/leads?q=Marcus");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

/**
 * The panel hangs off the design, so the deal needs one. Saving the energy step
 * is the cheapest thing in the builder that creates it — no canvas dragging.
 */
async function ensureDesign(page: Page, leadId: string) {
  await page.goto(`/portal/leads/${leadId}/solar-proposal?step=energy`);
  await page.getByRole("radio", { name: "From their bill" }).check();
  await page.getByLabel("Average monthly bill ($)").fill("200");
  await page.getByLabel("Rate ($/kWh)").fill("0.20");
  await page.getByRole("button", { name: "Save energy" }).click();
  await expect(page.getByText(/Energy saved/)).toBeVisible({ timeout: 15000 });
}

async function openSystemInfo(page: Page, leadId: string) {
  await page.goto(`/portal/leads/${leadId}`);
  await page.getByRole("tab", { name: "System info" }).click();
  await expect(page.getByRole("heading", { name: "Permitting & AHJ" })).toBeVisible({
    timeout: 15000,
  });
}

test.describe(FLAG_ON ? "permitting on the deal" : "permitting on the deal (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("AHJ and permit details are typed on the deal and survive a reload", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await ensureDesign(page, leadId);
    await openSystemInfo(page, leadId);

    await page.getByLabel("AHJ", { exact: true }).fill("City of Plano");
    await page.getByLabel("Permit #").fill("PMT-2026-8890");
    await page.getByLabel("AHJ contact name").fill("Dana Ruiz");
    await page.getByLabel("AHJ contact phone / email").fill("(214) 555-0100");
    await page.getByLabel("Installer title").fill("Project Manager");

    await page.getByRole("button", { name: "Save permitting & interconnection" }).click();
    await expect(page.getByText(/Permitting & interconnection saved/)).toBeVisible({
      timeout: 15000,
    });

    await openSystemInfo(page, leadId);
    await expect(page.getByLabel("AHJ", { exact: true })).toHaveValue("City of Plano");
    await expect(page.getByLabel("Permit #")).toHaveValue("PMT-2026-8890");
    await expect(page.getByLabel("AHJ contact name")).toHaveValue("Dana Ruiz");
    await expect(page.getByLabel("Installer title")).toHaveValue("Project Manager");
  });

  test("the detail line appears only once 'other utility status' is ticked", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await ensureDesign(page, leadId);
    await openSystemInfo(page, leadId);

    // An empty box asks for nothing. A permit packet that carries a blank
    // "other status" line is worse than one that carries none.
    const detail = page.getByLabel("Other utility status — detail");
    await expect(detail).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Other utility status" }).check();
    await detail.fill("Awaiting meter swap");
    await page.getByRole("checkbox", { name: "Permit not required" }).check();

    await page.getByRole("button", { name: "Save permitting & interconnection" }).click();
    await expect(page.getByText(/Permitting & interconnection saved/)).toBeVisible({
      timeout: 15000,
    });

    await openSystemInfo(page, leadId);
    await expect(page.getByRole("checkbox", { name: "Permit not required" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Other utility status" })).toBeChecked();
    await expect(page.getByLabel("Other utility status — detail")).toHaveValue(
      "Awaiting meter swap"
    );
  });
});
