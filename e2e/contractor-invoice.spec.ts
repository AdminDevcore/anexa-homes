import { test, expect, type Page } from "@playwright/test";

/**
 * The contractor-invoice drop box, end to end.
 *
 * The claim under test is a negative one — "nobody can read this from the job"
 * — so most of these assertions are about what is ABSENT. That is deliberate:
 * a folder that merely looks empty while shipping the file to the browser
 * would pass a happy-path test and still leak the document, because a file id
 * is a working URL. So the spec uploads an invoice, takes its real id from
 * Contractor Pay, and then asks the file route for it as the wrong people.
 *
 * See src/lib/contractor-invoice.ts.
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

/** The seeded solar deal, by name — another spec creates a second one. */
async function openSolarDeal(page: Page) {
  await toSolar(page);
  await page.goto("/portal/leads?q=Priya");
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
}

test.describe("contractor invoice drop box", () => {
  test.skip(!FLAG_ON, "the folder is solar-only, and solar is behind SOLAR_VERTICAL_ENABLED");

  test("an invoice goes in on the job and can only be read in Contractor Pay", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await openSolarDeal(page);

    const folders = page.getByTestId("deal-folders");
    await page.getByRole("button", { name: /^Contractor Invoice/ }).click();
    await expect(page.getByRole("button", { name: "All folders" })).toBeVisible({ timeout: 10000 });

    // A letter slot, not a file list: no generic uploader, and the warning that
    // says so out loud before anyone hands over a document.
    await expect(page.getByRole("button", { name: "Submit an invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload here" })).toHaveCount(0);
    await expect(page.getByText(/can't be opened again from the job/)).toBeVisible();

    await folders.locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");
    await expect(page.getByText("Invoice submitted")).toBeVisible({ timeout: 15000 });

    // Submitted — and still not readable. The count moves; nothing else does.
    await expect(page.getByText(/[1-9]\d* invoices? submitted/)).toBeVisible({ timeout: 15000 });
    await expect(folders.locator('a[href^="/portal/files/"]')).toHaveCount(0);
    // No "Move to…" either: refiling it into Other would strip the category the
    // file route reads and undo the whole thing with a dropdown.
    await expect(folders.getByLabel(/^Move .* to another folder$/)).toHaveCount(0);

    // The tile carries the tally back on the grid — "has he billed yet" is a
    // fair question on the job even where "what did he charge" is not.
    await page.getByRole("button", { name: "All folders" }).click();
    await expect(page.getByRole("button", { name: /^Contractor Invoice\s*[1-9]/ })).toBeVisible({
      timeout: 10000,
    });

    // …and it is not offered as a destination for anything else, either.
    await page.getByRole("button", { name: "Upload a file" }).click();
    const options = await page.locator("select option").allInnerTexts();
    expect(options).not.toContain("Contractor Invoice");
    await page.keyboard.press("Escape");

    // Contractor Pay: the one place it opens, with the three auto-tracked
    // facts — which job, who submitted it, when.
    await page.goto("/portal/contractor-pay");
    await expect(page.getByRole("heading", { name: "Contractor Pay" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Priya Raman/ })).toBeVisible({ timeout: 10000 });
    // Uploaded by whoever was signed in — the seeded owner, Marcus Reed.
    await expect(page.getByText("Marcus Reed").first()).toBeVisible();

    const fileHref = await page
      .locator('a[href^="/portal/files/"]')
      .first()
      .getAttribute("href");
    expect(fileHref).toBeTruthy();

    // Accounting holds the permission, so the bytes come back.
    const allowed = await page.request.get(fileHref!);
    expect(allowed.status()).toBe(200);

    /* THE ACTUAL CLAIM. Everyone below can open the deal this invoice is filed
     * on; none of them may open the invoice. `admin` is the one worth naming —
     * it holds nearly every other resource, so a well-meant "admins can do
     * everything" edit to the matrix fails right here. */
    for (const email of ["admin@anexahomes.com", "manager@anexahomes.com", "rep@anexahomes.com"]) {
      await login(page, email);
      const denied = await page.request.get(fileHref!);
      expect(denied.status(), `${email} must not read a contractor invoice`).toBe(403);

      await page.goto("/portal/contractor-pay");
      await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 15000 });
    }
  });

  // Contractor Pay stopped being a sidebar row of its own: it is the second tab
  // on Commissions, because both are money going out on the same payroll run.
  // The gate did not move with it — the tab carries ContractorInvoice:read, so
  // the rep who shares the page never sees the tab.
  test("accounting reaches Contractor Pay from the Commissions tabs; a rep has no tab", async ({
    page,
  }) => {
    await login(page, "accounting@anexahomes.com");
    await page.goto("/portal/commissions");

    const tabs = page.getByRole("navigation", { name: "Pay sections" });
    await expect(tabs.getByRole("link", { name: "Contractor Pay" })).toBeVisible({ timeout: 10000 });
    await tabs.getByRole("link", { name: "Contractor Pay" }).click();
    await page.waitForURL(/\/portal\/contractor-pay$/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Contractor Pay" })).toBeVisible();

    // One sidebar row for both halves, and it stays lit on the second one.
    await expect(page.locator('aside a[href="/portal/commissions"]')).toBeVisible();
    await expect(page.locator('aside a[href="/portal/contractor-pay"]')).toHaveCount(0);

    await login(page, "rep@anexahomes.com");
    await page.goto("/portal/commissions");
    await expect(page.getByRole("heading", { name: "Commissions" })).toBeVisible({ timeout: 10000 });
    // A lone tab is not drawn at all, so there is no strip to hunt through.
    await expect(page.getByRole("navigation", { name: "Pay sections" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Contractor Pay" })).toHaveCount(0);
  });
});

/**
 * The installer's own route to the same slot — the reason any of this exists.
 *
 * No flag guard: this runs on a ROOFING job, deliberately. Roofing has no
 * Contractor Invoice folder, so it is the case where a submitted invoice
 * carries a key the deal's grid does not recognise — the one that would
 * otherwise land it in "Other" and list it by name.
 */
test.describe("the installer submits from his job page", () => {
  test("he can bill a job, and then cannot reopen what he sent", async ({ page }) => {
    await login(page, "installer@anexahomes.com");

    // My Jobs is his: he is named on visits but is not admitted to the
    // customer record, so before this he had no page belonging to a job at all.
    await page.getByRole("link", { name: "My Jobs" }).click();
    await page.waitForURL(/\/portal\/jobs$/, { timeout: 15000 });
    await page.locator('a[href^="/portal/jobs/"]').first().click();
    await page.waitForURL(/\/portal\/jobs\/[0-9a-f-]+$/, { timeout: 15000 });

    await expect(page.getByRole("heading", { name: "Contractor Invoice" })).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles("public/anexa-mark.png");
    await expect(page.getByText("Invoice submitted")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/[1-9]\d* invoices? submitted/)).toBeVisible({ timeout: 15000 });

    // Contractor Pay is not his.
    await page.goto("/portal/contractor-pay");
    await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 15000 });

    // The office sees it, attributed to him by his login and stamped with the
    // upload time — neither of which he was asked to type.
    await login(page, "owner@anexahomes.com");
    await page.goto("/portal/contractor-pay");
    const row = page.locator("tr", { hasText: "Carlos Diaz" }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("Installer / Crew");
    const fileHref = await row.locator('a[href^="/portal/files/"]').getAttribute("href");
    expect(fileHref).toBeTruthy();
    expect((await page.request.get(fileHref!)).status()).toBe(200);

    /* And back as the man who sent it. He uploaded it, he is on the crew, and
     * a roofing crew DOES reach the deal — so every ordinary rule says yes.
     * The answer is still no. */
    await login(page, "installer@anexahomes.com");
    expect((await page.request.get(fileHref!)).status()).toBe(403);
  });
});
