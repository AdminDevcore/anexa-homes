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

test("industry: switching workspaces isolates the deal flow", async ({ page }) => {
  await login(page, "manager@anexahomes.com");

  // Roofing (default) has seeded appointments.
  await page.goto("/portal/leads");
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible({ timeout: 10000 });
  expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);

  // Switch to Solar via the top-right switcher.
  await page.getByRole("button", { name: "Switch industry" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 10000 });
  await expect(page.getByText(/Solar workspace/)).toBeVisible({ timeout: 10000 });

  // Solar is its own isolated workspace — no roofing deals leak in.
  await page.goto("/portal/leads");
  await expect(page.getByText("No appointments found")).toBeVisible({ timeout: 10000 });

  // The Solar pipeline shows Solar-specific stages (not roofing).
  await page.goto("/portal/pipeline");
  await expect(page.getByText("Solar Pipeline")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("PTO / Activated")).toBeVisible();
});

test("industry: a restricted user can't switch (installer = roofing only)", async ({ page }) => {
  await login(page, "installer@anexahomes.com");
  await page.goto("/portal/dashboard");
  // Static badge, not a switchable dropdown.
  await expect(page.getByText("Roofing").first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Switch industry" })).toHaveCount(0);
});
