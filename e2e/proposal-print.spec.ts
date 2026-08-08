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
