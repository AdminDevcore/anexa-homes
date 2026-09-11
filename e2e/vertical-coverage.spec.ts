import { test, expect, type Page } from "@playwright/test";

/**
 * PREFLIGHT: the suite must cover every workspace the app has switched on.
 *
 * This runs as its own Playwright project that every other project depends on,
 * so it goes first and a failure stops the run. That is deliberate. The defect
 * it guards is not a broken test — it is a run that passes while testing
 * nothing, and the only symptom is a skip count nobody reads.
 *
 * WHAT WENT WRONG. `.env` sets SOLAR_VERTICAL_ENABLED=1. `next dev` loads
 * `.env`; the Playwright runner did not. So the app booted with Solar ON while
 * the runner saw `undefined`, and 20 spec files called `test.skip()` on the ~84
 * tests covering it. Every run reported green. e2e/load-env.ts fixes the cause;
 * this file makes sure nobody can reintroduce it quietly, because a skip is not
 * a failure and a green run is not evidence.
 *
 * WHY IT ASKS THE APP INSTEAD OF READING THE VARIABLE AGAIN. Comparing
 * `process.env` to `process.env` is a tautology — it would have passed happily
 * throughout the entire period the bug existed. The only honest question is what
 * the SERVER decided, so this logs in and reads the workspace switcher, which
 * renders exactly what `userVerticals()` resolved on the server for a
 * super_admin (who is granted every live vertical). One process is asked; the
 * other is compared against it.
 */

const PASSWORD = "Passw0rd!";

/**
 * The env var that gates each vertical's specs, mirroring what the 20 spec files
 * ask. `roofing` has no flag: it is always on and nothing skips it.
 *
 * Adding a third vertical means adding it here. If you forget, this test fails
 * the moment the app starts offering it — which is the intended failure, not an
 * inconvenience: a workspace nobody tests is how this happened the first time.
 */
const FLAG_BY_VERTICAL: Record<string, string | null> = {
  Roofing: null,
  Solar: "SOLAR_VERTICAL_ENABLED",
};

/** True when the RUNNER would let that vertical's specs run rather than skip. */
function runnerCovers(vertical: string): boolean {
  const flag = FLAG_BY_VERTICAL[vertical];
  if (flag === null) return true;
  const v = process.env[flag];
  return v === "1" || v === "true";
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 30000 });
}

/**
 * What the SERVER is offering, read off the rendered header.
 *
 * Three shapes, because portal-shell has three:
 *   - a switcher menu, when more than one workspace is available;
 *   - a plain badge, when exactly one is;
 *   - NOTHING AT ALL, when the multi-vertical flag is off — the layout passes
 *     `vertical={null}` and the control is not rendered in any form.
 *
 * The third is why this anchors on the header landmark first. "No switcher on
 * the page" is also what a failed login, a redirect or a half-rendered page
 * looks like, and treating those as "one workspace" would let this test pass by
 * failing to look — the exact failure mode it exists to catch.
 */
async function workspacesOfferedByTheApp(page: Page): Promise<string[]> {
  await expect(
    page.getByRole("banner"),
    "the portal header never rendered, so this test cannot tell what the app is " +
      "offering and refuses to guess"
  ).toBeVisible({ timeout: 30000 });

  const switcher = page.getByTestId("workspace-switcher");
  const badge = page.getByTestId("workspace-badge");

  if (await switcher.count()) {
    await switcher.click();
    const items = page.getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    return (await items.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  }

  if (await badge.count()) return [(await badge.innerText()).trim()];

  // Header rendered, no workspace control in it: the single-workspace build.
  // DEFAULT_VERTICAL in src/lib/vertical.ts decides which one that is.
  return ["Roofing"];
}

test("the suite covers every workspace the app has switched on", async ({ page }) => {
  // The owner is granted every live vertical, so what they are offered is what
  // the build has enabled — not a reflection of one user's grant list.
  await login(page, "owner@anexahomes.com");
  const offered = await workspacesOfferedByTheApp(page);

  const skipped = offered.filter((v) => !runnerCovers(v));
  const unknown = offered.filter((v) => !(v in FLAG_BY_VERTICAL));

  expect(
    unknown,
    `The app is offering a workspace this preflight does not know about: ${unknown.join(", ")}. ` +
      `Add it to FLAG_BY_VERTICAL in this file, with the env var that gates its specs ` +
      `(or null if nothing does), so it cannot go untested in silence.`
  ).toEqual([]);

  expect(
    skipped,
    `The app has ${skipped.join(", ")} switched ON, but the runner will SKIP every spec ` +
      `covering it — so this run would report green while testing none of it.\n\n` +
      `Fix by making the two agree:\n` +
      `  • to test it:        ${skipped
        .map((v) => `${FLAG_BY_VERTICAL[v]}=1`)
        .join(" ")} pnpm e2e\n` +
      `  • to not ship it:    unset ${skipped
        .map((v) => FLAG_BY_VERTICAL[v])
        .join(", ")} so the app stops offering it too\n\n` +
      `e2e/load-env.ts should make this impossible by loading .env into the runner. ` +
      `If you are seeing this anyway, something is setting the variable for the app ` +
      `alone — check webServer.env in playwright.config.ts.`
  ).toEqual([]);

  // The mirror image: the runner expecting a workspace the app does not serve.
  // Those specs do not skip — they run and fail in confusing ways, a page at a
  // time, and the cause looks like a broken feature rather than a flag.
  const expectedButAbsent = Object.keys(FLAG_BY_VERTICAL).filter(
    (v) => runnerCovers(v) && FLAG_BY_VERTICAL[v] !== null && !offered.includes(v)
  );
  expect(
    expectedButAbsent,
    `The runner has ${expectedButAbsent
      .map((v) => FLAG_BY_VERTICAL[v])
      .join(", ")} set, so those specs will RUN, but the app is not offering ` +
      `${expectedButAbsent.join(", ")} — they will fail as if the feature were broken.`
  ).toEqual([]);
});
