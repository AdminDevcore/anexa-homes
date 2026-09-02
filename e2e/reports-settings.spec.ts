import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

// Reports used to be one page of charts here, exported from a single
// /portal/reports/export. It is a card hub now — every report is its own page
// with its own export — and `admin` no longer holds the Report resource at all.
// All three of those changes are covered by e2e/reports-hub.spec.ts, which owns
// reports outright; what is left in this file is settings.

test("admin can customize pipeline stages", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/pipeline");
  // By heading: the settings rail carries the same words on its own row. The
  // generous timeout is the dev server compiling this route on first hit.
  await expect(page.getByRole("heading", { name: "Pipeline Stages" })).toBeVisible({
    timeout: 45000,
  });
  // By heading: the rail lists every stage by name too.
  await expect(
    page.getByTestId("stage-panel").getByRole("heading", { name: "New Appointment" })
  ).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "New stage" }).click();
  const unique = `QA Stage ${Date.now() % 100000}`;
  // Scoped to the dialog: the open stage's own Name field carries the same
  // placeholder, because it is the same question.
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/Adjuster Meeting/).fill(unique);
  await dialog.getByRole("button", { name: "Add stage" }).click();
  await expect(page.getByText(`${unique} added`)).toBeVisible({ timeout: 15000 });
  // Added and opened: the panel is the stage that was just created.
  await expect(page.getByTestId("stage-panel").getByRole("heading", { name: unique })).toBeVisible({
    timeout: 10000,
  });
});

test("admin can open all settings sections", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  for (const path of [
    "/portal/settings/fields",
    "/portal/settings/branding",
    "/portal/settings/roles",
    "/portal/settings/commissions",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
  }
  await expect(page.getByRole("heading", { name: "Commission Rules" })).toBeVisible();
});

test("sales rep cannot access settings", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/settings");
  await expect(page).not.toHaveURL(/\/portal\/settings$/);
  await page.goto("/portal/settings/branding");
  await expect(page).not.toHaveURL(/\/portal\/settings\/branding/);
});
