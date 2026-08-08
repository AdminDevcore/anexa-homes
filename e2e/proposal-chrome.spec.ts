import { test, expect, type Page } from "@playwright/test";

// The proposal's sticky nav was written for the customer's own page, where the
// top of the viewport belongs to the document. Previewed inside the portal it
// kept that assumption: it pinned to y=0 on top of the CRM's header, covering
// the workspace switcher and the user menu, while the builder's own toolbar
// ("Back to builder", "Download PDF") vanished underneath the opaque header.
//
// Three bars now queue up — shell header, builder toolbar, proposal nav — and
// each one knows how much chrome is pinned above it. The same number is what
// stops a jump link from landing a chapter behind the bars.

const PASSWORD = "Passw0rd!";
const SHELL_HEADER_PX = 64;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openPreview(page: Page) {
  await page.goto("/portal/leads?q=Linda");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");
  await page.getByRole("button", { name: /5 · Preview & Share/ }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByTestId("preview-toolbar")).toBeVisible();
}

async function box(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no bounding box for ${sel}`);
  return b;
}

test("previewing in the portal stacks the top bars instead of overlapping them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "admin@anexahomes.com");
  await openPreview(page);

  // Scroll well past the cover so every sticky bar is pinned at its offset.
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(600);

  const shell = await box(page, "header.sticky.z-30");
  const toolbar = await box(page, '[data-testid="preview-toolbar"]');
  const nav = await box(page, '[data-testid="proposal-chrome"]');

  expect(shell.y, "shell header pinned at the top").toBe(0);
  expect(shell.height).toBe(SHELL_HEADER_PX);
  expect(toolbar.y, "the rep's toolbar sits below the shell header").toBeGreaterThanOrEqual(
    shell.y + shell.height - 1,
  );
  expect(nav.y, "the proposal's nav sits below the rep's toolbar").toBeGreaterThanOrEqual(
    toolbar.y + toolbar.height - 1,
  );

  // The controls that disappeared under the header are reachable while scrolled.
  await expect(page.getByRole("button", { name: "Back to builder" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeInViewport();
});

test("a jump link lands the chapter below the chrome, in the portal and in public", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "admin@anexahomes.com");
  await openPreview(page);

  const nav = page.getByTestId("proposal-chrome");
  await nav.getByRole("button", { name: "Timeline" }).click();
  await page.waitForTimeout(1000);

  let navBox = (await nav.boundingBox())!;
  let section = (await page.locator('[data-section="timeline"]').boundingBox())!;
  expect(section.y, "chapter must clear all three bars in the preview").toBeGreaterThanOrEqual(
    navBox.y + navBox.height - 2,
  );

  // On the customer's page the only chrome is the proposal's own nav, so the
  // chapter lands right under it — not shoved down by the CRM's geometry.
  // (PROPOSAL_NAV_PX has to live outside the "use client" chrome module for
  // this: imported across that boundary, a server render gets a client
  // reference instead of the number and the scroll margin collapses to 0.)
  await page.getByRole("button", { name: "Back to builder" }).click();
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  const open = page.getByRole("link", { name: "Open" });
  await expect(open).toBeVisible({ timeout: 30000 });
  const href = (await open.getAttribute("href"))!;

  await page.context().clearCookies();
  await page.goto(href);
  await expect(nav).toBeVisible();
  expect((await nav.boundingBox())!.y, "public nav owns the top of the viewport").toBe(0);

  await nav.getByRole("button", { name: "Timeline" }).click();
  await page.waitForTimeout(1000);
  navBox = (await nav.boundingBox())!;
  section = (await page.locator('[data-section="timeline"]').boundingBox())!;
  expect(section.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 2);
  expect(section.y, "and is not pushed down by chrome that isn't there").toBeLessThan(110);
});
