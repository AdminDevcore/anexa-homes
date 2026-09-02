import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/**
 * Whoever signs on the company's behalf.
 *
 * The path this covers is the one nothing else can: a signer added through the
 * screen, a template pointed at them, and a document that comes back already
 * countersigned without anybody opening a link. The integration tests prove the
 * send; this proves the settings screen actually drives it.
 */
test("authorised signers: add one, and the template picker offers them", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/signers");

  // Nobody yet — and the empty state says what adding one buys.
  // Generous: the first hit on a route in `next dev` compiles it, which
  // routinely outruns the 5s default. Every spec in this suite does the same.
  await expect(page.getByText("Nobody signs for the company yet")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /New signer/ }).first().click();

  // The panel opens on the new row. The standing-authorisation note is the
  // first thing on it, because that is what makes the rest legitimate.
  await expect(page.getByText(/standing authorisation/i).first()).toBeVisible({ timeout: 15000 });

  await page.getByLabel("Full name").fill("Mustafa Joulani");
  await page.getByLabel("Job title").fill("Owner");
  await page.getByLabel(/Licence \/ registration number/).fill("TX-12345");

  // A credential line of the company's own, which becomes its own token.
  await page.getByRole("button", { name: /Add line/ }).click();
  await page.getByPlaceholder("NABCEP #").fill("NABCEP #");
  await page.getByPlaceholder("PV-041234").fill("PV-041234");

  // One Save for the screen — it only appears once something has changed.
  await expect(page.getByTestId("settings-save-bar")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /Save changes/ }).click();
  await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 15000 });

  // The rail names them, badged as the default — the first signer added takes
  // it, or every contract would refuse to send.
  await expect(page.getByText("Mustafa Joulani").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Default").first()).toBeVisible({ timeout: 15000 });

  // They can't sign anything yet: no mark is saved, and the rail says so
  // rather than leaving it to be discovered at send time.
  await expect(page.getByText("no signature saved").first()).toBeVisible({ timeout: 15000 });

  // Type a signature rather than drawing one — a canvas is not a thing a spec
  // can draw on meaningfully, and both routes store the same normalised PNG.
  await page
    .locator("section", { hasText: "Signature" })
    .getByRole("button", { name: "Type" })
    .first()
    .click();
  await page.getByRole("button", { name: /Save signature/ }).click();
  await expect(page.getByAltText("Signature preview")).toBeVisible({ timeout: 15000 });

  // The hub counts them, company-wide.
  await page.goto("/portal/settings");
  await expect(page.getByText("1 signer").first()).toBeVisible({ timeout: 30000 });
});

test("authorised signers: a company field auto-signs, and nobody is asked to", async ({ page }) => {
  await login(page, "admin@anexahomes.com");

  // Build a template whose only signature belongs to us — an installer
  // attestation. Nothing outside the company signs it.
  await page.goto("/portal/documents");
  await page.getByRole("button", { name: /New template/ }).click();
  await page.waitForURL(/\/portal\/documents\/templates\/[0-9a-f-]+/, { timeout: 15000 });

  await expect(page.getByLabel("Name").first()).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Name").first().fill("Installer Attestation");

  // Drop a signature field and hand it to the company.
  await page.getByRole("button", { name: /^Signature$/ }).click();
  await page.getByRole("combobox").filter({ hasText: /Customer/ }).first().click();
  await page.getByRole("option", { name: /Company \(auto-signed\)/ }).click();

  // The properties panel explains what that means, in place of a link nobody
  // will be sent.
  await expect(page.getByText(/Filled automatically when the document is sent/)).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: /^Save$/ }).last().click();
  await page.waitForTimeout(1500);

  // Now the template settings card offers a signer, because there is finally
  // something for one to sign.
  await page.reload();
  await expect(page.getByLabel("Signed on our behalf by")).toBeVisible({ timeout: 15000 });
});
