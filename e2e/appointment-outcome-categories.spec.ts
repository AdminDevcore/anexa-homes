import { test, expect, type Page } from "@playwright/test";

/**
 * Solar sorts appointments by whether the visit ran; roofing keeps its list
 * exactly as it was. Both halves are asserted, because the owner asked for
 * this on solar only and has asked before to see roofing proven untouched.
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
  // Wait for the dashboard to RENDER as Solar before navigating on, or the next
  // goto() races the workspace cookie and loads the roofing list.
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

test("roofing keeps its appointment chips, with no Counts as and no rep filter", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/leads");
  const status = page.getByRole("group", { name: "Filter by status" });
  await expect(status.getByRole("button", { name: /^All/ })).toBeVisible({ timeout: 30000 });
  await expect(status.getByRole("button", { name: /^Needs outcome/ })).toHaveCount(0);
  await expect(status.getByRole("button", { name: /^Ran/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter by rep" })).toHaveCount(0);

  await page.goto("/portal/settings/appointment-outcomes");
  await expect(page.getByRole("button", { name: "Add outcome" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel(/^Counts as for /)).toHaveCount(0);
});

test.describe("solar", () => {
  test.skip(!FLAG_ON, "the Solar workspace is behind SOLAR_VERTICAL_ENABLED");

  test("an outcome's Counts as is saved and survives a reload", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    await page.goto("/portal/settings/appointment-outcomes");

    const select = () => page.getByLabel("Counts as for Not interested");
    await expect(select()).toHaveValue("ran", { timeout: 30000 });
    await select().selectOption("not_ran");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Outcomes saved")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });

    await page.reload();
    await expect(select()).toHaveValue("not_ran", { timeout: 30000 });

    // Put it back: later specs read this list.
    await select().selectOption("ran");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Outcomes saved")).toBeVisible({ timeout: 15000 });
  });

  test("appointments sort by status, and the rep filter narrows them", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    await page.goto("/portal/leads");

    const status = page.getByRole("group", { name: "Filter by status" });
    await expect(status.getByRole("button", { name: /^All/ })).toBeVisible({ timeout: 30000 });
    for (const label of ["Scheduled", "Needs outcome", "Ran", "Not ran", "Rescheduled", "Unscheduled", "Cancelled"]) {
      await expect(status.getByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`) })).toBeVisible();
    }

    const reps = page.getByRole("group", { name: "Filter by rep" });
    const unassigned = reps.getByRole("button", { name: /^Unassigned/ });
    const count = Number((await unassigned.innerText()).replace(/\D+/g, ""));
    await unassigned.click();
    await expect(unassigned).toHaveAttribute("aria-pressed", "true");
    if (count === 0) {
      await expect(page.getByText("No appointments match")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(count);
    }
  });
});
