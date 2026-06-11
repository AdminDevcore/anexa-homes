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
