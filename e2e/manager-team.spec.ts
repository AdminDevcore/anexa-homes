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

// Seed: Priya (manager@) manages Tyler & Dylan; all sample leads are assigned to
// Tyler. Sofia (pm@) is a manager with NO reps. Robert Johnson is Tyler's deal.
test("a manager sees their team's deals but another manager does not", async ({ page }) => {
  // Priya manages Tyler → sees Tyler's deal (Robert Johnson).
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/leads");
  await expect(page.getByText("Robert Johnson").first()).toBeVisible({ timeout: 15000 });

  // Sofia (manager, no reps) → does NOT see Tyler's deals.
  await login(page, "pm@anexahomes.com");
  await page.goto("/portal/leads");
  await expect(page.getByText("Robert Johnson")).toHaveCount(0, { timeout: 15000 });
});

test("a manager's team list shows only their reps", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/team");
  // Tyler reports to Priya → shown. Wendy (accounting) is outside her team → hidden.
  await expect(page.getByText("Tyler Brooks").first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Wendy Carter")).toHaveCount(0);
});

test("admin can assign a rep to a sales manager", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Tyler Brooks").click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByText("Reports to (sales manager):")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Sales manager (reports to)")).toBeVisible();
});

// A team is a manager plus their reps, and the name is the only part of it a
// person types. These cover the whole path that name takes: onto the manager,
// down onto their reps' roster rows, and into the leaderboard's team view.
test("naming a manager's team labels her reps and groups the leaderboard", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Priya Shah").click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByLabel("Team name").fill("Team Alpha");
  // ^Save$ on purpose: "Save changes" and "Save pay structure" are other cards.
  await page.getByRole("button", { name: /^Save$/ }).click();
  // The roster inside the card takes the new name — "Priya's team" no longer.
  await expect(page.getByText(/Team Alpha · \d+ (person|people)/)).toBeVisible({ timeout: 10000 });
  // Her reps are on the card, and the canvasser under one of them with them.
  await expect(page.getByRole("link", { name: "Tyler Brooks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cody Nguyen" })).toBeVisible();

  // The name reaches everyone under her, on the roster.
  await page.goto("/portal/team");
  await expect(page.getByText("Team Alpha").first()).toBeVisible({ timeout: 10000 });

  // And the leaderboard can be read by team, with her reps inside hers.
  await page.goto("/portal/team/performance?period=all&view=team");
  const teamRow = page.getByRole("button", { name: /Team Alpha/ });
  await expect(teamRow).toBeVisible({ timeout: 10000 });
  await teamRow.click();
  await expect(page.getByRole("link", { name: "Tyler Brooks" })).toBeVisible();
});

test("only a sales manager gets a team name", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Tyler Brooks").click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });
  // A rep belongs to a team but never names one — see setTeamNameAction.
  await expect(page.getByLabel("Team name")).toHaveCount(0);
  await expect(page.getByText("Reports to (sales manager):")).toBeVisible({ timeout: 10000 });
});
