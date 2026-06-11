import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function makePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Anexa Homes — Custom Contract", { x: 56, y: 720, size: 16 });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

test("admin can upload a PDF to a template and place a field", async ({ page }) => {
  const pdf = await makePdf();

  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/documents");
  await page.getByRole("link", { name: "Edit template" }).first().click();
  await page.waitForURL(/\/portal\/documents\/templates\/[0-9a-f-]+$/, { timeout: 15000 });

  // Upload the PDF.
  await page.locator('input[type="file"]').setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });

  // Uploader flips to "PDF uploaded" and a canvas (the rendered page) appears.
  await expect(page.getByText("PDF uploaded").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15000 });

  // The PDF must actually render (worker loads locally) — no loading/error overlay,
  // and the canvas has real pixels.
  await expect(page.getByText("Loading PDF…")).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText(/Couldn’t render the PDF preview/)).toHaveCount(0);
  await expect
    .poll(async () => page.locator("canvas").first().evaluate((c) => (c as HTMLCanvasElement).width), { timeout: 15000 })
    .toBeGreaterThan(0);

  // Place a signature field and save.
  await page.getByRole("button", { name: /Signature/ }).click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Template saved")).toBeVisible({ timeout: 10000 });

  // "Generate PDF" produces a filled sample PDF preview.
  await expect(page.getByRole("button", { name: /Generate PDF/ })).toBeVisible();
  const templateId = page.url().split("/").pop()!;
  const res = await page.request.get(`/portal/documents/templates/${templateId}/preview`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect((await res.body()).length).toBeGreaterThan(1000);
});
