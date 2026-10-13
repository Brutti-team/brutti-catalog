import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Native operator CLI intentionally has no browser declaration.
import { assembleSite } from '../../scripts/assemble-site.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const endpoint = 'https://catalog-browser-test.supabase.co';
const origin = 'http://127.0.0.1:5195';
const fixtureRoot = '<!doctype html><h1>Website preservation fixture</h1>\n';
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'static-route-test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-10-13T00:00:00Z' };
const callbackToken = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated', aud: 'authenticated' })).toString('base64url')}.test`;
let workspace: string, combined: string, pages: string;
let server: Server | undefined;
let callbackTokenReceived = false;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  workspace = await mkdtemp(join(tmpdir(), 'brutti-static-browser-'));
  const vite = join(repository, 'node_modules', 'vite', 'bin', 'vite.js');
  const build = async (mode: string, base: string) => promisify(execFile)(process.execPath,
    [vite, 'build', repository, '--config', join(repository, 'vite.config.ts'), '--mode', mode], {
      cwd: workspace,
      // Every public key selector is explicit; production configuration never enters these builds.
      env: { ...process.env, VITE_SUPABASE_URL: endpoint, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_static-test-only', VITE_SUPABASE_ANON_KEY: 'sb_publishable_static-test-only', VITE_ENQUIRY_EMAIL: '', VITE_BASE_PATH: base, GITHUB_PAGES: mode === 'site' ? 'false' : 'true' },
      maxBuffer: 4 * 1024 * 1024,
    });
  await build('site', '/catalog-assets/');
  await build('production', '/brutti-catalog/');
  const website = join(workspace, 'website-fixture'); await mkdir(website);
  await writeFile(join(website, 'index.html'), fixtureRoot);
  combined = join(workspace, 'combined-review.local');
  await assembleSite({ website, catalog: join(workspace, 'dist-site'), out: combined });
  pages = join(workspace, 'dist');
  server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', origin);
    const projectPages = url.pathname.startsWith('/brutti-catalog/');
    const root = projectPages ? pages : combined;
    let path: string;
    try { path = resolve(root, decodeURIComponent(projectPages ? url.pathname.slice('/brutti-catalog/'.length) : url.pathname.slice(1))); }
    catch { response.writeHead(400); response.end('Malformed path'); return; }
    const child = relative(root, path);
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) { response.writeHead(403); response.end('Forbidden'); return; }
    try {
      if ((await stat(path)).isDirectory()) {
        if (!url.pathname.endsWith('/')) { response.writeHead(301, { Location: `${url.pathname}/${url.search}` }); response.end(); return; }
        path = join(path, 'index.html');
      }
      const body = await readFile(path);
      const type = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(path)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type }); response.end(body);
    } catch { response.writeHead(404); response.end('Static 404; no SPA fallback'); }
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject); server!.listen(5195, '127.0.0.1', resolve);
  });
});

test.afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  callbackTokenReceived = false;
  await page.route(`${endpoint}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/v1/user') {
      if (route.request().headers().authorization === `Bearer ${callbackToken}`) callbackTokenReceived = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    const product = { id: 'static-route-table', name: 'Static route table', sku: 'STATIC-TABLE', category_id: 'tables', description: 'Test-only static routing fixture.', materials: 'Test-only wood', width: 80, depth: 80, height: 70, price: 120, status: 'published', availability: 'available', featured: false, images: [{ id: 'image', url: `${origin}/catalog-assets/images/placeholder.svg`, alt: 'Static route table' }], created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' };
    const data = path.endsWith('/products') ? [product] : path.endsWith('/categories') ? [{ id: 'tables', name: 'Tables', description: 'Test-only category' }] : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
});

test('concrete site and project Pages entries load directly and refresh on a raw static server', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) errors.push(`HTTP ${response.status()}`); });
  for (const [path, heading] of [
    ['/', 'Website preservation fixture'], ['/admin', 'Welcome back.'], ['/catalog', 'Good design. Better living.'],
    ['/brutti-catalog/', 'Welcome back.'], ['/brutti-catalog/admin', 'Welcome back.'], ['/brutti-catalog/catalog', 'Good design. Better living.'],
  ]) {
    const response = await page.goto(`${origin}${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  expect(await readFile(join(combined, 'index.html'), 'utf8')).toBe(fixtureRoot);
  expect(errors).toEqual([]);
});

test('product hash URLs resolve directly and refresh beneath both concrete entry bases', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/admin/#/product/static-route-table', '/catalog/#/catalog/product/static-route-table', '/catalog/#/product/static-route-table', '/brutti-catalog/admin/#/product/static-route-table']) {
    await page.goto(`${origin}${path}`);
    await expect(page.getByRole('heading', { name: 'Static route table', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Static route table', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('expired recovery callbacks retain their query and fragment at a static entry', async ({ page }) => {
  await page.goto(`${origin}/catalog?auth=recovery#error=access_denied&error_code=otp_expired&type=recovery`);
  await expect(page.getByRole('heading', { name: 'Reset your password.', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('expired or invalid');
  await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('auth')).toBe('recovery');
});

test('valid invite fragments reach Supabase before the static route initializes', async ({ page }) => {
  await page.goto(`${origin}/catalog/?auth=invite#access_token=${callbackToken}&refresh_token=test-only-refresh&type=invite&token_type=bearer&expires_in=3600`);
  await expect(page.getByRole('heading', { name: 'Set your password.', exact: true })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  expect(callbackTokenReceived).toBe(true);
});

test('unknown static paths return an actual 404 and never replace the website root', async ({ request }) => {
  for (const path of ['/does-not-exist', '/catalog/not-a-file', '/brutti-catalog/not-a-file']) {
    const response = await request.get(`${origin}${path}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe('Static 404; no SPA fallback');
  }
  expect(await (await request.get(`${origin}/`)).text()).toBe(fixtureRoot);
});
