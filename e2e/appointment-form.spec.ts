import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("new appointment: required custom field is enforced, attachment uploads", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/leads/new");

  // Custom fields section shows the seeded fields, required one marked with *
  await expect(page.getByText("Custom Fields")).toBeVisible();
  await expect(page.getByText("Damage Type")).toBeVisible();

  // Fill name but leave the required "Damage Type" empty → submit blocked
  const unique = `Tester ${Date.now()}`;
  await page.locator("input").first().fill("Reqcheck");
  await page.locator("input").nth(1).fill(unique);

  // Stage an attachment
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "site-photo.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 staged"),
  });
  await expect(page.getByText("site-photo.pdf")).toBeVisible();

  // Try to create without the required field → still on the form (toast error)
  await page.getByRole("button", { name: "Create Appointment" }).click();
  await expect(page).toHaveURL(/\/portal\/leads\/new/);

  // Fill the required Damage Type (its combobox is the last one on the form), then create
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "Hail", exact: true }).click();
  await page.getByRole("button", { name: "Create Appointment" }).click();

  // Lands on the new deal. The staged attachment is uncategorised, so it files
  // itself into the "Other" folder in Documents & Files — open that to see it.
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await page.getByRole("button", { name: /^Other/ }).click();
  await expect(page.getByText("site-photo.pdf")).toBeVisible({ timeout: 10000 });

  await page.context().clearCookies();
});
