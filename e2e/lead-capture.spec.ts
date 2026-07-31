import { test, expect, type Page } from "@playwright/test";

/**
 * The public website lead form.
 *
 * This is top of funnel: if it silently fails, every inbound enquiry is lost and
 * nothing anywhere reports a problem. It did exactly that — a stray `required`
 * on the OPTIONAL "preferred date" field made the browser refuse to dispatch the
 * submit event, so react-hook-form never ran, no error rendered, no request left
 * the browser, and no lead was created. The visitor clicked and nothing happened.
 *
 * These tests assert the whole path, including that a lead row actually exists
 * afterwards — "the form said thank you" is not proof that anything was saved.
 */

const PASSWORD = "Passw0rd!";

async function submitEnquiry(page: Page, lastName: string) {
  await page.goto("/contact");
  await page.fill('input[name="firstName"]', "E2E");
  await page.fill('input[name="lastName"]', lastName);
  await page.fill('input[name="email"]', `${lastName}@example.com`);
  await page.fill('input[name="phone"]', "(555) 010-2030");
  await page.fill('input[name="address"]', "500 Test Ave");
  await page.fill('input[name="city"]', "Dallas");
  await page.fill('input[name="zip"]', "75201");
  await page
    .getByRole("button", { name: /Request Free Inspection|Start Claim Support|Request/ })
    .first()
    .click();
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("website inspection request submits and confirms", async ({ page }) => {
  // Deliberately does NOT touch the optional date/time fields — leaving them
  // blank is the exact case that used to be unsubmittable.
  const post = page.waitForRequest((r) => r.method() === "POST", { timeout: 15000 });
  await submitEnquiry(page, `e2e${Date.now() % 100000}`);
  await post; // a request actually left the browser
  await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });
});

test("a website enquiry actually creates a lead in the CRM", async ({ page }) => {
  const last = `web${Date.now() % 100000}`;
  await submitEnquiry(page, last);
  await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });

  // The real assertion: it exists in the CRM, not just that the UI said so.
  await login(page, "admin@anexahomes.com");
  await page.goto(`/portal/leads?q=${last}`);
  await expect(page.getByRole("cell", { name: new RegExp(last) }).first()).toBeVisible({
    timeout: 15000,
  });
});

test("filling the optional date still works", async ({ page }) => {
  // The field is legitimately usable — the bug was that it was mandatory, not
  // that it existed.
  const last = `dated${Date.now() % 100000}`;
  await page.goto("/contact");
  await page.fill('input[name="firstName"]', "E2E");
  await page.fill('input[name="lastName"]', last);
  await page.fill('input[name="email"]', `${last}@example.com`);
  await page.fill('input[name="phone"]', "(555) 010-2030");
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(soon);
  await page.getByRole("button", { name: /Request/ }).first().click();
  await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });
});
