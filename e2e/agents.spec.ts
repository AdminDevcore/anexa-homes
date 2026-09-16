import { test, expect, type Page } from "@playwright/test";

/**
 * The Agents pages, as the people who use them. The runner is proven by the
 * integration tests; these prove WHO SEES WHAT — that a plain sales manager
 * gets no sidebar item and is sent away from the page, and that the owner's
 * switch gives a manager read and run without giving them edit.
 *
 * ORDER MATTERS (workers: 1, file order): the second test grants Priya the
 * switch, so the no-access test has to run before it.
 */

const PASSWORD = "Passw0rd!";

/** The member page whose switch was turned on, for afterAll to put back. */
let grantedAt = "";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * Undo the grant HERE, not inline at the end of the test that makes it. A
 * failure part-way through would otherwise leave Priya holding Agents access,
 * and around twenty later specs log in as her — every one of them would find a
 * sidebar item it does not expect. This suite has a history of exactly that
 * kind of cross-spec contamination.
 */
test.afterAll(async ({ browser }) => {
  if (!grantedAt) return;
  const page = await browser.newPage();
  try {
    await login(page, "owner@anexahomes.com");
    await page.goto(grantedAt);
    const toggle = page.getByTestId("agents-access-card").getByRole("switch");
    if ((await toggle.getAttribute("aria-checked")) === "true") {
      await toggle.click();
      await expect(page.getByText("Agents access removed from Priya Shah")).toBeVisible({ timeout: 10000 });
    }
  } finally {
    await page.close();
  }
});

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

  const card = page.getByTestId("agents-access-card");
  await expect(card).toContainText("Cannot create or edit agents.");
  const toggle = card.getByRole("switch", { name: "Agents access for Priya Shah" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Priya Shah now has Agents access")).toBeVisible({ timeout: 10000 });
  // Only now is there something to undo.
  grantedAt = page.url();

  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/dashboard");
  await page.getByRole("link", { name: "Agents", exact: true }).first().click();
  await page.waitForURL(/\/portal\/agents$/, { timeout: 15000 });
  // `exact` so a future "Hello Agent v2" does not turn this into a
  // strict-mode violation by matching two links.
  await expect(page.getByRole("link", { name: "Hello Agent", exact: true })).toBeVisible();
  // Read and run, never edit: no New agent, and no on/off switch on the row.
  await expect(page.getByRole("link", { name: "New agent" })).toHaveCount(0);
  await expect(page.getByTestId("agent-enabled")).toHaveCount(0);
});
