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

/**
 * The agent page itself. These log in as the admin and the accounting user, so
 * they neither depend on nor disturb the grant the test above makes — but they
 * stay AFTER it, because the afterAll that puts Priya back is written for the
 * file as a whole.
 */

test("an admin runs the disabled Hello Agent, after confirming, and reads the run", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents");
  await page.getByRole("link", { name: "Hello Agent" }).click();
  await page.waitForURL(/\/portal\/agents\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Hello Agent", level: 1 })).toBeVisible();

  await page.getByTestId("agent-run-now").click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Run a disabled agent?");
  await confirm.getByRole("button", { name: "Run anyway" }).click();

  // The run is written queued and finishes inside after(). The page refreshes
  // itself while anything is in flight; a reload is the fallback.
  const done = page.getByTestId("agent-run").filter({ hasText: "Said hello" }).first();
  await expect(async () => {
    if (!(await done.isVisible())) await page.reload();
    await expect(done).toHaveAttribute("data-status", "success", { timeout: 2000 });
  }).toPass({ timeout: 45000 });

  await done.getByRole("button", { name: /Said hello/ }).click();
  const detail = done.getByTestId("agent-run-detail");
  await expect(detail).toContainText('"greeting": "hello"');
  await expect(detail).toContainText("Run now by Dana Hill");
});

test("an admin creates an agent — and a secret in its config is refused", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents");
  await page.getByRole("link", { name: "New agent" }).click();
  await page.waitForURL("**/portal/agents/new", { timeout: 15000 });

  await page.getByLabel("Name", { exact: true }).fill("E2E Poller");
  await page.getByRole("combobox", { name: "Schedule" }).click();
  await page.getByRole("option", { name: "Every 15 minutes" }).click();
  await expect(page.getByTestId("agent-upcoming-runs")).toBeVisible();

  await page.getByLabel("Config (JSON)", { exact: true }).fill('{"password":"hunter2"}');
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/config\.password looks like a secret/)).toBeVisible({ timeout: 10000 });

  await page.getByLabel("Config (JSON)", { exact: true }).fill("{}");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.waitForURL(/\/portal\/agents\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "E2E Poller", level: 1 })).toBeVisible();
});

test("accounting reads an agent and its config, with no Run now and nothing to edit", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");
  await page.goto("/portal/agents");
  await page.getByRole("link", { name: "Hello Agent" }).click();
  await page.waitForURL(/\/portal\/agents\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByTestId("agent-config-readonly")).toContainText("system.hello");
  await expect(page.getByTestId("agent-run-now")).toHaveCount(0);
  await expect(page.getByTestId("agent-enabled")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save changes|Create agent/ })).toHaveCount(0);

  await page.goto("/portal/agents/new");
  await page.waitForURL(/\/portal\/agents$/, { timeout: 15000 });
});

/**
 * The Runs page. Navigates only — it grants nothing and changes nothing, so it
 * needs no restore of its own, and it logs in as the admin rather than Priya.
 * It DOES read the success run the admin test above wrote, so run the file.
 */

test("Runs puts Needs a human first, and the status filter narrows the feed", async ({ page }) => {
  // Reads the success run the admin test above wrote: run the whole file.
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents/runs");

  const needs = page.getByRole("heading", { name: /Needs a human/ });
  const all = page.getByRole("heading", { name: "All runs" });
  await expect(needs).toBeVisible();
  await expect(all).toBeVisible();
  expect((await needs.boundingBox())!.y).toBeLessThan((await all.boundingBox())!.y);

  const status = page.getByRole("group", { name: "Status" });
  await status.getByRole("link", { name: "Success", exact: true }).click();
  await expect(page).toHaveURL(/[?&]status=success/);
  await expect(status.getByRole("link", { name: "Success", exact: true })).toHaveAttribute("aria-current", "true");
  const rows = page.getByTestId("agent-run");
  await expect(rows.first()).toBeVisible();
  expect(new Set(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-status"))))).toEqual(new Set(["success"]));

  await status.getByRole("link", { name: "Failed", exact: true }).click();
  await expect(page).toHaveURL(/[?&]status=failed/);
  await expect(page.getByText("No runs match these filters.")).toBeVisible();
});
