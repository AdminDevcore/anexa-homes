import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("sales rep sees only training shared with their role", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/knowledge");

  // Visible to sales_rep
  await expect(page.getByRole("heading", { name: "Sales Rep Training" })).toBeVisible();
  await expect(page.getByText("Door Approach Script")).toBeVisible();
  // Company-Wide includes sales_rep
  await expect(page.getByRole("heading", { name: "Company-Wide" })).toBeVisible();

  // NOT visible: installer-only category
  await expect(page.getByRole("heading", { name: "Installer / Crew Training" })).toHaveCount(0);
  await expect(page.getByText("Job Site Safety Checklist")).toHaveCount(0);

  // Reps are read-only: no management controls
  await expect(page.getByRole("button", { name: /New category/i })).toHaveCount(0);

  await page.context().clearCookies();
});

test("installer sees their training but not sales rep training", async ({ page }) => {
  await login(page, "installer@anexahomes.com");
  await page.goto("/portal/knowledge");

  await expect(page.getByRole("heading", { name: "Installer / Crew Training" })).toBeVisible();
  await expect(page.getByText("Job Site Safety Checklist")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales Rep Training" })).toHaveCount(0);

  await page.context().clearCookies();
});

test("admin sees every category and can create a new one", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/knowledge");

  // Management sees all categories regardless of visibleRoles.
  await expect(page.getByRole("heading", { name: "Sales Rep Training" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Installer / Crew Training" })).toBeVisible();

  await page.getByRole("button", { name: /New category/i }).click();
  await page.getByPlaceholder("e.g. Sales Rep Training").fill("Accounting Training");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("heading", { name: "Accounting Training" })).toBeVisible();

  await page.context().clearCookies();
});
