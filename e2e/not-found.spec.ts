import { test, expect, type Page } from "@playwright/test";

/**
 * A page nobody may see answers 404, and says so.
 *
 * THE BUG. `src/app/portal/loading.tsx` put a Suspense boundary above every
 * route in the portal. A boundary means the shell — sidebar, header, the
 * signed-in user's initials — is flushed to the browser as soon as the page
 * segment suspends, and the HTTP status goes out with it. `notFound()` then
 * threw far too late to change a status that had already been sent, so all 15
 * portal routes that call it answered 200 with the chrome wrapped around a
 * COMPLETELY EMPTY <main>: no record, no message, nothing to click. It read as
 * a broken page rather than a refusal, and the access control underneath was
 * working perfectly the whole time.
 *
 * The status is the assertion here, not the appearance, because the status is
 * what a boundary silently takes away — and because 404 is the only answer that
 * does not distinguish "no such deal" from "somebody else's deal". A rep who
 * guesses an id learns nothing either way.
 */

const PASSWORD = "Passw0rd!";
const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 30000 });
}

async function dealIdOf(page: Page, q: string): Promise<string> {
  await page.goto(`/portal/leads?q=${encodeURIComponent(q)}`);
  const link = page.locator('table a[href^="/portal/leads/"]').first();
  await expect(link).toBeVisible({ timeout: 30000 });
  return (await link.getAttribute("href"))!.split("/").pop()!;
}

test("a deal the viewer may not see answers 404, not a blank page", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  const dealId = await dealIdOf(page, "Robert Johnson");

  // The control: the same URL, for somebody who may open it. Without this a
  // 404 everywhere would look like a pass.
  const allowed = await page.goto(`/portal/leads/${dealId}`);
  expect(allowed?.status(), "an admin can open the deal").toBe(200);
  await expect(page.getByText("Robert Johnson").first()).toBeVisible();

  // Cody is a canvasser: the deal is neither his nor one he created, so
  // listScope excludes it. The refusal must be a refusal, with a status.
  await login(page, "canvasser@anexahomes.com");
  const refused = await page.goto(`/portal/leads/${dealId}`);
  expect(refused?.status(), "an out-of-scope deal must answer 404").toBe(404);

  // Not a bare 404 document: the refusal renders INSIDE the portal, so the rep
  // keeps their sidebar and a way out. The original complaint was chrome
  // wrapped around nothing — the chrome was never the problem, the empty
  // middle was.
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /back to dashboard/i })).toBeVisible();
  await expect(page.locator("main"), "the refusal must not be a blank main").not.toBeEmpty();

  // And it must not say WHICH kind of nothing it is. "No such deal" and
  // "somebody else's deal" have to read identically or the message itself
  // tells a rep who guesses ids which ones are real.
  await expect(page.getByText(/Robert Johnson/)).toHaveCount(0);
});

test("a mistyped deal id answers 404, not a blank page", async ({ page }) => {
  await login(page, "admin@anexahomes.com");

  // Well-formed but nonexistent, and outright malformed: the second is worth
  // its own case because it takes a different path — nothing in the database
  // can match it, and a lookup that throws instead of returning null would
  // surface as a 500 rather than a 404.
  for (const id of [NO_SUCH_ID, "not-a-uuid"]) {
    const res = await page.goto(`/portal/leads/${id}`);
    expect(res?.status(), `/portal/leads/${id} must answer 404`).toBe(404);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
  }
});

test("the same holds for the other detail routes that refuse by id", async ({ page }) => {
  // One ancestor boundary broke all of these at once, so one of them going
  // green proves nothing about the rest.
  await login(page, "admin@anexahomes.com");
  for (const path of [
    `/portal/jobs/${NO_SUCH_ID}`,
    `/portal/projects/${NO_SUCH_ID}`,
    `/portal/team/${NO_SUCH_ID}`,
    `/portal/documents/${NO_SUCH_ID}`,
    `/portal/payroll/${NO_SUCH_ID}`,
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} must answer 404`).toBe(404);
  }
});
