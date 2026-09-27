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

test('user checks out; admin manages the order, product, and inventory', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { email } = await seedUser(db, `pipe-shop-${suffix}`, PASSWORD, 'user', 'Shop User');
  const { email: adminEmail } = await seedUser(db, `pipe-shop-admin-${suffix}`, PASSWORD, 'admin', 'Shop Admin');
  const context = await browser.newContext();
  const page = await context.newPage();
  let variantId;
  let orderId;
  let orderNumber;
  let orderedQuantity = 0;
  let createdProductId;
  let createdVariantId;
  try {
    await login(page, email, PASSWORD);
    await page.goto('/#/shop');
    /* Wait for the catalogue to render at least one product with an Add
       button. */
    const addBtn = page.locator('button.shop-add[data-shop-add]').first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    variantId = await addBtn.getAttribute('data-shop-add');
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

    /* DB sanity: one cart row exists before checkout. */
    const cart = await db.query(
      `SELECT ci.quantity FROM shop_cart_items ci
         JOIN shop_carts c ON c.id = ci.cart_id
         JOIN users u ON u.id = c.user_id
        WHERE u.email = $1`,
      [email],
    );
    expect(cart.rowCount).toBe(1);
    expect(cart.rows[0].quantity).toBe(1);
    orderedQuantity = Number(cart.rows[0].quantity);

    /* Submit a real order and verify the converted cart + persisted order. */
    const checkoutForm = page.locator('form[data-shop-checkout-form]');
    await checkoutForm.locator('[name="customer_name"]').fill('Shop User');
    await checkoutForm.locator('[name="phone"]').fill('+853 6000 0000');
    const checkoutResp = page.waitForResponse((r) =>
      r.url().endsWith('/api/shop/checkout') && r.request().method() === 'POST');
    await checkoutForm.getByRole('button', { name: '確認訂購' }).click();
    expect((await checkoutResp).status()).toBe(201);
    await expect(page.locator('.shop-order-success')).toBeVisible({ timeout: 10_000 });

    const order = await db.query(
      `SELECT o.id,o.order_number,o.status
         FROM shop_orders o JOIN users u ON u.id=o.user_id
        WHERE u.email=$1 ORDER BY o.created_at DESC LIMIT 1`,
      [email],
    );
    expect(order.rowCount).toBe(1);
    expect(order.rows[0].status).toBe('pending');
    ({ id: orderId, order_number: orderNumber } = order.rows[0]);

    /* Admin sees the new order and advances it through the real API. */
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, adminEmail, PASSWORD);
    await adminPage.goto('/#/admin/shop');
    const orderCard = adminPage.locator('.shop-order').filter({ hasText: orderNumber });
    await expect(orderCard).toBeVisible({ timeout: 15_000 });
    await orderCard.locator('[data-order-next]').selectOption('confirmed');
    const statusResp = adminPage.waitForResponse((r) =>
      r.url().includes(`/api/admin/shop/orders/${orderId}`) && r.request().method() === 'PATCH');
    await orderCard.locator('[data-order-update]').click();
    expect((await statusResp).status()).toBe(200);
    expect((await db.query('SELECT status FROM shop_orders WHERE id=$1', [orderId])).rows[0].status).toBe('confirmed');

    /* Product creation and stock adjustment use an isolated test SKU. */
    await adminPage.locator('[data-admin-tab="products"]').click();
    const productName = `E2E Product ${suffix.slice(0, 8)}`;
    const productForm = adminPage.locator('form[data-product-form]');
    await productForm.locator('[name="name"]').fill(productName);
    await productForm.locator('[name="slug"]').fill(`e2e-${suffix}`);
    await productForm.locator('[name="category"]').fill('E2E');
    await productForm.locator('[name="sku"]').fill(`E2E-${suffix}`);
    await productForm.locator('[name="price"]').fill('12.34');
    await productForm.locator('[name="stock_quantity"]').fill('1');
    const createProductResp = adminPage.waitForResponse((r) =>
      r.url().endsWith('/api/admin/shop/products') && r.request().method() === 'POST');
    await productForm.getByRole('button', { name: '建立商品' }).click();
    expect((await createProductResp).status()).toBe(201);
    const created = await db.query(
      `SELECT p.id AS product_id,v.id AS variant_id,v.stock_quantity
         FROM shop_products p JOIN shop_product_variants v ON v.product_id=p.id
        WHERE p.slug=$1`,
      [`e2e-${suffix}`],
    );
    expect(created.rows[0].stock_quantity).toBe(1);
    createdProductId = created.rows[0].product_id;
    createdVariantId = created.rows[0].variant_id;

    const productRow = adminPage.locator('.shop-admin-row').filter({ hasText: productName });
    await expect(productRow).toBeVisible({ timeout: 10_000 });
    const inventoryResp = adminPage.waitForResponse((r) =>
      r.url().includes(`/api/admin/shop/inventory/${createdVariantId}`) && r.request().method() === 'POST');
    await productRow.locator('[data-stock][data-delta="1"]').click();
    expect((await inventoryResp).status()).toBe(200);
    expect((await db.query('SELECT stock_quantity FROM shop_product_variants WHERE id=$1', [createdVariantId])).rows[0].stock_quantity).toBe(2);
    await adminContext.close();
  } finally {
    if (createdVariantId) await retryDeadlock(() => db.query('DELETE FROM shop_inventory_movements WHERE variant_id=$1', [createdVariantId]));
    if (createdProductId) await retryDeadlock(() => db.query('DELETE FROM shop_products WHERE id=$1', [createdProductId]));
    if (orderId) {
      await retryDeadlock(() => db.query('DELETE FROM shop_inventory_movements WHERE order_id=$1', [orderId]));
      if (variantId && orderedQuantity) {
        await retryDeadlock(() => db.query('UPDATE shop_product_variants SET stock_quantity=stock_quantity+$1 WHERE id=$2', [orderedQuantity, variantId]));
      }
      await retryDeadlock(() => db.query('DELETE FROM shop_orders WHERE id=$1', [orderId]));
    }
    await retryDeadlock(() => db.query(`DELETE FROM shop_cart_items WHERE cart_id IN (SELECT id FROM shop_carts WHERE user_id IN (SELECT id FROM users WHERE email = $1))`, [email]));
    await retryDeadlock(() => db.query(`DELETE FROM shop_carts WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, [email]));
    await cleanupUsers(db, [email, adminEmail]);
    await closeDb();
    await context.close();
  }
});
