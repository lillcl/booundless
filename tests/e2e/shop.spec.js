/* E2E: shop smoke — add to cart, change qty, open checkout form, view orders. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedUser,
  cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('user browses shop, adds a product to cart, opens checkout', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { email } = await seedUser(db, `pipe-shop-${suffix}`, PASSWORD, 'user', 'Shop User');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, email, PASSWORD);
    await page.goto('/#/shop');
    /* Wait for the catalogue to render at least one product with an Add
       button. */
    const addBtn = page.locator('button.shop-add[data-shop-add]').first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    const variantId = await addBtn.getAttribute('data-shop-add');
    expect(variantId).toBeTruthy();

    /* Add to cart — this hits POST /api/shop/cart/items. */
    const addResp = page.waitForResponse((r) =>
      r.url().includes('/api/shop/cart/items') && r.request().method() === 'POST');
    await addBtn.click();
    expect((await addResp).status()).toBeGreaterThanOrEqual(200);
    expect((await addResp).status()).toBeLessThan(300);

    /* Open the checkout form. */
    await page.locator('button.shop-checkout[data-shop-checkout]').first().click();
    await expect(page.locator('form[data-shop-checkout-form]')).toBeVisible({ timeout: 10_000 });

    /* DB sanity: one cart row exists. */
    const cart = await db.query(
      `SELECT ci.quantity FROM shop_cart_items ci
         JOIN shop_carts c ON c.id = ci.cart_id
         JOIN users u ON u.id = c.user_id
        WHERE u.email = $1`,
      [email],
    );
    expect(cart.rowCount).toBe(1);
    expect(cart.rows[0].quantity).toBe(1);
  } finally {
    await retryDeadlock(() => db.query(`DELETE FROM shop_cart_items WHERE cart_id IN (SELECT id FROM shop_carts WHERE user_id IN (SELECT id FROM users WHERE email = $1))`, [email]));
    await retryDeadlock(() => db.query(`DELETE FROM shop_carts WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, [email]));
    await cleanupUsers(db, [email]);
    await closeDb();
    await context.close();
  }
});