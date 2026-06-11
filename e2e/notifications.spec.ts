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

test("creating a lead notifies admins via the rules engine", async ({ page }) => {
  // Manager creates an appointment -> "New appointment → Managers" rule fires (actor excluded).
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");
  const last = `Notify${Date.now() % 100000}`;
  const inputs = page.locator("form input");
  await inputs.nth(0).fill("Lead");
  await inputs.nth(1).fill(last);
  await page.locator('input[type="datetime-local"]').fill("2026-06-20T10:00");
  await page.getByRole("button", { name: /Create Appointment/ }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  // Admin (a recipient) should see the notification.
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/notifications");
  await expect(page.getByText(`New appointment: Lead ${last}`)).toBeVisible({ timeout: 10000 });
});

test("admin can create a notification rule", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/notifications");
  await expect(page.getByText("Notification Rules")).toBeVisible();
  // Seeded rules present
  await expect(page.getByText("New appointment → Managers")).toBeVisible();

  await page.getByRole("button", { name: /Add Rule/ }).click();
  const name = `QA Rule ${Date.now() % 100000}`;
  await page.getByPlaceholder(/Notify managers/).fill(name);
  // Pick a dynamic recipient (unique label) and create.
  await page.getByText("Assigned sales rep").click();
  await page.getByRole("button", { name: /^Create$/ }).click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 10000 });
});

test("sales rep cannot access notification settings", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/settings/notifications");
  await expect(page).not.toHaveURL(/\/portal\/settings\/notifications/);
});
