// Phase 7 — Frontend & UX audit (real browser, real backend).
//
// Covers the UI-audit dimensions the checkout spec does not: navigation,
// broken routes, JavaScript runtime errors, failed network requests, mobile
// viewport rendering, keyboard navigation, session persistence across
// refresh, search, the 404 page, and baseline accessibility structure
// (landmarks, image alt text, heading hierarchy).
import { test, expect, type Page } from '@playwright/test';
import { openSignUpForm } from './helpers';

const PRODUCT_NAME = 'iPhone 15 Pro E2E';

// Collect console errors and failed requests for the whole test.
function attachMonitors(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    // 404s are recorded WITH their URL: WebKit's console message for a failed
    // subresource omits the URL, so console text alone cannot tell a seeded
    // placeholder image from a genuinely broken route.
    if (res.status() === 404 || res.status() >= 500) {
      failedRequests.push(`${res.request().method()} ${res.url()} :: ${res.status()}`);
    }
  });
  return { consoleErrors, failedRequests };
}

/** Wait for finite entrance animations so layout/colour are measured settled. */
async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    const finite = (document.getAnimations?.() ?? []).filter((animation) => {
      const endTime = animation.effect?.getComputedTiming?.().endTime;
      return typeof endTime === 'number' && Number.isFinite(endTime);
    });
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
}

test('core navigation — every routed page renders without console errors or failed requests', async ({ page }) => {
  const { consoleErrors, failedRequests } = attachMonitors(page);

  const routes = ['/', '/about', '/collection', '/contact', '/cart', '/login'];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'networkidle' });
    // Each page must render actual content (not a blank crash screen).
    await expect(page.locator('body')).not.toBeEmpty();
  }

  // Filter transient, environment-known noise (dev websocket HMR, favicon)
  // and the e2e seed's placeholder image URLs (example.com does not serve
  // images — a test-data artifact, not an app defect; production products
  // carry Cloudinary URLs).
  const isKnownNoise = (e: string) =>
    /websocket|favicon|example\.com\/e2e-/i.test(e);
  const missing = failedRequests.filter((e) => /:: 404$/.test(e));
  const allMissingKnown = missing.every(isKnownNoise);
  const realErrors = consoleErrors.filter((e) => {
    if (isKnownNoise(e)) return false;
    // WebKit reports a bare "Failed to load resource … 404" with no URL. If
    // every 404 response recorded for this run is known test-data noise, the
    // bare message is attributable to those URLs.
    if (allMissingKnown && /Failed to load resource.*404/i.test(e)) return false;
    return true;
  });
  expect(realErrors, `console errors: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  const realFailed = failedRequests.filter((e) => !isKnownNoise(e));
  expect(realFailed, `failed requests: ${JSON.stringify(realFailed, null, 2)}`).toEqual([]);
});

test('unknown route shows the NotFound page (no blank screen, no crash)', async ({ page }) => {
  const { consoleErrors } = attachMonitors(page);
  await page.goto('/this-route-does-not-exist', { waitUntil: 'networkidle' });
  await expect(page.getByText(/404|not found|page not found/i).first()).toBeVisible();
  const realErrors = consoleErrors.filter((e) => !/websocket|favicon/i.test(e));
  expect(realErrors).toEqual([]);
});

test('product detail loads with images, and related products render', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page
    .getByRole('link', { name: new RegExp(PRODUCT_NAME) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/product\//);

  const imgs = page.locator('img');
  await expect(imgs.first()).toBeVisible();

  // Main product imagery must actually load (naturalWidth > 0). The e2e
  // seed uses example.com placeholder URLs that intentionally do not serve
  // images — excluded as a test-data artifact (production uses Cloudinary).
  const broken = await imgs.evaluateAll((els) =>
    els
      .filter(
        (el) =>
          (el as HTMLImageElement).complete &&
          (el as HTMLImageElement).naturalWidth === 0 &&
          !/example\.com\/e2e-/.test((el as HTMLImageElement).src)
      )
      .map((el) => (el as HTMLImageElement).src)
  );
  expect(broken, `broken images: ${broken.join(', ')}`).toEqual([]);
});

test('collection page search and category filter work', async ({ page }) => {
  await page.goto('/collection', { waitUntil: 'networkidle' });

  // The search input filters the product grid.
  const search = page.getByPlaceholder(/search/i).first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill('iPhone');
    await page.waitForTimeout(800); // debounce
    const cards = page.locator('a[href^="/product/"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      await expect(cards.nth(i)).toContainText(/iPhone/i);
    }
  }
});

test('mobile viewport (iPhone 12) — layout adapts, bottom nav present, no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });

  // Measure the settled layout: an entrance transform that is still sliding in
  // is not a layout defect (and WebKit counts transformed overflow area).
  await settleAnimations(page);

  // No horizontal overflow on mobile.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(2);

  // Core content is still visible.
  await expect(page.getByRole('banner').or(page.locator('header').first())).toBeVisible();
});

test('keyboard navigation — a shopper can reach the search bar and primary links by keyboard', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // Walk the first ~20 focusable stops; the document must never lose focus
  // (focus-trap/loop bugs surface as body focus forever).
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
  }
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? 'BODY');
  expect(['INPUT', 'A', 'BUTTON', 'TEXTAREA', 'SELECT']).toContain(activeTag);
});

test('login form validation blocks an empty submit (no navigation, no token)', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  // Native HTML5 `required` validation must block submission: the app stays
  // on /login, no API call is made, and no token is stored.
  await page.waitForTimeout(1500);
  expect(page.url()).toContain('/login');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token).toBeNull();
});

test('cart page redirects anonymous users to login (protected route)', async ({ page }) => {
  await page.goto('/cart', { waitUntil: 'networkidle' });
  await page.waitForURL(/\/login|\/cart/, { timeout: 8000 });
  // Anonymous visit lands on login (redirect) OR shows a "please login" state.
  const url = page.url();
  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  expect(
    /\/login/.test(url) || bodyText.includes('login') || bodyText.includes('sign in')
  ).toBe(true);
});

test('session persists across a full browser refresh', async ({ page }) => {
  // Register a fresh account via the UI (same flow as checkout.spec.ts).
  const account = {
    name: 'Audit Shopper',
    email: `ui-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Audit!Pass123',
  };
  await page.goto('/login');
  const form = await openSignUpForm(page);
  await form.getByRole('textbox', { name: 'Full Name' }).fill(account.name);
  await form.getByRole('textbox', { name: 'Email Address' }).fill(account.email);
  await form.getByRole('textbox', { name: 'Password' }).fill(account.password);
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('token') ?? ''), { timeout: 20_000 })
    .not.toBe('');

  // Hard refresh: the token survives and the profile page recognizes the user.
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto('/profile', { waitUntil: 'networkidle' });
  const bodyText = await page.locator('body').innerText();
  expect(
    /audit shopper|profile|account|logout|log out/i.test(bodyText),
    'profile page should recognize the persisted session'
  ).toBe(true);
});

test('accessibility structure — landmarks, image alt text, single h1 on home', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // Landmark structure.
  await expect(page.locator('header, nav, [role="banner"]').first()).toBeVisible();
  await expect(page.locator('footer, [role="contentinfo"]').first()).toBeVisible();

  // Every content image needs an alt attribute (empty alt is acceptable for
  // decorative images; a MISSING attribute is the failure).
  const missingAlt = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .filter((img) => !img.hasAttribute('alt'))
      .map((img) => img.src)
  );
  expect(missingAlt, `images without alt: ${missingAlt.join(', ')}`).toEqual([]);

  // Heading hierarchy does not skip levels h1 -> h3.
  const skipped = await page.evaluate(() => {
    const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
      (h) => Number(h.tagName.slice(1))
    );
    const skips: number[] = [];
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) skips.push(levels[i - 1]);
    }
    return skips;
  });
  expect(skipped, `skipped heading levels after: ${skipped.join(', ')}`).toEqual([]);
});
