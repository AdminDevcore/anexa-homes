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

    /*
      The order is fixed; the MEMBERSHIP is not. Three chapters are conditional
      on what the snapshot actually carries — `year` needs twelve months of
      measured usage, `savings` can be switched off by the rep, and neither is
      a defect when it is absent. So this asserts the sequence is a subsequence
      of the document's designed order rather than pinning a list that a
      perfectly good proposal would fail.
    */
    const ORDER = ["cover", "today", "system", "cost", "pay", "savings", "year", "timeline", "accept"];
    const ids = chapters.map((c) => c.id);
    expect(ids[0]).toBe("cover");
    expect(ids).toEqual(ORDER.filter((id) => ids.includes(id)));
    // The chapters that are never optional.
    expect(ids).toEqual(expect.arrayContaining(["cover", "today", "system", "cost", "pay", "timeline", "accept"]));

    // The cover owns the first sheet; everything after it starts a new one.
    expect(chapters.slice(1).every((c) => c.breakBefore === "page")).toBe(true);
  });

  /*
    THE DIRECT TEST FOR THE DEFECT THE 2026-08-30 REBUILD EXISTED TO FIX.

    Six chapters used to print as nine sheets, and four of those sheets carried
    no chapter mark at all — they were continuations that read as leftovers. A
    sheet without a mark is the signature of a chapter that overflowed, so this
    asserts the two things that together make that impossible: every chapter
    carries its own mark, and no chapter is taller than the sheet it is drawn
    on.
  */
  test("no chapter overflows its sheet, and every chapter is marked", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);
    await page.emulateMedia({ media: "print" });
    // The page box, at CSS pixels: 8.5in tall at 96dpi.
    await page.setViewportSize({ width: 1056, height: 816 });

    const sheets = await page.evaluate(() => {
      const SHEET = 816;
      return Array.from(document.querySelectorAll<HTMLElement>("#proposal-root [data-chapter]")).map(
        (el) => ({
          id: el.getAttribute("data-section"),
          over: Math.round(el.getBoundingClientRect().height - SHEET),
          // The cover is the one chapter with no numbered mark — it is the
          // cover, and numbering it "00 / 08" would be furniture.
          marked:
            el.getAttribute("data-section") === "cover" ||
            !!el.querySelector("[data-chapter-head]"),
        }),
      );
    });

    const unmarked = sheets.filter((s) => !s.marked).map((s) => s.id);
    expect(unmarked, `these sheets carry no chapter mark: ${unmarked.join(", ")}`).toEqual([]);

    // A few pixels of rounding is not an orphan sheet; a chapter that genuinely
    // runs long is. 8px of tolerance, then it is a defect.
    const spilling = sheets.filter((s) => s.over > 8).map((s) => `${s.id} (+${s.over}px)`);
    expect(
      spilling,
      `these chapters run past their sheet and will print a continuation with no mark on it: ${spilling.join(", ")}`,
    ).toEqual([]);
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

  test("nothing in the document is hidden behind a disclosure on paper", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await documentOrSkip(page);
    await page.emulateMedia({ media: "print" });

    /*
      This used to assert that the FAQ's <details> kept its summary and the
      disclosures' dropped theirs. There are no <details> in the document any
      more: the questions and the assumptions live in the back matter, open, as
      ordinary markup — which is the same guarantee reached by removing the
      mechanism rather than by configuring it.

      The assertion that matters is unchanged and is now structural: no part of
      this document may be collapsed on paper, because a collapsed element
      prints as nothing and the things it would hide are the assumptions and
      the disclosures.
    */
    const collapsed = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLDetailsElement>("#proposal-root details"))
        .filter((el) => getComputedStyle(el).display === "none" || !el.open)
        .map((el) => el.querySelector("summary")?.textContent?.trim() ?? "(unlabelled)"),
    );
    expect(
      collapsed,
      `these would print as nothing: ${collapsed.join(" · ")}`,
    ).toEqual([]);

    // The questions and their answers both reach the paper.
    await expect(page.getByText("Common questions")).toBeAttached();
    await expect(
      page.getByText("What happens if the system makes more power than I use?"),
    ).toBeAttached();
    await expect(page.getByText("Assumptions used in this proposal")).toBeAttached();
  });
});
