// Checkout E2E (testing-plan gap §5.1) — the COD money path driven through a
// real Chromium against the REAL backend + real MongoDB (in-memory):
// register (UI) -> browse catalog -> product page -> add to cart (server
// cart sync) -> cart page -> checkout form -> COD order -> /orders redirect,
// then the created order is verified through the API with the browser token.
//
// The PayPal branch is intentionally NOT driven here: it needs real sandbox
// credentials + a public HTTPS host (docs/devops/08 checklist, owner action).
import { test, expect, type Page } from '@playwright/test';

const PRODUCT_NAME = 'iPhone 15 Pro E2E';

// Client-side validation only allows letters+spaces in the name — no digits.
// A fresh account is generated per test (duplicate emails 400 by design).
const newAccount = () => ({
  name: 'Ete Shopper',
  email: `e2e-shopper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: 'E2e!Pass123',
});

const address = {
  'First name': 'E2E',
  'Last name': 'Shopper',
  'Email address': 'e2e@example.com',
  Street: '1 E2E Street',
  City: 'Springfield',
  State: 'IL',
  'Zip code': '62701',
  Country: 'USA',
  Phone: '5550100',
};

async function registerViaUi(page: Page) {
  const account = newAccount();
  await page.goto('/login');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Switch to Sign Up mode' }).click();

  // Role-based selectors: the login form labels its inputs (the footer also
  // has a placeholder-only email input that would collide by placeholder).
  const form = page.getByRole('form', { name: 'Sign Up form' });
  await expect(form.getByRole('button', { name: 'Create Account' })).toBeEnabled();
  await form.getByRole('textbox', { name: 'Full Name' }).fill(account.name);
  await form.getByRole('textbox', { name: 'Email Address' }).fill(account.email);
  await form.getByRole('textbox', { name: 'Password' }).fill(account.password);
  await form.getByRole('button', { name: 'Create Account' }).click();

  // The app persists the JWT under localStorage 'token' on success.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('token') ?? ''), {
      timeout: 20_000,
    })
    .not.toBe('');
}

async function verifyOrderViaApi(
  page: Page,
  productName: string,
  expectedMethod: string
) {
  const verification = await page.evaluate(async () => {
    const token = localStorage.getItem('token') ?? '';
    const res = await fetch('http://localhost:3001/api/orders/userorders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({}),
    });
    return res.json();
  });

  expect(verification.success).toBe(true);
  const orders = verification.orders ?? verification.data ?? [];
  const ours = (Array.isArray(orders) ? orders : []).find(
    (o: { items?: Array<{ name?: string }> }) =>
      (o.items ?? []).some((i) => i.name === productName)
  );
  expect(ours, `order containing ${productName} should exist`).toBeTruthy();
  expect(ours.paymentMethod).toBe(expectedMethod);
  expect(ours.paymentStatus).toBe('pending');
  return ours;
}

test('COD checkout in a real browser creates a real order', async ({ page }) => {
  // --- 1. Register through the real signup form --------------------------
  await registerViaUi(page);

  // --- 2. Catalog: the seeded bestseller is browsable on the home page ---
  await page.goto('/');
  const productCard = page.getByRole('link', {
    name: `View details for ${PRODUCT_NAME}`,
  });
  await expect(productCard.first()).toBeVisible();
  await productCard.first().click();

  // --- 3. Product page: pick a color, add to cart (syncs the server cart) -
  const cartSync = page
    .waitForResponse(
      (res) =>
        res.url().includes('/api/cart/add') && res.request().method() === 'POST',
      { timeout: 20_000 }
    )
    .catch(() => null);
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Cart' }).first().click(); // .first(): related-products cards have a quick-add with the same label
  await expect(page.getByText('Added to cart')).toBeVisible();
  await cartSync;

  // --- 4. Cart page shows the item, then proceed to checkout -------------
  await page.goto('/cart');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible();
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page).toHaveURL(/\/place-order/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // --- 5. Fill the delivery form (all inputs are aria-labelled) ----------
  for (const [label, value] of Object.entries(address)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }

  // --- 6. Choose COD explicitly and place the order ----------------------
  await page
    .getByRole('button', { name: 'Select payment method: Cash on Delivery' })
    .click();
  await page.getByRole('button', { name: 'Place order' }).click();

  // --- 7. Success: redirect to /orders + confirmation toast -------------
  await expect(page).toHaveURL(/\/orders/, { timeout: 20_000 });
  await expect(page.getByText('Order placed successfully!')).toBeVisible();

  // --- 8. Verify the persisted order through the API with the UI token ---
  const ours = await verifyOrderViaApi(page, PRODUCT_NAME, 'COD');
  expect(ours.orderStatus).toBe('Order Placed');
  expect(ours.total).toBe(999 + 10); // price + fixed delivery fee

  // --- 9. The order also appears on the orders page in the browser -------
  await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible();
});

test('Card checkout in a real browser also creates a real (pending) order', async ({ page }) => {
  await registerViaUi(page);

  await page.goto('/');
  await page
    .getByRole('link', { name: 'View details for MacBook Air E2E' })
    .first()
    .click();
  await page.getByRole('button', { name: 'Silver', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Cart' }).first().click(); // .first(): related-products cards have a quick-add with the same label
  await expect(page.getByText('Added to cart')).toBeVisible();

  await page.goto('/cart');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  for (const [label, value] of Object.entries(address)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page
    .getByRole('button', { name: 'Select payment method: Credit/Debit Card' })
    .click();
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page).toHaveURL(/\/orders/, { timeout: 20_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await verifyOrderViaApi(page, 'MacBook Air E2E', 'Card');
});

test('Install App is user-initiated and does not block login or signup', async ({ page }) => {
  await page.goto('/login');

  const dialog = page.getByRole('dialog', { name: 'Install NovaCart' });
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Install App' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Maybe Later' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to Sign Up mode' }).click();
  const createAccount = page.getByRole('form', { name: 'Sign Up form' })
    .getByRole('button', { name: 'Create Account' });
  await expect(createAccount).toBeEnabled();
  await createAccount.click();
  await expect(dialog).toHaveCount(0);
});
