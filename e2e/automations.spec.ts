import { test, expect, type Page } from "@playwright/test";

/**
 * The whole promise of the feature in one pass: a rule written in Settings
 * makes a real document appear on a real deal with nobody clicking anything.
 *
 * The rule is built AROUND the deal rather than the other way round — the spec
 * reads the stage the Advance button is about to land on and writes the rule
 * for that stage. Hard-coding a stage name would make this fail the first time
 * somebody reorders the seeded pipeline.
 */

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** Open the first deal in the pipeline list. */
async function openDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByTestId("deal-stage-bar")).toBeVisible();
}

test("a stage move fires the rule and files the document", async ({ page }) => {
  await login(page, "admin@anexahomes.com");

  // 1. Find out where this deal is about to go.
  await openDeal(page);
  const dealUrl = page.url();
  const target = (await page.getByTestId("deal-stage-advance").innerText()).trim();
  expect(target).not.toBe("");

  // 2. Write a rule for exactly that stage.
  await page.goto("/portal/settings/automations");
  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByLabel("What this automation is called").fill("E2E paperwork");

  await page.getByRole("combobox", { name: "Which stage" }).click();
  await page.getByRole("option", { name: target, exact: true }).click();

  await page.getByRole("button", { name: "Add action" }).click();
  await page.getByRole("combobox", { name: "Action 1 which document" }).click();
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: "Create automation" }).click();
  await expect(page.getByText("E2E paperwork created")).toBeVisible({ timeout: 15000 });

  // 3. Move the deal. Nobody touches the document.
  await page.goto(dealUrl);
  await page.getByTestId("deal-stage-advance").click();
  await expect(
    page.getByTestId("deal-stage-bar").getByText(target, { exact: true }).first()
  ).toBeVisible({ timeout: 10000 });

  // 4. The run is recorded, and it generated something.
  //
  // Re-navigating inside toPass(), not one goto and a long timeout: the stage
  // bar updates optimistically, so the click returns before the rule has
  // finished generating a PDF — and the settings page renders once on the
  // server, so waiting on a static DOM would never pick the run up.
  await expect(async () => {
    await page.goto("/portal/settings/automations");
    // Runs are their own row in the rail — every rule's, newest first.
    await page.getByRole("button", { name: /Recent runs/ }).click();
    await expect(page.getByText(/Generated .*\.pdf/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
});

test("a rule cannot send a deal back to the stage that triggered it", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/automations");

  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByLabel("What this automation is called").fill("E2E loop");

  // Same stage on both sides of the rule — the shortest possible loop.
  await page.getByRole("combobox", { name: "Which stage" }).click();
  const stage = page.getByRole("option").first();
  const stageName = (await stage.innerText()).trim();
  await stage.click();

  await page.getByRole("button", { name: "Add action" }).click();
  await page.getByRole("combobox", { name: "Action 1", exact: true }).click();
  await page.getByRole("option", { name: "Move the deal to a stage" }).click();
  await page.getByRole("combobox", { name: "Action 1 which stage" }).click();
  await page.getByRole("option", { name: stageName, exact: true }).click();

  await page.getByRole("button", { name: "Create automation" }).click();

  // Refused at the point somebody writes it, rather than three needless runs later.
  await expect(page.getByText(/same stage that triggered it/i)).toBeVisible();
});
