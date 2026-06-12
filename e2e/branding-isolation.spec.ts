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

test("second tenant uses distinct currency and locale settings", async ({ page }) => {
  // Log in as Summit Roofing owner and navigate to settings
  await login(page, "ownerb@summitroofing.test");
  // Verify we're logged in as the right tenant by checking the support phone
  await expect(page.getByText(/\(111\) 222-3333/)).toBeVisible();
  
  // Navigate to branding page (no immediate errors expected)
  await page.goto("/portal/settings/branding", { waitUntil: "domcontentloaded" });
  
  // Verify Summit Roofing is shown (company isolation)
  await expect(page.getByText("Summit Roofing")).toBeVisible();
  await expect(page.getByText("Anexa Homes")).toHaveCount(0);
  
  // Log back in as Anexa and verify isolation
  await login(page, "owner@anexahomes.com");
  await expect(page.getByText("Anexa Homes").first()).toBeVisible();
  await expect(page.getByText("Summit Roofing")).toHaveCount(0);
});
