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

/**
 * Operations, then one of its tabs. These forms were a "System info" slide of
 * their own; they are now steps inside Operations, one tab each.
 */
async function openOperations(
  page: Page,
  leadId: string,
  tab: "Permitting" | "Interconnection" | "Project fields"
) {
  await page.goto(`/portal/leads/${leadId}`);
  await page.getByRole("tab", { name: "Operations" }).click();
  await page.getByRole("tab", { name: tab }).click();
  const heading = tab === "Permitting" ? "Permitting & AHJ" : tab;
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({
    timeout: 15000,
  });
}

test.describe(FLAG_ON ? "permitting on the deal" : "permitting on the deal (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("AHJ and permit details are typed on the deal and survive a reload", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await ensureDesign(page, leadId);
    await openOperations(page, leadId, "Permitting");
    // The slide it replaced is gone, not merely renamed beside it.
    await expect(page.getByRole("tab", { name: "System info" })).toHaveCount(0);

    await page.getByLabel("AHJ", { exact: true }).fill("City of Plano");
    await page.getByLabel("Permit #").fill("PMT-2026-8890");
    await page.getByLabel("AHJ contact name").fill("Dana Ruiz");
    await page.getByLabel("AHJ contact phone / email").fill("(214) 555-0100");
    await page.getByLabel("Installer title").fill("Project Manager");

    await page.getByRole("button", { name: "Save permitting" }).click();
    await expect(page.getByText(/Permitting saved/)).toBeVisible({ timeout: 15000 });

    await openOperations(page, leadId, "Permitting");
    await expect(page.getByLabel("AHJ", { exact: true })).toHaveValue("City of Plano");
    await expect(page.getByLabel("Permit #")).toHaveValue("PMT-2026-8890");
    await expect(page.getByLabel("AHJ contact name")).toHaveValue("Dana Ruiz");
    await expect(page.getByLabel("Installer title")).toHaveValue("Project Manager");
  });

  test("the detail line appears only once 'other utility status' is ticked", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const leadId = await openDesignerDeal(page);
    await ensureDesign(page, leadId);
    await openOperations(page, leadId, "Interconnection");

    // An empty box asks for nothing. A permit packet that carries a blank
    // "other status" line is worse than one that carries none.
    const detail = page.getByLabel("Other utility status — detail");
    await expect(detail).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Other utility status" }).check();
    await detail.fill("Awaiting meter swap");
    await page.getByLabel("Meter #").fill("MTR-55120");
    await page.getByRole("button", { name: "Save interconnection" }).click();
    await expect(page.getByText(/Interconnection saved/)).toBeVisible({ timeout: 15000 });

    // The two tabs write the same row. Saving the second must not undo the first.
    await page.getByRole("tab", { name: "Permitting" }).click();
    await page.getByRole("checkbox", { name: "Permit not required" }).check();
    await page.getByRole("button", { name: "Save permitting" }).click();
    await expect(page.getByText(/Permitting saved/)).toBeVisible({ timeout: 15000 });

    await openOperations(page, leadId, "Permitting");
    await expect(page.getByRole("checkbox", { name: "Permit not required" })).toBeChecked();
    await page.getByRole("tab", { name: "Interconnection" }).click();
    await expect(page.getByRole("checkbox", { name: "Other utility status" })).toBeChecked();
    await expect(page.getByLabel("Other utility status — detail")).toHaveValue(
      "Awaiting meter swap"
    );
    await expect(page.getByLabel("Meter #")).toHaveValue("MTR-55120");
  });
});

test.describe(
  FLAG_ON ? "the company's own project fields" : "the company's own project fields (flag off — skipped)",
  () => {
    test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

    /**
     * Settings has offered "Project Fields" since custom fields existed, and
     * nothing in the app ever rendered one — so a company could define a field,
     * map it into a document template, and never be able to fill it. This is
     * that round trip: define it in Settings, fill it on the deal, read it back.
     */
    test("a project field defined in settings is filled on the deal", async ({ page }) => {
      await login(page, "admin@anexahomes.com");
      await page.getByRole("button", { name: "Switch workspace" }).click();
      await page.getByRole("menuitem", { name: "Solar" }).click();
      await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });

      // Unique per run: the key is a slug of the label, and a second field with
      // the same slug is refused.
      const label = `Permit Packet Notes ${Date.now()}`;

      await page.goto("/portal/settings/fields");
      await page.getByRole("button", { name: "New field" }).click();
      await expect(page.getByRole("heading", { name: "Add a custom field" })).toBeVisible();
      await page.getByRole("radio", { name: "Projects" }).check();
      await page.getByPlaceholder("e.g. Gate Code").fill(label);
      await page.getByRole("button", { name: "Add field" }).click();
      await expect(page.getByText(`${label} added`)).toBeVisible({ timeout: 15000 });

      // Already in the Solar workspace — switching again would not navigate.
      await page.goto("/portal/leads?q=Marcus");
      await page.locator('table a[href^="/portal/leads/"]').first().click();
      await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
      const leadId = page.url().split("/").pop()!;
      await ensureDesign(page, leadId);
      await openOperations(page, leadId, "Project fields");

      await page.getByLabel(label).fill("Left with the city on the 12th");
      await page
        .getByRole("button", { name: /Save project fields|Create job & save project fields/ })
        .click();
      await expect(page.getByText("Project fields saved")).toBeVisible({ timeout: 15000 });

      await openOperations(page, leadId, "Project fields");
      await expect(page.getByLabel(label)).toHaveValue("Left with the city on the 12th");
      // The job exists now, so the button stops offering to create one.
      await expect(page.getByRole("button", { name: "Save project fields" })).toBeVisible();
    });
  }
);
