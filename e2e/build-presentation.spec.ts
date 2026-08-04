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

test("the documents section offers Build Presentation, not the page header", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");
  // The contract tools live beside the documents they produce, further down the
  // same page — the header is down to Edit / Edit Job.
  await expect(page.getByRole("link", { name: "Build Presentation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Insurance Contract" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simple Cash Bid" })).toBeVisible();
  await page.context().clearCookies();
});

test("builder gates generation until required photos are uploaded", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openDeal(page, "Linda");
  await page.getByRole("link", { name: "Build Presentation" }).click();
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
  await page.getByRole("link", { name: "Build Presentation" }).click();
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

  // Renders customer sections.
  await expect(page.getByText("Your Roofing Proposal")).toBeVisible();
  await expect(page.getByText("Estimated out-of-pocket")).toBeVisible();
  await expect(page.getByText("Common questions")).toBeVisible();

  // SECURITY: customer-facing page must not expose internal money.
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("company overhead");
  expect(body).not.toContain("profit pool");
  expect(body).not.toContain("cost $/u");
  expect(body).not.toContain("rep split");
});
