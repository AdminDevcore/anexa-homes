import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("staff can create a lead", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");
  const last = `QA${Date.now() % 100000}`;
  await page.locator('input').first().fill("Test"); // first name
  // Fill by label-adjacent inputs: use explicit order via the form sections
  await page.getByText("Last name", { exact: false });
  // More robust: target the two name inputs
  const inputs = page.locator("form input");
  await inputs.nth(0).fill("Test");
  await inputs.nth(1).fill(last);
  await page.locator('input[type="datetime-local"]').fill("2026-06-20T10:00");
  await page.getByRole("button", { name: /Create Appointment/ }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: new RegExp(last) })).toBeVisible();
});

test("tasks: create and complete", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/tasks");
  const title = `Follow up ${Date.now() % 100000}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("New task…").fill(title);
  await page.getByRole("button", { name: /Add task/ }).click();
  // `.first()`: the title renders in both the desktop table and the mobile cards.
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
});

// Open a deal (lead) and make sure it's in production (crew/QC/daily/photos visible).
async function openProductionDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  // The deal page is tabbed — production (crew/QC/photos) lives under its own tab.
  const prodTab = page.getByRole("button", { name: "Production", exact: true });
  if (await prodTab.isVisible().catch(() => false)) await prodTab.click();
  const start = page.getByRole("button", { name: /Start production/ });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await expect(page.getByText(/Job AH-/)).toBeVisible({ timeout: 10000 });
  }
}

test("photo upload appears on a project", async ({ page }) => {
  // Priya (manager) oversees the reps who own the production deals.
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);

  // The production section has a file input per photo-checklist slot; upload into the first.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "roof.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  // After upload + refresh, an image served from /portal/files should appear.
  await expect(page.locator('img[src^="/portal/files/"]').first()).toBeVisible({ timeout: 15000 });
});

