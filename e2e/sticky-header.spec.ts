import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** Distance from the top of the screen to the top of the portal's top bar. */
function headerTop(page: Page) {
  return page.evaluate(
    () => document.querySelector("header")!.getBoundingClientRect().top
  );
}

/**
 * Opening any Radix overlay (Select, Dialog, Sheet, modal menu) puts
 * `overflow: hidden` on <body> to lock scrolling. That must not cost us the
 * top bar. It did: while <html> also carried an `overflow-x`, <body> stopped
 * propagating its overflow to the viewport and became a scroll container in
 * its own right, so the sticky header started sticking to the top of the
 * *document* instead of the top of the *screen* — it vanished upward for
 * exactly as long as the menu stayed open, then came back when it closed.
 */
test("portal top bar stays on screen while a select is open", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/leads/new");

  const source = page.getByRole("combobox").filter({ hasText: "Select source" });
  await expect(source).toBeVisible();

  // Scroll far enough that the header is actually stuck rather than merely
  // sitting at the top of an unscrolled page — otherwise the assertion passes
  // for the wrong reason. "instant" defeats the global `scroll-behavior:
  // smooth`, which would otherwise still be animating when we measure.
  await page.evaluate(() =>
    window.scrollTo({ top: 600, behavior: "instant" as ScrollBehavior })
  );
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await headerTop(page)).toBeCloseTo(0, 0);

  await source.click();
  await expect(page.getByRole("option").first()).toBeVisible();

  // The whole point: still pinned to the top of the screen, not scrolled away.
  expect(await headerTop(page)).toBeCloseTo(0, 0);

  // ...and the scroll lock the overlay came for still holds.
  await page.evaluate(() => window.scrollBy(0, 300));
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(600, 0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  expect(await headerTop(page)).toBeCloseTo(0, 0);

  // The clip rule earns its keep by keeping a horizontal gutter off the page.
  // Moving it must not have given that up.
  const overflowsSideways = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
  expect(overflowsSideways).toBe(false);

  await page.context().clearCookies();
});
