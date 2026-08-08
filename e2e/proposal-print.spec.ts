import { test, expect, type Page } from "@playwright/test";

// Printing the proposal must produce the proposal — not the CRM around it, and
// not a bleached page where the dark chapters (the estimate above all) have lost
// their background and print white-on-white. Chrome's print dialog ships with
// "Background graphics" OFF, so the page has to force its own colour.
// Each case uploads photos, generates, and re-renders the whole proposal twice
// (screen then print), which does not fit the default per-test budget.
test.describe.configure({ timeout: 180_000 });

const PASSWORD = "Passw0rd!";
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

async function openBuilder(page: Page) {
  await page.goto("/portal/leads?q=Linda");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL("**/portal/leads/**");
  await page.getByRole("link", { name: "Build Proposal" }).click();
  await page.waitForURL("**/presentation");
}

/** Fill a checklist slot. `count` > 1 puts several photos in ONE group, which is
 *  what turns the customer gallery into a swipeable (and clippable) carousel. */
async function uploadSlot(page: Page, labelText: string, count = 1) {
  const input = page.locator("label", { hasText: labelText }).locator('input[type="file"]');
  await input.first().setInputFiles(
    Array.from({ length: count }, (_, i) => ({
      name: `${labelText.replace(/\W+/g, "_")}_${i}.png`,
      mimeType: "image/png",
      buffer: PNG,
    })),
  );
}

async function fillRequiredPhotos(page: Page) {
  await uploadSlot(page, "Front of house", 2); // one group, two photos
  await uploadSlot(page, "Full roof");
  await uploadSlot(page, "Roof damage");
  await expect(page.getByText("All recommended photos uploaded ✓")).toBeVisible({ timeout: 30000 });
}

test("printing the builder preview prints the proposal, not the CRM around it", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openBuilder(page);
  await fillRequiredPhotos(page);

  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Your new roof")).toBeVisible();

  await page.emulateMedia({ media: "print" });

  // The portal shell and the builder's own toolbar are workspace furniture.
  await expect(page.locator('aside a[href="/portal/pipeline"]')).toBeHidden();
  await expect(page.getByRole("banner").first()).toBeHidden();
  await expect(page.getByRole("heading", { name: "Build Proposal" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Back to builder" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to deal" })).toBeHidden();

  // The proposal itself still prints.
  await expect(page.getByText("Your new roof")).toBeVisible();
});

test("the printed proposal keeps the colour that makes its dark chapters legible", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openBuilder(page);
  await fillRequiredPhotos(page);

  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  await expect(page.getByText("Presentation generated")).toBeVisible({ timeout: 30000 });
  const href = await page.getByRole("link", { name: "Open" }).getAttribute("href");

  await page.context().clearCookies();
  await page.goto(href!);
  await expect(page.getByText("Estimated out-of-pocket")).toBeVisible();
  await page.emulateMedia({ media: "print" });

  // Every dark chapter must opt out of Chrome's "economy" print colour, or its
  // background is dropped and its white text prints on white paper.
  const dark = await page.evaluate(() =>
    ["cover", "financial", "signature"].map((id) => {
      const el = document.querySelector(`[data-section="${id}"]`);
      if (!el) return { id, adjust: "MISSING" };
      return { id, adjust: getComputedStyle(el).printColorAdjust };
    }),
  );
  expect(dark).toEqual([
    { id: "cover", adjust: "exact" },
    { id: "financial", adjust: "exact" },
    { id: "signature", adjust: "exact" },
  ]);

  // And the estimate is still on the page.
  await expect(page.getByText("Estimated out-of-pocket")).toBeVisible();
});

test("every inspection photo lands on the printed page", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openBuilder(page);
  await fillRequiredPhotos(page);

  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  await expect(page.getByText("Presentation generated")).toBeVisible({ timeout: 30000 });
  const href = await page.getByRole("link", { name: "Open" }).getAttribute("href");

  await page.context().clearCookies();
  await page.goto(href!);
  await page.emulateMedia({ media: "print" });

  // On screen the gallery is a horizontal swipe. On paper anything past the
  // first frame is scrolled out of view and simply never prints.
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-section="photos"] [data-photo-track]')).map((t) => ({
      photos: t.childElementCount,
      overflowing: t.scrollWidth > t.clientWidth + 1,
    })),
  );
  expect(clipped.length).toBeGreaterThan(0);
  for (const t of clipped) expect(t.overflowing, `track of ${t.photos} photos`).toBe(false);
});

test("the page box is a real 8.5x11 with no margin for the browser's own furniture", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await openBuilder(page);
  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  await expect(page.getByText("Presentation generated")).toBeVisible({ timeout: 30000 });
  const href = await page.getByRole("link", { name: "Open" }).getAttribute("href");

  await page.context().clearCookies();
  await page.goto(href!);

  // Read the rule back out of the CSSOM, not out of the source file. Chrome
  // ACCEPTS `size: letter portrait` and silently keeps only `letter` — the
  // orientation is discarded on parse, so a source grep would happily pass
  // while the document printed sideways. Only the parsed rule tells the truth.
  const rule = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of Array.from(rules ?? [])) if (r.cssText?.startsWith("@page")) return r.cssText;
    }
    return null;
  });
  expect(rule, "@page rule reaches the page").not.toBeNull();
  // Explicit dimensions survive; a bare paper name does not pin orientation.
  expect(rule).toMatch(/size:\s*8\.5in\s+11in/);
  expect(rule).not.toMatch(/size:\s*letter/);
  // Zero margin is the only thing that denies Chrome somewhere to draw the
  // date, the tab title and the page URL.
  expect(rule).toMatch(/margin:\s*0(px)?\b/);
});

test("the printed proposal carries no date, tab title or CRM url", async ({ page }) => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  await login(page, "admin@anexahomes.com");
  await openBuilder(page);
  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: /Generate presentation|Re-generate/ }).click();
  await expect(page.getByText("Presentation generated")).toBeVisible({ timeout: 30000 });
  const href = await page.getByRole("link", { name: "Open" }).getAttribute("href");

  await page.context().clearCookies();
  await page.goto(href!, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });

  // displayHeaderFooter asks for the SAME default templates the print dialog
  // draws when "Headers and footers" is ticked — the worst case, not the
  // convenient one. With no page margin there is nowhere to put them.
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true });
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;

  const first = await doc.getPage(1);
  const { width, height } = first.getViewport({ scale: 1 });
  expect(Math.round(width), "portrait Letter width in pt").toBe(612);
  expect(Math.round(height), "portrait Letter height in pt").toBe(792);

  for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
    const text = (await (await doc.getPage(i)).getTextContent()).items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    expect(text, `page ${i} must not carry the CRM url`).not.toMatch(/\/portal\/leads\/|localhost:\d+|https?:\/\//);
    expect(text, `page ${i} must not carry a print date`).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d/);
  }
});
