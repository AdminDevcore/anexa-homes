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
 * The bug: typing "Shoreline Street" offered four STREETS and no houses, because
 * the suggestions came from Nominatim and OpenStreetMap has no building on a
 * TIGER-only road. A rep had to type the house number, city, state and ZIP by
 * hand on every lead.
 *
 * These stub our own routes rather than Google's. The server-side Places calls
 * are made by Next, not the browser, so `page.route` cannot see them — and the
 * parsing and Places-vs-Nominatim routing they'd exercise are already covered by
 * unit tests. What is only testable here is the wiring: that a house-numbered
 * prediction reaches the dropdown, that picking it fills four fields at once,
 * and that the field still accepts a hand-typed address.
 */

const PREDICTIONS = {
  source: "google",
  results: [
    {
      label: "404 Shoreline Street, Plano, TX 75075, USA",
      primary: "404 Shoreline St",
      secondary: "Plano, TX 75075, USA",
      placeId: "place-404",
      parts: null,
    },
    {
      label: "408 Shoreline Street, Plano, TX 75075, USA",
      primary: "408 Shoreline St",
      secondary: "Plano, TX 75075, USA",
      placeId: "place-408",
      parts: null,
    },
  ],
};

const DETAILS: Record<string, unknown> = {
  "place-404": {
    address: "404 Shoreline St",
    city: "Plano",
    state: "TX",
    zip: "75075",
    lat: 33.0198,
    lng: -96.6989,
    formatted: "404 Shoreline St, Plano, TX 75075, USA",
    precision: "ROOFTOP",
  },
  "place-408": {
    address: "408 Shoreline St",
    city: "Plano",
    state: "TX",
    zip: "75075",
    lat: 33.0201,
    lng: -96.699,
    formatted: "408 Shoreline St, Plano, TX 75075, USA",
    precision: "ROOFTOP",
  },
};

/** Stub the suggestion routes, and count what the field actually spends. */
async function stubGeocode(page: Page) {
  const calls = { suggest: 0, details: 0, sessions: new Set<string>() };

  await page.route("**/api/geocode/autocomplete*", async (route) => {
    calls.suggest += 1;
    const session = new URL(route.request().url()).searchParams.get("session");
    if (session) calls.sessions.add(session);
    await route.fulfill({ json: PREDICTIONS });
  });

  await page.route("**/api/geocode/place*", async (route) => {
    calls.details += 1;
    const url = new URL(route.request().url());
    const session = url.searchParams.get("session");
    if (session) calls.sessions.add(session);
    await route.fulfill({ json: { place: DETAILS[url.searchParams.get("placeId") ?? ""] ?? null } });
  });

  return calls;
}

// By placeholder, not by role: the Preferred language field carries a
// `list=` datalist, which gives it an implicit combobox role too.
const addressBox = (page: Page) => page.getByPlaceholder("Start typing an address…");

test("new appointment: a house number is suggested, and picking it fills city, state and ZIP", async ({
  page,
}) => {
  await stubGeocode(page);
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");

  const address = addressBox(page);
  await expect(address).toBeVisible({ timeout: 15000 });
  await address.fill("404 Shoreline");

  // The regression this whole change exists to prevent: the top suggestion has
  // a house number on it, not just a street.
  const option = page.getByRole("option", { name: /404 Shoreline St/ });
  await expect(option).toBeVisible({ timeout: 10000 });

  await option.click();

  await expect(address).toHaveValue("404 Shoreline St");
  await expect(page.getByLabel("City")).toHaveValue("Plano");
  await expect(page.getByLabel("State")).toHaveValue("TX");
  await expect(page.getByLabel("ZIP")).toHaveValue("75075");
});

test("arrow keys move through suggestions and Enter picks the highlighted one", async ({ page }) => {
  await stubGeocode(page);
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");

  const address = addressBox(page);
  await expect(address).toBeVisible({ timeout: 15000 });
  await address.fill("404 Shoreline");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10000 });

  // Down once moves off the first row, so Enter takes the SECOND address.
  await address.press("ArrowDown");
  await address.press("Enter");

  await expect(address).toHaveValue("408 Shoreline St");
});

test("a hand-typed address is left alone — picking is never required", async ({ page }) => {
  await stubGeocode(page);
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");

  const address = addressBox(page);
  await expect(address).toBeVisible({ timeout: 15000 });
  await address.fill("77 Nowhere Lane");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10000 });

  // Dismiss the dropdown without choosing anything.
  await address.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(address).toHaveValue("77 Nowhere Lane");
  // Nothing was picked, so nothing else was filled in.
  await expect(page.getByLabel("City")).toHaveValue("");
});

test("one address costs one billing session, and the next lookup starts a new one", async ({
  page,
}) => {
  const calls = await stubGeocode(page);
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");

  const address = addressBox(page);
  await expect(address).toBeVisible({ timeout: 15000 });

  await address.fill("404 Shoreline");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10000 });
  await page.getByRole("option", { name: /404 Shoreline St/ }).click();
  await expect(address).toHaveValue("404 Shoreline St");

  const afterFirst = new Set(calls.sessions);
  expect(afterFirst.size).toBe(1);
  expect(calls.details).toBe(1);

  // A second lookup must not reuse a token the details call already closed —
  // Google would bill the new keystrokes against a settled session.
  await address.fill("408 Shoreline");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10000 });
  await expect.poll(() => calls.sessions.size).toBeGreaterThan(1);
});

test("field map: the search box offers house numbers too", async ({ page }) => {
  await stubGeocode(page);
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");

  const search = page.getByLabel("Search an address on the map");
  await expect(search).toBeVisible({ timeout: 20000 });
  await search.fill("404 Shoreline");

  await expect(page.getByRole("option", { name: /404 Shoreline St/ })).toBeVisible({
    timeout: 10000,
  });
});

/**
 * The 2026-08-24 failure, from the rep's side.
 *
 * Places API (New) had never been enabled on the Google Cloud project, so every
 * suggestion call came back 403 and the field quietly fell through to a free
 * geocoder that has no data on new-construction streets. What a rep saw was
 * "No matching address." — a sentence about the customer's house, for a problem
 * that was entirely ours. It read as a fact, so nobody reported it, and it
 * stood for sixteen days.
 *
 * The field must now be able to tell the two states apart out loud.
 */
async function stubEmptySuggestions(page: Page, degraded: string | null) {
  await page.route("**/api/geocode/autocomplete*", async (route) => {
    await route.fulfill({ json: { results: [], source: "none", degraded } });
  });
}

test("an outage says the lookup is unavailable, and never blames the address", async ({ page }) => {
  await stubEmptySuggestions(page, "Address lookup is unavailable.");
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");

  const address = addressBox(page);
  await expect(address).toBeVisible({ timeout: 15000 });
  await address.fill("23330 wise walk drive katy tx");

  await expect(page.getByText("Address lookup is unavailable")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("No matching address.")).toHaveCount(0);
  // And the rep is told to carry on, because a broken dropdown must never be a
  // reason a lead does not get written down.
  await expect(page.getByText(/type it in full and carry on/i)).toBeVisible();
});

test("a genuine miss still says so, plainly", async ({ page }) => {
  await stubEmptySuggestions(page, null);
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads/new");

  const address = addressBox(page);
  await expect(address).toBeVisible({ timeout: 15000 });
  await address.fill("zzzzqqq nonexistent street");

  // Every provider answered and none of them knew it. That IS a fact about the
  // address, and the old wording is the right one for it.
  await expect(page.getByText("No matching address.")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Address lookup is unavailable")).toHaveCount(0);
});
