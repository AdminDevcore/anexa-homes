import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function logout(page: Page) {
  await page.context().clearCookies();
}

test("public homepage renders hero + CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Restoring Roofs");
  await expect(page.getByRole("link", { name: /Request Free Roof Inspection/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Team Login/i }).first()).toBeVisible();
});

test("unauthenticated portal access redirects to login", async ({ page }) => {
  await page.goto("/portal/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("super admin lands on dashboard and sees company-wide leads", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await expect(page).toHaveURL(/\/portal\/dashboard/);
  await expect(page.getByText("Total Appointments")).toBeVisible();
  await page.goto("/portal/leads");
  // Seed creates 10 leads; admin should see them all (e.g. Johnson).
  await expect(page.getByRole("cell", { name: /Johnson/ }).first()).toBeVisible();
  await logout(page);
});

test("sales rep can reach dashboard and pipeline", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await expect(page).toHaveURL(/\/portal\/dashboard/);
  await expect(page.getByText(/Welcome back, Tyler/)).toBeVisible();
  await page.goto("/portal/pipeline");
  await expect(page.getByText("Roofing Pipeline")).toBeVisible();
  await logout(page);
});

test("there is no homeowner account to sign in with", async ({ page }) => {
  // This product has no customer portal: homeowners reach proposals, contracts
  // and review requests through public token links, never a login. The seed
  // therefore creates no customer user, and `auth/config.ts` refuses the
  // retired role outright — so this credential cannot get past the sign-in form.
  await page.goto("/login");
  await page.fill("#email", "customer@anexahomes.com");
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page).not.toHaveURL(/\/portal/);
  await logout(page);
});

test("accounting can view payroll, sales rep cannot", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");
  await page.goto("/portal/payroll");
  await expect(page).toHaveURL(/\/portal\/payroll/);
  await expect(page.getByText(/Payroll & Accounting/)).toBeVisible();
  await logout(page);

  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/payroll");
  // Rep lacks Payroll read -> redirected to dashboard.
  await expect(page).not.toHaveURL(/\/portal\/payroll/);
  await logout(page);
});

/**
 * Google sign-in, as far as it can be driven without real Google credentials.
 *
 * The happy path needs an actual OAuth round trip and a Google account, so what
 * is testable here is the two ends: the button appears only when the provider
 * is configured, and a refusal comes back as a sentence rather than an
 * unchanged form. The decision itself is unit-tested in
 * src/lib/__tests__/google-signin.test.ts, which is where the interesting cases
 * live (unverified address, disabled account, ambiguous match).
 */
test("the Google button appears only when the provider is configured", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15000 });

  const button = page.getByRole("button", { name: /Continue with Google/i });
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    await expect(button).toBeVisible();
  } else {
    // A button that can only fail is worse than no button: with no client id
    // the provider is not registered at all, so it must not be offered.
    await expect(button).toHaveCount(0);
  }
});

test("a refused Google sign-in explains itself on the login page", async ({ page }) => {
  // Auth.js collapses every refusal into one AccessDenied code, so the signIn
  // callback redirects with its OWN reason instead. This is that landing.
  await page.goto("/login?error=no_account");
  await expect(page.getByText(/No Anexa account uses that email/i)).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/Ask an admin/i)).toBeVisible();

  // A disabled account is a different answer from a missing one.
  await page.goto("/login?error=account_inactive");
  await expect(page.getByText(/that account is not active/i)).toBeVisible({ timeout: 15000 });

  // Auth.js's own codes land on this same param. Echoing one would show the
  // user a word from a library, so unknown codes render nothing.
  await page.goto("/login?error=AccessDenied");
  await expect(page.getByText(/Ask an admin/i)).toHaveCount(0);
  await expect(page.getByLabel("Email")).toBeVisible();
});
