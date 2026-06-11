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

// Open a deal in production (photo checklists live in the production section).
async function openProductionDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const start = page.getByRole("button", { name: /Start production/ });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await expect(page.getByText(/Job AH-/)).toBeVisible({ timeout: 10000 });
  }
}

test("photos: deal shows Site & Install checklists and accepts an upload", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);

  await expect(page.getByText("Front of house")).toBeVisible({ timeout: 10000 });

  // Upload a photo into the first slot via its hidden file input.
  const input = page.locator('input[type="file"][accept="image/*"]').first();
  await input.setInputFiles("public/anexa-mark.png");
  await expect(page.getByText("Photo added")).toBeVisible({ timeout: 15000 });
});

test("photos: compiles a PDF photo report for a deal", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);
  const href = await page.locator('a:has-text("Compile PDF report")').first().getAttribute("href");
  expect(href).toBeTruthy();
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
});

test("photos: deal Survey/Install buttons capture and compile each group separately", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  // No production needed — the buttons live in the deal's Photos & Documents card.
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await expect(page.getByRole("button", { name: "Survey" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Install Photos" })).toBeVisible();

  // Open the Survey set, drop a photo in, and compile just the survey group.
  await page.getByRole("button", { name: "Survey" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Survey" })).toBeVisible({ timeout: 10000 });
  await dialog.locator('input[type="file"]').setInputFiles("public/anexa-mark.png");
  await expect(page.getByText(/added/)).toBeVisible({ timeout: 15000 });

  const href = await dialog.locator('a:has-text("Compile PDF")').getAttribute("href");
  expect(href).toContain("group=survey");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
});

test("photos: admin can add a slot to a photo template", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/photo-templates");
  await expect(page.getByText("Site / Inspection Photos")).toBeVisible({ timeout: 10000 });

  const label = `QA Slot ${Date.now() % 100000}`;
  await page.getByPlaceholder(/New photo label/).first().fill(label);
  await page.getByRole("button", { name: /Add photo/ }).first().click();
  // The new slot renders as an editable input whose value is the label.
  await expect
    .poll(() => page.getByRole("textbox").evaluateAll((els, l) => els.some((e) => (e as HTMLInputElement).value === l), label), {
      timeout: 10000,
    })
    .toBe(true);
});

test("photos: sales rep cannot access photo-template settings", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/settings/photo-templates");
  await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 10000 });
});
