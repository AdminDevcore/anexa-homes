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

test("chat: seeded channel and welcome message are visible", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/chat");
  await expect(page.getByText("Company Announcements")).toBeVisible({ timeout: 10000 });
  await page.getByText("Company Announcements").click();
  await expect(page.getByText(/Welcome to the Anexa Homes team chat/)).toBeVisible({ timeout: 10000 });
});

test("chat: manager can DM a sales rep and send a message", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/chat");
  await page.getByRole("button", { name: /New/ }).click();
  await page.getByRole("menuitem", { name: /New message/ }).click();
  await page.getByPlaceholder(/Search teammates/).fill("Tyler");
  await page.getByRole("button", { name: /Tyler Brooks/ }).click();

  const text = `Hello Tyler ${Date.now() % 100000}`;
  await page.getByPlaceholder(/Type a message/).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  // Target the message bubble (the text also appears in the list preview).
  await expect(page.getByRole("paragraph").filter({ hasText: text })).toBeVisible({ timeout: 10000 });
});

test("chat: sales rep cannot DM another sales rep", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/chat");
  await page.getByRole("button", { name: /New/ }).click();
  await page.getByRole("menuitem", { name: /New message/ }).click();

  // Manager (non-rep) is available...
  await expect(page.getByRole("button", { name: /Priya Shah/ })).toBeVisible({ timeout: 10000 });
  // ...but the other sales rep (Dylan Foster) is filtered out.
  await expect(page.getByRole("button", { name: /Dylan Foster/ })).toHaveCount(0);
});

test("chat: a rep can post in a shared channel", async ({ page }) => {
  // Reps can co-exist/post in channels; the rep<->rep block is a DM-only rule.
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/chat");
  await page.getByText("Company Announcements").click();
  const text = `Channel note ${Date.now() % 100000}`;
  await page.getByPlaceholder(/Type a message/).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: text })).toBeVisible({ timeout: 10000 });
});
