import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("deal page: no Claim tab, claim info folded into Overview, no Estimated Value", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");

  // Claim tab is gone
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
  // Claim info is the first slide of the job switcher, open by default.
  await expect(page.getByRole("tab", { name: "Claim Info" })).toBeVisible();
  // Roof info / line items / supplements removed from the claim card
  await expect(page.getByText("Total Squares")).toHaveCount(0);
  await expect(page.getByText("Line Item Information")).toHaveCount(0);
  await expect(page.getByText("Supplement Opportunities")).toHaveCount(0);
  // Amounts kept. The card is read-first now — an Edit button swaps in the
  // form — so these are the READ labels; "RCV ($)" only exists on the input.
  await expect(page.getByRole("heading", { name: "Amounts" })).toBeVisible();
  await expect(page.getByText("RCV", { exact: true })).toBeVisible();
  await expect(page.getByText("ACV", { exact: true })).toBeVisible();
  // Estimated Value removed from Summary
  await expect(page.getByText("Estimated Value")).toHaveCount(0);

  await page.context().clearCookies();
});

test("settings: inspection outcomes are customizable", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/inspection-outcomes");

  await expect(page.getByRole("heading", { name: "Inspection Outcomes" })).toBeVisible();
  // A default outcome is present
  await expect(page.locator('input[value="Damage confirmed"]')).toBeVisible();

  // Add a new outcome
  await page.getByPlaceholder(/Approved/).fill("Re-inspection requested");
  await page.getByRole("button", { name: /Add outcome/ }).click();
  await expect(page.locator('input[value="Re-inspection requested"]')).toBeVisible();

  await page.context().clearCookies();
});

test("settings: production checklist is customizable", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/production-checklist");

  await expect(page.getByRole("heading", { name: "Production Checklist" })).toBeVisible();
  await expect(page.locator('input[value="Magnetic nail sweep complete"]')).toBeVisible();

  await page.getByPlaceholder(/Magnetic/).fill("Permit posted on site");
  await page.getByRole("button", { name: /Add item/ }).click();
  await expect(page.locator('input[value="Permit posted on site"]')).toBeVisible();

  await page.context().clearCookies();
});
