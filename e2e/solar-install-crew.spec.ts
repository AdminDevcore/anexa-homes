import { test, expect, type Page } from "@playwright/test";

/**
 * Staffing and scheduling an install, on the Installation slide.
 *
 * Two things this covers that the app could not do before:
 *
 *  1. The install date is on the slide it schedules, and is settable BEFORE a
 *     job exists — picking one is what opens the job. It used to live in the
 *     Summary sidebar, away from the crew and photos it governs.
 *
 *  2. Installs are staffed by naming people. `Crew`/`CrewMember` exist in the
 *     schema but nothing in the app ever created one, so the crew dropdown hid
 *     itself on every job and production ran with zero crews and zero
 *     assignments. Several people go on one install, each with a role.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function toSolar(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

/**
 * A solar deal of this spec's OWN, not the seeded one.
 *
 * Setting an install date CREATES the job, and a job is not something a spec
 * can undo — there is no delete. Doing that to the shared seeded deal leaves
 * every later spec looking at a deal that has a job when it expects none, which
 * is how `solar-no-insurance`'s leak test started failing on "Supplement" from
 * the Edit Job dialog. Own your fixtures when you are going to mutate them.
 */
async function newSolarDeal(page: Page): Promise<string> {
  await toSolar(page);
  await page.goto("/portal/leads/new");
  const unique = `Crewtest ${Date.now()}`;
  await page.locator("input").first().fill("Install");
  await page.locator("input").nth(1).fill(unique);
  await page.getByRole("button", { name: /Create Appointment/ }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  return page.url().split("/").pop()!;
}

/** Open the Installation slide of the deal's one switcher. */
async function openInstall(page: Page) {
  const slides = page.getByTestId("deal-slides");
  await expect(slides).toBeVisible({ timeout: 15000 });
  await slides.getByRole("tab", { name: "Installation" }).click();
}

test.describe(FLAG_ON ? "solar install crew" : "solar install crew (flag off — skipped)", () => {
  test.skip(!FLAG_ON, "Needs the solar workspace enabled.");

  test("the install date is on the Installation slide, not in the Summary", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await newSolarDeal(page);

    // Gone from the sidebar: it was the only control there that changed the JOB
    // rather than describing the deal.
    const summary = page.getByTestId("deal-summary-cards");
    if (await summary.count()) {
      await expect(summary.getByLabel("Install date")).toHaveCount(0);
    }

    await openInstall(page);
    await expect(page.getByLabel("Install date")).toBeVisible({ timeout: 15000 });
  });

  test("picking a date opens the job, and then people can be put on it", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await newSolarDeal(page);
    await openInstall(page);

    // The seeded solar deal has no job. The date is offered anyway — gating it
    // on an existing job is what used to hide it, and the date is agreed with a
    // homeowner well before the job formally opens.
    const date = page.getByLabel("Install date");
    await expect(date).toBeVisible({ timeout: 15000 });
    await date.fill("2026-11-04");
    await expect(page.getByText(/Install date set|Date saved/)).toBeVisible({ timeout: 15000 });

    // With a job open, the slide carries the crew.
    await openInstall(page);
    await expect(page.getByText(/Nobody assigned yet/)).toBeVisible({ timeout: 15000 });

    // More than one person, which is the whole point: an install is a team.
    //
    // Each add is confirmed by the LIST growing, not by the toast. Sonner
    // toasts linger for seconds, so a second `expect(toast)` happily matches
    // the first one still on screen and the test walks on before the refresh
    // has landed — which is exactly how this spec first passed its way into a
    // one-person crew. The picker is rebuilt from server data on refresh, and
    // clicking it too early re-offers somebody already assigned.
    const crew = page.getByTestId("install-crew");
    const members = crew.getByRole("listitem");

    async function add(nth: number) {
      await crew.getByRole("combobox").click();
      const option = page.getByRole("option").first();
      const name = ((await option.textContent()) ?? "").trim();
      await option.click();
      await crew.getByRole("button", { name: "Add", exact: true }).click();
      await expect(members).toHaveCount(nth, { timeout: 15000 });
      return name;
    }

    const firstName = await add(1);
    const secondName = await add(2);

    // The second did not replace the first: two rows, two different people.
    // Read off the rows themselves rather than off the option labels — an
    // option's text runs the name straight into its role ("Carlos Diazinstaller")
    // with no separator, so slicing it is guesswork.
    expect(firstName).not.toEqual(secondName);
    const removes = await crew.getByLabel(/^Remove /).evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")!.replace(/^Remove /, ""))
    );
    expect(removes).toHaveLength(2);
    expect(new Set(removes).size).toBe(2);

    // Somebody already on the install stops being offered — the action refuses
    // a duplicate anyway, and a name that can only fail is a worse way to learn.
    await crew.getByRole("combobox").click();
    for (const name of removes) {
      await expect(page.getByRole("option", { name: new RegExp(`^${name}`) })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
  });
});
