import { test, expect } from '@playwright/test';

test('public vehicle demo never leaves maintenance history loading', async ({ page }) => {
  await page.goto('/demo');

  const records = page.locator('#detailRecords');
  await expect(records).toBeVisible();
  await expect(records).not.toContainText('載入中…');
  await expect(records.locator('.row')).toHaveCount(3);
  await expect(records).toContainText('機油及機油隔');
});
