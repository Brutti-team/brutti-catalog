import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductImage } from '../src/lib/types';

const fake = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), remove: vi.fn(),
  channel: vi.fn(), removeChannel: vi.fn(), upsert: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: fake.getUser }, from: fake.from, rpc: fake.rpc,
  storage: { from: () => ({ remove: fake.remove }) },
  channel: fake.channel, removeChannel: fake.removeChannel,
}) }));

const endpoint = 'https://example.supabase.co';
const image = (path = 'admin/photo.webp'): ProductImage => ({
  id: path, alt: 'Photo', storagePath: path,
  url: `${endpoint}/storage/v1/object/public/product-images/${path}`,
});
const product: Product = {
  id: 'product-id', name: 'Catalog item', sku: 'CAT-1', categoryId: 'category-id',
  description: '', materials: '', width: 0, depth: 0, height: 0, price: null,
  status: 'draft', availability: 'available', featured: false, images: [],
  createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
};
const row = (extra: Record<string, unknown> = {}) => ({
  ...product, category_id: product.categoryId, created_at: product.createdAt,
  updated_at: product.updatedAt, ...extra,
});
let previous: Record<string, unknown> | null;
let deleted: Record<string, unknown> | null;
let saveError: { message: string } | null;
let caps: Record<string, unknown> | null;
let events: (() => void)[];
let channelStatus: ((status: string) => void) | undefined;
let channelObject: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', endpoint);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
  previous = row({ images: [image()] }); deleted = previous; saveError = null;
  caps = { ordering: true, imageCleanup: true, priceBasis: false };
  fake.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null });
  fake.rpc.mockImplementation(async (name: string) => name === 'catalog_capabilities'
    ? { data: caps, error: caps ? null : { code: 'PGRST202', message: 'Not installed' } }
    : { data: true, error: null });
  fake.remove.mockResolvedValue({ data: [{ name: 'admin/photo.webp' }], error: null });
  fake.upsert.mockImplementation((saved: Record<string, unknown>) => ({
    select: () => ({ single: async () => ({ data: saved, error: saveError }) }),
  }));
  fake.from.mockImplementation((table: string) => table === 'catalog_admins' ? {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'admin' }, error: null }) }) }),
  } : table === 'categories' ? { select: () => ({ order: async () => ({ data: [], error: null }) }) } : {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: previous, error: null }) }),
      order: async () => ({ data: previous ? [previous] : [], error: null }),
    }),
    upsert: fake.upsert,
    delete: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: deleted, error: null }) }) }) }),
  });
  events = []; channelStatus = undefined;
  channelObject = {
    on: vi.fn((_type, _filter, callback) => { events.push(callback); return channelObject; }),
    subscribe: vi.fn(callback => { channelStatus = callback; return channelObject; }),
  };
  fake.channel.mockReturnValue(channelObject);
  fake.removeChannel.mockResolvedValue('ok');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('catalog management compatibility and image cleanup', () => {
  it('loads ordering only from confirmed server fields and disables unavailable capabilities', async () => {
    caps = null; previous = row({ display_order: 7 });
    const catalog = await import('../src/lib/catalog');
    const data = await catalog.loadCatalog();
    expect(data.products[0].displayOrder).toBe(7);
    expect(data.capabilities).toEqual({ ordering: false, imageCleanup: false, priceBasis: false });
  });

  it('does not send uninstalled schema columns or delete images in legacy workspaces', async () => {
    caps = null;
    const catalog = await import('../src/lib/catalog');
    await catalog.saveProduct({ ...product, displayOrder: 3, priceBasis: 'fixed' });
    expect(fake.upsert.mock.calls[0][0]).not.toHaveProperty('display_order');
    expect(fake.upsert.mock.calls[0][0]).not.toHaveProperty('price_basis');
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('preserves an existing price_basis column when the separate import proposal is installed first', async () => {
    caps = null; previous = row({ price_basis: 'starting-from' });
    const catalog = await import('../src/lib/catalog');
    const data = await catalog.loadCatalog();
    await catalog.saveProduct(data.products[0]);
    expect(fake.upsert.mock.calls[0][0]).toHaveProperty('price_basis', 'starting-from');
  });

  it('persists approved display order and cleans removed images once after the save succeeds', async () => {
    previous = row({ images: [image(), image()] });
    const catalog = await import('../src/lib/catalog');
    const saved = await catalog.saveProduct({ ...product, displayOrder: 12 });
    expect(fake.upsert.mock.calls[0][0]).toHaveProperty('display_order', 12);
    expect(saved.displayOrder).toBe(12);
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(['admin/photo.webp']);
    expect(fake.rpc).toHaveBeenCalledWith('can_remove_catalog_image', { p_storage_path: 'admin/photo.webp' });
  });

  it('retains a removed image while another product references it', async () => {
    fake.rpc.mockImplementation(async (name: string) => ({ data: name === 'catalog_capabilities' ? caps : false, error: null }));
    const catalog = await import('../src/lib/catalog');
    await catalog.saveProduct(product);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('does not clean retained images or failed product saves', async () => {
    const catalog = await import('../src/lib/catalog');
    await catalog.saveProduct({ ...product, images: [image()] });
    expect(fake.remove).not.toHaveBeenCalled();
    saveError = { message: 'Session expired' };
    await expect(catalog.saveProduct(product)).rejects.toThrow(/Session expired/);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('requires an affected delete record so a lost session cannot falsely report success', async () => {
    deleted = null;
    const catalog = await import('../src/lib/catalog');
    await expect(catalog.deleteProduct(product.id)).rejects.toThrow(/not deleted|not found|sign in/i);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('cleans canonical URL-only legacy images through the Storage API', async () => {
    const { storagePath: _path, ...urlOnly } = image();
    deleted = row({ images: [urlOnly] });
    const catalog = await import('../src/lib/catalog');
    await catalog.deleteProduct(product.id);
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(['admin/photo.webp']);
  });

  it('accepts a safe root-level legacy object and detects a Storage API no-op', async () => {
    deleted = row({ images: [image('legacy.webp')] });
    fake.remove.mockResolvedValue({ data: [], error: null });
    const catalog = await import('../src/lib/catalog');
    const result = await catalog.deleteProduct(product.id);
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(['legacy.webp']);
    expect(result.cleanupWarning).toMatch(/deleted.*images may remain/i);
  });

  it.each([
    { ...image(), storagePath: '../other.webp' },
    { ...image(), storagePath: 'admin/../other.webp' },
    { ...image(), url: `${endpoint}/storage/v1/object/public/product-images/admin/%2e%2e/other.webp` },
    { ...image(), url: 'https://unrelated.example/photo.webp' },
    { ...image(), url: `${endpoint}/storage/v1/object/public/product-images/admin%2Fphoto.webp` },
  ])('refuses unsafe or noncanonical paths without deleting unrelated assets: %j', async unsafe => {
    deleted = row({ images: [unsafe] });
    const catalog = await import('../src/lib/catalog');
    await catalog.deleteProduct(product.id);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('reports a completed save or deletion truthfully when image cleanup fails', async () => {
    fake.remove.mockResolvedValue({ data: null, error: { message: 'Storage unavailable' } });
    const catalog = await import('../src/lib/catalog');
    const saved = await catalog.saveProduct(product);
    expect(saved.id).toBe(product.id);
    expect(saved.cleanupWarning).toMatch(/saved.*images may remain/i);
    const removed = await catalog.deleteProduct(product.id);
    expect(removed.cleanupWarning).toMatch(/deleted.*images may remain/i);
  });

  it('cleans abandoned uploads once through the reference guard without changing product records', async () => {
    const catalog = await import('../src/lib/catalog');
    const outcome = await catalog.cleanupAbandonedImages([image(), image()]);
    expect(outcome.cleanupWarning).toBeUndefined();
    expect(fake.rpc).toHaveBeenCalledWith('can_remove_catalog_image', { p_storage_path: 'admin/photo.webp' });
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(['admin/photo.webp']);
    expect(fake.upsert).not.toHaveBeenCalled();
  });

  it('reports abandoned uploads that cannot be cleaned when the capability is unavailable', async () => {
    caps = null;
    const catalog = await import('../src/lib/catalog');
    const outcome = await catalog.cleanupAbandonedImages([image()]);
    expect(outcome.cleanupWarning).toMatch(/unused images may remain/i);
    expect(fake.remove).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalledWith('can_remove_catalog_image', expect.anything());
  });

  it('reports abandoned uploads when the administrator role is lost without attempting deletion', async () => {
    fake.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const catalog = await import('../src/lib/catalog');
    const outcome = await catalog.cleanupAbandonedImages([image()]);
    expect(outcome.cleanupWarning).toMatch(/unused images may remain/i);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('preserves a protected or shared upload without reporting it as an unused image', async () => {
    fake.rpc.mockImplementation(async (name: string) => name === 'catalog_capabilities'
      ? { data: caps, error: null }
      : { data: false, error: null });
    const catalog = await import('../src/lib/catalog');
    const outcome = await catalog.cleanupAbandonedImages([image()]);
    expect(outcome.cleanupWarning).toBeUndefined();
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('preserves abandoned uploads and reports a failed server reference check', async () => {
    fake.rpc.mockImplementation(async (name: string) => name === 'catalog_capabilities'
      ? { data: caps, error: null }
      : { data: null, error: { message: 'Denied' } });
    const catalog = await import('../src/lib/catalog');
    const outcome = await catalog.cleanupAbandonedImages([image()]);
    expect(outcome.cleanupWarning).toMatch(/unused images may remain/i);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('rejects noncanonical abandoned uploads and reports a Storage API no-op', async () => {
    fake.remove.mockResolvedValue({ data: [], error: null });
    const catalog = await import('../src/lib/catalog');
    const outcome = await catalog.cleanupAbandonedImages([
      { ...image(), url: 'https://unrelated.example/photo.webp' }, image(),
    ]);
    expect(outcome.cleanupWarning).toMatch(/unused images may remain/i);
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(['admin/photo.webp']);
  });

  it('does not request cleanup capability or authentication for an empty abandoned upload list', async () => {
    const catalog = await import('../src/lib/catalog');
    expect(await catalog.cleanupAbandonedImages([])).toEqual({});
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.getUser).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Infinity, NaN, 1000001])('rejects invalid display order %s', async displayOrder => {
    const { validateProduct } = await import('../src/lib/catalog');
    expect(() => validateProduct({ ...product, displayOrder })).toThrow(/display order/i);
  });
});

describe('catalog realtime subscription', () => {
  it('reloads on table events without consuming payloads, debounces, polls after channel errors, and cleans up', async () => {
    vi.useFakeTimers();
    const visibility = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const catalog = await import('../src/lib/catalog');
    const reload = vi.fn().mockResolvedValue(undefined);
    const stop = catalog.subscribeCatalog(reload, visibility as unknown as Document);
    expect(channelObject.on.mock.calls.map(call => call[1].table)).toEqual(['products', 'categories']);
    events.forEach(callback => callback());
    await vi.advanceTimersByTimeAsync(200);
    expect(reload).toHaveBeenCalledExactlyOnceWith();
    channelStatus?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reload).toHaveBeenCalledTimes(2);
    events[0](); stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(fake.removeChannel).toHaveBeenCalledExactlyOnceWith(channelObject);
  });

  it('uses the polling fallback when realtime cannot be configured', async () => {
    vi.useFakeTimers(); fake.channel.mockImplementation(() => { throw new Error('No realtime'); });
    const visibility = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const catalog = await import('../src/lib/catalog');
    const reload = vi.fn().mockRejectedValue(new Error('Read temporarily unavailable'));
    const stop = catalog.subscribeCatalog(reload, visibility as unknown as Document);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reload).toHaveBeenCalledOnce(); stop();
  });
});
