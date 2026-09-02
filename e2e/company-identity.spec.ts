import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * The company's phone and email are printed on a customer-facing solar proposal
 * and BLOCK it from generating while blank — and until now no screen in the app
 * wrote either column, so the live company was stopped by a finding it had no
 * way to clear. Both the fields and their round trip are pinned here.
 */
test("the company's own phone and email can be set, and survive a reload", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/branding");

  // The legal entity lives on the Company tab; the screen has one Save.
  await page.getByRole("tab", { name: "Company" }).click();
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "The legal entity" }) })
    .first();

  const phone = `(555) 010-${String(Date.now() % 10000).padStart(4, "0")}`;
  const email = `quotes+${Date.now() % 100000}@anexahomes.com`;

  await card.getByPlaceholder("(555) 123-4567").fill(phone);
  await card.getByPlaceholder("support@example.com").fill(email);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Branding saved")).toBeVisible({ timeout: 15000 });

  await page.reload();
  await page.getByRole("tab", { name: "Company" }).click();
  await expect(card.getByPlaceholder("(555) 123-4567")).toHaveValue(phone);
  await expect(card.getByPlaceholder("support@example.com")).toHaveValue(email);
});
