import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";
// Minimal valid 1x1 PNG (sharp can process it).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openDeal(page: Page, query: string) {
  await page.goto(`/portal/leads?q=${query}`);
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");
}

async function uploadSlot(page: Page, labelText: string) {
  const input = page.locator("label", { hasText: labelText }).locator('input[type="file"]');
  await input.first().setInputFiles({ name: `${labelText.replace(/\W+/g, "_")}.png`, mimeType: "image/png", buffer: PNG });
}

test("Build Proposal closes out the visit panel; contracts stay with the documents", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");
  // Building the proposal is the last step of the visit, so it lives in the
  // Summary panel under the numbered outcomes — not down in the document card.
  await expect(page.getByText("The visit")).toBeVisible();
  await expect(page.getByRole("link", { name: "Build Proposal" })).toBeVisible();
  // The contract tools still live beside the documents they produce.
  await expect(page.getByRole("button", { name: "Insurance Contract" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simple Cash Bid" })).toBeVisible();
  await page.context().clearCookies();
});

test("the visit reads as a sequence: appointment, then inspection", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");

  const panel = page.locator("ol", { hasText: "Appointment" }).first();
  // The step titles are CSS-uppercased, and innerText returns them rendered.
  const text = (await panel.innerText()).replace(/\s+/g, " ").toLowerCase();
  expect(text).toContain("appointment");
  expect(text.indexOf("appointment")).toBeLessThan(text.indexOf("inspection"));
  // The claim is deliberately NOT a step: the Summary's Claim Status picker
  // owns it, and two controls for one claim made the button guess a status.
  expect(text).not.toContain("insurance claim");

  // Notes are collapsed behind their count until asked for.
  await expect(page.getByRole("button", { name: /Add note|note[s]?$/ }).first()).toBeVisible();
  await page.context().clearCookies();
});

test("builder gates generation until required photos are uploaded", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");

  // Required photos missing initially.
  await expect(page.getByText("Required photos missing")).toBeVisible();

  // Upload the 3 required site slots; re-locate each call (the list re-renders).
  await uploadSlot(page, "Front of house");
  await expect(page.getByText("All required photos uploaded").or(page.getByText("Required photos missing"))).toBeVisible();
  await uploadSlot(page, "Full roof");
  await uploadSlot(page, "Roof damage");

  await expect(page.getByText("All required photos uploaded ✓")).toBeVisible({ timeout: 20000 });
  await page.context().clearCookies();
});

test("generate produces a public presentation with NO cost/profit leak", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");

  await uploadSlot(page, "Front of house");
  await uploadSlot(page, "Full roof");
  await uploadSlot(page, "Roof damage");
  await expect(page.getByText("All required photos uploaded ✓")).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: /Generate presentation/ }).click();

  const openLink = page.getByRole("link", { name: "Open" });
  await expect(openLink).toBeVisible({ timeout: 20000 });
  const href = await openLink.getAttribute("href");
  expect(href).toContain("/present/");

  // Visit the public customer presentation (no auth needed).
  await page.context().clearCookies();
  await page.goto(href!);

  // Renders customer sections. (The cover headline, not the old "Your Roofing
  // Proposal" string — that copy was retired long before this spec was.)
  await expect(page.getByText("Your new roof")).toBeVisible();
  await expect(page.getByText("Estimated out-of-pocket")).toBeVisible();
  await expect(page.getByText("Common questions")).toBeVisible();

  // SECURITY: customer-facing page must not expose internal money.
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("company overhead");
  expect(body).not.toContain("profit pool");
  expect(body).not.toContain("cost $/u");
  expect(body).not.toContain("rep split");
});

test("cash and monthly sit side by side, and the customer's pick reaches the deal", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");
  const dealUrl = page.url();
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");

  await uploadSlot(page, "Front of house");
  await uploadSlot(page, "Full roof");
  await uploadSlot(page, "Roof damage");
  await expect(page.getByText("All required photos uploaded ✓")).toBeVisible({ timeout: 20000 });

  // Details — give the deal an out-of-pocket and turn on monthly payments.
  // The builder's field labels aren't tied to their inputs, so target the
  // placeholder rather than pretending getByLabel works here.
  await page.getByRole("button", { name: /2 · Details/ }).click();
  const deductible = page.locator('input[placeholder="e.g. 2500"]');
  await deductible.fill("2500");
  await deductible.press("Tab"); // the field commits on blur
  // This label DOES wrap its checkbox, so it is addressable by name.
  await page.getByLabel("Also offer 0% monthly payments").check();

  // The builder previews exactly what the customer will see. All six terms are
  // offered by default and the longest leads, so the headline is 60 months.
  await expect(page.getByText("Customer sees")).toBeVisible();
  await expect(page.getByText("$2,500", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Preview & Share/ }).click();
  // Earlier tests in this file share the seeded deal, so this proposal may
  // already exist — the button then reads "Re-generate" and its share link is
  // ALREADY on screen. Waiting for the toast (which fires after generate's own
  // save resolves) is what stops us reading a stale href mid-save.
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  await expect(page.getByText("Presentation generated")).toBeVisible({ timeout: 20000 });
  const openLink = page.getByRole("link", { name: "Open" });
  await expect(openLink).toBeVisible({ timeout: 20000 });
  const href = await openLink.getAttribute("href");

  // The customer opens their proposal with no session at all.
  await page.context().clearCookies();
  await page.goto(href!);

  await expect(page.getByText("Choose how you'd like to pay")).toBeVisible();
  await expect(page.getByText("Pay in full")).toBeVisible();
  await expect(page.getByText("Monthly payments")).toBeVisible();
  // 0% means WHEN, not how much: $2,500 over 60 months is $41.67.
  await expect(page.getByText("$41.67")).toBeVisible();
  await expect(page.getByText(/60 months · 0% interest · \$2,500\.00 total/)).toBeVisible();

  // Pick monthly. Both columns carry a "Choose this", so scope to the card.
  const monthly = page.locator("div").filter({ hasText: /^Monthly payments/ }).last();
  await monthly.getByRole("button", { name: "Choose this" }).click();
  await expect(page.getByText("Your selection")).toBeVisible({ timeout: 15000 });

  // It survives a reload, so it really was written and not just local state.
  await page.reload();
  await expect(page.getByText("Your selection")).toBeVisible();

  // And the rep sees it on the deal.
  await login(page, "admin@anexahomes.com");
  await page.goto(dealUrl);
  await expect(page.getByText(/Payment choice from/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Monthly payments · 60 months/)).toBeVisible();
});
