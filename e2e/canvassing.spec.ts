import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

// Auto-loaded house dots stream in from the live OSM API and re-render the
// markers, which can detach an open popup mid-click. So: wait for the map to
// settle, then click pins with short, retried clicks until one opens its action
// card. Returns when the detail dialog is open.
async function openADotDetail(page: Page) {
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });
  await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 20000 });

  // Poll until the "Loading houses/pins…" pill is gone so markers stop moving.
  const loader = page.getByText(/Loading (houses|pins)…/);
  for (let t = 0; t < 30; t++) {
    if (!(await loader.isVisible().catch(() => false))) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000);

  const pins = page.locator(".anexa-knock-pin");
  await expect(pins.first()).toBeVisible({ timeout: 10000 });
  for (let attempt = 0; attempt < 4; attempt++) {
    const n = await pins.count();
    for (let i = 0; i < n; i++) {
      const bb = await pins.nth(i).boundingBox().catch(() => null);
      if (!bb) continue;
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(250);
      const details = page.getByRole("button", { name: "Details" }).first();
      if (!(await details.isVisible().catch(() => false))) continue;
      // Bound the click so a detach (marker re-render) doesn't burn the budget.
      const clicked = await details.click({ timeout: 2500 }).then(() => true).catch(() => false);
      if (!clicked) continue;
      // Wait for the detail card's content to actually render (not just an empty
      // dialog shell whose fetch is still in flight under parallel load).
      const ready = await page
        .getByRole("dialog")
        .getByText("Estimated property value")
        .isVisible({ timeout: 10000 })
        .catch(() => false);
      if (ready) return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Could not open a house dot detail card");
}

test("canvassing: rep sees their seeded knocks but cannot draw territories", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.getByRole("heading", { name: "Canvassing" })).toBeVisible();
  // Seeded: rep has 1 "Sold" knock.
  await expect(page.getByRole("button", { name: /Sold/ })).toContainText("1", { timeout: 10000 });
  // Reps cannot draw/manage territories.
  await expect(page.getByRole("button", { name: /Draw territory/ })).toHaveCount(0);
});

test("canvassing: blank house pins are tracked as 'Not Knocked' with territory progress", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  // Seeded territory: 4 knocked + 4 not-knocked = 8 houses.
  await expect(page.getByRole("button", { name: /Not Knocked/ })).toContainText("4", { timeout: 10000 });
  await expect(page.getByText("Houses", { exact: true }).locator("..")).toContainText("8");
  await expect(page.getByText("Knocked", { exact: true }).locator("..")).toContainText("4");
  // Remaining-only filter exists.
  await expect(page.getByRole("button", { name: "Remaining only" })).toBeVisible();
});

test("canvassing: manager can draw territories and filter by rep", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.getByRole("button", { name: /Draw territory/ })).toBeVisible({ timeout: 10000 });
  // Manager gets the rep filter (sees all reps' activity).
  await expect(page.getByRole("combobox").filter({ hasText: /All reps/ })).toBeVisible();
});

test("canvassing: only house dots are actionable — empty taps create no pin", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible({ timeout: 10000 });
  await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(3000);

  // Tapping empty space must NOT open any pin/dialog (no manual pins).
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.94, box.y + box.height * 0.05);
  await page.waitForTimeout(700);
  expect(await page.getByRole("dialog").count()).toBe(0);

  // Tapping a pre-generated house dot opens its action popup.
  const pins = page.locator(".anexa-knock-pin");
  await expect(pins.first()).toBeVisible({ timeout: 10000 });
  const n = await pins.count();
  let opened = false;
  for (let i = 0; i < n; i++) {
    const bb = await pins.nth(i).boundingBox();
    if (!bb) continue;
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForTimeout(300);
    if (await page.getByRole("button", { name: "Details" }).first().isVisible().catch(() => false)) {
      opened = true;
      break;
    }
  }
  expect(opened).toBe(true);
});

test("canvassing: convert a house dot to an appointment creates a task", async ({ page }) => {
  test.setTimeout(120000); // first-hit route compile + map interaction can be slow
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await openADotDetail(page);
  await expect(page.getByRole("button", { name: /Book appointment time/ })).toBeVisible({ timeout: 10000 });
  await page.locator('input[type="datetime-local"]').fill("2026-06-10T14:30");
  await page.getByRole("button", { name: /Book appointment time/ }).click();
  await expect(page.getByText(/Appointment booked/)).toBeVisible({ timeout: 10000 });
});

test("canvassing: a house dot shows a property value and carries it into a converted lead", async ({ page }) => {
  test.setTimeout(120000); // first-hit route compile + map interaction can be slow
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await openADotDetail(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Estimated property value")).toBeVisible({ timeout: 10000 });
  // Value resolves to a dollar figure (demo AVM provider, no key needed).
  await expect(dialog.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 15000 });

  // Convert to a lead and confirm the value lands on the lead page.
  await dialog.getByRole("button", { name: /Create appointment from this house/ }).click();
  const convert = page.getByRole("dialog");
  await expect(convert.getByText(/will become an appointment/)).toBeVisible({ timeout: 10000 });
  await convert.getByRole("button", { name: "Create appointment", exact: true }).click();
  await expect(page.getByText(/Appointment created from knock/)).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Open appointment" }).click();
  await page.waitForURL("**/portal/leads/**", { timeout: 10000 });
  await expect(page.getByText("Property Value")).toBeVisible({ timeout: 10000 });
});

test("canvassing: manager can draw a territory on the map", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible({ timeout: 10000 });
  await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const box = (await map.boundingBox())!;
  await page.getByRole("button", { name: /Draw territory/ }).click();
  // Draw in the top-right area, away from the seeded center pins/label.
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.15);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.15);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.32);
  await page.getByRole("button", { name: /Finish \(3\)/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("New territory")).toBeVisible({ timeout: 10000 });
  await dialog.getByPlaceholder(/North Frisco/).fill("E2E Zone");
  await dialog.getByRole("button", { name: /Create.*populate/i }).click();
  await expect(page.getByText("Territory created")).toBeVisible({ timeout: 10000 });
});

test("canvassing: leaderboard ranks reps and highlights the viewer", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await page.getByRole("tab", { name: "Leaderboard" }).click();
  await expect(page.getByText("Tyler Brooks")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("(you)")).toBeVisible();
});

test("canvassing: a role without access is redirected", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 10000 });
});
