import { test, expect, type Page } from "@playwright/test";
import { expectRowValue } from "./list-value";

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
  await expectRowValue(page, "Damage confirmed");

  // Add a new one. The list is a draft with one Save, like every settings
  // screen, so the row appears first and the Save is what writes it.
  await page.getByPlaceholder(/Approved/).fill("Re-inspection requested");
  await page.getByRole("button", { name: "Add outcome" }).click();
  await expectRowValue(page, "Re-inspection requested");
  await page.getByRole("button", { name: "Save changes" }).click();
  // The exact toast: "Saved" on its own is a substring of the save bar's own
  // "Unsaved changes to …", so it passes before the action has run.
  await expect(page.getByText("Outcomes saved")).toBeVisible({ timeout: 15000 });
  // The save bar goes when the panel's draft matches what the server sent back:
  // the round trip has landed, and a reload now cannot race it.
  await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });
  await page.reload();
  await expectRowValue(page, "Re-inspection requested", 15000);

  await page.context().clearCookies();
});

test("settings: production checklist is customizable", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/settings/production-checklist");

  await expect(page.getByRole("heading", { name: "Production Checklist" })).toBeVisible();
  await expectRowValue(page, "Magnetic nail sweep complete");

  await page.getByPlaceholder(/Magnetic/).fill("Permit posted on site");
  await page.getByRole("button", { name: "Add item" }).click();
  await expectRowValue(page, "Permit posted on site");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Steps saved")).toBeVisible({ timeout: 15000 });
  // The save bar goes when the panel's draft matches what the server sent back:
  // the round trip has landed, and a reload now cannot race it.
  await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });
  await page.reload();
  await expectRowValue(page, "Permit posted on site", 15000);

  await page.context().clearCookies();
});
