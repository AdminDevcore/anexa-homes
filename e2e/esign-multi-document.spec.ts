import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** A real, readable PDF so the upload path and the page-model read are exercised. */
async function pdfFixture(label: string, pageCount: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${label} — page ${i + 1}`, { x: 60, y: 700, size: 20, font, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}

async function uploadActiveDocument(page: Page, label: string, pageCount: number) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: `${label.toLowerCase().replace(/\s+/g, "-")}.pdf`,
    mimeType: "application/pdf",
    buffer: await pdfFixture(label, pageCount),
  });
  await expect(page.getByText(/PDF uploaded/)).toBeVisible({ timeout: 20000 });
}

/**
 * Drop a signature field on the ACTIVE document and prove it stuck.
 *
 * The proof is a reload, not a toast: toasts stack and linger, so an earlier
 * "Template saved" can satisfy a later assertion and hide a save that never ran.
 */
async function placeSignatureField(page: Page, tab: RegExp, expected: number) {
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByText("Template saved")).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.getByRole("button", { name: tab })).toContainText(String(expected), { timeout: 15000 });
}

test("e-sign: one template, two PDFs, one signing link and one merged PDF", async ({ page }) => {
  await login(page, "admin@anexahomes.com");

  // 1. A new template starts as a single PDF — the shape every existing
  //    template has.
  await page.goto("/portal/documents");
  await page.getByRole("button", { name: /New template/ }).click();
  await page.waitForURL(/\/portal\/documents\/templates\/[0-9a-f-]+$/, { timeout: 15000 });
  
  const name = `Bundle Test ${Date.now()}`;
  await page.locator("#template-name").fill(name);
  await page.getByRole("button", { name: /^Save$/ }).first().click();
  await expect(page.getByText("Saved").first()).toBeVisible({ timeout: 15000 });

  await uploadActiveDocument(page, "Install Agreement", 2);
  // Document 1 of a template that has never been split is named after the
  // template itself.
  const doc1Tab = new RegExp(`1\\s*${name}`);
  await placeSignatureField(page, doc1Tab, 1);

  // 2. Adding a second document promotes the original PDF to document 1 and
  //    keeps the field already placed on it.
  await page.getByRole("button", { name: /Add document/ }).click();
  await expect(page.getByText(/Document added/)).toBeVisible({ timeout: 20000 });
  const doc2Tab = /2\s*Document 2/;
  await expect(page.getByRole("button", { name: doc2Tab })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: doc1Tab })).toContainText("1");

  await page.getByRole("button", { name: doc2Tab }).click();
  await uploadActiveDocument(page, "Limited Warranty", 1);
  await placeSignatureField(page, doc2Tab, 1);
  // The first document's field survived the split.
  await expect(page.getByRole("button", { name: doc1Tab })).toContainText("1");

  // The envelope note only appears once there is genuinely a bundle.
  await expect(page.getByText(/go out as .*one envelope/i)).toBeVisible();

  // 3. Send it. One template, one envelope — so one signing link.
  await page.goto("/portal/documents");
  await page.getByRole("button", { name: /Send for Signature/ }).click();
  await page.locator('button:has-text("Choose a document")').click();
  await page.getByRole("option", { name }).click();
  await page.locator('button:has-text("Choose a lead")').click();
  await page.getByRole("option", { name: /Johnson/ }).first().click();
  await page.getByRole("button", { name: /^Send$/ }).click();

  const linkInput = page.locator("input[readonly]");
  await expect(linkInput.first()).toBeVisible({ timeout: 15000 });
  await expect(linkInput).toHaveCount(1);
  const url = await linkInput.first().inputValue();

  // 4. The customer sees BOTH documents in one scroll, under one Sign button.
  await page.context().clearCookies();
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));

  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("heading", { name: "Document 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign$/ })).toHaveCount(2);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Finish & Sign/ }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByPlaceholder("Type your full name").fill("Robert Johnson");
  await page.getByRole("button", { name: /Adopt & Sign/ }).click();
  await page.getByRole("button", { name: /Finish & Sign/ }).click();
  await expect(page.getByText("All signed!")).toBeVisible({ timeout: 30000 });

  // 5. One completed package, one downloadable signed file.
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/documents");
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/portal\/documents\/[0-9a-f-]+$/);
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(1);
});
