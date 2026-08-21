import { test, expect, type Page } from "@playwright/test";

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

test("admin can add a lead source and keep typing the next one", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/lead-sources");
  await expect(page.getByRole("heading", { name: "Lead Sources" })).toBeVisible();

  const field = page.getByPlaceholder(/New source/);
  const unique = `QA Source ${Date.now() % 100000}`;
  await field.fill(unique);
  await page.getByRole("button", { name: /Add source/ }).click();

  await expect(page.getByText(unique, { exact: true })).toBeVisible({ timeout: 10000 });
  // This is a rapid-entry list: the field must come back empty, editable and
  // still focused so the next source can be typed straight in.
  await expect(field).toHaveValue("");
  await expect(field).toBeEnabled();
  await expect(field).toBeFocused();
});

test("the add field survives a server action that fails outright", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/lead-sources");
  await expect(page.getByRole("heading", { name: "Lead Sources" })).toBeVisible();

  const field = page.getByPlaceholder(/New source/);
  const addButton = page.getByRole("button", { name: /Add source/ });

  // A dropped connection, a restarted dev server or an expired session makes the
  // action *throw* rather than return { ok: false }. The panel used to latch into
  // its saving state forever, leaving every control — including this field —
  // permanently disabled until a full page reload.
  await page.route(PAGE_URL, (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue()
  );

  await field.fill("Doomed Source");
  await addButton.click();

  await expect(field).toBeEnabled({ timeout: 10000 });
  await expect(addButton).toBeEnabled();

  // And the panel still works once the connection comes back.
  await page.unroute(PAGE_URL);
  const unique = `QA Recovered ${Date.now() % 100000}`;
  await field.fill(unique);
  await addButton.click();
  await expect(page.getByText(unique, { exact: true })).toBeVisible({ timeout: 10000 });
});
