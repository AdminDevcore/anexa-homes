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

test("ops can assign a task to a rep and the rep sees it in My tasks", async ({ page }) => {
  const title = `Chase QA ${Date.now() % 100000}`;

  // Manager assigns a task to the rep (Tyler Brooks).
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");
  await page.getByPlaceholder("New task…").fill(title);
  await page.getByText("Assign to me").click(); // open assignee select
  await page.getByRole("option", { name: "Tyler Brooks" }).click();
  await page.getByRole("button", { name: /Add/ }).click();
  await expect(page.getByText("Task added")).toBeVisible({ timeout: 10000 });

  // Rep sees it under the default "My tasks" filter.
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/tasks");
  await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
});

test("a sales rep has no assignee picker (can only create for themselves)", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/tasks");
  await expect(page.getByPlaceholder("New task…")).toBeVisible();
  await expect(page.getByText("Assign to me")).toHaveCount(0);
});

test("a manager can assign tasks to others", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");
  await expect(page.getByText("Assign to me")).toBeVisible({ timeout: 10000 });
});

test("a follow-up task added on a lead appears on that lead", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  // Reach a lead detail via the pipeline (its cards link straight to a lead).
  await page.goto("/portal/pipeline");
  await page.locator('a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByText("Follow-ups & Tasks")).toBeVisible();
  const title = `Lead follow-up ${Date.now() % 100000}`;
  const input = page.getByPlaceholder("Follow-up task…");
  await input.fill(title);
  await input.locator("xpath=..").getByRole("button", { name: /Add/ }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
});
