import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
// @ts-expect-error Native operator CLI intentionally has no browser declaration.
import { assembleSite } from '../scripts/assemble-site.mjs';

let directory: string, website: string, catalog: string, out: string;
const index = '<!doctype html><title>Actual website fixture</title><p>Unchanged root bytes</p>\n';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function fixture(assetFolder = 'catalog-assets') {
  await mkdir(join(website, 'assets'), { recursive: true });
  await writeFile(join(website, 'index.html'), index);
  await writeFile(join(website, '404.html'), '<h1>Original static 404</h1>');
  await writeFile(join(website, 'assets', 'website.bin'), Buffer.from([0, 255, 1, 2]));
  for (const entry of ['admin', 'catalog']) {
    await mkdir(join(catalog, entry), { recursive: true });
    await writeFile(join(catalog, entry, 'index.html'), `<script type="module" src="/${assetFolder}/assets/app.js"></script><link rel="stylesheet" href="/${assetFolder}/assets/app.css">`);
  }
  await mkdir(join(catalog, assetFolder, 'assets'), { recursive: true });
  await writeFile(join(catalog, assetFolder, 'assets', 'app.js'), 'document.body.dataset.catalog = "ready";');
  await writeFile(join(catalog, assetFolder, 'assets', 'app.css'), 'body { color: green; }');
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brutti-assembly-test-'));
  website = join(directory, 'website'); catalog = join(directory, 'catalog'); out = join(directory, 'review.local');
  await fixture();
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe('review-only static site assembly', () => {
  it('preserves all website bytes and emits digest evidence while adding the catalog folders', async () => {
    const report = await assembleSite({ website, catalog, out });
    expect(await readFile(join(out, 'index.html'), 'utf8')).toBe(index);
    expect(await readFile(join(out, '404.html'), 'utf8')).toBe('<h1>Original static 404</h1>');
    expect(await readFile(join(out, 'assets', 'website.bin'))).toEqual(Buffer.from([0, 255, 1, 2]));
    expect(await readFile(join(out, 'admin', 'index.html'))).toEqual(await readFile(join(catalog, 'admin', 'index.html')));
    expect(await readFile(join(out, 'catalog-assets', 'assets', 'app.js'))).toEqual(await readFile(join(catalog, 'catalog-assets', 'assets', 'app.js')));
    expect(report.website).toMatchObject({ fileCount: 3, indexSha256Before: digest(index), indexSha256After: digest(index), rootUnchanged: true, freshness: 'not-verified' });
    expect(report.website.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.catalog).toMatchObject({ fileCount: 4, assetFolder: 'catalog-assets' });
    expect(report.catalog.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.gates).toMatchObject({ sourceBytesPreserved: true, websiteFilesPreserved: true, noCollisions: true, noSymlinks: true, noPrivateCredentials: true, staticEntrypointsValid: true });
    expect(JSON.parse(await readFile(join(out, 'assembly-report.json'), 'utf8'))).toEqual(report);
    expect(await readFile(join(website, 'index.html'), 'utf8')).toBe(index);
    expect(await readdir(website)).toEqual(['404.html', 'assets', 'index.html']);
  });

  it('supports a distinct nested custom asset base referenced by both entry documents', async () => {
    await rm(catalog, { recursive: true }); await fixture('furniture/assets-root');
    const report = await assembleSite({ website, catalog, out });
    expect(report.catalog.assetFolder).toBe('furniture');
    expect(await readFile(join(out, 'furniture', 'assets-root', 'assets', 'app.js'), 'utf8')).toContain('ready');
  });

  it.each(['admin', 'catalog', 'catalog-assets', 'assembly-report.json'])('refuses the existing website collision %s before writing an output', async collision => {
    await writeFile(join(website, collision), 'Original website-owned path');
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/collision/i);
    await expect(readFile(join(out, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(website, collision), 'utf8')).toBe('Original website-owned path');
  });

  it('refuses an existing output without touching its files', async () => {
    await mkdir(out); await writeFile(join(out, 'keep.txt'), 'preserve');
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/new.*output|already exists/i);
    expect(await readFile(join(out, 'keep.txt'), 'utf8')).toBe('preserve');
  });

  it.each(['website', 'catalog'])('refuses an output nested under the %s source', async source => {
    const target = join(source === 'website' ? website : catalog, 'review.local');
    await expect(assembleSite({ website, catalog, out: target })).rejects.toThrow(/overlap/i);
    await expect(readFile(join(target, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an output containing either input source', async () => {
    await expect(assembleSite({ website, catalog, out: directory })).rejects.toThrow(/overlap/i);
  });

  it('reports a missing existing website build explicitly and produces no invented root', async () => {
    await rm(website, { recursive: true });
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/existing website build.*required|website build.*missing/i);
    await expect(readFile(join(out, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['website', 'catalog'])('refuses a symlink escape in the %s source', async source => {
    const outside = join(directory, 'outside.txt'); await writeFile(outside, 'Do not copy');
    await symlink(outside, join(source === 'website' ? website : catalog, 'escape.txt'));
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/symlink/i);
    await expect(readFile(join(out, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses symlinked source and output ancestors', async () => {
    const alias = join(directory, 'alias'); await symlink(website, alias);
    await expect(assembleSite({ website: alias, catalog, out })).rejects.toThrow(/symlink/i);
    await expect(assembleSite({ website, catalog, out: join(alias, 'review.local') })).rejects.toThrow(/symlink/i);
  });

  it.each(['.env', '.env.local', '.aws/credentials', 'private.pem'])('refuses private credential paths before copying: %s', async path => {
    const parts = path.split('/'); await mkdir(join(website, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(website, path), 'MUST_NOT_APPEAR_IN_REPORT');
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/credentials|private|hidden/i);
    await expect(readFile(join(out, 'assembly-report.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses embedded private keys without disclosing their values', async () => {
    await writeFile(join(catalog, 'catalog-assets', 'assets', 'app.js'), 'const key = "sb_secret_test_private_value_123456";');
    try { await assembleSite({ website, catalog, out }); throw new Error('Assembly must fail'); }
    catch (error) {
      expect((error as Error).message).toMatch(/private credentials/i);
      expect((error as Error).message).not.toContain('test_private_value');
    }
  });

  it.each(['index.html', '404.html', 'unexpected.txt'])('refuses a catalog root replacement or unexpected root file: %s', async path => {
    await writeFile(join(catalog, path), '<h1>Do not replace the website root</h1>');
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/catalog.*root|unexpected/i);
  });

  it('refuses missing entry documents or missing referenced assets', async () => {
    await rm(join(catalog, 'admin', 'index.html'));
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/entry|admin/);
    await fixture(); await rm(join(catalog, 'catalog-assets', 'assets', 'app.js'));
    await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/asset/);
  });

  it('refuses traversal or external asset references', async () => {
    for (const src of ['/catalog-assets/../index.html', 'https://external.example/app.js']) {
      await writeFile(join(catalog, 'admin', 'index.html'), `<script src="${src}"></script>`);
      await expect(assembleSite({ website, catalog, out })).rejects.toThrow(/asset|safe/);
    }
  });
});
