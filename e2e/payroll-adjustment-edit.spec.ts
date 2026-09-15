import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "./global-setup";

/**
 * A bonus or deduction on an OPEN payroll run is corrected in place.
 *
 * The run, one commission line (which is what makes the rep a payee on the
 * page) and the deduction are written straight into the isolated e2e schema,
 * so this spec neither depends on nor disturbs the commissions payroll.spec
 * generates, runs and pays.
 *
 * Set QA3_SCREENSHOT_DIR to keep screenshots of the dialog and the result.
 */

const PASSWORD = "Passw0rd!";
const LABEL = `E2E Edit Run ${Date.now()}`;
const db = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });

let runId: string;
let adjustmentId: string;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function shot(page: Page, name: string) {
  const dir = process.env.QA3_SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test.beforeAll(async () => {
  const company = await db.company.findUniqueOrThrow({ where: { slug: "anexa-homes" }, select: { id: true } });
  const accounting = await db.user.findFirstOrThrow({
    where: { companyId: company.id, email: "accounting@anexahomes.com" },
    select: { id: true },
  });
  const rep = await db.user.findFirstOrThrow({
    where: { companyId: company.id, email: "rep@anexahomes.com" },
    select: { id: true },
  });
  const run = await db.payrollRun.create({
    data: { companyId: company.id, label: LABEL, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-07") },
  });
  runId = run.id;
  await db.payrollItem.create({ data: { payrollRunId: run.id, userId: rep.id, label: "E2E commission line", amount: 2_500_00 } });
  const adjustment = await db.payrollAdjustment.create({
    data: {
      companyId: company.id, payrollRunId: run.id, userId: rep.id, kind: "deduction",
      amountCents: -500_00, reason: "Trenching — 50 ft", createdById: accounting.id,
    },
  });
  adjustmentId = adjustment.id;
});

test.afterAll(async () => {
  await db.payrollAdjustment.deleteMany({ where: { payrollRunId: runId } });
  await db.payrollRun.deleteMany({ where: { id: runId } });
  await db.$disconnect();
});

test("payroll ledger: a deduction is edited in place, keeps its sign, and says who edited it", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");
  await page.goto(`/portal/payroll/${runId}`);
  await expect(page.getByRole("heading", { name: LABEL })).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "Trenching — 50 ft" });
  await expect(row).toContainText("-$500.00");
  await row.getByRole("button", { name: "Edit adjustment" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit adjustment" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Amount (USD)")).toHaveValue("500");
  await expect(dialog.getByLabel("Reason")).toHaveValue("Trenching — 50 ft");
  await dialog.getByLabel("Amount (USD)").fill("750");
  await dialog.getByLabel("Reason").fill("Trenching — 75 ft");
  await shot(page, "qa3-edit-dialog");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog).toBeHidden();
  const edited = page.getByRole("listitem").filter({ hasText: "Trenching — 75 ft" });
  await expect(edited).toContainText("-$750.00");
  await expect(edited).toContainText("edited by");
  await shot(page, "qa3-after-save");

  const saved = await db.payrollAdjustment.findUniqueOrThrow({
    where: { id: adjustmentId },
    select: { amountCents: true, reason: true, updatedById: true },
  });
  expect(saved).toMatchObject({ amountCents: -750_00, reason: "Trenching — 75 ft" });
  expect(saved.updatedById).toBeTruthy();

  // Once the run is finalised the line can no longer be edited.
  await db.payrollRun.update({ where: { id: runId }, data: { finalizedAt: new Date() } });
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Trenching — 75 ft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit adjustment" })).toHaveCount(0);
});
