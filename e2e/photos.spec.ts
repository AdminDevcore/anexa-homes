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
/** The photo checklists live on the Field Production slide of the job switcher. */
async function openFieldProduction(page: Page) {
  await page.getByRole("tab", { name: "Field Production" }).click();
}

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
  await openFieldProduction(page);

  await expect(page.getByText("Front of house")).toBeVisible({ timeout: 10000 });

  // Upload a photo into the first slot via its hidden file input.
  const input = page.locator('input[type="file"][accept="image/*"]').first();
  await input.setInputFiles("public/anexa-mark.png");
  await expect(page.getByText("Photo added")).toBeVisible({ timeout: 15000 });
});

test("photos: compiles a PDF photo report for a deal", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);
  await openFieldProduction(page);
  const href = await page.locator('a:has-text("Compile PDF report")').first().getAttribute("href");
  expect(href).toBeTruthy();
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
});

test("photos: deal Survey/Install folders capture and compile each group separately", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  // No production needed — the folders live in the deal's Documents & Files card.
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  // Survey and Install Photos are folder tiles in the grid, not header buttons.
  await expect(page.getByRole("button", { name: /Survey Photos/ })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Install Photos/ })).toBeVisible();

  // Open the Survey folder, drop a photo in, and compile just the survey group.
  await page.getByRole("button", { name: /Survey Photos/ }).click();
  // The capture UI now renders inline in the open folder rather than in a modal,
  // so the file input must be scoped to the folder card — the deal page has
  // several other hidden file inputs that a page-wide .first() would grab.
  const folders = page.getByTestId("deal-folders");
  await expect(page.getByRole("button", { name: "All folders" })).toBeVisible({ timeout: 10000 });
  await folders.locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");

  // Which capture UI renders depends on whether this deal reached production:
  // a templated slot checklist if it did, bulk upload if it did not. Both are
  // valid, and the deal picked by the pipeline list is not fixed across runs —
  // so assert on the outcome they share (the photo landed) rather than on one
  // path's toast copy. Anchored, because a bare /added/ also matches "Notes
  // can't be edited once added" in the sidebar, twice: a strict-mode violation
  // rather than a pass.
  await expect(
    page.getByText(/^Photo added$/).or(page.getByText(/^\d+ .* added$/))
  ).toBeVisible({ timeout: 15000 });

  // Whichever path rendered, the compile link must be scoped to THIS group and
  // produce a real PDF — Survey and Install stay separate reports. The
  // checklist route names the group by template kind ("site"), the bulk route
  // by folder key ("survey").
  const href = await folders.locator('a:has-text("Compile PDF")').first().getAttribute("href");
  expect(href).toMatch(/group=(survey|site)$/);
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
