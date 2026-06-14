import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("auto-suggest categorizes a supplier transaction", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/bookkeeping");

  // The seeded unreviewed "ABC Supplier — shingle delivery" row, category empty.
  const catSelect = page.locator("tr", { hasText: "ABC Supplier — shingle delivery" }).locator("select").first();
  await expect(catSelect).toHaveValue("");

  await page.getByRole("button", { name: /Auto-suggest/ }).click();

  // After suggest, the category is filled (Materials via keyword + vendor history).
  await expect(catSelect).not.toHaveValue("", { timeout: 10000 });

  await page.context().clearCookies();
});

test("attach a receipt and leave a note on a transaction", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/bookkeeping");

  // Open the transaction detail via the pencil button.
  const row = page.locator("tr", { hasText: "ABC Supplier — shingle delivery" });
  await row.getByRole("button", { name: "Notes & receipt" }).click();

  // Receipt section present
  await expect(page.getByText("Receipt / invoice")).toBeVisible();
  await expect(page.getByText("No receipt attached.")).toBeVisible();

  // Upload a receipt
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({
    name: "abc-invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake invoice"),
  });
  await expect(page.getByText("abc-invoice.pdf")).toBeVisible({ timeout: 10000 });

  // Leave a note
  await page.getByPlaceholder("Add a note…").fill("Net-30 terms, pay by month end");
  await page.getByPlaceholder("Add a note…").blur();

  await page.context().clearCookies();
});
