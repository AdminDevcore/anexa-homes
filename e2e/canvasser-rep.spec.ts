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

// Cody (canvasser@) is seeded reporting to Tyler (rep@). An appointment Cody books
// must auto-assign to Tyler and show up in Tyler's pipeline.
test("a canvasser's appointment auto-assigns to their sales rep", async ({ page }) => {
  const first = "Knock";
  const last = `Lead ${Date.now() % 100000}`;
  const name = `${first} ${last}`;

  // Canvasser books an appointment.
  await login(page, "canvasser@anexahomes.com");
  await page.goto("/portal/leads/new");
  await page.locator("input").first().fill(first); // First name
  await page.locator("input").nth(1).fill(last);   // Last name
  await page.locator('input[type="datetime-local"]').fill("2026-07-20T10:00");

  // "Damage Type" is a REQUIRED custom field in the seed, so a create that
  // leaves it blank is refused. It is the last combobox on the form, the same
  // way appointment-form.spec.ts addresses it.
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "Hail", exact: true }).click();

  await page.getByRole("button", { name: "Create Appointment" }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  // The rep (Tyler) sees it among their appointments — proving it auto-assigned to them.
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/leads");
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15000 });
});

test("admin can assign a canvasser to a sales rep on the team page", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Cody Nguyen").click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });
  // The reporting card reflects the seeded assignment to Tyler.
  await expect(page.getByText("Reports to (sales rep):")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Tyler Brooks").first()).toBeVisible();
  // The editor exposes the assigned-rep picker for canvassers.
  await expect(page.getByText("Assigned sales rep (reports to)")).toBeVisible();
});
