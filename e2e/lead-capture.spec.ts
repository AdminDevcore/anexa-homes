import { test, expect, type Page } from "@playwright/test";

/**
 * The public website lead form.
 *
 * This is top of funnel: if it silently fails, every inbound enquiry is lost and
 * nothing anywhere reports a problem. It did exactly that for months — a stray
 * `required` on the optional "preferred date" field made the browser swallow the
 * submit event before React ever saw it, so there was no POST, no error, and no
 * lead. These tests assert the whole path end to end, including that a lead row
 * actually exists afterwards, because "the form said thank you" is not proof.
 */

const PASSWORD = "Passw0rd!";
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

async function submitEnquiry(page: Page, service: string | null, lastName: string) {
  await page.goto(service ? `/contact?service=${service}` : "/contact");
  await page.fill('input[name="firstName"]', "E2E");
  await page.fill('input[name="lastName"]', lastName);
  await page.fill('input[name="email"]', `${lastName}@example.com`);
  await page.fill('input[name="phone"]', "(555) 010-2030");
  await page.fill('input[name="address"]', "500 Test Ave");
  await page.fill('input[name="city"]', "Dallas");
  await page.fill('input[name="zip"]', "75201");
  await page.getByRole("button", { name: /Request Free Inspection|Start Claim Support|Request/ }).first().click();
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
  await submitEnquiry(page, null, `e2e${Date.now() % 100000}`);
  await post; // a request actually left the browser
  await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });
});

test("a website enquiry actually creates a lead in the CRM", async ({ page }) => {
  const last = `web${Date.now() % 100000}`;
  await submitEnquiry(page, "roofing", last);
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
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(tomorrow);
  await page.getByRole("button", { name: /Request/ }).first().click();
  await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });
});

test.describe("vertical routing", () => {
  test.skip(!FLAG_ON, "solar routing only applies when the vertical is enabled");

  test("a solar enquiry lands in Solar, not Roofing", async ({ page }) => {
    const last = `solarweb${Date.now() % 100000}`;
    await submitEnquiry(page, "solar", last);
    await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });

    await login(page, "admin@anexahomes.com");

    // Not in Roofing…
    await page.goto(`/portal/leads?q=${last}`);
    await expect(page.getByRole("cell", { name: new RegExp(last) })).toHaveCount(0);

    // …but in Solar.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Solar" }).click();
    await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
    await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });

    await page.goto(`/portal/leads?q=${last}`);
    await expect(page.getByRole("cell", { name: new RegExp(last) }).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("a roofing enquiry still lands in Roofing", async ({ page }) => {
    const last = `roofweb${Date.now() % 100000}`;
    await submitEnquiry(page, "roofing", last);
    await expect(page.getByText("Thank you!")).toBeVisible({ timeout: 15000 });

    await login(page, "admin@anexahomes.com");
    await page.goto(`/portal/leads?q=${last}`);
    await expect(page.getByRole("cell", { name: new RegExp(last) }).first()).toBeVisible({
      timeout: 15000,
    });
  });
});
