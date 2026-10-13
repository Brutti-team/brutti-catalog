import { describe, expect, it } from 'vitest';
// Operator scripts are native Node modules; browser code never imports them.
// @ts-expect-error Native .mjs operator module intentionally has no browser declaration.
import { draftRow, sourceIdentity, validateManifest } from '../scripts/import-manifest.mjs';
// @ts-expect-error Native .mjs operator module intentionally has no browser declaration.
import { backendConfig } from '../scripts/backend-config.mjs';
import { formatProductPrice } from '../src/lib/price';

const digest = 'a'.repeat(64);
const file = `images/${'b'.repeat(64)}.webp`;
const evidence = { documentSha256: digest, pageCount: 104, pages: [{ page: 12, imageCandidates: [{ file }] }] };
const product = { sourceKey: 'review-test', name: 'Import regression fixture', sku: 'TEST-IMPORT-1', category: 'Racks & Shelves',
  reviewed: true, pages: [12], description: null, materials: 'Source materials', finishing: 'Source finish',
  dimensionsCm: { width: null, depth: 50, height: null }, availability: null,
  price: { myr: 1234.56, basis: 'starting-from', sourceText: 'Price starting from RM1,234.56' }, images: [{ file, alt: 'Reviewed source photo' }] };
const manifest = { version: 1, source: 'brutti-catalogue-2025', reviewed: true, documentSha256: digest, products: [product] };

describe('reviewed catalogue import', () => {
  it('does not infer unknown details or publish imported records', () => {
    validateManifest(manifest, evidence);
    const row = draftRow(product, [{ name: 'Racks & Shelves', id: 'category-id' }], []);
    expect(row).toMatchObject({ status: 'draft', featured: false, availability: 'unavailable', width: 0, depth: 50, height: 0, description: '', price: 1234.56, price_basis: 'starting-from', materials: 'Source materials\nFinishing: Source finish' });
  });
  it('requires human approval and exact source digest before any import', () => {
    expect(() => validateManifest({ ...manifest, reviewed: false }, evidence)).toThrow(/reviewed/);
    expect(() => validateManifest(manifest, { ...evidence, documentSha256: 'c'.repeat(64) })).toThrow(/digest/);
    expect(() => validateManifest(manifest, { ...evidence, pageCount: 103 })).toThrow(/104-page/);
  });
  it('rejects duplicate identities, SKUs, duplicate photos and photos from unrelated pages', () => {
    expect(() => validateManifest({ ...manifest, products: [product, product] }, evidence)).toThrow(/unique/);
    expect(() => validateManifest({ ...manifest, products: [product, { ...product, sourceKey: 'second' }] }, evidence)).toThrow(/SKU/);
    expect(() => validateManifest({ ...manifest, products: [{ ...product, images: [product.images[0], product.images[0]] }] }, evidence)).toThrow(/deduplicate/);
    expect(() => validateManifest({ ...manifest, products: [{ ...product, pages: [13] }] }, evidence)).toThrow(/source pages/);
  });
  it('requires explicit unknowns and printed price text', () => {
    expect(() => validateManifest({ ...manifest, products: [{ ...product, materials: undefined }] }, evidence)).toThrow(/materials/);
    expect(() => validateManifest({ ...manifest, products: [{ ...product, price: { myr: 123, basis: 'starting-from', sourceText: '' } }] }, evidence)).toThrow(/printed price/);
    expect(() => validateManifest({ ...manifest, products: [{ ...product, category: 'Invented category' }] }, evidence)).toThrow(/official/);
  });
  it('keeps stable identity across re-exports and formats starting prices accurately', () => {
    expect(sourceIdentity(product.sourceKey)).toBe(draftRow(product, [{ name: product.category, id: 'c' }], []).id);
    expect(sourceIdentity(product.sourceKey)).not.toBe(sourceIdentity('different-product'));
    expect(formatProductPrice({ price: 1234.56, priceBasis: 'starting-from' })).toMatch(/^Starting from RM\s?1,234.56$/);
    expect(formatProductPrice({ price: null })).toBe('On enquiry');
  });
  it('operator tools refuse other projects and privileged keys', () => {
    expect(() => backendConfig({ VITE_SUPABASE_URL: 'https://other.supabase.co', VITE_SUPABASE_ANON_KEY: 'x' })).toThrow(/existing/);
    expect(() => backendConfig({ VITE_SUPABASE_URL: 'https://lgdjoxafleqnbomtfzqt.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_secret_test' })).toThrow(/Private/);
    const key = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    expect(() => backendConfig({ VITE_SUPABASE_URL: 'https://lgdjoxafleqnbomtfzqt.supabase.co', VITE_SUPABASE_ANON_KEY: key })).toThrow(/anon/);
  });
});
