import { test, expect, type Page } from "@playwright/test";

/**
 * THE SOLAR SCREENS AT FOUR WIDTHS.
 *
 * The QA pass that produced ANEXA_SOLAR_QA_REPORT.md could not finish this
 * section: a sibling session had left the tree unable to compile, so no page
 * rendered at any width. This is that section, automated — which is the better
 * home for it anyway, because "does the payroll table still fit on a phone" is
 * a question that wants asking on every commit rather than once.
 *
 * WHAT IT ASSERTS, and deliberately not more:
 *
 *   1. THE PAGE DOES NOT SCROLL SIDEWAYS. A body wider than the viewport is the
 *      one responsive defect that is unambiguous — everything is reachable or
 *      it is not. Judgements about whether a layout looks good are not
 *      something a test should pretend to make.
 *   2. WIDE CONTENT SCROLLS INSIDE ITS OWN BOX. A table that overflows is fine;
 *      a table that overflows the DOCUMENT is not. So an element wider than the
 *      viewport is only a failure when no scrollable ancestor contains it.
 *   3. THE PAGE ACTUALLY RENDERED. Otherwise "no overflow" passes on a 500.
 *
 * A tolerance of 2px absorbs sub-pixel rounding in the layout engine, which
 * otherwise fails a page that is visually exact.
 */

const PASSWORD = "Passw0rd!";
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/**
 * Sign in, retrying once.
 *
 * The dev server this runs against compiles routes on first hit, so a cold
 * `/login` occasionally takes longer than the wait and the submit is lost. That
 * is the harness warming up, not the product — retrying once separates the two
 * instead of leaving a layout suite that fails for reasons unrelated to layout.
 */
async function login(page: Page, email: string) {
  const attempt = async () => {
    await page.context().clearCookies();
    // `domcontentloaded`, not the default `load`: the dev server streams, and a
    // full-load wait races the redirect the login page performs when a session
    // already exists, surfacing as ERR_ABORTED rather than as a failure.
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/portal/**", { timeout: 25_000 });
    /**
     * Let the post-login client navigation finish before anything navigates
     * away. Without it the first `goto` races the redirect and lands back on
     * the dashboard, which reads as a permission rule and is not one.
     *
     * Waiting on the shell rather than on `networkidle`: the dev server holds
     * an HMR websocket open for the life of the page, so the network is never
     * idle and that wait burns its entire timeout on every login.
     */
    await page
      .locator('a[href="/portal/dashboard"]')
      .first()
      .waitFor({ state: "attached", timeout: 15_000 });
  };
  try {
    await attempt();
  } catch {
    await attempt();
  }
}

/**
 * Anything sticking out past the viewport that nothing can scroll to reveal.
 *
 * Walking ancestors rather than trusting `overflow-x: auto` on the element
 * itself: the pattern in this codebase is a wrapper div that scrolls around a
 * table that does not, so asking the wide element about its own overflow would
 * report every one of them as broken.
 */
async function unreachableOverflow(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 2;
    const scrollable = (el: Element | null): boolean => {
      while (el && el !== document.body && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if (
          (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden") &&
          el.scrollWidth > el.clientWidth
        ) {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };
    return [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (r.right <= limit) return false;
        return !scrollable(el.parentElement);
      })
      .slice(0, 5)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 4).join(".") : "";
        return `<${el.tagName.toLowerCase()} class="${cls}"> right=${Math.round(r.right)} limit=${limit}`;
      });
  });
}

/**
 * Go there, tolerating a page that redirects.
 *
 * Several portal routes are permission-aware and send some roles somewhere
 * else; Playwright reports the superseded navigation as ERR_ABORTED. That is
 * routing behaviour, not a layout defect, and this spec is about layout — so
 * the abort is absorbed and whatever the browser settled on is measured.
 */
async function visit(page: Page, path: string) {
  const once = async () => {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    } catch (err) {
      if (!String(err).includes("ERR_ABORTED")) throw err;
      await page.waitForLoadState("domcontentloaded");
    }
  };
  await once();
  // One retry when a still-settling client navigation stole the first attempt.
  // A route that genuinely redirects lands in the same place twice, so this
  // separates a race from a permission rule rather than papering over both.
  if (new URL(page.url()).pathname !== path) await once();
}

async function documentScrollsSideways(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: de.scrollWidth > de.clientWidth + 2 };
  });
}

test.describe("solar screens are usable at every width", () => {
  // Six page loads against a dev server that compiles on first hit, plus a
  // possible login retry. The default 30s is a cold-start budget, not a
  // statement about how long any of this should take.
  test.describe.configure({ timeout: 120_000 });

  test.skip(!FLAG_ON, "Solar workspace is behind SOLAR_VERTICAL_ENABLED.");

  /**
   * The pages the report named, plus the two that carry the widest content —
   * payroll (a money table) and the proposal builder (a five-step form).
   * `leadId` is resolved at run time from the pipeline rather than hardcoded,
   * so the spec survives a reseed.
   */
  const STATIC_PAGES = [
    ["Pipeline", "/portal/pipeline"],
    ["Payroll", "/portal/payroll"],
    ["Reports", "/portal/reports"],
    // `/portal/documents` is deliberately absent: it redirects to the dashboard
    // for roles whose workspace has no templates, so measuring it measures the
    // dashboard under the wrong name. The landing assertion below is what
    // caught that, and it is worth more than the extra page.
    ["Commissions", "/portal/commissions"],
    ["Solar settings", "/portal/settings/solar"],
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`${vp.name} — ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page, "admin@anexahomes.com");

      const failures: string[] = [];

      for (const [label, path] of STATIC_PAGES) {
        await visit(page, path);
        // Rendered at all — otherwise "no overflow" passes on an error page.
        await expect(page.locator("body")).not.toBeEmpty();
        /**
         * AND IT IS THE PAGE WE ASKED FOR.
         *
         * Without this the spec silently measures wherever it was sent — a
         * bounce to /login measures the login layout and reports the result
         * under the name of a portal page, which is exactly the false trail the
         * first run of this spec produced.
         */
        const landed = new URL(page.url()).pathname;
        if (landed !== path) {
          failures.push(`${label} @${vp.width}: expected ${path}, landed on ${landed}`);
          continue;
        }

        const doc = await documentScrollsSideways(page);
        const stuck = await unreachableOverflow(page);
        if (doc.over && stuck.length > 0) {
          failures.push(`${label} @${vp.width}: document ${doc.scrollW}px > ${doc.clientW}px — ${stuck.join(" | ")}`);
        }
      }

      expect(failures, failures.join("\n")).toEqual([]);
    });
  }

  test("the deal page and the proposal builder fit a phone", async ({ page }) => {
    // The two densest solar screens, at the width that breaks things.
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "admin@anexahomes.com");

    await visit(page, "/portal/pipeline");
    // The board renders its cards client-side, so give them a moment before
    // deciding there is nothing to open.
    const dealLink = page.locator('a[href^="/portal/leads/"]').first();
    await dealLink.waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
    if ((await dealLink.count()) === 0) test.skip(true, "No deal in the seeded pipeline to open.");
    const href = await dealLink.getAttribute("href");
    expect(href).toBeTruthy();

    for (const path of [href!, `${href}/solar-proposal`]) {
      await visit(page, path);
      await expect(page.locator("body")).not.toBeEmpty();
      const doc = await documentScrollsSideways(page);
      const stuck = await unreachableOverflow(page);
      expect(
        doc.over && stuck.length > 0,
        `${path} @390: ${doc.scrollW}px > ${doc.clientW}px — ${stuck.join(" | ")}`
      ).toBe(false);
    }
  });
});
