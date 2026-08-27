import { test, expect, type Page } from "@playwright/test";

/**
 * Printing the solar proposal must produce the proposal.
 *
 * Chrome's print dialog ships with "Background graphics" OFF, so every dark
 * ground in the document has to force its own colour or it prints white text on
 * white paper. The money chapter and the acceptance screen are both dark, which
 * makes this the difference between a printed proposal and two blank sheets
 * where the price and the signature line should be.
 *
 * This is a REGRESSION test with a real history: the document was rebuilt from
 * twelve sections into seven chapters, and the rewrite dropped
 * `print-color-adjust` from the new `Chapter` primitive — every dark chapter at
 * once. Nothing on screen showed it.
 */

const FLAG_ON = process.env.SOLAR_ENABLED !== "0";
const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal\//, { timeout: 20000 });
}

/**
 * Open the seeded solar deal, generate a proposal, and return the document.
 *
 * Returns `null` when the seed cannot produce one. The seeded solar deal has a
 * design and a finance row but NO DRAWN LAYOUT, and the module count — and so
 * the price — comes from the layout, which blocks generation. That is a gap in
 * the shared seed rather than a fact about printing, so these tests report it
 * and skip rather than failing red forever or quietly asserting nothing.
 */
async function openSolarProposalPreview(page: Page): Promise<string | null> {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });

  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  const leadId = page.url().split("/").pop()!;

  await page.getByRole("link", { name: /Build Proposal/ }).first().click();
  await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });

  await page.getByRole("button", { name: "Review & send" }).click();
  await page.getByRole("button", { name: "Check it is ready" }).click();
  const ready = page.getByText("Ready to generate");
  const blocked = page.getByText("Blocked — fix the issues below");
  await expect(ready.or(blocked)).toBeVisible({ timeout: 30000 });

  await page.getByRole("button", { name: /Create the customer.s proposal/ }).click();
  await page.waitForTimeout(3000);

  // Straight to the document by URL: what is under test is the PROPOSAL, and
  // routing through the builder's chrome only adds unrelated ways to fail.
  await page.goto(`/portal/leads/${leadId}/solar-proposal/preview`);
  const root = page.locator("#proposal-root");
  if ((await root.count()) === 0) return null;
  return leadId;
}

/** Shared entry: skips with the reason when the seed cannot make a document. */
async function documentOrSkip(page: Page) {
  const id = await openSolarProposalPreview(page);
  test.skip(
    id === null,
    "The shared e2e seed cannot generate a solar proposal: the seeded deal has " +
      "no drawn panel layout, and the module count (and therefore the price) " +
      "comes from it. Seed a layout for the solar lead to switch these on.",
  );
  await expect(page.locator("#proposal-root")).toBeAttached({ timeout: 20000 });
}

test.describe(FLAG_ON ? "solar proposal in print" : "solar proposal in print (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");
  test.describe.configure({ timeout: 180_000 });

  test("every dark chapter keeps its background on paper", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);

    await expect(page.locator('[data-section="cost"]')).toBeAttached({ timeout: 20000 });
    await page.emulateMedia({ media: "print" });

    /*
      Every dark ground marks itself with `data-dark-ground`, and the assertion
      reads the COMPUTED value off each one.

      The first version of this test hunted for dark backgrounds by matching
      `getComputedStyle(el).backgroundColor` against /^rgba?\(/. Tailwind v4
      emits oklch(), so it matched nothing, found zero grounds, and reported
      that all zero of them were correct — a green test over a document that
      would have printed blank.
    */
    const grounds = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("#proposal-root [data-dark-ground]")).map(
        (el) => ({
          id: el.getAttribute("data-section") ?? el.tagName.toLowerCase(),
          adjust: getComputedStyle(el).printColorAdjust,
        }),
      ),
    );

    // Guard the guard: if the marker is ever dropped, this fails loudly instead
    // of passing over an empty list.
    expect(grounds.length, "the document still has dark grounds to protect").toBeGreaterThanOrEqual(3);

    const bleached = grounds.filter((g) => g.adjust !== "exact");
    expect(
      bleached,
      `these dark grounds would print white-on-white: ${JSON.stringify(bleached)}`,
    ).toEqual([]);
  });

  test("the chapters print in order, each on its own page", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);
    await page.emulateMedia({ media: "print" });

    const chapters = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#proposal-root [data-chapter]")).map((el) => ({
        id: el.getAttribute("data-section"),
        breakBefore: getComputedStyle(el).breakBefore,
      })),
    );

    expect(chapters.map((c) => c.id)).toEqual([
      "cover",
      "today",
      "system",
      "cost",
      "savings",
      "timeline",
      "accept",
    ]);

    // The cover owns the first sheet; everything after it starts a new one.
    expect(chapters.slice(1).every((c) => c.breakBefore === "page")).toBe(true);
  });

  test("the sheet is landscape, and nothing else in the app is", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);
    await page.emulateMedia({ media: "print" });

    /*
      Read the page box back out of the CSSOM, never out of the source. Chrome
      ACCEPTS `size: letter landscape`, parses it, and silently keeps only
      `letter` — the orientation is discarded and a source grep would pass over
      a document that prints portrait. Explicit dimensions are the only spelling
      that survives.

      Two @page rules reach this document: the app-wide portrait box in
      globals.css, and this document's named landscape one. The named rule is
      what makes the choice deterministic — two unnamed rules would be settled
      by source order, which nothing enforces.
    */
    const rules = await page.evaluate(() => {
      const out: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let cssRules;
        try { cssRules = sheet.cssRules; } catch { continue; }
        for (const r of Array.from(cssRules ?? [])) {
          if (r.cssText?.startsWith("@page")) out.push(r.cssText);
        }
      }
      return out;
    });

    const named = rules.find((r) => r.includes("anexa-solar"));
    expect(named, "the solar document declares its own page box").toBeTruthy();
    expect(named).toMatch(/size:\s*11in\s+8\.5in/);
    expect(named).not.toMatch(/size:\s*letter/);
    // Zero margin is the only thing denying Chrome somewhere to draw the date,
    // the tab title and the page URL.
    expect(named).toMatch(/margin:\s*0(px)?\b/);

    // The app-wide box is still portrait: this document changed its own paper,
    // not the contracts' and not the roofing proposal's.
    const appWide = rules.find((r) => !r.includes("anexa-solar"));
    expect(appWide, "globals.css still sets the app-wide page box").toBeTruthy();
    expect(appWide).toMatch(/size:\s*8\.5in\s+11in/);

    const usesNamed = await page.evaluate(
      () => getComputedStyle(document.documentElement).page,
    );
    expect(usesNamed, "the document actually claims the named box").toBe("anexa-solar");
  });

  test("every sheet carries something", async ({ page }) => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);
    await page.emulateMedia({ media: "print" });

    /*
      `preferCSSPageSize`, never `format` — a format OVERRIDES the document's
      own @page box, which is where both the landscape size and the zero margin
      live, and would render something that looks fine and is not the document.
      This mirrors renderProposalPdf exactly.
    */
    const buf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
    });
    const doc = await getDocument({ data: new Uint8Array(buf) }).promise;

    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const { width, height } = p.getViewport({ scale: 1 });
      expect(Math.round(width), `page ${i} landscape width in pt`).toBe(792);
      expect(Math.round(height), `page ${i} landscape height in pt`).toBe(612);

      /*
        A chapter that runs a few pixels past the fold prints an extra sheet
        carrying nothing but background, and there is no way to see that from
        the screen. Text is the cheap proxy: the only page in this document that
        legitimately holds none is one that is a photograph, and there is none.
      */
      const text = (await p.getTextContent()).items
        .map((it) => ("str" in it ? it.str : ""))
        .join("")
        .trim();
      expect(text.length, `page ${i} of ${doc.numPages} is a blank sheet`).toBeGreaterThan(0);
    }
  });

  test("the FAQ prints its questions, the disclosures collapse", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);
    await page.emulateMedia({ media: "print" });

    // A <details> that hides its own summary in print would print five answers
    // with no questions attached to them.
    const faq = page.locator("details[data-keep-summary]").first();
    await expect(faq).toBeAttached();
    const faqSummary = await faq.locator("summary").evaluate((el) => getComputedStyle(el).display);
    expect(faqSummary).not.toBe("none");

    const disclosure = page.locator("details:not([data-keep-summary])").first();
    const discSummary = await disclosure
      .locator("summary")
      .evaluate((el) => getComputedStyle(el).display);
    expect(discSummary).toBe("none");
  });
});
