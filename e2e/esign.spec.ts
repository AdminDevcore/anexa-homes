import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("e-sign: staff sends, customer signs, signed PDF + audit produced", async ({ page }) => {
  // 1. Staff sends a Roofing Contract to a customer lead.
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/documents");
  await page.getByRole("button", { name: /Send for Signature/ }).click();

  await page.locator('button:has-text("Choose a document")').click();
  await page.getByRole("option", { name: "Roofing Contract" }).click();

  await page.locator('button:has-text("Choose a lead")').click();
  await page.getByRole("option", { name: /Johnson/ }).first().click();

  await page.getByRole("button", { name: /^Send$/ }).click();

  // 2. Capture the generated signing link.
  const linkInput = page.locator('input[readonly]').first();
  await expect(linkInput).toBeVisible({ timeout: 10000 });
  const url = await linkInput.inputValue();
  expect(url).toContain("/sign/");

  // 3. Open the signing link (as the customer would, unauthenticated).
  await page.context().clearCookies();
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  await page.goto(path);

  // 4. Consent + sign (typed signature).
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Finish & Sign/ }).click(); // opens signature pad
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByPlaceholder("Type your full name").fill("Robert Johnson");
  await page.getByRole("button", { name: /Adopt & Sign/ }).click();
  await page.getByRole("button", { name: /Finish & Sign/ }).click();

  // 5. Confirmation.
  await expect(page.getByText("All signed!")).toBeVisible({ timeout: 15000 });

  // 6. Staff sees completed status + verified audit chain + download.
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/documents");
  await page.getByRole("link", { name: "Roofing Contract" }).first().click();
  await expect(page).toHaveURL(/\/portal\/documents\/[0-9a-f-]+$/);
  await expect(page.getByText(/integrity verified/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Download/ })).toBeVisible();
});

test("e-sign: send with co-borrower shows per-signer status + resend", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/documents");
  await page.getByRole("button", { name: /Send for Signature/ }).click();

  await page.locator('button:has-text("Choose a document")').click();
  await page.getByRole("option", { name: "Roofing Contract" }).click();

  await page.locator('button:has-text("Choose a lead")').click();
  await page.getByRole("option", { name: /Johnson/ }).first().click();

  // Add a co-borrower as a second signer.
  await page.getByRole("button", { name: /Add co-borrower/ }).click();
  await page.getByPlaceholder("Co-borrower name").fill("Jane Johnson");
  await page.getByPlaceholder("Co-borrower email").fill("jane.johnson@example.com");

  await page.getByRole("button", { name: /^Send$/ }).click();

  // Two signing links produced (one per signer).
  await expect(page.locator('input[readonly]')).toHaveCount(2, { timeout: 10000 });
  await page.getByRole("button", { name: /^Done$/ }).click();

  // List shows the per-signer summary for the new 2-signer package.
  await expect(page.getByText("signed 0 of 2").first()).toBeVisible();

  // Resend re-issues links and surfaces the "Reminder sent" dialog.
  await page.getByRole("button", { name: /^Resend$/ }).first().click();
  await expect(page.getByText("Reminder sent")).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input[readonly]').first()).toBeVisible();
});
