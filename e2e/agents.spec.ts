import { test, expect, type Page } from "@playwright/test";

/**
 * The Agents pages, as the people who use them. The runner is proven by the
 * integration tests; these prove who sees what, that Run now reaches a real
 * run row through the page, and that the queue sits where the spec puts it.
 *
 * ORDER MATTERS (workers: 1, file order). The owner test turns Priya's switch
 * on and back off, so the "no access" test runs before it; the Runs test reads
 * the run the admin test writes.
 */

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("a sales manager has no Agents item, and the page sends them away", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/dashboard");
  await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0);
  await page.goto("/portal/agents");
  await page.waitForURL("**/portal/dashboard", { timeout: 15000 });
});

test("the owner gives a manager Agents access, and the manager can then read Agents", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Priya Shah").first().click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });
  const memberUrl = page.url();

  const card = page.getByTestId("agents-access-card");
  await expect(card).toContainText("Cannot create or edit agents.");
  const toggle = card.getByRole("switch", { name: "Agents access for Priya Shah" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Priya Shah now has Agents access")).toBeVisible({ timeout: 10000 });

  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/dashboard");
  await page.getByRole("link", { name: "Agents", exact: true }).first().click();
  await page.waitForURL(/\/portal\/agents$/, { timeout: 15000 });
  await expect(page.getByRole("link", { name: "Hello Agent" })).toBeVisible();
  // Read and run, never edit: no New agent, and no on/off switch on the row.
  await expect(page.getByRole("link", { name: "New agent" })).toHaveCount(0);
  await expect(page.getByTestId("agent-enabled")).toHaveCount(0);

  // Put it back for every spec that logs in as Priya after this one.
  await login(page, "owner@anexahomes.com");
  await page.goto(memberUrl);
  await page.getByTestId("agents-access-card").getByRole("switch").click();
  await expect(page.getByText("Agents access removed from Priya Shah")).toBeVisible({ timeout: 10000 });
});
