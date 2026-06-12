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

test("each tenant sees only its own brand identity", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  // Verify Anexa's company name and support phone are visible
  await expect(page.getByText("Anexa Homes").first()).toBeVisible();
  await expect(page.getByText(/\(555\) 200-7663/)).toBeVisible();

  // Switch to Summit Roofing tenant
  await login(page, "ownerb@summitroofing.test");
  // Verify Summit's company name and support phone are visible
  await expect(page.getByText("Summit Roofing").first()).toBeVisible();
  await expect(page.getByText(/\(111\) 222-3333/)).toBeVisible();
  // Ensure Anexa's name is not present (isolating data)
  await expect(page.getByText("Anexa Homes")).toHaveCount(0);
});

test("editing company B's branding does not change company A", async ({ page }) => {
  // Tenant B (Summit Roofing) renames itself via the Settings UI.
  await login(page, "ownerb@summitroofing.test");
  await page.goto("/portal/settings/branding", { waitUntil: "domcontentloaded" });

  // The company-name input is in the Company Identity form (placeholder e.g. Anexa Homes).
  const nameInput = page.getByPlaceholder("e.g., Acme Roofing");
  await nameInput.fill("Summit Roofing Co");
  await page.getByRole("button", { name: /save company info/i }).click();
  await expect(page.getByText("Company information saved")).toBeVisible();

  // Tenant A (Anexa) must be completely unaffected by tenant B's write.
  await login(page, "owner@anexahomes.com");
  await expect(page.getByText("Anexa Homes").first()).toBeVisible();
  // The name tenant B set must never leak into tenant A's portal.
  await expect(page.getByText("Summit Roofing Co")).toHaveCount(0);
});
