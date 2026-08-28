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

/**
 * What a sales rep may do with contract templates: read them, send them, and
 * nothing else. The send half is the one that broke — see the second test.
 */
test("a sales rep can send a template but cannot author one", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/documents");

  // Templates are visible.
  await expect(page.getByText("Roofing Contract").first()).toBeVisible({ timeout: 15000 });

  // No authoring controls: no new, no edit, no delete.
  await expect(page.getByRole("button", { name: /New template/ })).toHaveCount(0);
  await expect(page.getByLabel("Edit template")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Delete template/ })).toHaveCount(0);

  // And they can send one.
  await page.getByRole("button", { name: /Send for Signature/ }).click();
  await page.locator('button:has-text("Choose a document")').click();
  await page.getByRole("option", { name: "Roofing Contract" }).click();
  await page.locator('button:has-text("Choose a lead")').click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: /^Send$/ }).click();

  const linkInput = page.locator("input[readonly]").first();
  await expect(linkInput).toBeVisible({ timeout: 15000 });
  expect(await linkInput.inputValue()).toContain("/sign/");
});

/**
 * The reported bug. A rep with no deals in the ACTIVE workspace got no button
 * at all — the control was rendered only when the scoped lead list came back
 * non-empty, so "you have no deals here yet" was indistinguishable from "you
 * are not allowed to send documents". Every sales rep in production was in that
 * state in the Roofing workspace, which is the one they land in by default.
 */
test("a rep with no deals in this workspace still gets the send control, with a reason", async ({ page }) => {
  await login(page, "rep2@anexahomes.com");
  await page.goto("/portal/documents");

  // They can still read the templates.
  await expect(page.getByText("Roofing Contract").first()).toBeVisible({ timeout: 15000 });

  const send = page.getByRole("button", { name: /Send for Signature/ });
  await expect(send).toBeVisible({ timeout: 15000 });
  await send.click();

  // The dialog explains why it cannot be completed instead of vanishing.
  await expect(page.getByText(/no deals in the Roofing workspace/i)).toBeVisible({ timeout: 10000 });
});
