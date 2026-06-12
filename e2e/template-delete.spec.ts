import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("a document template can be deleted", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/documents");

  const card = page.locator("li", { hasText: "Warranty Certificate" });
  await expect(card).toHaveCount(1);

  // Auto-accept the confirm dialog.
  page.on("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Delete template" }).click();

  // The template is gone.
  await expect(page.locator("li", { hasText: "Warranty Certificate" })).toHaveCount(0, { timeout: 10000 });

  await page.context().clearCookies();
});
