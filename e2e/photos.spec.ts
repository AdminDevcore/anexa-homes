import { test, expect, type Page } from "@playwright/test";
import { expectRowValue } from "./list-value";

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

/**
 * The number on one folder tile in the deal's Documents & Files grid. Read off
 * the tile rather than counted from its contents: the count is what tells a
 * user something is filed there, and it is what read 0 while the checklist
 * beside it was full.
 */
async function folderCount(page: Page, label: string): Promise<number> {
  const tile = page
    .getByTestId("deal-folders")
    .getByRole("button", { name: new RegExp(`^${label}\\b`) })
    .first();
  await expect(tile).toBeVisible({ timeout: 15000 });
  const text = await tile.innerText();
  const found = /(\d+)/.exec(text);
  expect(found, `no count on the ${label} tile: ${text}`).toBeTruthy();
  return Number(found![1]);
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

/**
 * A photo shot against a checklist slot is a document ON THE DEAL, not just a
 * thumbnail on the job.
 *
 * It used to be filed with `category = the slot's LABEL`, which is not a folder
 * key in either vertical, and — taken from the job's checklist — with no
 * `leadId` at all. So it appeared in no folder on the deal: Survey Photos read
 * 0 with the checklist beside it full, and nothing landed in Other either.
 *
 * All three halves of the fix are pinned here: the right tile counts it, the
 * fallback drawer does not, and the stored file carries the slot's name rather
 * than whatever the phone called it.
 */
test("photos: a checklist photo files itself into the Survey folder under the slot's name", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);

  const surveyBefore = await folderCount(page, "Survey Photos");
  const otherBefore = await folderCount(page, "Other");

  await openFieldProduction(page);
  const slot = () => page.getByTestId("photo-slot").filter({ hasText: "Front of house" }).first();
  await expect(slot()).toBeVisible({ timeout: 10000 });
  await slot().locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");
  await expect(page.getByText(/^Photo added$/)).toBeVisible({ timeout: 15000 });

  await page.reload();
  expect(await folderCount(page, "Survey Photos")).toBe(surveyBefore + 1);
  expect(await folderCount(page, "Other")).toBe(otherBefore);

  // The newest shot in that slot — photos come back oldest first. Matched on
  // the file route, so the office's example photo (served from
  // /api/photo-templates/example) can never be the one picked up.
  await openFieldProduction(page);
  const src = await slot().locator('img[src^="/portal/files/"]').last().getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  // Named for the slot: this is the caption the deal's photo report prints and
  // the filename anyone downloading it gets. "anexa-mark.png" would mean the
  // slot never got a say.
  expect(res.headers()["content-disposition"]).toContain("Front_of_house");
});

test("photos: every checklist photo is a separately downloadable attachment", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);
  await openFieldProduction(page);

  // Put a shot in a known slot so there is something to take back out.
  const slot = () => page.getByTestId("photo-slot").filter({ hasText: "Front of house" }).first();
  await expect(slot()).toBeVisible({ timeout: 10000 });
  await slot().locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");
  await expect(page.getByText(/^Photo added$/)).toBeVisible({ timeout: 15000 });

  // The capture checklist is one view of these photos; the attachment list is
  // the other — the one you use to hand them to a lender one file at a time.
  // Scoped to the visible tab: the other checklist's panel is still in the DOM.
  const list = page.getByTestId("photo-attachments").locator("visible=true").first();
  await expect(list).toBeVisible({ timeout: 15000 });
  const row = list.locator("li").filter({ hasText: "Front of house" }).first();
  await expect(row).toBeVisible();

  // A download link, not a preview link: the browser must save the file rather
  // than open it, and save it under the slot's label.
  const href = await row.getByRole("link", { name: /^Download / }).getAttribute("href");
  expect(href).toMatch(/\/portal\/files\/[^?]+\?download=1$/);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const disposition = res.headers()["content-disposition"];
  expect(disposition).toContain("attachment");
  expect(disposition).toContain("Front_of_house");
  // The ASCII fallback squashes the spaces; filename* is what actually reaches
  // the downloads folder, so it has to carry the label as written.
  expect(disposition).toContain("filename*=UTF-8''Front%20of%20house");

  // And the same list must be reachable from the FOLDER, which is where anyone
  // collecting files for a lender actually goes — above the slots, not buried
  // under fifteen of them, or opening the folder looks unchanged.
  await page.getByTestId("deal-folders").getByRole("button", { name: /^Survey Photos/ }).click();
  const inFolder = page.getByTestId("deal-folders").getByTestId("photo-attachments");
  await expect(inFolder).toBeVisible({ timeout: 15000 });
  await expect(inFolder.getByRole("link", { name: /^Download Front of house/ }).first()).toBeVisible();
  // Scoped to the folder: the deal page renders its own copy of the checklist
  // elsewhere, and a page-wide .first() measures that one instead.
  const slotTop = await page.getByTestId("deal-folders").getByTestId("photo-slot").first().boundingBox();
  const listTop = await inFolder.boundingBox();
  expect(listTop!.y).toBeLessThan(slotTop!.y);
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
  const panel = page.getByTestId("checklist-panel");
  await expect(panel.getByRole("heading", { name: "Site / Inspection Photos" })).toBeVisible({
    timeout: 10000,
  });

  // The checklist is one draft with one Save: "Add photo" puts an empty row on
  // the end, and nothing is written until the Save.
  const label = `QA Slot ${Date.now() % 100000}`;
  await panel.getByRole("button", { name: "Add photo" }).click();
  const last = panel.getByRole("textbox", { name: /^Photo \d+ label$/ }).last();
  await last.fill(label);
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/ saved$/)).toBeVisible({ timeout: 15000 });

  // The save bar goes when the panel's draft matches what the server sent back:
  // the round trip has landed, and a reload now cannot race it.
  await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });

  await page.reload();
  await expectRowValue(page, label, 15000);
});

/**
 * The example photo: set once in Settings, shown on every job, never mistaken
 * for one of the job's own photos.
 *
 * The count is read BEFORE the example is set and compared after, rather than
 * asserted against a fixed number: the deal this picks has whatever photos
 * earlier specs left on it, and an example that quietly became a FileAsset
 * would show up as a difference either way.
 */
test("photos: an example photo shows on the job without counting as one of its photos", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openProductionDeal(page);
  await openFieldProduction(page);

  const slotRow = () => page.getByTestId("photo-slot").filter({ hasText: "Front of house" }).first();
  await expect(slotRow()).toBeVisible({ timeout: 10000 });
  const photosBefore = await slotRow().locator('img[src^="/portal/files/"]').count();

  // Set the example on that slot. The first file input on the settings page is
  // the first slot of the site checklist — the same "Front of house".
  await page.goto("/portal/settings/photo-templates");
  await expect(
    page.getByTestId("checklist-panel").getByRole("heading", { name: "Site / Inspection Photos" })
  ).toBeVisible({ timeout: 10000 });
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first()
    .setInputFiles("public/anexa-mark.png");
  await expect(page.getByText("Example photo set")).toBeVisible({ timeout: 15000 });

  // Back on the job: the slot now offers the example, and holds exactly the
  // photos it held before — the example is not one of them.
  await openProductionDeal(page);
  await openFieldProduction(page);
  const example = slotRow().getByRole("button", { name: /See an example of/ }).first();
  await expect(example).toBeVisible({ timeout: 15000 });
  await expect(example.locator("img")).toHaveAttribute("src", /\/api\/photo-templates\/example\?item=/);
  expect(await slotRow().locator('img[src^="/portal/files/"]').count()).toBe(photosBefore);

  // And it opens full size, labelled as a reference rather than as evidence.
  await example.click();
  await expect(page.getByRole("dialog").getByText(/Example — Front of house/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("dialog").getByText(/not part of this job/)).toBeVisible();
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

  // Both checklists are in the rail under solar's own vocabulary, whether or not
  // a row exists yet — the bug was that neither was.
  const rail = page.getByRole("navigation", { name: "Photo checklists" });
  await expect(rail.getByRole("button", { name: /Site Survey Photos/ })).toBeVisible({
    timeout: 15000,
  });
  await expect(rail.getByRole("button", { name: /Installation Photos/ })).toBeVisible();
  // Roofing's names must not leak across the workspace boundary.
  await expect(page.getByText("Site / Inspection Photos")).toHaveCount(0);

  // A slot can be added, creating the solar template row on the way in if this
  // workspace has never had one.
  const panel = page.getByTestId("checklist-panel");
  const label = `QA Solar Slot ${Date.now() % 100000}`;
  await panel.getByRole("button", { name: "Add photo" }).click();
  await panel.getByRole("textbox", { name: /^Photo \d+ label$/ }).last().fill(label);
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/ saved$/)).toBeVisible({ timeout: 15000 });

  // The save bar goes when the panel's draft matches what the server sent back:
  // the round trip has landed, and a reload now cannot race it.
  await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });

  await page.reload();
  await expectRowValue(page, label, 15000);
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
