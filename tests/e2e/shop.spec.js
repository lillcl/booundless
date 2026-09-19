import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../../api/_lib/db.js';
import { hashPassword } from '../../api/_lib/auth.js';
import { SHOP_CATALOG } from '../../db/shop-catalog.js';

test.describe('shop customer experience', () => {
  test('renders the database catalogue and generated product visuals', async ({ page }) => {
    const productResponse = page.waitForResponse((response) =>
      response.url().includes('/api/shop/products') && response.status() === 200,
    );

    await page.goto('/#/shop');
    const response = await productResponse;
    const payload = await response.json();

    await expect(page).toHaveTitle(/訂購/);
    await expect(page.getByRole('heading', { name: '汽車用品' })).toBeVisible();
    await expect(page.locator('.shop-head')).toHaveCSS('min-height', '190px');
    await expect(page.locator('.shop-chip')).toHaveCount(0);
    await expect(page.locator('[data-compatible-wrap]')).toBeHidden();
    await expect(page.locator('.shop-product')).toHaveCount(payload.products.length);
    expect(payload.products.length).toBe(SHOP_CATALOG.length);

    const visual = page.locator('.shop-product__visual').first();
    await expect(visual).toBeVisible();
    await expect(visual).toHaveCSS('background-image', /shop-(fluids-filters|mechanical|care-interior|safety-ev-moto)-v1\.png/);
    await expect(page.locator('[data-shop-cart]')).toContainText('登入後即可儲存購物車');
    await page.locator('[data-shop-categories]').selectOption('機油與引擎保養');
    await expect(page.locator('.shop-product')).toHaveCount(payload.products.filter((item) => item.category === '機油與引擎保養').length);
    await page.locator('[data-shop-categories]').selectOption('全部');
    await page.locator('[data-product-search]').fill('過江龍');
    await expect(page.locator('.shop-product')).toHaveCount(2);
    await expect(page.locator('.shop-product')).toContainText(['Jump Starter','搭電線']);
  });

  test('requires authentication before adding an item', async ({ page }) => {
    await page.goto('/#/shop');
    await page.locator('.shop-add:not([disabled])').first().click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole('heading', { name: '登入' })).toBeVisible();
  });

  test('has no horizontal overflow on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/shop');
    await expect(page.locator('.shop-product')).toHaveCount(SHOP_CATALOG.length);

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  });
});

test.describe('shop administration boundary', () => {
  test('protects the admin UI and API from signed-out visitors', async ({ page, request }) => {
    const response = await request.get('/api/admin/shop/orders');
    expect([401, 403]).toContain(response.status());

    await page.goto('/#/admin/shop');
    await expect(page).toHaveURL(/#\/admin\/shop$/);
    await expect(page.getByRole('heading', { name: '請先登入管理員帳號' })).toBeVisible();
    await expect(page.getByRole('link', { name: '前往登入' })).toHaveAttribute('href', '#/login');
  });
});

test.describe('complete order and administration workflow', () => {
  test('customer checkout is synchronized to admin and the database', async ({ browser }) => {
    test.setTimeout(60_000);
    const runId = randomUUID();
    const customerEmail = `shop-customer-${runId}@example.test`;
    const adminEmail = `shop-admin-${runId}@example.test`;
    const password = 'Shop-e2e-only-2026!';
    const adminId = `u-e2e-admin-${runId}`;
    const db = await getDb();
    let customerId = null;
    let orderId = null;
    let vehicleId = null;

    await db.query(
      `INSERT INTO users(id,email,password_hash,role,display_name)
       VALUES($1,$2,$3,'admin','Shop E2E Admin')`,
      [adminId, adminEmail, await hashPassword(password)],
    );

    const customerContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    const adminPage = await adminContext.newPage();

    try {
      await customerPage.goto('/#/register');
      await customerPage.locator('#registerName').fill('Shop E2E Customer');
      await customerPage.locator('#registerEmail').fill(customerEmail);
      await customerPage.locator('#registerPassword').fill(password);
      await customerPage.locator('#registerPasswordConfirm').fill(password);
      await customerPage.getByRole('button', { name: '建立帳號並登入' }).click();
      await expect(customerPage).toHaveURL(/#\/home$/, { timeout: 15_000 });

      customerId = (await db.query('SELECT id FROM users WHERE email=$1', [customerEmail])).rows[0]?.id;
      expect(customerId).toBeTruthy();

      const vehicle = await customerPage.evaluate(async () => {
        const response = await fetch('/api/vehicles', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
          make:'Audi', model:'Q4 e-tron', year:2023, fuel_type:'EV', vehicle_class:'light_passenger', powertrain_type:'ev', mileage_km:12000,
        }) });
        return { ok:response.ok, body:await response.json() };
      });
      expect(vehicle.ok, JSON.stringify(vehicle.body)).toBe(true);
      vehicleId = vehicle.body.id;

      await customerPage.goto('/#/shop');
      await expect(customerPage.locator('[data-shop-passport]')).toContainText('Audi Q4 e-tron');
      await customerPage.locator('[data-product-search]').fill('全合成機油');
      await expect(customerPage.locator('.shop-product')).toHaveCount(0);
      await customerPage.locator('[data-product-search]').fill('Type 2');
      await expect(customerPage.locator('.shop-product').filter({ hasText:'Type 2 充電線' })).toHaveCount(1);
      await customerPage.locator('[data-product-search]').fill('');
      const firstProduct = customerPage.locator('.shop-product').first();
      const productName = (await firstProduct.locator('h3').textContent()).trim();
      const initialVariant = (await db.query(
        `SELECT v.id,v.stock_quantity FROM shop_product_variants v
         JOIN shop_products p ON p.id=v.product_id WHERE p.name=$1
         ORDER BY v.created_at LIMIT 1`,
        [productName],
      )).rows[0];
      expect(initialVariant).toBeTruthy();
      const addButton = firstProduct.locator('.shop-add');
      await expect(addButton).toBeEnabled();
      await addButton.click();
      await expect(customerPage.locator('[data-shop-count]')).toHaveText('1');
      const quantity = firstProduct.locator('.shop-qty');
      await expect(quantity).toContainText('1');
      await quantity.getByRole('button', { name: `增加 ${productName}` }).click();
      await expect(customerPage.locator('[data-shop-count]')).toHaveText('2');
      await expect(firstProduct.locator('.shop-qty')).toContainText('2');
      await firstProduct.getByRole('button', { name: `減少 ${productName}` }).click();
      await expect(customerPage.locator('[data-shop-count]')).toHaveText('1');
      await customerPage.locator('[data-shop-checkout]').click();
      await customerPage.getByLabel('姓名').fill('Playwright Customer');
      await customerPage.getByLabel('電話').fill('6888 1234');
      await customerPage.getByRole('button', { name: '確認訂購' }).click();

      const success = customerPage.locator('.shop-order-success');
      await expect(success).toContainText('訂單已收到');
      const orderNumber = (await success.locator('b').textContent()).trim();
      expect(orderNumber).toMatch(/^BO-/);

      const orderResult = await db.query(
        `SELECT o.id,o.status,oi.variant_id,oi.quantity,v.stock_quantity,
          (SELECT quantity_delta FROM shop_inventory_movements
           WHERE order_id=o.id AND variant_id=oi.variant_id AND reason='order_placed'
           ORDER BY created_at DESC LIMIT 1) AS quantity_delta
         FROM shop_orders o
         JOIN shop_order_items oi ON oi.order_id=o.id
         JOIN shop_product_variants v ON v.id=oi.variant_id
         WHERE o.order_number=$1`,
        [orderNumber],
      );
      expect(orderResult.rowCount).toBe(1);
      orderId = orderResult.rows[0].id;
      expect(orderResult.rows[0].status).toBe('pending');
      expect(orderResult.rows[0].variant_id).toBe(initialVariant.id);
      expect(Number(orderResult.rows[0].stock_quantity)).toBe(
        Number(initialVariant.stock_quantity) - Number(orderResult.rows[0].quantity),
      );
      expect(Number(orderResult.rows[0].quantity_delta)).toBe(-Number(orderResult.rows[0].quantity));

      await adminPage.goto('/#/login');
      await adminPage.locator('#loginEmail').fill(adminEmail);
      await adminPage.locator('#loginPassword').fill(password);
      await adminPage.getByRole('button', { name: '登入', exact: true }).click();
      await expect(adminPage).toHaveURL(/#\/home$/, { timeout: 15_000 });
      await adminPage.goto('/#/admin/shop');

      const adminOrder = adminPage.locator('.shop-order').filter({ hasText: orderNumber });
      await expect(adminOrder).toContainText(productName);
      await expect(adminOrder.locator('.shop-status')).toHaveText('待確認');
      await adminOrder.locator('select').selectOption('confirmed');
      await adminOrder.getByRole('button', { name: '更新狀態' }).click();
      await expect(adminOrder.locator('.shop-status')).toHaveText('已確認');

      const stored = await db.query('SELECT status FROM shop_orders WHERE id=$1', [orderId]);
      expect(stored.rows[0].status).toBe('confirmed');

      await customerPage.goto('/#/orders');
      const customerOrder = customerPage.locator('.shop-order').filter({ hasText: orderNumber });
      await expect(customerOrder.locator('.shop-status')).toHaveText('已確認');
    } finally {
      await customerContext.close();
      await adminContext.close();

      if (orderId) {
        await db.query('BEGIN');
        try {
          await db.query(
            `UPDATE shop_product_variants v
             SET stock_quantity=v.stock_quantity+i.quantity,version=v.version+1,updated_at=NOW()
             FROM shop_order_items i
             WHERE i.order_id=$1 AND i.variant_id=v.id`,
            [orderId],
          );
          await db.query('DELETE FROM shop_inventory_movements WHERE order_id=$1', [orderId]);
          await db.query('DELETE FROM shop_orders WHERE id=$1', [orderId]);
          await db.query('COMMIT');
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      }
      if (customerId) await db.query('DELETE FROM shop_carts WHERE user_id=$1', [customerId]);
      if (vehicleId) await db.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
      await db.query('DELETE FROM audit_log WHERE actor_email IN ($1,$2)', [customerEmail, adminEmail]);
      await db.query('DELETE FROM users WHERE email IN ($1,$2)', [customerEmail, adminEmail]);
      await closeDb();
    }
  });
});
