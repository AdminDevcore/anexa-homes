import { test, expect, type Page } from "@playwright/test";
import { expectRowValue } from "./list-value";

const PASSWORD = "Passw0rd!";
// Server actions POST back to the page's own URL, so this pattern matches both
// the document load and the action call — the handlers below tell them apart by
// HTTP method.
const PAGE_URL = "**/portal/settings/lead-sources";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * The list is a DRAFT with one Save, like every other settings screen.
 *
 * Adding a source puts a row on the screen; nothing is written until "Save
 * changes". These specs hold both halves — that a burst of names can be typed
 * without waiting for a round trip each time, and that the Save is what
 * persists them.
 */
test("admin can add a lead source and keep typing the next one", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/lead-sources");
  await expect(page.getByRole("heading", { name: "Lead Sources" })).toBeVisible();

  const field = page.getByPlaceholder("e.g. Facebook Ads");
  const unique = `QA Source ${Date.now() % 100000}`;
  await field.fill(unique);
  await page.getByRole("button", { name: "Add source" }).click();

  // On the screen as an editable row, not yet in the database.
  await expectRowValue(page, unique, 10000);

  // This is a rapid-entry list: the field comes back empty, editable and still
  // focused so the next source can be typed straight in.
  await expect(field).toHaveValue("");
  await expect(field).toBeEnabled();
  await expect(field).toBeFocused();

  // And the Save is what writes it.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Lead sources saved")).toBeVisible({ timeout: 15000 });
  // The save bar goes when the panel's draft matches what the server sent back:
  // the round trip has landed, and a reload now cannot race it.
  await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });
  await page.reload();
  await expectRowValue(page, unique, 10000);
});

test("the screen survives a server action that fails outright", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/lead-sources");
  await expect(page.getByRole("heading", { name: "Lead Sources" })).toBeVisible();

  const field = page.getByPlaceholder("e.g. Facebook Ads");
  await field.fill("Doomed Source");
  await page.getByRole("button", { name: "Add source" }).click();

  // A dropped connection, a restarted dev server or an expired session makes the
  // action *throw* rather than return { ok: false }. The panel used to latch into
  // its saving state forever, leaving every control permanently disabled until a
  // full page reload.
  await page.route(PAGE_URL, (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue()
  );

  const save = page.getByRole("button", { name: "Save changes" });
  await save.click();

  await expect(field).toBeEnabled({ timeout: 10000 });
  await expect(save).toBeEnabled();

  // And it still works once the connection comes back.
  await page.unroute(PAGE_URL);
  await save.click();
  await expect(page.getByText("Lead sources saved")).toBeVisible({ timeout: 15000 });
});
