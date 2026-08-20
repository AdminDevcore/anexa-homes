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

  // "Damage Type" is a REQUIRED custom field in the seed, so a create that
  // leaves it blank is refused with "Damage Type is required." — which this
  // spec then read as the form being broken. It is the last combobox on the
  // form, the same way appointment-form.spec.ts addresses it.
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "Hail", exact: true }).click();

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

/**
 * Open a deal and make sure it really is in production (crew / QC / photos).
 *
 * Both the "Start production" button and everything it unlocks live INSIDE the
 * Field Production slide of the job switcher, and Claim Info is the slide that
 * shows by default. So the slide has to be opened before the button can be
 * seen at all — checking `isVisible()` on the default slide always answered
 * false, which quietly made this helper a no-op and left the deal un-started.
 */
async function openProductionDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByRole("tab", { name: "Field Production" }).click();
  const start = page.getByRole("button", { name: /Start production/ });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    // The refresh re-renders the page on the default slide, so re-open it.
    await expect(page.getByText(/Job AH-/)).toBeVisible({ timeout: 15000 });
    await page.getByRole("tab", { name: "Field Production" }).click();
  }
}

test("photo upload appears on a project", async ({ page }) => {
  // Priya (manager) oversees the reps who own the production deals.
  await login(page, "manager@anexahomes.com");
  await openProductionDeal(page);

  // Scoped to the production slide. A page-wide input[type=file].first() used
  // to land here by accident, back when Documents & Files kept an
  // always-mounted upload input; now that files live in folders, this has to
  // name the section it means.
  const production = page.locator('[data-deal-slide="field"]');

  // One file input per photo-checklist slot; upload into the first.
  await production.locator('input[type="file"]').first().setInputFiles({
    name: "roof.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  // After upload + refresh, an image served from /portal/files should appear.
  await expect(production.locator('img[src^="/portal/files/"]').first()).toBeVisible({
    timeout: 15000,
  });
});

