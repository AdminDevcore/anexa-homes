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

/** Opens the "New task" modal on /portal/tasks and returns its dialog locator. */
async function openNewTask(page: Page) {
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("ops can assign a task to a rep and the rep sees it in My tasks", async ({ page }) => {
  const title = `Chase QA ${Date.now() % 100000}`;

  // Manager assigns a task to the rep (Tyler Brooks).
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");
  const dialog = await openNewTask(page);
  await dialog.getByPlaceholder("New task…").fill(title);
  await dialog.getByText("Assign to me").click(); // open assignee select
  await page.getByRole("option", { name: "Tyler Brooks" }).click();
  await dialog.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByText("Task added")).toBeVisible({ timeout: 10000 });

  // Rep sees it under the default "My tasks" filter. `.first()` because the page
  // renders both the desktop table and the mobile cards — the title is in the DOM
  // twice, and a bare getByText is a strict-mode violation.
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/tasks");
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
});

test("a sales rep has no assignee picker (can only create for themselves)", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/tasks");
  const dialog = await openNewTask(page);
  await expect(dialog.getByPlaceholder("New task…")).toBeVisible();
  await expect(dialog.getByText("Assign to me")).toHaveCount(0);
});

test("a manager can assign tasks to others", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");
  const dialog = await openNewTask(page);
  await expect(dialog.getByText("Assign to me")).toBeVisible({ timeout: 10000 });
});

test("tagging a job fills in that deal's rep and links the task to the deal", async ({ page }) => {
  const title = `Site survey ${Date.now() % 100000}`;
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");

  const dialog = await openNewTask(page);
  await dialog.getByPlaceholder("New task…").fill(title);

  // Tag the seeded "Robert Johnson" deal — every seeded lead is Tyler Brooks'.
  await dialog.getByLabel("Search for a job").fill("Johnson");
  await dialog.getByRole("button", { name: /Robert Johnson/ }).click();

  // Assignee auto-filled with the deal's assigned rep. Assert on the combobox
  // itself — a bare getByText also matches the hidden native <option>.
  await expect(
    dialog.getByRole("combobox").filter({ hasText: "Tyler Brooks" })
  ).toBeVisible({ timeout: 10000 });
  await dialog.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByText(/Task added to Robert Johnson/)).toBeVisible({ timeout: 10000 });

  // The task lists under the job, linking back to that deal.
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row.getByRole("link", { name: /Robert Johnson/ })).toBeVisible({ timeout: 10000 });
});

test("filters collapse into a Filters popover with an active count", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");

  // Default view: My tasks + Open are the active chips, so no filter badge.
  // `exact` on "Open" — otherwise it also matches "Open Next.js Dev Tools" in dev.
  await expect(page.getByRole("button", { name: "My tasks" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("combobox").filter({ hasText: /Any priority/ }).click();
  await page.getByRole("option", { name: "Urgent" }).click();
  await expect(page.getByRole("button", { name: "Filters (1 active)" })).toBeVisible();
});

test("search narrows the list and the shown count follows it", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/tasks");
  await page.getByLabel("Search tasks").fill("zzz-no-such-task-zzz");
  await expect(page.getByText("0 shown")).toBeVisible();
  await expect(page.getByText("No tasks match these filters.").first()).toBeVisible();
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
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
});
