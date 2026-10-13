import { test, expect } from '@playwright/test';
import { bruttiCategories } from '../../src/data/categories';

test('an older catalog response cannot restore stale products after a newer refresh', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let productReads = 0;
  const old = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Stale response fixture', sku: 'TEST-STALE-1', category_id: bruttiCategories[0].id,
    description: 'Test-only description', materials: 'Test-only materials', width: 50, depth: 50, height: 50,
    price: null, status: 'published', availability: 'unavailable', featured: false,
    images: [{ id: 'state-photo', url: '/images/placeholder.svg', alt: 'Test fixture' }], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await page.route('https://catalog-browser-test.supabase.co/**', async route => {
    const url = route.request().url();
    if (url.includes('/products?')) {
      const first = ++productReads === 1;
      const body = JSON.stringify([{ ...old, name: first ? old.name : 'Current response fixture' }]);
      if (first) await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-fixture-response': first ? 'stale' : 'current' }, body });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: url.includes('/categories?') ? JSON.stringify(bruttiCategories) : '{}' });
  });
  await page.goto('/#/catalog');
  await expect(page.getByRole('heading', { name: 'Current response fixture', exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().includes('/products?') && r.headers()['x-fixture-response'] === 'stale');
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'Current response fixture', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stale response fixture', exact: true })).toHaveCount(0);
});
