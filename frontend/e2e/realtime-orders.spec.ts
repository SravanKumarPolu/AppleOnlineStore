import { expect, test } from '@playwright/test';
import { openSignUpForm } from './helpers';

const API_BASE =
  process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_PORT || 3001}`;
const ADMIN_BASE = `http://localhost:${process.env.E2E_ADMIN_PORT || 5174}`;

test('a shopper sees the admin order-status change without refreshing', async ({
  browser,
  page: shopperPage,
}) => {
  const shopperEmail = `realtime-shopper-${Date.now()}@example.com`;
  await shopperPage.goto('/login');
  const signUpForm = await openSignUpForm(shopperPage);
  await signUpForm.getByRole('textbox', { name: 'Full Name' }).fill('Ete Shopper');
  await signUpForm.getByRole('textbox', { name: 'Email Address' }).fill(shopperEmail);
  await signUpForm.getByRole('textbox', { name: 'Password' }).fill('E2e!Pass123');
  await signUpForm.getByRole('button', { name: 'Create Account' }).click();
  await expect
    .poll(() => shopperPage.evaluate(() => localStorage.getItem('token') ?? ''))
    .not.toBe('');

  await shopperPage.goto('/orders');
  await expect(shopperPage.getByRole('status')).toContainText('Live updates on');

  const adminPage = await browser.newPage();
  try {
    await adminPage.goto(`${ADMIN_BASE}/orders`);
    await adminPage.getByLabel('Email Address').fill('e2e-admin@example.com');
    await adminPage.getByLabel('Password').fill('e2e-admin-password-1');
    await adminPage.getByRole('button', { name: 'Sign In' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Order Management' })).toBeVisible();
    await expect(adminPage.getByRole('status')).toContainText('Live updates on');

    const placed = await shopperPage.evaluate(async (apiBase) => {
      const token = localStorage.getItem('token') ?? '';
      const catalogResponse = await fetch(`${apiBase}/api/product/list?limit=100`);
      const catalog = await catalogResponse.json();
      const product = catalog.products.find(
        (candidate: { name: string }) => candidate.name === 'iPhone 15 Pro E2E'
      );
      if (!product) throw new Error('E2E catalog product is unavailable');

      const response = await fetch(`${apiBase}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          items: [
            {
              productId: product._id,
              name: product.name,
              image: product.image[0],
              price: product.price,
              quantity: 1,
              color: product.color[0],
            },
          ],
          address: {
            firstName: 'E2E',
            lastName: 'Shopper',
            email: 'realtime@example.com',
            street: '1 E2E Street',
            city: 'Springfield',
            state: 'IL',
            zipcode: '62701',
            country: 'USA',
            phone: '5550100',
          },
          paymentMethod: 'COD',
        }),
      });
      return { status: response.status, body: await response.json() };
    }, API_BASE);

    expect(placed.status).toBe(200);
    expect(placed.body.success).toBe(true);

    await expect(adminPage.getByText('New order received')).toHaveCount(1);
    const adminOrder = adminPage.locator('.card-elevated').filter({ hasText: shopperEmail });
    await expect(adminOrder.first()).toBeVisible();
    await adminOrder
      .locator('button:not([disabled])')
      .filter({ hasText: /^Packing$/ })
      .first()
      .click();

    const shopperOrder = shopperPage
      .locator('div.bg-white.rounded-lg.shadow-md')
      .filter({ hasText: 'iPhone 15 Pro E2E' });
    await expect(shopperOrder.getByText('Packing', { exact: true })).toBeVisible();
  } finally {
    await adminPage.close();
  }
});
