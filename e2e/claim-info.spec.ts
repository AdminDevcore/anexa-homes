import { test, expect, type Page, type Locator } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

// A claim field input, located by its label span sibling.
function field(page: Page, label: string): Locator {
  return page
    .locator("div.space-y-1", { has: page.getByText(label, { exact: true }) })
    .locator("input");
}

// The claim card reads by default and edits on request, like every other card
// on the deal, so its inputs only exist once Edit is open. Scoped to the claim
// slide because the Homeowner and Summary cards each have an "Edit" of their own.
async function openClaimEditor(page: Page) {
  const edit = page.locator('[data-deal-slide="claim"]').getByRole("button", { name: "Edit" });
  await edit.click();
  await expect(field(page, "Carrier")).toBeVisible();
}

// Every field that previously failed to persist, plus the ones that worked.
// Roof info (squares, waste, pitch, stories) deliberately absent: it moved to
// Scope of Work and the claim card only tracks the claim and its amounts.
const VALUES: Record<string, string> = {
  "Carrier": "Allstate",
  "Claim Number": "AS-2026-777",
  "Policy Number": "POL-TEST-999",
  "Adjuster Name": "Jane Adjuster",
  "Adjuster Phone": "(555) 333-4444",
  "Adjuster Email": "jane@insurance.com",
  "Adjuster Meeting Date": "2026-07-15",
  "Date of Loss": "2026-03-02",
  "Deductible ($)": "2750",
  "RCV ($)": "41000",
  "ACV ($)": "32000",
  "Depreciation ($)": "9000",
};

test("every claim field persists after reload", async ({ page }) => {
  await login(page, "admin@anexahomes.com");

  // Robert Johnson is seeded in production with an open claim (Roofing workspace).
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  // Claim Info is the first slide of the job switcher, so it is already open.
  await expect(page.getByRole("tab", { name: "Claim Info" })).toBeVisible({ timeout: 10000 });
  await openClaimEditor(page);

  for (const [label, value] of Object.entries(VALUES)) {
    await field(page, label).fill(value);
  }

  // Explicit save (the fallback button the user asked for).
  await page.getByRole("button", { name: "Save claim" }).click();
  await expect(page.getByText("Claim saved")).toBeVisible({ timeout: 10000 });

  // Reload from scratch and confirm EVERY value persisted.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Claim Info" })).toBeVisible({ timeout: 10000 });
  await openClaimEditor(page);

  for (const [label, value] of Object.entries(VALUES)) {
    await expect(field(page, label), `field "${label}" should persist`).toHaveValue(value);
  }
});
