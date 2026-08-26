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

/** Open the seeded solar deal and generate a proposal to look at. */
async function openSolarProposalPreview(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });

  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });

  await page.getByRole("link", { name: /Build Proposal/ }).first().click();
  await page.waitForURL(/\/solar-proposal$/, { timeout: 15000 });

  await page.getByRole("button", { name: /Preview & Share/ }).click();
  await page.getByRole("button", { name: /Generate|Re-generate/ }).first().click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(/\/solar-proposal\/preview/, { timeout: 20000 });
}

test.describe(FLAG_ON ? "solar proposal in print" : "solar proposal in print (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");
  test.describe.configure({ timeout: 180_000 });

  test("every dark chapter keeps its background on paper", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarProposalPreview(page);

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
    await openSolarProposalPreview(page);
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

  test("the FAQ prints its questions, the disclosures collapse", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await openSolarProposalPreview(page);
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
