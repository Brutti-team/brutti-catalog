import { test, expect, type Page } from '@playwright/test';
import { bruttiCategories } from '../../src/data/categories';

const endpoint = 'https://catalog-browser-test.supabase.co';
const user = { id: '90000000-0000-4000-8000-000000000001', email: 'test-admin@example.invalid', role: 'authenticated', aud: 'authenticated' };
const token = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.test`;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');

async function backend(page: Page, initial: Record<string, unknown>[] = []) {
  let products = initial;
  let uploadGate: Promise<void> | undefined;
  let uploadCount = 0;
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('sb-catalog-browser-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_at: 4102444800, expires_in: 3600, user }));
  }, { token, user });
  await page.route(`${endpoint}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname.endsWith('/catalog_admins')) return json({ user_id: user.id });
    if (url.pathname.endsWith('/categories')) return json(bruttiCategories);
    if (url.pathname.endsWith('/products')) {
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        products = [...products.filter(p => p.id !== row.id), row];
        return json(row);
      }
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        products = products.filter(p => p.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      return json(products);
    }
    if (url.pathname.includes('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    if (url.pathname.startsWith('/storage/v1/object/')) {
      uploadCount++;
      if (uploadGate) await uploadGate;
      return json({ Key: url.pathname.replace('/storage/v1/object/', '') });
    }
    return json({});
  });
  return { records: () => products, uploads: () => uploadCount, holdUploads: (gate: Promise<void>) => { uploadGate = gate; } };
}

test('Draft with unknown sizes persists; edit, upload, publish, public filters and archive use backend records', async ({ page }) => {
  const db = await backend(page);
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name').fill('Browser regression item');
  await dialog.getByLabel(/^SKU/).fill('TEST-CRUD-1');
  // Unknown dimensions remain zero: this must pass native form validation for Draft.
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({ status: 'draft', width: 0, depth: 0, height: 0 });
  await page.getByRole('button', { name: 'Edit Browser regression item', exact: true }).click();
  await dialog.getByLabel('Product name').fill('Browser regression item edited');
  await dialog.getByLabel('Description', { exact: true }).fill('Test-only product description.');
  await dialog.getByLabel('Materials', { exact: true }).fill('Test-only materials and finishing.');
  for (const key of ['width','depth','height']) await dialog.getByLabel(`${key} in centimetres`).fill('50');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'test-only-photo.png', mimeType: 'image/png', buffer: pixel });
  await expect(dialog.locator('.image-editor-item')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Preview product' }).click();
  await expect(dialog.locator('.editor-preview')).toBeVisible();
  await dialog.getByLabel(/^Status/).selectOption('published');
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({ name: 'Browser regression item edited', status: 'published' });
  expect(db.uploads()).toBe(1);
  await page.goto('/#/catalog');
  await expect(page.locator('.pub-product-card')).toHaveCount(1);
  await page.getByPlaceholder('Search furniture, materials…').fill('no-match');
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
  await page.getByPlaceholder('Search furniture, materials…').fill('');
  await page.locator('.pub-category-filters').getByRole('button', { name: 'Rentals', exact: true }).click();
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
  await page.locator('.pub-category-filters').getByRole('button', { name: 'Racks & Shelves', exact: true }).click();
  await expect(page.locator('.pub-product-card')).toHaveCount(1);
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'More actions for Browser regression item edited' }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect.poll(() => db.records()[0].status).toBe('archived');
  await page.goto('/#/catalog');
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
});

test('pending uploads preserve staff removals and alt-text edits and reject overlapping batches', async ({ page }) => {
  const original = { id: '90000000-0000-4000-8000-000000000002', name: 'Upload regression fixture', sku: 'TEST-UPLOAD-1', category_id: bruttiCategories[0].id,
    description: '', materials: '', width: 0, depth: 0, height: 0, price: null, status: 'draft', availability: 'unavailable', featured: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), images: [
      { id: 'first', alt: 'First source photo', url: `${endpoint}/storage/v1/object/public/product-images/first.png` },
      { id: 'second', alt: 'Second source photo', url: `${endpoint}/storage/v1/object/public/product-images/second.png` },
    ] };
  const db = await backend(page, [original]);
  let release!: () => void;
  db.holdUploads(new Promise<void>(resolve => { release = resolve; }));
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'Edit Upload regression fixture', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'new-test-photo.png', mimeType: 'image/png', buffer: pixel });
  await expect(dialog.getByRole('button', { name: 'Save product', exact: true })).toBeDisabled();
  await expect(dialog.locator('input[type=file]')).toBeDisabled();
  await dialog.getByLabel('Image 2 description').fill('Staff edit while upload is pending');
  await dialog.getByRole('button', { name: 'Remove image 1', exact: true }).click();
  release();
  await expect(dialog.locator('.image-editor-item')).toHaveCount(2);
  await expect(dialog.getByLabel('Image 1 description')).toHaveValue('Staff edit while upload is pending');
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const images = db.records()[0].images as { id: string; alt: string }[];
  expect(images[0]).toMatchObject({ id: 'second', alt: 'Staff edit while upload is pending' });
  expect(images.some(image => image.id === 'first')).toBe(false);
  expect(db.uploads()).toBe(1);
});

test('visible catalog picks up remote publishing and preserves starting-price semantics', async ({ page }) => {
  await page.clock.install();
  const row = { id: '90000000-0000-4000-8000-000000000003', name: 'Starting-price browser fixture', sku: 'TEST-STARTING-1', category_id: bruttiCategories[0].id,
    description: 'Test-only source description', materials: 'Test-only materials', width: 50, depth: 50, height: 50, price: 1234.56, price_basis: 'starting-from', status: 'draft', availability: 'unavailable', featured: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), images: [{ id: 'price-test-photo', alt: 'Test-only image', url: `${endpoint}/storage/v1/object/public/product-images/test.png` }] };
  const db = await backend(page, [row]);
  await page.goto('/#/catalog');
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
  db.records()[0].status = 'published';
  await page.clock.fastForward(30_000);
  await expect(page.locator('.pub-product-card')).toHaveCount(1);
  await expect(page.locator('.pub-product-card')).toContainText(/Starting from RM\s?1,234.56/);
  await page.locator('.pub-product-card').click();
  await expect(page.locator('.pub-detail-price')).toContainText(/Starting from RM\s?1,234.56/);
  db.records()[0].status = 'archived';
  await page.clock.fastForward(30_000);
  await expect(page.locator('.pub-detail-price')).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`admin and public layouts remain usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await backend(page);
    await page.setViewportSize(viewport);
    await page.goto('/#/admin');
    await expect(page.getByRole('button', { name: 'Add product', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('admin-test-fixtures.png'), fullPage: true });
    await page.goto('/#/catalog');
    await expect(page.getByRole('heading', { name: 'Good design. Better living.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('public-empty-test-backend.png'), fullPage: true });
  });
}
