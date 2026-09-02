import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Wait for some text box on the page to be holding exactly this value.
 *
 * The settings lists are edited in place, so a row is an `<input>` with a
 * CONTROLLED value — which never reaches the `value` attribute, so
 * `locator('input[value="…"]')` matches nothing however long you wait. Read the
 * live property instead.
 */
export async function expectRowValue(
  scope: Page | Locator,
  value: string,
  timeout = 15000
): Promise<void> {
  await expect
    .poll(
      () =>
        scope
          .getByRole("textbox")
          .evaluateAll((els, v) => els.some((e) => (e as HTMLInputElement).value === v), value),
      { timeout }
    )
    .toBe(true);
}

/** The opposite: no text box is holding it. */
export async function expectNoRowValue(
  scope: Page | Locator,
  value: string,
  timeout = 15000
): Promise<void> {
  await expect
    .poll(
      () =>
        scope
          .getByRole("textbox")
          .evaluateAll((els, v) => els.some((e) => (e as HTMLInputElement).value === v), value),
      { timeout }
    )
    .toBe(false);
}
