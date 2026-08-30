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
 *
 *  3. The crew is per VISIT. A job has two dates that send different people —
 *     the install and the AHJ / utility inspection after it — so each date
 *     carries its own list, and the calendar can tell them apart.
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
async function newSolarDeal(page: Page): Promise<{ id: string; name: string }> {
  await toSolar(page);
  await page.goto("/portal/leads/new");
  const unique = `Crewtest ${Date.now()}`;
  await page.locator("input").first().fill("Install");
  await page.locator("input").nth(1).fill(unique);
  await page.getByRole("button", { name: /Create Appointment/ }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  // The name as the calendar renders it, so a spec can pick this deal's events
  // out of a month that also holds the seed's.
  return { id: page.url().split("/").pop()!, name: `Install ${unique}` };
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

    // With a job open, the slide carries the crew — under the date it staffs.
    await openInstall(page);
    await expect(page.getByText(/Nobody on the install yet/)).toBeVisible({ timeout: 15000 });

    // More than one person, which is the whole point: an install is a team.
    //
    // Each add is confirmed by the LIST growing, not by the toast. Sonner
    // toasts linger for seconds, so a second `expect(toast)` happily matches
    // the first one still on screen and the test walks on before the refresh
    // has landed — which is exactly how this spec first passed its way into a
    // one-person crew. The picker is rebuilt from server data on refresh, and
    // clicking it too early re-offers somebody already assigned.
    const crew = page.getByTestId("install-crew-install");
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
    // The label names the visit as well as the person ("Remove X from the
    // install"), because the same person can be on both lists on this page.
    const removes = await crew.getByLabel(/^Remove /).evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")!.replace(/^Remove | from the install$/g, ""))
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

  /**
   * The AHJ / utility inspection that follows the install.
   *
   * Its column already existed and the solar calendar already read it — there
   * was simply nowhere in the app to set one, so it was permanently null. This
   * covers the whole path: the field is on the slide it belongs to, it writes
   * its OWN column (a shared action setting two dates is how the second one
   * ends up in the first one's column), and both dates come out on the calendar
   * next to the appointment.
   */
  test("the inspection date reads as following the install, and both reach the calendar", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const { name } = await newSolarDeal(page);
    await openInstall(page);

    const install = page.getByLabel("Install date");
    const inspection = page.getByLabel("Inspection date");
    await expect(install).toBeVisible({ timeout: 15000 });
    await expect(inspection).toBeVisible();

    // NEXT month, not this one: a day cell shows only its first three events,
    // and the seed puts its appointments around today. One month out the two
    // days are the deal's own.
    const anchor = new Date();
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() + 1);
    const on = (day: number) =>
      `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // The first date opens the job, so its toast is the one that says so.
    await install.fill(on(10));
    await expect(page.getByText(/Install date set — the job is now open/)).toBeVisible({ timeout: 15000 });

    // Re-read the input: the save refreshes the route, which replaces it.
    await openInstall(page);
    await page.getByLabel("Inspection date").fill(on(20));
    await expect(page.getByText(/Date saved/)).toBeVisible({ timeout: 15000 });

    // The install date is NOT what got overwritten — the two are separate
    // columns, and the slide still reads the one set a moment ago.
    await openInstall(page);
    await expect(page.getByLabel("Install date")).toHaveValue(on(10));
    await expect(page.getByLabel("Inspection date")).toHaveValue(on(20));

    // The two cards sit side by side now, so the inspection says in words what
    // being underneath used to imply — and this is the assertion that matters,
    // because it is also what catches an inspection booked BEFORE its install.
    await expect(page.getByText("10 days after the install")).toBeVisible();

    await page.goto("/portal/calendar");
    await page.getByLabel("Next month").click();
    // Titled by type, so this asserts each date landed on its own kind of event
    // rather than two of the same.
    await expect(page.getByTitle(`Install · ${name}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTitle(`Inspection · ${name}`)).toBeVisible({ timeout: 15000 });
  });

  /**
   * Two visits, two crews, one job.
   *
   * The failure this replaces: one flat list per job that could not say WHICH
   * date somebody was on. The office could add people and still not answer "who
   * is going out on the inspection", and nothing could be filtered onto the
   * right person's calendar because the fact was never recorded.
   */
  test("the install crew and the inspection crew are staffed separately", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    const { name } = await newSolarDeal(page);
    await openInstall(page);

    const anchor = new Date();
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() + 1);
    const on = (day: number) =>
      `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    await page.getByLabel("Install date").fill(on(12));
    await expect(page.getByText(/the job is now open/)).toBeVisible({ timeout: 15000 });
    await openInstall(page);
    await page.getByLabel("Inspection date").fill(on(22));
    await expect(page.getByText(/Date saved/)).toBeVisible({ timeout: 15000 });
    await openInstall(page);

    const installCrew = page.getByTestId("install-crew-install");
    const inspectionCrew = page.getByTestId("install-crew-inspection");
    await expect(installCrew).toBeVisible({ timeout: 15000 });
    await expect(inspectionCrew).toBeVisible();

    // Each list is staffed from its own picker, and the two must not be the
    // same list rendered twice.
    async function addTo(list: typeof installCrew, index: number) {
      await list.getByRole("combobox").click();
      const option = page.getByRole("option").nth(index);
      const label = ((await option.textContent()) ?? "").trim();
      await option.click();
      await list.getByRole("button", { name: "Add", exact: true }).click();
      await expect(list.getByRole("listitem")).toHaveCount(1, { timeout: 15000 });
      return label;
    }

    const onInstall = await addTo(installCrew, 0);
    const onInspection = await addTo(inspectionCrew, 1);
    expect(onInstall).not.toEqual(onInspection);

    // One name each — adding to the install did not add to the inspection.
    await expect(installCrew.getByRole("listitem")).toHaveCount(1);
    await expect(inspectionCrew.getByRole("listitem")).toHaveCount(1);

    // The person on the install is not on the inspection's list, and vice
    // versa. Read off the remove labels, which name both the person and the
    // visit, rather than off option text that runs a name into its role.
    const namesOn = async (list: typeof installCrew, visit: string) =>
      list.getByLabel(new RegExp(`^Remove .* from the ${visit}$`)).evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label")!.replace(new RegExp(`^Remove | from the .*$`, "g"), ""))
      );
    const installNames = await namesOn(installCrew, "install");
    const inspectionNames = await namesOn(inspectionCrew, "inspection");
    expect(installNames).toHaveLength(1);
    expect(inspectionNames).toHaveLength(1);
    expect(installNames[0]).not.toEqual(inspectionNames[0]);

    // …and the calendar carries each crew on its own event, which is the whole
    // point: the event now says who is going, not just that it is happening.
    await page.goto("/portal/calendar");
    await page.getByLabel("Next month").click();
    const install = page.getByTitle(new RegExp(`^Install · ${name}`));
    await expect(install).toBeVisible({ timeout: 15000 });
    await install.click();
    await expect(page.getByTestId("calendar-event-crew")).toHaveText(installNames[0]);
    await page.keyboard.press("Escape");

    const inspection = page.getByTitle(new RegExp(`^Inspection · ${name}`));
    await expect(inspection).toBeVisible({ timeout: 15000 });
    await inspection.click();
    await expect(page.getByTestId("calendar-event-crew")).toHaveText(inspectionNames[0]);
  });

  /**
   * Assigning somebody who cannot open this workspace.
   *
   * The seeded installer is granted ROOFING only, so a solar install will never
   * reach their calendar no matter how correctly it is assigned. That is the
   * exact shape of the bug this feature fixes, so it must not be reintroduced
   * silently: the office is told at the moment it assigns, not on the day.
   */
  test("staffing someone without this workspace says so", async ({ page }) => {
    await login(page, "admin@anexahomes.com");
    await newSolarDeal(page);
    await openInstall(page);
    await page.getByLabel("Install date").fill("2026-12-09");
    await expect(page.getByText(/the job is now open/)).toBeVisible({ timeout: 15000 });
    await openInstall(page);

    const crew = page.getByTestId("install-crew-install");
    await crew.getByRole("combobox").click();
    const option = page.getByRole("option", { name: /no access to this workspace/ }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    await option.click();
    await crew.getByRole("button", { name: "Add", exact: true }).click();

    await expect(crew.getByText(/No workspace access/)).toBeVisible({ timeout: 15000 });
  });
});
