import { test, expect, type Page } from '@playwright/test';
import { bruttiCategories } from '../../src/data/categories';

const endpoint = 'https://catalog-browser-test.supabase.co';
const user = { id: '90000000-0000-4000-8000-000000000001', email: 'test-admin@example.invalid', role: 'authenticated', aud: 'authenticated' };
const token = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.test`;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function backend(page: Page, initial: Record<string, unknown>[] = [], features: { ordering?: boolean; imageCleanup?: boolean; storageFailure?: boolean; denyDelete?: boolean; productModels?: boolean } = {}) {
  let products = initial;
  const categories = bruttiCategories.map(category => ({ ...category }));
  const removals: string[] = [];
  let productReads = 0;
  let uploadGate: Promise<void> | undefined;
  let uploadCount = 0;
  const storedModels = new Map<string, Buffer>();
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('sb-catalog-browser-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_at: 4102444800, expires_in: 3600, user }));
  }, { token, user });
  await page.route(`${endpoint}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname.endsWith('/catalog_admins')) return json({ user_id: user.id });
    if (url.pathname.endsWith('/categories')) return json(categories);
    if (url.pathname.endsWith('/rpc/catalog_capabilities')) return json({ ordering: features.ordering === true, imageCleanup: features.imageCleanup === true,
      priceBasis: initial.some(row => Object.hasOwn(row, 'price_basis')) });
    if (url.pathname.endsWith('/rpc/catalog_product_models_enabled')) return json(features.productModels === true);
    if (url.pathname.endsWith('/rpc/can_remove_catalog_image')) {
      const path = request.postDataJSON().p_storage_path;
      return json(!products.some(product => (product.images as { storagePath?: string; url: string }[]).some(image =>
        image.storagePath === path || image.url === `${endpoint}/storage/v1/object/public/product-images/${path}`)));
    }
    if (url.pathname.endsWith('/products')) {
      if (request.method() === 'PATCH') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        const previous = products.find(product => product.id === id);
        const guard = url.searchParams.get('model_path');
        if (!previous || (guard === 'is.null' ? previous.model_path != null : guard?.slice(3) !== previous.model_path)) return json(null);
        const saved = { ...previous, ...request.postDataJSON() };
        products = products.map(product => product.id === id ? saved : product);
        return json(saved);
      }
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        const saved = { ...products.find(p => p.id === row.id), ...row };
        products = [...products.filter(p => p.id !== row.id), saved];
        return json(saved);
      }
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        if (features.denyDelete) return json(null);
        const deleted = products.find(p => p.id === id);
        products = products.filter(p => p.id !== id);
        return json(deleted ? { id: deleted.id, images: deleted.images, model_path: deleted.model_path } : null);
      }
      productReads++;
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id) return json(products.filter(p => p.id === id));
      return json(products);
    }
    if (url.pathname === '/storage/v1/object/product-models' && request.method() === 'DELETE') {
      const paths = request.postDataJSON().prefixes as string[];
      return json(paths.filter(path => storedModels.delete(path)).map(name => ({ name })));
    }
    const modelPath = url.pathname.split('/product-models/')[1];
    if (url.pathname.startsWith('/storage/v1/object/') && modelPath) {
      if (request.method() === 'POST') {
        const data = request.postDataBuffer()!;
        const header = data.indexOf('PK\x03\x04');
        const end = data.lastIndexOf('PK\x05\x06');
        if (header < 0 || end < header) return route.fulfill({ status: 400, json: { message: 'Invalid model package' } });
        storedModels.set(modelPath, data.subarray(header, end + 22 + data.readUInt16LE(end + 20)));
        return json({ Key: `product-models/${modelPath}` });
      }
      const model = storedModels.get(modelPath);
      if (model) return route.fulfill({ status: 200, contentType: 'application/zip', body: model });
      return route.fulfill({ status: 404, json: { message: 'Model not found' } });
    }
    if (url.pathname.includes('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    if (url.pathname === '/storage/v1/object/product-images' && request.method() === 'DELETE') {
      if (features.storageFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Storage temporarily unavailable' }) });
      const paths = request.postDataJSON().prefixes as string[];
      removals.push(...paths);
      return json(paths.map(name => ({ name })));
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      uploadCount++;
      if (uploadGate) await uploadGate;
      return json({ Key: url.pathname.replace('/storage/v1/object/', '') });
    }
    return json({});
  });
  return { records: () => products, categories: () => categories, reads: () => productReads, removals: () => removals,
    uploads: () => uploadCount, storedModels, holdUploads: (gate: Promise<void>) => { uploadGate = gate; } };
}

test('a non-GLB model is previewed, saved and opened by customers, and can be removed', async ({ page }) => {
  const id = '90000000-0000-4000-8000-000000000118';
  const product = { id, name: 'Model browser fixture', sku: 'TEST-MODEL-1', category_id: bruttiCategories[0].id,
    description: 'Fixture description', materials: 'Fixture materials', width: 50, depth: 60, height: 70, price: null,
    status: 'published', availability: 'available', featured: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    images: [{ id: 'first', alt: 'Fixture photo', url: `${endpoint}/storage/v1/object/public/product-images/first.png` }], model_path: null, model_name: null };
  const db = await backend(page, [product], { productModels: true });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Model browser fixture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit product' });
  const section = dialog.getByRole('region', { name: 'Real 3D model', exact: true });
  await expect(section.getByText('Generate a real 3D model')).toBeVisible();
  await section.getByText('Or upload an existing 3D model file').click();
  await expect(section.getByRole('button', { name: 'Choose model files' })).toBeVisible();
  await section.locator('input[type=file]').setInputFiles({ name: 'pyramid.obj', mimeType: 'text/plain', buffer: Buffer.from('v -1 0 -1\nv 1 0 -1\nv 1 0 1\nv -1 0 1\nv 0 2 0\nf 1 5 2\nf 2 5 3\nf 3 5 4\nf 4 5 1\nf 1 2 3 4\n') });
  await expect(section.getByRole('button', { name: 'Wireframe' })).toBeEnabled({ timeout: 15_000 });
  await expect(section.getByText('pyramid.obj', { exact: true })).toBeVisible();
  expect(db.storedModels.size).toBe(0);
  await dialog.getByRole('button', { name: 'Save product' }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({ model_name: 'pyramid.obj', model_path: expect.stringMatching(new RegExp(`^${id}/[^/]+\\.zip$`)) });
  expect(db.storedModels.size).toBe(1);
  await page.goto(`/#/catalog/product/${id}`);
  await page.getByRole('button', { name: 'Interactive 3D', exact: true }).click();
  const wireframe = page.getByRole('button', { name: 'Wireframe' });
  await expect(wireframe).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText('INTERACTIVE OBJECT', { exact: true })).toBeVisible();
  await expect(page.getByText('Triangles', { exact: true })).toBeVisible();
  const autoRotate = page.getByRole('button', { name: 'Auto rotate' });
  await autoRotate.click();
  await expect(page.getByRole('button', { name: 'Pause rotation' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Pause rotation' }).click();
  await expect(autoRotate).toHaveAttribute('aria-pressed', 'false');
  await wireframe.click();
  await expect(wireframe).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Original photos' }).click();
  await expect(page.getByRole('img', { name: 'Fixture photo' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Interactive 3D', exact: true }).click();
  await expect(wireframe).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Model browser fixture', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove model' }).click();
  await dialog.getByRole('button', { name: 'Save product' }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({ model_path: null, model_name: null });
  expect(db.storedModels.size).toBe(0);
  await page.goto(`/#/catalog/product/${id}`);
  await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Interactive 3D', exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Fixture photo' })).toBeVisible();
});

test('Draft with unknown sizes persists; edit, upload, publish, public filters and archive use backend records', async ({ page }) => {
  const db = await backend(page);
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name').fill('Browser regression item');
  await dialog.getByLabel(/^SKU/).fill('TEST-CRUD-1');
  await expect(dialog.getByLabel('Display order', { exact: true })).toHaveCount(0); // Not available until ordering capability is enabled.
  // Unknown dimensions remain zero: this must pass native form validation for Draft.
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({ status: 'draft', width: 0, depth: 0, height: 0 });
  expect(db.records()[0]).not.toHaveProperty('display_order');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Browser regression item', exact: true }).click();
  const livePreview = dialog.getByRole('region', { name: 'Live preview', exact: true });
  await expect(livePreview.getByRole('heading', { name: 'Browser regression item', exact: true })).toBeInViewport();
  await dialog.getByLabel('Product name').fill('Browser regression item edited');
  await dialog.getByLabel('Description', { exact: true }).fill('Test-only product description.');
  await dialog.getByLabel('Materials', { exact: true }).fill('Test-only materials and finishing.');
  for (const key of ['width','depth','height']) await dialog.getByLabel(`${key} in centimetres`).fill('50');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'test-only-photo.png', mimeType: 'image/png', buffer: pixel });
  await expect(dialog.locator('.image-editor-item')).toHaveCount(1);
  await expect(livePreview.getByRole('heading', { name: 'Browser regression item edited', exact: true })).toBeVisible();
  await expect(livePreview.getByText('Test-only product description.', { exact: true })).toBeVisible();
  await expect(livePreview.getByRole('img')).toBeVisible();
  await dialog.getByLabel(/^Status/).selectOption('published');
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({ name: 'Browser regression item edited', status: 'published' });
  expect(db.uploads()).toBe(1);
  await page.goto('/#/catalog');
  await expect(page.locator('.pub-product-card')).toHaveCount(1);
  await page.getByPlaceholder('Search kiosks, counters, materials…').fill('no-match');
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
  await page.getByPlaceholder('Search kiosks, counters, materials…').fill('');
  await page.locator('.pub-category-filters').getByRole('button', { name: 'Rentals', exact: true }).click();
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
  await page.locator('.pub-category-filters').getByRole('button', { name: 'Racks & Shelves', exact: true }).click();
  await expect(page.locator('.pub-product-card')).toHaveCount(1);
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
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
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
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

const fixture = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id: `90000000-0000-4000-8000-${String(id).padStart(12, '0')}`, name, sku: `TEST-MANAGEMENT-${id}`,
  category_id: bruttiCategories[0].id, description: 'Test-only description', materials: 'Test-only materials',
  width: 50, depth: 50, height: 50, price: null, status: 'published', availability: 'available', featured: false,
  created_at: '2026-10-13T00:00:00.000Z', updated_at: '2026-10-13T00:00:00.000Z',
  images: [{ id: 'shared', alt: 'Test-only photo', storagePath: 'tests/shared.webp',
    url: `${endpoint}/storage/v1/object/public/product-images/tests/shared.webp` }], ...extra,
});

test('staff display order persists and curated public sorting keeps featured products first', async ({ page }) => {
  const db = await backend(page, [fixture(10, 'Featured high order', { featured: true, display_order: 90 }),
    fixture(11, 'Lower order', { display_order: 10 }), fixture(12, 'Higher order', { display_order: 20 })], { ordering: true });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Higher order', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Display order', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records().find(row => row.name === 'Higher order')).toHaveProperty('display_order', 5);
  await page.getByLabel('Sort products').selectOption('display-order');
  await expect(page.locator('tbody tr').first()).toContainText('Higher order');
  await page.goto('/#/catalog');
  await expect(page.locator('.pub-product-card h3')).toHaveText(['Featured high order', 'Higher order', 'Lower order']);
});

test('removing a shared photo waits for its final product reference before Storage API cleanup', async ({ page }) => {
  const db = await backend(page, [fixture(20, 'Shared photo owner A', { status: 'draft' }),
    fixture(21, 'Shared photo owner B', { status: 'draft' })], { imageCleanup: true });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Shared photo owner A', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Remove image 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.removals()).toEqual([]);
  page.once('dialog', prompt => prompt.accept());
  await page.getByRole('button', { name: 'More actions for Shared photo owner B' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Product deleted');
  expect(db.records().some(row => row.name === 'Shared photo owner B')).toBe(false);
  expect(db.removals()).toEqual(['tests/shared.webp']);
});

test('an expired authorization during deletion leaves the product visible and reports no false success', async ({ page }) => {
  const db = await backend(page, [fixture(30, 'Protected delete fixture', { status: 'draft' })], { denyDelete: true });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  page.once('dialog', prompt => prompt.accept());
  await page.getByRole('button', { name: 'More actions for Protected delete fixture' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('was not deleted');
  expect(db.records()).toHaveLength(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a completed product save reports remaining photos when Storage cleanup fails', async ({ page }) => {
  const db = await backend(page, [fixture(40, 'Cleanup warning fixture', { status: 'draft' })], { imageCleanup: true, storageFailure: true });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Cleanup warning fixture', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Remove image 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(/Product saved;.*images may remain/);
  expect(db.records()[0].images).toEqual([]);
  expect(db.removals()).toEqual([]);
});

for (const finish of ['save-after-removal', 'discard', 'save-retained', 'discard-failed-cleanup', 'navigate-during-upload']) {
  test(`new editor uploads are accounted for on ${finish}`, async ({ page }) => {
    const db = await backend(page, [], { imageCleanup: true, storageFailure: finish === 'discard-failed-cleanup' });
    let release: (() => void) | undefined;
    if (finish === 'navigate-during-upload') db.holdUploads(new Promise<void>(resolve => { release = resolve; }));
    await page.goto('/#/admin');
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Product name').fill('Upload lifecycle fixture');
    await dialog.getByLabel(/^SKU/).fill('TEST-LIFECYCLE-1');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'test-lifecycle.png', mimeType: 'image/png', buffer: pixel });
    if (finish === 'navigate-during-upload') {
      await expect(dialog.getByRole('button', { name: 'Save product', exact: true })).toBeDisabled();
      await page.goto('/#/catalog');
      release?.();
      await expect.poll(() => db.removals().length).toBe(1);
      expect(db.records()).toEqual([]);
      return;
    }
    await expect(dialog.locator('.image-editor-item')).toHaveCount(1);
    if (finish === 'save-after-removal') await dialog.getByRole('button', { name: 'Remove image 1', exact: true }).click();
    if (finish.startsWith('discard')) {
      page.once('dialog', prompt => prompt.accept());
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (finish === 'discard-failed-cleanup') {
      await expect(page.getByRole('status')).toContainText('unused images may remain');
      expect(db.records()).toEqual([]);
      expect(db.removals()).toEqual([]);
    } else if (finish === 'save-retained') {
      expect(db.records()).toHaveLength(1);
      expect(db.records()[0].images).toHaveLength(1);
      expect(db.removals()).toEqual([]);
    } else {
      expect(db.removals()).toHaveLength(1);
      expect(db.removals()[0]).toMatch(new RegExp(`^${user.id}/[a-f0-9-]+\\.webp$`));
      expect(db.records()).toHaveLength(finish === 'discard' ? 0 : 1);
      if (finish !== 'discard') expect(db.records()[0].images).toEqual([]);
    }
  });
}

test('real websocket table notifications reload server records and never merge draft payloads', async ({ page }) => {
  const db = await backend(page, [fixture(50, 'Realtime browser fixture', { status: 'draft' })]);
  let emit: ((table: 'products' | 'categories', type?: string) => void) | undefined;
  await page.routeWebSocket('wss://catalog-browser-test.supabase.co/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      const decoded = JSON.parse(message.toString());
      const arrayFormat = Array.isArray(decoded);
      const [joinRef, ref, topic, event, payload] = arrayFormat ? decoded
        : [decoded.join_ref, decoded.ref, decoded.topic, decoded.event, decoded.payload];
      const send = (replyEvent: string, replyPayload: unknown, replyRef = ref) => socket.send(JSON.stringify(arrayFormat
        ? [joinRef, replyRef, topic, replyEvent, replyPayload]
        : { join_ref: joinRef, ref: replyRef, topic, event: replyEvent, payload: replyPayload }));
      if (event === 'phx_join') {
        const filters = payload.config.postgres_changes.map((filter: Record<string, unknown>, index: number) => ({ ...filter, id: `filter-${index}` }));
        send('phx_reply', { status: 'ok', response: { postgres_changes: filters } });
        emit = (table, type = 'UPDATE') => send('postgres_changes', { ids: filters.filter((filter: { table: string }) => filter.table === table).map((filter: { id: string }) => filter.id),
          data: { schema: 'public', table, type, columns: [], record: { id: 'untrusted-payload', status: 'draft', name: 'Never render payload' },
            old_record: { id: 'untrusted-payload' }, commit_timestamp: new Date().toISOString(), errors: null } }, null);
      } else if (event === 'heartbeat' || event === 'phx_leave') send('phx_reply', { status: 'ok', response: {} });
    });
  });
  await page.goto('/#/catalog');
  await expect.poll(() => Boolean(emit)).toBe(true);
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
  const reads = db.reads();
  db.records()[0].status = 'published'; emit!('products');
  await expect(page.locator('.pub-product-card')).toHaveCount(1);
  expect(db.reads()).toBeGreaterThan(reads);
  await expect(page.locator('.pub-product-card')).toContainText('Realtime browser fixture');
  await expect(page.getByText('Never render payload')).toHaveCount(0);
  db.categories()[0].name = 'Realtime category update'; emit!('categories');
  await expect(page.locator('.pub-category-filters').getByRole('button', { name: 'Realtime category update', exact: true })).toBeVisible();
  db.records()[0].status = 'archived'; emit!('products', 'DELETE');
  await expect(page.locator('.pub-product-card')).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
  test(`admin and public layouts remain usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await backend(page);
    await page.setViewportSize(viewport);
    await page.goto('/#/admin');
    await expect(page.getByRole('button', { name: 'Add product', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const breadcrumb = await page.locator('.breadcrumbs').boundingBox();
    const actions = await page.locator('.topbar-actions').boundingBox();
    expect(breadcrumb).not.toBeNull();
    expect(actions).not.toBeNull();
    const overlap = breadcrumb!.x < actions!.x + actions!.width && actions!.x < breadcrumb!.x + breadcrumb!.width &&
      breadcrumb!.y < actions!.y + actions!.height && actions!.y < breadcrumb!.y + breadcrumb!.height;
    expect(overlap, 'Admin breadcrumb and connection/actions must never overlap').toBe(false);
    await page.screenshot({ path: testInfo.outputPath('admin-test-fixtures.png'), fullPage: true });
    await page.goto('/#/catalog');
    await expect(page.getByRole('heading', { name: 'Considered spaces. Crafted to belong.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('public-empty-test-backend.png'), fullPage: true });
  });
}


function minimalTriangleGlb(): Buffer {
  const positions = Buffer.alloc(36);
  for (const [index, value] of [0, 0, 0, 1, 0, 0, 0, 1, 0].entries()) positions.writeFloatLE(value, index * 4);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  };
  const text = JSON.stringify(gltf);
  const jsonChunk = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const result = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + positions.length);
  result.write('glTF', 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonChunk.length, 12);
  result.write('JSON', 16);
  jsonChunk.copy(result, 20);
  const binHeader = 20 + jsonChunk.length;
  result.writeUInt32LE(positions.length, binHeader);
  result.write('BIN\x00', binHeader + 4);
  positions.copy(result, binHeader + 8);
  return result;
}

test('existing product photos generate a real GLB through the authenticated service and save only after preview', async ({ page }) => {
  const id = '90000000-0000-4000-8000-000000000208';
  const product = {
    id, name: 'Photo to 3D fixture', sku: 'TEST-PHOTO-3D', category_id: bruttiCategories[0].id,
    description: 'Fixture product', materials: 'Fixture wood', width: 45, depth: 40, height: 50, price: null,
    status: 'published', availability: 'available', featured: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    images: [
      { id: 'front', alt: 'Front photo', url: endpoint + '/storage/v1/object/public/product-images/front.png', storagePath: 'front.png' },
      { id: 'side', alt: 'Side photo', url: endpoint + '/storage/v1/object/public/product-images/side.png', storagePath: 'side.png' },
    ],
    model_path: null, model_name: null
  };
  const db = await backend(page, [product], { productModels: true });
  const requests: string[][] = [];
  const glb = minimalTriangleGlb();
  await page.route(endpoint + '/functions/v1/catalog-image-to-3d', async route => {
    const input = route.request().postDataJSON() as { action: string; imageIds?: string[] };
    if (input.action === 'download') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: glb });
    if (input.action === 'config') return route.fulfill({ status: 200, json: { configured: true, job: null } });
    if (input.action === 'start') {
      requests.push(input.imageIds || []);
      return route.fulfill({ status: 200, json: { job: { id: 'test-generation', status: 'processing' } } });
    }
    if (input.action === 'status') return route.fulfill({ status: 200, json: { job: { id: 'test-generation', status: 'ready', progress: 100 } } });
    return route.fulfill({ status: 400, json: { error: 'Invalid action' } });
  });
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Photo to 3D fixture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit product' });
  const section = dialog.getByRole('region', { name: 'Real 3D model', exact: true });
  await expect(section.getByRole('button', { name: 'Use photo 1 for 3D generation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section.getByRole('button', { name: 'Use photo 2 for 3D generation' })).toHaveAttribute('aria-pressed', 'false');
  await section.getByRole('button', { name: 'Use photo 2 for 3D generation' }).click();
  await expect(section.getByRole('button', { name: 'Use photo 1 for 3D generation' })).toHaveAttribute('aria-pressed', 'false');
  await expect(section.getByRole('button', { name: 'Use photo 2 for 3D generation' })).toHaveAttribute('aria-pressed', 'true');
  page.once('dialog', dialog => void dialog.accept());
  await section.getByRole('button', { name: 'Generate 3D from selected photos' }).click();
  await expect(section.getByRole('button', { name: 'Preview generated 3D' })).toBeVisible({ timeout: 20_000 });
  expect(requests).toEqual([['side']]);
  expect(db.storedModels.size).toBe(0);
  await section.getByRole('button', { name: 'Preview generated 3D' }).click();
  await expect(section.getByRole('button', { name: 'Wireframe' })).toBeEnabled({ timeout: 20_000 });
  expect(db.storedModels.size).toBe(0);
  await dialog.getByRole('button', { name: 'Save product' }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.records()[0]).toMatchObject({
    model_name: 'generated-model.glb',
    model_path: expect.stringMatching(new RegExp('^' + id + '/.*\\.zip$')),
  });
  expect(db.storedModels.size).toBe(1);
  await page.goto('/#/catalog/product/' + id);
  await expect(page.getByRole('button', { name: 'Interactive 3D', exact: true })).toBeVisible();
});


test('without a connected GPU, staff can use free TRELLIS demo and import a genuine GLB for preview', async ({ page }) => {
  const id = '90000000-0000-4000-8000-000000000209';
  const product = {
    id, name: 'Community 3D demo fixture', sku: 'TEST-FREE-3D',
    category_id: bruttiCategories[0].id, description: 'Fixture product',
    materials: 'Wood', width: 70, depth: 30, height: 125, price: null,
    status: 'published', availability: 'available', featured: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    images: [{ id: 'front', alt: 'Front photo', url: endpoint + '/storage/v1/object/public/product-images/front.png', storagePath: 'front.png' }],
    model_path: null, model_name: null,
  };
  const db = await backend(page, [product], { productModels: true });
  await page.route(endpoint + '/functions/v1/catalog-image-to-3d', route =>
    route.fulfill({ status: 200, json: { configured: false, job: null } }));
  await page.goto('/#/admin');
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: /Products/ }).click();
  await page.getByRole('button', { name: 'Edit Community 3D demo fixture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit product' });
  const region = dialog.getByRole('region', { name: 'Real 3D model', exact: true });
  const offline = region.getByRole('group', { name: 'Generate 3D without a GPU server' });
  await expect(offline.getByText('Try real 3D without Meshy or your own GPU')).toBeVisible();
  await expect(offline.getByRole('button', { name: 'Download original product photo' })).toBeEnabled();
  await expect(offline.getByRole('link', { name: 'Open Microsoft TRELLIS.2 demo' }))
    .toHaveAttribute('href', 'https://huggingface.co/spaces/microsoft/TRELLIS.2');
  expect(db.storedModels.size).toBe(0);
  await offline.locator('input[type="file"]').setInputFiles({
    name: 'from-demo.glb', mimeType: 'model/gltf-binary', buffer: minimalTriangleGlb(),
  });
  await expect(region.getByRole('button', { name: 'Wireframe' })).toBeEnabled({ timeout: 15_000 });
  expect(db.storedModels.size).toBe(0);
  await dialog.getByRole('button', { name: 'Save product' }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.storedModels.size).toBe(1);
  expect(db.records()[0]).toMatchObject({ model_name: 'from-demo.glb' });
});
