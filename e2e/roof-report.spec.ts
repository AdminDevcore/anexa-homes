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

test("roof report: trace a facet, save squares, persist + show on Summary", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads");
  await page.locator('a[href^="/portal/leads/"]:not([href$="/new"])').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByRole("button", { name: /Build Roof Report|Roof Report/ }).click();
  // Wait for geocode + satellite imagery.
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(4000);

  const box = (await page.locator(".leaflet-container").boundingBox())!;
  // Trace a quadrilateral facet.
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.58);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.58);
  await page.getByRole("button", { name: /Close facet/ }).click();
  await expect(page.getByRole("button", { name: /Facet 1/ })).toBeVisible();

  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText(/Saved —/)).toBeVisible({ timeout: 10000 });

  // Reload: report persists on the Summary and the geometry reopens.
  await page.reload();
  await expect(page.getByText(/sq · .*pitch/)).toBeVisible({ timeout: 10000 });
});
