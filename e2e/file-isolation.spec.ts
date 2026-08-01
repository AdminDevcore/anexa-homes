import { test, expect, type Page } from "@playwright/test";

/**
 * Deal-attached files must not cross the vertical boundary — including for
 * admins.
 *
 * FileAsset is deliberately NOT a SCOPED model: the same table holds
 * company-level assets (the branding logo, bookkeeping receipts) that belong to
 * no workspace. Deal files are isolated through their PARENT instead.
 *
 * The leak this covers: non-admin staff were already safe, because their check
 * runs through the scoped `prisma.lead`/`prisma.project`. Admins skipped that
 * branch entirely, so an admin sitting in Roofing could fetch a Solar deal's
 * file by replaying its id — no UI needed, just the URL.
 *
 * Flag off there is one workspace and nothing to cross, so these skip.
 *
 *   SOLAR_VERTICAL_ENABLED=1 pnpm e2e file-isolation.spec.ts
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function switchTo(page: Page, workspace: "Roofing" | "Solar") {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: workspace }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(new RegExp(`· ${workspace} workspace`))).toBeVisible({
    timeout: 15000,
  });
}

/** Upload a photo to the first deal in the current workspace; return its file id. */
async function uploadToFirstDeal(page: Page): Promise<string | null> {
  await page.goto("/portal/leads");
  const firstDeal = page.locator('table a[href^="/portal/leads/"]').first();
  if ((await firstDeal.count()) === 0) return null;
  await firstDeal.click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  const input = page.locator('input[type="file"]').first();
  if ((await input.count()) === 0) return null;
  await input.setInputFiles({
    name: "iso-probe.png",
    mimeType: "image/png",
    // 1x1 PNG.
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });

  // The uploaded file is served from /portal/files/<id> — read the id back out
  // of the rendered markup rather than guessing it.
  //
  // Waits on COUNT, not visibility: the thumbnail is often inside a collapsed
  // section, so it is present in the DOM but hidden. Its id is what we need,
  // and requiring visibility just makes the test fail for the wrong reason.
  const link = page.locator('[src*="/portal/files/"], [href*="/portal/files/"]').first();
  await expect
    .poll(async () => await link.count(), { timeout: 20000 })
    .toBeGreaterThan(0);
  const attr =
    (await link.getAttribute("src")) ?? (await link.getAttribute("href")) ?? "";
  return attr.match(/\/portal\/files\/([0-9a-f-]+)/)?.[1] ?? null;
}

test.describe("file isolation", () => {
  test.skip(!FLAG_ON, "needs SOLAR_VERTICAL_ENABLED=1 — one workspace has no boundary to cross");

  test("an admin in Roofing cannot fetch a Solar deal's file by id", async ({ page }) => {
    await login(page, "admin@anexahomes.com");

    await switchTo(page, "Solar");
    const solarFileId = await uploadToFirstDeal(page);
    test.skip(!solarFileId, "no solar deal available to attach a file to");

    // Same admin, same session — only the workspace changes.
    await switchTo(page, "Roofing");
    const res = await page.request.get(`/portal/files/${solarFileId}`);

    // 404, not 403: the file must not even be acknowledged to exist over there.
    expect(res.status()).toBe(404);
  });

  test("the same admin CAN fetch it from the Solar workspace", async ({ page }) => {
    // The negative test above is only meaningful if the positive one holds —
    // otherwise a broken upload would make it pass for the wrong reason.
    await login(page, "admin@anexahomes.com");

    await switchTo(page, "Solar");
    const solarFileId = await uploadToFirstDeal(page);
    test.skip(!solarFileId, "no solar deal available to attach a file to");

    const res = await page.request.get(`/portal/files/${solarFileId}`);
    expect(res.status()).toBe(200);
  });

  // NOTE on company-level assets (the branding logo, bookkeeping receipts):
  // they stay shared because the fix is deliberately scoped to files that have
  // a leadId/projectId. Nothing else in the FileAsset table is touched, and
  // `/api/branding/logo` resolves by companyId with no session at all. That
  // property is already covered by branding-isolation.spec.ts, so it is not
  // re-asserted here — a duplicate that only ever returned 400 (the route
  // requires a ?company= param) would have looked like coverage without being
  // any.
});
