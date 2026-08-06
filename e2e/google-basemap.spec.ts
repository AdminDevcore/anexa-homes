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

/**
 * The rail's Layers section and the mobile Layers button share a name; the rail
 * one is the collapsible section header, so target it by aria-expanded.
 */
async function openRailLayers(page: Page) {
  await page.locator("button[aria-expanded]", { hasText: "Layers" }).click();
}

test("field map: Google basemaps are offered and drive the tile proxy", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15000 });

  // The manager rail carries the Layers panel inline, collapsed by default.
  await openRailLayers(page);
  await expect(page.getByRole("button", { name: "Satellite", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google Sat", exact: true })).toBeVisible();

  // Selecting Google Sat must request the HYBRID tiles — satellite imagery with
  // the roadmap layer over it, which is what labels house numbers on rooftops.
  const tileRequest = page.waitForRequest(/\/api\/map\/tiles\/hybrid\/\d+\/\d+\/\d+/, { timeout: 15000 });
  await page.getByRole("button", { name: "Google Sat", exact: true }).click();
  await tileRequest;

  // The choice survives a reload via the URL, like every other layer toggle.
  await expect(page).toHaveURL(/base=googleHybrid/);
  await page.reload();
  await openRailLayers(page);
  await expect(page.getByRole("button", { name: "Google Sat", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("map tiles: the proxy refuses anyone without canvassing access", async ({ page, request }) => {
  // Signed out: no session cookie, no tiles. Without this the route is an open,
  // unmetered Google tile proxy billed to us.
  const anon = await request.get("/api/map/tiles/hybrid/16/15038/26766");
  expect(anon.status()).toBe(401);

  // Signed in as a role with no Canvassing read, it is still refused.
  await login(page, "accounting@anexahomes.com");
  const res = await page.request.get("/api/map/tiles/hybrid/16/15038/26766");
  expect(res.status()).toBe(401);
});

test("map tiles: a bad tile type or coordinate is rejected, not proxied", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  expect((await page.request.get("/api/map/tiles/terrain/16/15038/26766")).status()).toBe(400);
  expect((await page.request.get("/api/map/tiles/hybrid/99/15038/26766")).status()).toBe(400);
  expect((await page.request.get("/api/map/tiles/hybrid/16/abc/26766")).status()).toBe(400);
});
