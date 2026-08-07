import { test, expect, type Locator, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

/** A claim-worksheet input, located by its label span sibling. */
function worksheetField(page: Page, label: string): Locator {
  return page
    .locator("div.space-y-1", { has: page.getByText(label, { exact: true }) })
    .locator("input");
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * Claim status is a company-customizable list, set from the deal Summary.
 *
 * The two halves have to be checked together: a status invented in Settings is
 * worthless if the deal's picker doesn't offer it, and the picker is worthless
 * if what it writes doesn't survive a reload.
 */
test("a custom claim status reaches the deal picker and sticks", async ({ page }) => {
  await login(page, "owner@anexahomes.com");

  // ── Settings: the built-ins are there, and a new one can be invented ──
  await page.goto("/portal/settings/claim-statuses");
  await expect(page.getByRole("heading", { name: "Claim Statuses" })).toBeVisible({ timeout: 15000 });
  // "Scope Received" is flagged, because deleting it closes the Scope of Work tab.
  await expect(page.getByText("Opens scope").first()).toBeVisible();

  await page.getByPlaceholder("e.g. Depreciation released").fill("Depreciation Released");
  await page.getByRole("button", { name: "Add status" }).click();
  await expect(page.locator('input[value="Depreciation Released"]')).toBeVisible({ timeout: 10000 });

  // ── Deal page: the picker offers the office's own list ──
  await page.goto("/portal/leads?q=Robert");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const dealUrl = page.url();

  const picker = page.getByRole("combobox", { name: "Claim Status" });
  await expect(picker).toBeVisible({ timeout: 15000 });
  await picker.click();
  await expect(page.getByRole("option", { name: "Not Filed" })).toBeVisible();
  await page.getByRole("option", { name: "Depreciation Released" }).click();
  await expect(page.getByText("Claim: Depreciation Released").first()).toBeVisible({ timeout: 15000 });

  // ── It persisted, not just painted optimistically ──
  await page.goto(dealUrl);
  await expect(page.getByRole("combobox", { name: "Claim Status" })).toContainText(
    "Depreciation Released",
    { timeout: 15000 }
  );
});

/**
 * Setting the status is the ONLY way to open a claim — the "Open claim" button
 * that used to sit in the visit panel is gone. Sarah Anderson is seeded at
 * `inspection_complete`: a roofing insurance deal with no project and therefore
 * no claim row, which is exactly the state this has to work from.
 */
test("picking a status opens the claim and unlocks the worksheet", async ({ page }) => {
  await login(page, "owner@anexahomes.com");

  await page.goto("/portal/leads?q=Anderson");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const dealUrl = page.url();

  // ── No claim yet: the worksheet is locked and points at the picker ──
  const slide = page.locator('[data-deal-slide="claim"]');
  await expect(page.getByRole("tab", { name: "Claim Info" })).toBeVisible({ timeout: 15000 });
  await expect(slide.getByText("No insurance claim opened yet")).toBeVisible();
  // The visit panel's old button is gone for good — nothing on the page opens a
  // claim until the picker is touched. (The dialog it raises has a button of the
  // same name; this asserts the state BEFORE any of that.)
  await expect(page.getByRole("button", { name: "Open claim" })).toHaveCount(0);

  // ── Pick a status well past "Filed": that exact status is what's saved ──
  const picker = page.getByRole("combobox", { name: "Claim Status" });
  await expect(picker).toBeVisible({ timeout: 15000 });
  await picker.click();
  await page.getByRole("option", { name: "Adjuster Scheduled" }).click();

  // Opening a claim asks for what makes it workable, in the same breath.
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  await page.getByLabel("Carrier").fill("State Farm");
  await page.getByLabel("Claim Number").fill("SF-2026-4471");
  await page.getByRole("button", { name: "Open claim" }).click();
  await expect(page.getByText("Claim: Adjuster Scheduled").first()).toBeVisible({ timeout: 15000 });

  // ── The claim now exists, carrying what the dialog collected ──
  await page.goto(dealUrl);
  await expect(page.getByRole("tab", { name: "Claim Info" })).toBeVisible({ timeout: 15000 });
  await expect(slide.getByText("State Farm")).toBeVisible({ timeout: 15000 });
  await expect(slide.getByText("SF-2026-4471")).toBeVisible();
  await expect(slide.getByText("No insurance claim opened yet")).toHaveCount(0);
  // Born complete, so no warning — and untouched amounts read as unset, not $0.
  await expect(slide.getByText("This claim is missing")).toHaveCount(0);
  await expect(slide.getByText("$0")).toHaveCount(0);

  // ── And the status it was opened with is the one on file, not "Filed" ──
  await expect(page.getByRole("combobox", { name: "Claim Status" })).toContainText(
    "Adjuster Scheduled",
    { timeout: 15000 }
  );
});

/**
 * Skipping is allowed — a carrier does not always hand over the claim number on
 * the filing call — but the claim it produces must not pass for a worked one.
 */
test("a skipped claim is opened, and flagged until its details arrive", async ({ page }) => {
  await login(page, "owner@anexahomes.com");

  // David Kim is seeded at `appointment_set` — like Sarah Anderson, an early
  // stage that gets no project and therefore no claim row.
  await page.goto("/portal/leads?q=Kim");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const dealUrl = page.url();

  const picker = page.getByRole("combobox", { name: "Claim Status" });
  await expect(picker).toBeVisible({ timeout: 15000 });
  await picker.click();
  // Exact: "Filed" is a substring of "Not Filed", which sorts first.
  await page.getByRole("option", { name: "Filed", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Skip for now" }).click();

  // The claim opened, and says so plainly rather than looking filled in.
  await page.goto(dealUrl);
  const slide = page.locator('[data-deal-slide="claim"]');
  await expect(slide.getByText("This claim is missing its carrier and claim number")).toBeVisible({
    timeout: 15000,
  });

  // Filling them in clears the flag — the banner is a state, not a sticker.
  // Worksheet fields label with a bare span, so they're found the same way
  // claim-info.spec.ts finds them, not by getByLabel.
  await slide.getByRole("button", { name: "Add claim info" }).click();
  await worksheetField(page, "Carrier").fill("Allstate");
  await worksheetField(page, "Claim Number").fill("AS-2026-88");
  await page.getByRole("button", { name: "Save claim" }).click();
  // Wait for the save to land. Navigating on the click alone re-renders from the
  // pre-save row and the banner is still legitimately there.
  await expect(page.getByText("Claim saved")).toBeVisible({ timeout: 10000 });
  await page.goto(dealUrl);
  await expect(slide.getByText("Allstate")).toBeVisible({ timeout: 15000 });
  await expect(slide.getByText("This claim is missing")).toHaveCount(0);
});
