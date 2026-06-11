import { test, expect } from "@playwright/test";

test("website inspection request submits and confirms", async ({ page }) => {
  await page.goto("/contact");
  const unique = `e2e_${Date.now()}`;
  await page.fill('input[name="firstName"]', "E2E");
  await page.fill('input[name="lastName"]', unique);
  await page.fill('input[name="email"]', `${unique}@example.com`);
  await page.fill('input[name="phone"]', "(555) 010-2030");
  await page.fill('input[name="address"]', "500 Test Ave");
  await page.fill('input[name="city"]', "Dallas");
  await page.fill('input[name="zip"]', "75201");
  await page.getByRole("button", { name: /Request Free Inspection|Start Claim Support/ }).click();
  await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 10000 });
});
