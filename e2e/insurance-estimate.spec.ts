import { test, expect, type Page } from "@playwright/test";

/**
 * The carrier's estimate figures belong where the proposal is built.
 *
 * Before this, the builder collected one insurance number — the deductible — and
 * read RCV / ACV / depreciation / supplements straight off the Claim record. A rep
 * holding the adjuster's estimate on a deal whose claim had not been filled in
 * built a proposal that told the customer $0 was covered, and the only fix was to
 * leave the builder for the Claim tab.
 *
 * These figures are presentation-only by design: they never write back to the
 * Claim, so the claims report and payroll keep reading the record.
 */

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openDetailsStep(page: Page, query: string) {
  await page.goto(`/portal/leads?q=${query}`);
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");
  // The numbered step chip, not the "Next: Details" button at the foot of step 1.
  await page.getByRole("button", { name: "2 · Details" }).click();
}

/** Generate the proposal and follow the public link a customer would open. */
async function openPublicProposal(page: Page) {
  await page.getByRole("button", { name: "5 · Preview & Share" }).click();
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  const openLink = page.getByRole("link", { name: "Open" });
  await expect(openLink).toBeVisible({ timeout: 20000 });
  const href = await openLink.getAttribute("href");
  expect(href).toContain("/present/");
  await page.goto(href!);
}

test("typed carrier figures reach the customer's financial summary", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  // James Miller — an insurance deal whose claim is seeded, so the fallback hint
  // has something to name before anything is typed over it.
  await openDetailsStep(page, "James");

  const block = page.locator("div", { hasText: "Insurance estimate" }).last();
  await expect(block).toBeVisible();
  // Blank fields advertise what the claim would supply on its own.
  await expect(page.getByText(/Using the claim.s \$32,000/)).toBeVisible();

  await page.getByLabel("Insurance RCV ($)").fill("41250");
  await page.getByLabel("Actual cash value / ACV ($)").fill("33000");
  await page.getByLabel("Recoverable depreciation ($)").fill("8250");
  await page.getByLabel("Approved supplements ($)").fill("4125");
  await page.getByLabel("Deductible ($)").fill("1750");
  // Blur the last field so its onBlur commits before the save.
  await page.getByLabel("Insurance RCV ($)").click();

  // The rep sees the RCV land immediately: total project value = RCV + supplements.
  // Exact, because the field hints below mention the phrase too.
  await expect(page.getByText("Total project value", { exact: true })).toBeVisible();
  await expect(page.getByText("$45,375", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 15000 });

  await openPublicProposal(page);

  const summary = page.locator("dl", { hasText: "Insurance RCV" }).first();
  await expect(summary).toContainText("$41,250.00");
  await expect(summary).toContainText("$33,000.00");
  await expect(summary).toContainText("$8,250.00");
  await expect(summary).toContainText("$4,125.00");
  // The deductible drives what the customer actually owes.
  await expect(page.getByText("$1,750.00").first()).toBeVisible();
  // The claim's own numbers are nowhere on the page — the override won.
  await expect(page.getByText("$32,000.00")).toHaveCount(0);

  await page.context().clearCookies();
});

test("left blank, the claim's own figures still print", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  // Robert Johnson — nothing typed into this deal's builder, so every figure has
  // to come from the seeded claim exactly as it did before this feature existed.
  await openDetailsStep(page, "Robert");

  await expect(page.getByLabel("Insurance RCV ($)")).toHaveValue("");
  await expect(page.getByText(/Using the claim.s \$24,500/)).toBeVisible();

  await openPublicProposal(page);

  const summary = page.locator("dl", { hasText: "Insurance RCV" }).first();
  await expect(summary).toContainText("$24,500.00"); // claim.rcv
  await expect(summary).toContainText("$19,110.00"); // claim.acv
  await expect(summary).toContainText("$5,390.00"); // claim.depreciation

  await page.context().clearCookies();
});
