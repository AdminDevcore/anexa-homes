import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openProposalShareStep(page: Page, query: string) {
  await page.goto(`/portal/leads?q=${query}`);
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");
  const dealUrl = page.url();
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");
  await page.getByRole("button", { name: /Preview & Share/ }).click();
  return dealUrl;
}

test("Send docs: several templates go out from the proposal in one pass", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  const dealUrl = await openProposalShareStep(page, "Kevin");

  // The paperwork button sits with the other share actions.
  await page.getByRole("button", { name: /Send docs/ }).click();

  // Pick two documents; the customer is already known, so there's no lead picker.
  await expect(page.getByRole("heading", { name: "Send documents" })).toBeVisible();
  await expect(page.getByText("Choose a lead")).toHaveCount(0);
  const dialog = page.getByRole("dialog");
  await dialog.locator("label", { hasText: "Roofing Contract" }).click();
  await dialog.locator("label", { hasText: "Certificate of Completion" }).click();

  // The signer came prefilled from the deal.
  await expect(dialog.locator("#send-docs-name")).toHaveValue(/Kevin Taylor/);

  await page.getByRole("button", { name: "Send 2 documents" }).click();

  // Both envelopes come back with their own signing link.
  const sent = dialog.getByTestId("sent-doc");
  await expect(sent).toHaveCount(2, { timeout: 15000 });
  await expect(sent.filter({ hasText: "Roofing Contract" })).toHaveCount(1);
  await expect(sent.filter({ hasText: "Certificate of Completion" })).toHaveCount(1);
  const links = dialog.locator("input[readonly]");
  await expect(links).toHaveCount(2);
  expect(await links.first().inputValue()).toContain("/sign/");
  // The rep can hand this device to a customer standing right there.
  await expect(dialog.getByRole("button", { name: "Sign in person" }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Done$/ }).click();

  // Both land in the deal's Contract folder. The deal page is heavy, so the
  // first click can land before hydration and go nowhere — retry until the
  // folder actually opens.
  await page.goto(dealUrl);
  const folders = page.getByTestId("deal-folders");
  await expect(folders).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await folders.getByRole("button", { name: /^Contract/ }).click();
    await expect(page.getByRole("button", { name: "All folders" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByRole("link", { name: /Roofing Contract/ })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("link", { name: /Certificate of Completion/ })).toBeVisible();
  await page.context().clearCookies();
});

test("Send docs: nothing checked means nothing to send", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openProposalShareStep(page, "Sarah");

  await page.getByRole("button", { name: /Send docs/ }).click();
  await expect(page.getByRole("button", { name: "Send document" })).toBeDisabled();

  // Adding a co-borrower keeps one signer form for every checked document.
  const dialog = page.getByRole("dialog");
  await dialog.locator("label", { hasText: "Roofing Contract" }).click();
  await page.getByRole("button", { name: /Add co-borrower/ }).click();
  await page.getByPlaceholder("Co-borrower name").fill("Dana Anderson");
  await page.getByPlaceholder("Co-borrower email").fill("dana.anderson@example.com");
  await page.getByRole("button", { name: "Send document" }).click();

  // Two signers on the one envelope: customer + co-borrower.
  await expect(dialog.locator("input[readonly]")).toHaveCount(2, { timeout: 15000 });
  await page.context().clearCookies();
});
