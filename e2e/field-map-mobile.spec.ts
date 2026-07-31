import { test, expect, type Page } from "@playwright/test";

// The redesign targets a rep on a phone, so these run at phone size with touch.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function settledMap(page: Page) {
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });
  await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 20000 });
  const loader = page.getByText(/Loading (houses|pins)…/);
  for (let t = 0; t < 30; t++) {
    if (!(await loader.isVisible().catch(() => false))) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000);
}

test("field map: rep logs a knock in two taps", async ({ page }) => {
  test.setTimeout(120000);
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await settledMap(page);

  // Tap 1 — a house dot opens the bottom sheet with big disposition buttons.
  const pins = page.locator(".anexa-knock-pin");
  await expect(pins.first()).toBeVisible({ timeout: 10000 });
  const notHome = page.getByRole("button", { name: "Not Home" });
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    const n = await pins.count();
    for (let i = 0; i < n; i++) {
      const bb = await pins.nth(i).boundingBox().catch(() => null);
      if (!bb) continue;
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(350);
      if (await notHome.isVisible().catch(() => false)) {
        opened = true;
        break;
      }
    }
    if (!opened) await page.waitForTimeout(1000);
  }
  expect(opened).toBe(true);

  // Tap 2 — one disposition button logs it and the sheet closes.
  await notHome.click();
  await expect(page.getByText("Knock updated")).toBeVisible({ timeout: 10000 });
  await expect(notHome).toBeHidden({ timeout: 10000 });
});

test("field map: the map is not pushed below the fold", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible({ timeout: 10000 });
  const box = (await map.boundingBox())!;
  // The map starts near the top of the viewport and owns most of the screen.
  expect(box.y).toBeLessThan(120);
  expect(box.height).toBeGreaterThan(500);
});

test("field map: filters survive a reload via the URL", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("button", { name: "Remaining only" }).click();
  await expect(page).toHaveURL(/remaining=1/, { timeout: 10000 });

  await page.reload();
  await expect(page).toHaveURL(/remaining=1/);
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("button", { name: "Remaining only" })).toHaveAttribute("aria-pressed", "true");
});

test("field map: reps do not get manager tooling", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Draw territory/ })).toHaveCount(0);
  // ZIP codes is a manager layer — it must not even appear in the rep's sheet.
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.getByRole("button", { name: "ZIP codes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hail" })).toBeVisible();
});
