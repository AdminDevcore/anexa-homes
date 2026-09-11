import { test, expect, type Page } from "@playwright/test";

/**
 * Row scoping, asserted by people who are not admins.
 *
 * WHY THIS FILE EXISTS. Almost every other spec signs in as admin@, and an
 * admin's `listScope` is `{ companyId }` — no row narrowing whatsoever. So the
 * entire suite could stay green while every row-scope gate in the product was
 * deleted. These tests are the only ones that would go red, which makes them
 * the only ones covering the class of bug this codebase has repeatedly shipped:
 * an action that asks "may you edit deals?" and never "may you edit THIS one?".
 *
 * HOW TO RUN. The solar block below needs the flag, and the Playwright RUNNER
 * does not load `.env` — only the app under test does. So a plain `pnpm e2e`
 * silently skips it (along with ~84 other solar tests across 20 spec files):
 *
 *   SOLAR_VERTICAL_ENABLED=1 pnpm e2e row-scope.spec.ts
 *
 * The seed fixtures are documented in prisma/seed.ts under ROW-SCOPE FIXTURES.
 * Every seeded lead belongs to Tyler (rep@) except Marisol Vega, who belongs to
 * Dylan (rep2@), so the boundary is checked in both directions rather than only
 * outward from one rep.
 */

const PASSWORD = "Passw0rd!";
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** The id of a deal, found by search as somebody who can see everything. */
async function leadIdBySearch(page: Page, q: string): Promise<string> {
  await page.goto(`/portal/leads?q=${encodeURIComponent(q)}`);
  const link = page.locator('table a[href^="/portal/leads/"]').first();
  await expect(link).toBeVisible({ timeout: 15000 });
  const href = await link.getAttribute("href");
  return href!.split("/").pop()!;
}

/**
 * WHY THIS DOES NOT ASSERT A 404 STATUS, AND WHY IT ACCEPTS TWO SHAPES.
 *
 * A refused deal renders one of two ways, and which one you get is Next's
 * business, not the product's:
 *
 *   1. The portal shell with a COMPLETELY EMPTY `<main>` — sidebar, header,
 *      your initials, and nothing else. `notFound()` fired inside the page
 *      segment after the layout had already streamed, so the 200 was sent long
 *      before anything was refused and the status cannot change.
 *   2. A bare Next 404 page with no portal chrome and no `<main>` at all.
 *
 * Shape 1 is a real product wart — a blank screen where a 404 belongs, with no
 * "not found" message of any kind — and worth fixing on its own. Neither shape
 * is a security hole, and pinning the test to either one would make it fail on
 * a rendering detail while proving nothing about access.
 *
 * So the assertion is the property both shapes share: NOTHING of the deal is on
 * the page. `main` empty-or-absent catches the body; the name check catches a
 * page that renders the customer somewhere outside it; and the login check
 * stops the whole thing passing vacuously because the session was dropped and
 * every assertion became trivially true.
 */
async function expectDealHidden(page: Page, url: string, customerName: string) {
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");

  expect(page.url(), `${url} bounced to the login page — this proves nothing`).not.toContain(
    "/login"
  );

  const main = page.locator("main");
  const body = (await main.count()) ? ((await main.innerText()) || "").trim() : "";
  expect(body, `${url} rendered deal content`).toBe("");

  await expect(
    page.getByText(customerName),
    `${url} must not name the customer`
  ).toHaveCount(0);
}

/**
 * Put this session in the solar workspace.
 *
 * NOT by clicking the switcher. That was the first version and it silently did
 * nothing: the menu click raced, `waitForURL(/dashboard/)` matched the page we
 * were already on, and the test went on to search ROOFING and find no solar
 * deal — a green-looking path that proved nothing. The cookie is what the
 * server actually reads (`getActiveVertical`), so set it and then CHECK it,
 * because a workspace that quietly falls back to roofing is precisely how this
 * test would stop testing anything.
 */
async function useSolarWorkspace(page: Page) {
  await page.context().addCookies([
    { name: "anexa_vertical", value: "solar", url: new URL(page.url()).origin },
  ]);
  await page.goto("/portal/dashboard");
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
    "the solar workspace must actually be active, or this test reads roofing"
  ).toHaveText(/Solar/);
}

test.describe("a rep cannot reach another rep's deal", () => {
  test("rep B cannot see rep A's deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const tylersLead = await leadIdBySearch(page, "Robert Johnson");

    // Tyler can open his own deal — proves the id is good, so the refusal
    // below is about WHO is asking and not about a broken URL.
    await login(page, "rep@anexahomes.com");
    const ok = await page.goto(`/portal/leads/${tylersLead}`);
    expect(ok?.status()).toBe(200);

    await login(page, "rep2@anexahomes.com");
    await expectDealHidden(page, `/portal/leads/${tylersLead}`, "Robert Johnson");
  });

  test("rep A cannot see rep B's deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const dylansLead = await leadIdBySearch(page, "Marisol Vega");

    await login(page, "rep2@anexahomes.com");
    const ok = await page.goto(`/portal/leads/${dylansLead}`);
    expect(ok?.status()).toBe(200);

    await login(page, "rep@anexahomes.com");
    await expectDealHidden(page, `/portal/leads/${dylansLead}`, "Marisol Vega");
  });

  test("a canvasser cannot see their own rep's deal", async ({ page }) => {
    // Cody reports to Tyler, which routes Cody's appointments to him. It does
    // not work in reverse: a canvasser sees deals they own or created, and
    // Robert Johnson is neither.
    await login(page, "admin@anexahomes.com");
    const tylersLead = await leadIdBySearch(page, "Robert Johnson");

    await login(page, "canvasser@anexahomes.com");
    await expectDealHidden(page, `/portal/leads/${tylersLead}`, "Robert Johnson");
  });
});

test.describe(FLAG_ON ? "the solar builder is scoped like the deal page" : "solar builder scope (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  /**
   * The bug this covers, exactly: /portal/leads/<id> correctly refused a rep
   * who did not own the deal, while the three solar routes underneath fetched on
   * `{ id, companyId }` and rendered the customer's name, address and price
   * ladder to the same person. Four URLs, one boundary.
   */
  test("rep B is shut out of every solar route under rep A's deal", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await useSolarWorkspace(page);
    const solarLead = await leadIdBySearch(page, "Priya Raman");

    await login(page, "rep2@anexahomes.com");
    await useSolarWorkspace(page);

    for (const path of ["", "/solar-proposal", "/solar-proposal/design", "/solar-proposal/preview"]) {
      await expectDealHidden(page, `/portal/leads/${solarLead}${path}`, "Priya Raman");
    }
  });
});

test("an installer reaches the job and not the deal", async ({ page }) => {
  // Carlos is named on Marisol Vega's INSTALL VISIT and is on no crew assigned
  // to it. Being on Tuesday's install says where to be; it does not say "read
  // this homeowner's contract".
  await login(page, "admin@anexahomes.com");
  const dealId = await leadIdBySearch(page, "Marisol Vega");

  await login(page, "installer@anexahomes.com");
  await page.goto("/portal/jobs");
  const job = page.locator('a[href^="/portal/jobs/"]').first();
  await expect(job, "the installer should see the job they are assigned to").toBeVisible({
    timeout: 15000,
  });
  const jobUrl = await job.getAttribute("href");

  const onTheJob = await page.goto(jobUrl!);
  expect(onTheJob?.status(), "the job itself is reachable").toBe(200);

  await expectDealHidden(page, `/portal/leads/${dealId}`, "Marisol Vega");
});

/**
 * Downloads are gated on the `export` verb, which a canvasser does not hold on
 * anything. Asserted as status codes through the browser's own session rather
 * than by looking for a hidden button: hiding the control is a courtesy, the
 * route refusing is the control.
 */
test.describe("a canvasser cannot export", () => {
  const ROUTES = [
    "/portal/canvassing/export",
    "/portal/storm-intelligence/export",
    "/portal/storm-intelligence/pdf",
    "/portal/bookkeeping/export",
    "/portal/bookkeeping/1099/export",
    "/portal/contractor-pay/payouts/export",
    "/portal/reports/operations/export",
    "/api/bookkeeping/pnl",
    "/api/bookkeeping/balance-sheet",
    "/api/bookkeeping/reconciliation",
  ];

  test("every export route answers 403", async ({ page }) => {
    await login(page, "canvasser@anexahomes.com");
    for (const route of ROUTES) {
      const res = await page.request.get(route);
      expect(res.status(), `${route} should refuse a canvasser`).toBe(403);
    }
  });

  test("and the same route serves an admin, so the 403s mean something", async ({ page }) => {
    // Without this control the test above would pass just as happily against a
    // broken login or a route that 403s everybody.
    await login(page, "admin@anexahomes.com");
    const res = await page.request.get("/portal/canvassing/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });
});
