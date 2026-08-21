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

/**
 * Solar's photo checklists.
 *
 * PhotoTemplate is vertical-isolated, so the pair seeded for roofing is
 * invisible from the Solar workspace. Before this was fixed the Settings page
 * mapped over an empty list and rendered as a bare heading with no way to
 * create anything, and solar's Survey/Installation folders were plain file
 * dumps rather than checklists. Both halves are asserted here.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

async function switchToSolar(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

test("photos: the solar workspace has its own editable checklists", async ({ page }) => {
  test.skip(!FLAG_ON, "multi-vertical is behind SOLAR_VERTICAL_ENABLED");
  await login(page, "admin@anexahomes.com");
  await switchToSolar(page);

  await page.goto("/portal/settings/photo-templates");

  // Both checklists are on screen under solar's own vocabulary, whether or not
  // a row exists yet — the bug was that neither was.
  await expect(page.getByRole("heading", { name: "Site Survey Photos" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Installation Photos" })).toBeVisible();
  // Roofing's names must not leak across the workspace boundary.
  await expect(page.getByText("Site / Inspection Photos")).toHaveCount(0);

  // A slot can be added, creating the solar template row on the way in if this
  // workspace has never had one.
  const label = `QA Solar Slot ${Date.now() % 100000}`;
  await page.getByPlaceholder(/New photo label/).first().fill(label);
  await page.getByRole("button", { name: /Add photo/ }).first().click();
  await expect
    .poll(
      () =>
        page
          .getByRole("textbox")
          .evaluateAll((els, l) => els.some((e) => (e as HTMLInputElement).value === l), label),
      { timeout: 15000 }
    )
    .toBe(true);
});

test("photos: a solar deal's photo folders are checklist folders, not file dumps", async ({ page }) => {
  test.skip(!FLAG_ON, "multi-vertical is behind SOLAR_VERTICAL_ENABLED");
  await login(page, "admin@anexahomes.com");
  await switchToSolar(page);

  await page.goto("/portal/leads");
  await page.getByRole("cell", { name: /Priya Raman/ }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByRole("button", { name: /Survey Photos/ }).first().click();

  // Solar's folder keys are `survey_photos` / `install_photos`, not roofing's
  // `survey` / `install`. They used to be missing `special: "photos"`, so both
  // opened the generic file list — no capture UI and no report. The Compile PDF
  // link is the tell: only the photo body renders one, and it must carry
  // solar's own group key so the report finds the files that were filed there.
  const compile = page.getByRole("link", { name: /Compile PDF/ }).first();
  await expect(compile).toBeVisible({ timeout: 15000 });
  await expect(compile).toHaveAttribute("href", /group=survey_photos$/);
  await expect(page.getByRole("button", { name: /Add photos/ })).toBeVisible();

  // And the report route accepts that key rather than 400-ing on it.
  const href = await compile.getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
});
