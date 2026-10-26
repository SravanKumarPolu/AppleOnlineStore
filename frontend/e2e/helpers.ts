// Shared end-to-end helpers.
//
// Why this exists: the login card animates in (100 ms delay, then a 500 ms
// opacity + translate transition). A click dispatched while the card is still
// moving can be computed from the pre-animation box, land outside the toggle and
// silently do nothing — the Firefox leg of the 2026-10-26 matrix run flaked
// exactly this way ("session persists across a full browser refresh" waited the
// full 90 s for a Sign Up form that never appeared). Waiting for the card to
// stop moving costs two frames and removes the race for every caller.
import { expect, type Page } from '@playwright/test';

/** Resolve once the element's box has been identical for two consecutive frames. */
export async function waitForStableBox(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const globalWindow = window as unknown as { __ncLastTop?: number; __ncLastLeft?: number };
      const { top, left } = el.getBoundingClientRect();
      const stable =
        globalWindow.__ncLastTop !== undefined &&
        Math.abs(globalWindow.__ncLastTop - top) < 0.5 &&
        Math.abs((globalWindow.__ncLastLeft ?? left) - left) < 0.5;
      globalWindow.__ncLastTop = top;
      globalWindow.__ncLastLeft = left;
      return stable;
    },
    selector,
    { polling: 'raf' }
  );
}

/**
 * Switch the login page to registration mode and return the Sign Up form.
 *
 * The form is asserted visible within 10 s, so a lost click fails fast and
 * legibly instead of hanging until the test timeout. Callers keep their own
 * assertions on the form's contents.
 */
export async function openSignUpForm(page: Page) {
  const loginForm = page.locator('form[aria-label="Login form"]');
  await expect(loginForm).toBeVisible();
  await waitForStableBox(page, 'form[aria-label="Login form"]');

  await page.getByRole('button', { name: 'Switch to Sign Up mode' }).click();

  const signUpForm = page.getByRole('form', { name: 'Sign Up form' });
  await expect(signUpForm).toBeVisible({ timeout: 10_000 });
  return signUpForm;
}
