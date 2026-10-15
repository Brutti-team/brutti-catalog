import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { backendConfig, PROJECT_URL, readOnlyJson } from '../scripts/backend-config.mjs';
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { inspectBackend, PRODUCT_COLUMNS } from '../scripts/inspect-backend.mjs';
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { CATEGORY_NAMES } from '../scripts/import-manifest.mjs';

const config = { url: PROJECT_URL, key: 'sb_publishable_test-only-fixture' };
const categories = CATEGORY_NAMES.map((name: string, index: number) => ({ id: `category-${index}`, name }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('read-only backend helpers', () => {
  it('rejects a legacy anon key belonging to a different project', () => {
    const payload = Buffer.from(JSON.stringify({ role: 'anon', ref: 'differentproject' })).toString('base64url');
    expect(() => backendConfig({ VITE_SUPABASE_URL: PROJECT_URL, VITE_SUPABASE_ANON_KEY: `header.${payload}.signature` })).toThrow(/project/);
  });

  it('accepts the existing project legacy anon key and public publishable format', () => {
    const payload = Buffer.from(JSON.stringify({ role: 'anon', ref: 'lgdjoxafleqnbomtfzqt' })).toString('base64url');
    expect(backendConfig({ VITE_SUPABASE_URL: PROJECT_URL, VITE_SUPABASE_ANON_KEY: `header.${payload}.signature` }).url).toBe(PROJECT_URL);
    expect(backendConfig({ VITE_SUPABASE_URL: PROJECT_URL, VITE_SUPABASE_ANON_KEY: config.key }).key).toBe(config.key);
  });

  it('records HTTP evidence without including error bodies or credentials', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit) => response({ code: '42501', message: 'Bearer SECRET_IN_ERROR_BODY' }, 401));
    const result = await readOnlyJson(`${PROJECT_URL}/rest/v1/catalog_admins`, { apikey: config.key }, { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 401, errorCode: '42501', data: null });
    expect(result.requestedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(JSON.stringify(result)).not.toContain('SECRET_IN_ERROR_BODY');
    expect(JSON.stringify(result)).not.toContain(config.key);
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
  });

  it('redacts network exception details', async () => {
    const result = await readOnlyJson(`${PROJECT_URL}/rest/v1/`, {}, {
      fetchImpl: async () => { throw new Error('SECRET_IN_NETWORK_ERROR'); },
    });
    expect(result).toMatchObject({ ok: false, status: null, errorCode: 'NETWORK_ERROR' });
    expect(JSON.stringify(result)).not.toContain('SECRET_IN_NETWORK_ERROR');
  });
});

describe('public inspector OpenAPI fallback', () => {
  it('keeps successful category/product evidence when OpenAPI requires additional privileges', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/rest/v1/') return response({ message: 'restricted' }, 401);
      if (url.pathname.endsWith('/categories')) return response(categories);
      if (url.searchParams.get('select') === 'price_basis') return response({ code: '42703', message: 'missing' }, 400);
      if (url.searchParams.get('select') === 'display_order') return response({ code: '42703', message: 'missing' }, 400);
      return response([]);
    });
    const result = await inspectBackend(config, { fetchImpl });
    expect(result.requiredReadsPassed).toBe(true);
    expect(result.schema).toMatchObject({ complete: false, source: 'column-probes', openapi: { status: 401 } });
    expect(result.productColumns).toEqual(PRODUCT_COLUMNS);
    expect(result.categories).toEqual(CATEGORY_NAMES);
    expect(result.anonymouslyVisibleProductsInFirst1000).toBe(0);
    expect(result.unpublishedVisible).toBe(false);
    expect(result.optionalProductColumns.price_basis).toMatchObject({ availability: 'missing-in-api-schema', status: 400, errorCode: '42703' });
    expect(result.note).toMatch(/cannot prove.*total.*RLS/i);
    expect(JSON.stringify(result)).not.toContain(config.key);
  });

  it('permits legitimate staff category additions and renames while reporting original import differences', async () => {
    const editedCategories = [
      ...categories.filter((category: { name: string }) => category.name !== 'Displays & Panels'),
      { id: 'category-custom-kiosks', name: 'Kiosks' },
      { id: 'category-renamed-panels', name: 'Panels' },
    ];
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/rest/v1/') return response({}, 401);
      if (url.pathname.endsWith('/categories')) return response(editedCategories);
      return response([]);
    });
    const result = await inspectBackend(config, { fetchImpl });
    expect(result.requiredReadsPassed).toBe(true);
    expect(result.categories).toContain('Kiosks');
    expect(result.categories).toContain('Panels');
    expect(result.missing).toContain('Displays & Panels');
    expect(result.unexpected).toContain('Kiosks');
    expect(result.note).toMatch(/Category additions\/renames made in Admin are permitted/);
  });

  it('rejects an empty or duplicated category response even when API status is 200', async () => {
    for (const badCategories of [[], [categories[0], categories[0]], [{ id: '', name: '' }]]) {
      const fetchImpl = async (input: string) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/categories')) return response(badCategories);
        return response([]);
      };
      expect((await inspectBackend(config, { fetchImpl })).requiredReadsPassed).toBe(false);
    }
  });

  it('still blocks public exposure of non-published products', async () => {
    const fetchImpl = async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/categories')) return response([...categories, { id: 'custom', name: 'Kiosks' }]);
      if (url.pathname.endsWith('/products') && url.searchParams.get('select') === 'id,status') {
        return response([{ id: 'secret-draft', status: 'draft' }]);
      }
      return response([]);
    };
    const result = await inspectBackend(config, { fetchImpl });
    expect(result.requiredReadsPassed).toBe(false);
    expect(result.unpublishedVisible).toBe(true);
  });

  it('does not describe failed public reads as an empty catalog', async () => {
    const fetchImpl = async (input: string) => new URL(input).pathname.endsWith('/categories')
      ? response(categories) : response({ code: '42501' }, 401);
    const result = await inspectBackend(config, { fetchImpl });
    expect(result.requiredReadsPassed).toBe(false);
    expect(result.categories).toEqual(CATEGORY_NAMES);
    expect(result.anonymouslyVisibleProductsInFirst1000).toBeNull();
    expect(result.unpublishedVisible).toBeNull();
    expect(result.productReads.status).toBe(401);
  });
});
