import { test, expect, type Page } from "@playwright/test";

/**
 * The money path, end to end: a contractor's invoice becomes a payable, gets a
 * number typed on it, is approved, is batched into the SAME payroll run the
 * reps are paid from, and settles.
 *
 * The assertions that matter are the ones about state changing in step: an
 * unpriced line must not be approvable, an approved line must not be editable
 * once batched, and marking the run paid must move the Contractor Pay row to
 * "paid" — because if it does not, the money leaves the building and the next
 * run batches the same invoice again.
 *
 * Runs on a ROOFING job via the installer's own page, so it needs no flag.
 */
const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** Submit one invoice as the crew lead and come back to the office. */
async function submitInvoice(page: Page) {
  await login(page, "installer@anexahomes.com");
  await page.goto("/portal/jobs");
  await page.locator('a[href^="/portal/jobs/"]').first().click();
  await page.waitForURL(/\/portal\/jobs\/[0-9a-f-]+$/, { timeout: 15000 });
  await page.locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");
  await expect(page.getByText("Invoice submitted")).toBeVisible({ timeout: 15000 });
}

/** The row for Carlos Diaz's invoice on the Contractor Pay register. */
const carlosRow = (page: Page) => page.locator("tr", { hasText: "Carlos Diaz" }).first();

test("an invoice is priced, approved, and paid through the same payroll run", async ({ page }) => {
  await submitInvoice(page);

  await login(page, "accounting@anexahomes.com");
  await page.goto("/portal/contractor-pay");

  // Submitted, but not yet a payable: no amount, no actions, nothing owed.
  await expect(carlosRow(page)).toContainText("submitted");
  await expect(carlosRow(page)).toContainText("Not generated");

  // Generate turns every submitted invoice into a pay line at zero — nothing
  // in this product can read a PDF, so zero is the honest starting number.
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect(page.getByText(/pay line\(s\) generated/)).toBeVisible({ timeout: 15000 });
  await expect(carlosRow(page)).toContainText("pending");

  // A zero cannot be approved. Payroll batches whatever is approved, so a zero
  // waved through here is a $0 line on a pay stub and a contractor who was told
  // he was paid.
  await expect(carlosRow(page).getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(page.getByText(/still needs? an amount typed in/)).toBeVisible();

  // Type what the invoice says.
  const amount = carlosRow(page).getByLabel("Invoice amount");
  await amount.fill("1850.00");
  await amount.blur();
  await expect(amount).toHaveValue("1850.00", { timeout: 15000 });

  await carlosRow(page).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved")).toBeVisible({ timeout: 15000 });
  await expect(carlosRow(page)).toContainText("approved");

  /* Into the one payroll run. This is the claim the whole feature rests on:
   * the same button that pays the reps pays the crews. */
  await page.goto("/portal/payroll");
  await page.getByRole("button", { name: "New Payroll Run" }).click();
  const dialog = page.getByRole("dialog");
  // By placeholder and position: the dialog's Label/Input pairs are not wired
  // with htmlFor, so getByLabel finds nothing here.
  await dialog.getByPlaceholder(/June 2026/).fill("Contractor pay e2e");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
  await dialog.locator('input[type="date"]').first().fill(iso(weekAgo));
  await dialog.locator('input[type="date"]').last().fill(iso(today));
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/portal\/payroll\/[0-9a-f-]+$/, { timeout: 20000 });
  const runUrl = page.url();

  const runRow = page.locator("tr", { hasText: "Carlos Diaz" }).first();
  await expect(runRow).toBeVisible({ timeout: 10000 });
  await expect(runRow).toContainText("Contractor invoice");
  await expect(runRow).toContainText("$1,850");

  // Batched: the number stops being an opinion. Editing it now would leave the
  // run's total disagreeing with its own line.
  await page.goto("/portal/contractor-pay");
  await expect(carlosRow(page)).toContainText("In payroll run");
  await expect(carlosRow(page).getByLabel("Invoice amount")).toHaveCount(0);
  await expect(carlosRow(page)).toContainText("$1,850");

  // Approve and pay the run — and the register must follow it to "paid".
  await page.goto(runUrl);
  await page.getByRole("button", { name: "Approve Run" }).click();
  await expect(page.getByText("Run approved")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Mark All Paid" }).click();
  await expect(page.getByText("Marked paid")).toBeVisible({ timeout: 20000 });

  await page.goto("/portal/contractor-pay");
  await expect(carlosRow(page)).toContainText("paid");

  // Pressing Generate again must not re-create a line for an invoice that has
  // already been paid once — that is what the unique index on the invoice is for.
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect(page.getByText(/Nothing new/)).toBeVisible({ timeout: 15000 });
});

test("a rep can neither reach the register nor price anything on it", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/contractor-pay");
  await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 15000 });
});
