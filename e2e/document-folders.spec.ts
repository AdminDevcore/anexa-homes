import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** Open the first roofing deal from the pipeline list. */
async function openDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
}

test("folders: a roofing deal shows the restoration folder grid", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page);

  await expect(page.getByRole("button", { name: /^Contract/ })).toBeVisible({ timeout: 10000 });
  for (const label of [
    "Insurance Documents",
    "Adjuster Scope",
    "Survey Photos",
    "Install Photos",
    "Materials",
    "Permits",
    "Personal Files",
    "Invoices & Payments",
    "Call Recordings",
    "Internal Documents",
  ]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }

  // Solar-only folders must never leak into a roofing deal.
  await expect(page.getByRole("button", { name: /Interconnection/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Utility Bill/ })).toHaveCount(0);
});

test("folders: upload lands in the folder you opened, and can be moved out", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openDeal(page);

  // Open Permits and upload into it — the file must file itself there, not in
  // an undifferentiated pile. The input is scoped to the folder card because
  // the deal page has several other hidden file inputs.
  const folders = page.getByTestId("deal-folders");
  await page.getByRole("button", { name: /^Permits/ }).click();
  await expect(page.getByRole("button", { name: "All folders" })).toBeVisible({ timeout: 10000 });
  await folders.locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");
  await expect(page.getByText(/file\(s\) uploaded/)).toBeVisible({ timeout: 15000 });

  // Back on the grid, Permits owns the file.
  await page.getByRole("button", { name: "All folders" }).click();
  await expect(page.getByRole("button", { name: /^Permits\s*[1-9]/ })).toBeVisible({ timeout: 10000 });

  // Move it to Materials, and the count follows it across.
  await page.getByRole("button", { name: /^Permits/ }).click();
  await page.getByLabel(/^Move .* to another folder$/).first().selectOption("materials");
  await expect(page.getByText("Moved")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "All folders" }).click();
  await expect(page.getByRole("button", { name: /^Materials\s*[1-9]/ })).toBeVisible({ timeout: 10000 });
});

/**
 * The solar workspace lives behind SOLAR_VERTICAL_ENABLED. With the flag off
 * there is no switcher and no solar deal to reach, so this skips rather than
 * fails — same convention as vertical.spec.ts.
 *
 *   SOLAR_VERTICAL_ENABLED=1 pnpm e2e   → runs
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

test("folders: a solar deal gets the solar folder set", async ({ page }) => {
  test.skip(!FLAG_ON, "multi-vertical is behind SOLAR_VERTICAL_ENABLED");
  await login(page, "manager@anexahomes.com");

  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  // Wait for the switch to actually land before navigating on, or the next
  // goto races it and you get the roofing list back. The page header carries
  // "<Role> · <Workspace> workspace"; the empty-state hint can also name the
  // workspace, so anchor on the header.
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });

  await page.goto("/portal/leads");
  await page.getByRole("cell", { name: /Priya Raman/ }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await expect(page.getByRole("button", { name: /Utility Bill/ })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Interconnection/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Engineering Plan Sets/ })).toBeVisible();
  // Roofing-only folders must not appear on a solar deal.
  await expect(page.getByRole("button", { name: /Adjuster Scope/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Call Recordings/ })).toHaveCount(0);
});
