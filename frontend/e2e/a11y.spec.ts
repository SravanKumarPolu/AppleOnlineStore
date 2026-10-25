// Automated accessibility (WCAG 2.1 A/AA subset) via axe-core.
//
// Scope note: axe catches roughly half of real accessibility defects
// mechanically (names, roles, labels, contrast, landmarks, heading order). It
// is a floor, not a conformance certificate — manual keyboard/screen-reader
// testing is still required (documented in the baseline §11).
//
// The scan fails the build on `critical` and `serious` violations. Moderate
// findings are printed but do not fail: they include best-practice rules that
// axe itself does not map to a WCAG success criterion.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SEVERITIES_THAT_FAIL = new Set(['critical', 'serious']);

async function scan(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter((violation) =>
    SEVERITIES_THAT_FAIL.has(violation.impact ?? '')
  );

  if (results.violations.length > 0) {
    // Always surface the full list in the run log so triage does not need a
    // re-run; only the blocking subset fails the assertion.
    console.log(
      `[a11y:${label}] ${results.violations.length} violation(s): ` +
        results.violations
          .map(
            (violation) =>
              `${violation.id}(${violation.impact}, ${violation.nodes.length}: ` +
              violation.nodes
                .slice(0, 3)
                .map((node) => `${node.target.join(' ')} => ${node.html.slice(0, 150)}`)
                .join(' | ') +
              ')'
          )
          .join(', ')
    );
  }

  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
    `blocking a11y violations on ${label}`
  ).toEqual([]);
}

test.describe('accessibility — WCAG 2.1 A/AA subset', () => {
  test('home page has no blocking violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation').first()).toBeVisible();
    await scan(page, 'home');
  });

  test('collection page (filters + grid) has no blocking violations', async ({ page }) => {
    await page.goto('/collection');
    await expect(page.getByText(/Showing \d+ of \d+ products/i)).toBeVisible();
    await scan(page, 'collection');
  });

  test('product detail has no blocking violations', async ({ page }) => {
    await page.goto('/collection');
    await page.locator('a[href^="/product/"]').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await scan(page, 'product');
  });

  test('login form has no blocking violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('form').first()).toBeVisible();
    await scan(page, 'login');
  });
});
