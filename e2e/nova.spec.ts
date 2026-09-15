import { test, expect, type Page } from "@playwright/test";

/**
 * Nova in a real browser, against the real routes, as a sales rep.
 *
 * The model is the scripted stand-in (src/server/modules/nova/model.ts), so
 * this proves the wiring — the dock, a write waiting on Confirm, the portal's
 * own action doing the work, and the audit trail on the deal's Activity tab —
 * without a model key or a model's judgement. The stand-in refuses to run in
 * production and on Vercel. The Playwright RUNNER does not load `.env`, so:
 *
 *   SOLAR_VERTICAL_ENABLED=1 NOVA_ENABLED=1 NOVA_SCRIPTED_MODEL=1 \
 *   ANTHROPIC_API_KEY=scripted pnpm e2e nova.spec.ts
 *
 * Without OPENAI_API_KEY the dock runs by text, which is what this drives.
 */

const PASSWORD = "Passw0rd!";
const on = (k: string) => process.env[k] === "1" || process.env[k] === "true";
const ENABLED = on("SOLAR_VERTICAL_ENABLED") && on("NOVA_ENABLED") && on("NOVA_SCRIPTED_MODEL");

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 30_000 });
}

/** Set the workspace cookie the server reads, then check it took. */
async function useWorkspace(page: Page, vertical: "solar" | "roofing") {
  await page.context().addCookies([{ name: "anexa_vertical", value: vertical, url: new URL(page.url()).origin }]);
  await page.goto("/portal/dashboard");
  await expect(page.getByRole("button", { name: "Switch workspace" })).toHaveText(
    vertical === "solar" ? /Solar/ : /Roofing/,
    { timeout: 30_000 }
  );
}

async function leadIdBySearch(page: Page, q: string): Promise<string> {
  await page.goto(`/portal/leads?q=${encodeURIComponent(q)}`);
  const link = page.locator('table a[href^="/portal/leads/"]').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  return (await link.getAttribute("href"))!.split("/").pop()!;
}

async function openActivity(page: Page) {
  await page.getByTestId("deal-slides").getByRole("tab", { name: "Activity" }).click();
  const feed = page.getByTestId("solar-activity-feed");
  await expect(feed).toBeVisible({ timeout: 30_000 });
  return feed;
}

async function askNova(page: Page, text: string) {
  const panel = page.getByTestId("nova-panel");
  if (!(await panel.isVisible())) await page.getByTestId("nova-toggle").click();
  await page.locator("#nova-input").fill(text);
  await page.getByRole("button", { name: "Send to Nova" }).click();
}

test.describe(ENABLED ? "Nova" : "Nova (flags off — skipped)", () => {
  test.skip(!ENABLED, "Needs SOLAR_VERTICAL_ENABLED, NOVA_ENABLED and NOVA_SCRIPTED_MODEL.");
  test.setTimeout(240_000);

  test("a note asked of Nova waits for Confirm, then is on the deal's Activity tab, made as the rep", async ({ page, context }) => {
    await login(page, "rep@anexahomes.com");
    await useWorkspace(page, "solar");
    const dealId = await leadIdBySearch(page, "Priya Raman");
    await page.goto(`/portal/leads/${dealId}`);

    const note = `Called Priya about plan review ${Date.now()}`;
    await askNova(page, `note: ${note}`);

    const transcript = page.getByTestId("nova-transcript");
    await expect(transcript).toContainText(`Add a note to Priya Raman's deal: "${note}" Shall I go ahead?`, { timeout: 60_000 });
    const confirmBar = page.getByTestId("nova-confirm");
    await expect(confirmBar).toBeVisible();

    // Nothing is written yet: the same deal, opened fresh, has no such note.
    const fresh = await context.newPage();
    await fresh.goto(`/portal/leads/${dealId}`);
    await expect(await openActivity(fresh)).not.toContainText(note);
    await fresh.close();

    await confirmBar.getByRole("button", { name: "Confirm" }).click();
    await expect(transcript).toContainText(`Added a note to Priya Raman's deal: "${note}"`, { timeout: 60_000 });
    await expect(confirmBar).toHaveCount(0);

    await page.reload();
    const feed = await openActivity(page);
    await expect(feed).toContainText(note);
    const record = feed.getByTestId("nova-activity-item").filter({ hasText: note });
    await expect(record).toHaveCount(1);
    await expect(record).toContainText("for Tyler Brooks");
  });

  test("Cancel leaves the deal as it was", async ({ page }) => {
    await login(page, "rep@anexahomes.com");
    await useWorkspace(page, "solar");
    const dealId = await leadIdBySearch(page, "Priya Raman");
    await page.goto(`/portal/leads/${dealId}`);

    const note = `Never posted ${Date.now()}`;
    await askNova(page, `note: ${note}`);
    const confirmBar = page.getByTestId("nova-confirm");
    await expect(confirmBar).toBeVisible({ timeout: 60_000 });
    await confirmBar.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("nova-transcript")).toContainText("Okay, I won't do that.", { timeout: 60_000 });

    await page.reload();
    await expect(await openActivity(page)).not.toContainText(note);
  });

  test("Nova is offered in the Solar workspace and not in Roofing", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await useWorkspace(page, "roofing");
    await expect(page.getByTestId("nova-toggle")).toHaveCount(0);
    await useWorkspace(page, "solar");
    await expect(page.getByTestId("nova-toggle")).toBeVisible();
  });
});
