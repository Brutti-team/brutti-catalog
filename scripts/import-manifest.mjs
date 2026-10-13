import { createHash } from 'node:crypto';

export const CATEGORY_NAMES = ['Racks & Shelves','Tables & Kitchen Counters','Displays & Panels','Beds & Bunk Beds','Reception Counters','Displays & Mementos','Rentals'];

export function sourceIdentity(sourceKey) {
  // Identity deliberately excludes document digest so corrected/re-exported PDFs cannot duplicate staff records.
  const hex = createHash('sha256').update(`brutti-catalogue-2025:${sourceKey}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export function validateManifest(manifest, evidence) {
  const fail = message => { throw new Error(message); };
  if (manifest.version !== 1 || manifest.source !== 'brutti-catalogue-2025' || manifest.reviewed !== true)
    fail('A reviewed version 1 Brutti 2025 manifest is required.');
  if (!/^[a-f0-9]{64}$/.test(manifest.documentSha256) || evidence.documentSha256 !== manifest.documentSha256 || evidence.pageCount !== 104)
    fail('Manifest must match the 104-page source evidence digest.');
  if (!Array.isArray(manifest.products) || !manifest.products.length) fail('No reviewed products supplied; nothing to import.');
  const keys = new Set(), skus = new Set();
  for (const p of manifest.products) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.sourceKey || '') || keys.has(p.sourceKey)) fail('Product source keys must be stable and unique.');
    keys.add(p.sourceKey);
    if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.length > 120) fail('Verify each product name (2–120 characters).');
    if (typeof p.sku !== 'string' || !p.sku.trim() || p.sku.length > 64 || skus.has(p.sku.trim().toUpperCase())) fail('Assign a unique staff SKU to every product.');
    skus.add(p.sku.trim().toUpperCase());
    if (!CATEGORY_NAMES.includes(p.category)) fail('Choose one of the seven official categories.');
    if (p.reviewed !== true || !Array.isArray(p.pages) || !p.pages.length || p.pages.some(n => !Number.isInteger(n) || n < 1 || n > 104)) fail('Each product needs reviewed source page numbers.');
    for (const [key, max] of [['description',10000], ['materials',2000], ['finishing',2000]])
      if (p[key] !== null && (typeof p[key] !== 'string' || p[key].length > max)) fail(`Missing/invalid ${key}; use null for unknown source details.`);
    if (p.availability !== null && !['available','made-to-order','unavailable'].includes(p.availability)) fail('Verify availability or leave it null (imports default to unavailable).');
    if (!p.dimensionsCm || ['width','depth','height'].some(k => p.dimensionsCm[k] !== null && (!Number.isFinite(p.dimensionsCm[k]) || p.dimensionsCm[k] <= 0 || p.dimensionsCm[k] >= 100000))) fail('Dimensions must be verified cm values or null.');
    if (!p.price || !['fixed','starting-from','unknown'].includes(p.price.basis) ||
        (p.price.basis === 'unknown' ? p.price.myr !== null : !Number.isFinite(p.price.myr) || p.price.myr < 0 || p.price.myr > 9999999999.99 || Math.abs(p.price.myr * 100 - Math.round(p.price.myr * 100)) > 0.0001)) fail('Price needs verified MYR amount and fixed/starting-from basis, or unknown/null.');
    if (p.price.basis !== 'unknown' && (typeof p.price.sourceText !== 'string' || !p.price.sourceText.trim())) fail('Keep the exact printed price text as evidence.');
    if (!Array.isArray(p.images) || p.images.length < 1 || p.images.length > 8) fail('Approve 1–8 actual product photographs.');
    const imageFiles = new Set();
    for (const image of p.images) {
      if (imageFiles.has(image.file)) fail('Repeated photo within one product; deduplicate it.');
      imageFiles.add(image.file);
      if (!/^images\/[a-f0-9]{64}\.webp$/.test(image.file || '') || typeof image.alt !== 'string' || image.alt.length > 300) fail('Use extracted WebP photos and reviewed image descriptions.');
      if (!p.pages.some(n => evidence.pages?.find(page => page.page === n)?.imageCandidates?.some(candidate => candidate.file === image.file))) fail('Approved photo is absent from this product’s source pages.');
    }
  }
  return manifest.products;
}

export function draftRow(product, categories, images) {
  const category = categories.find(c => c.name === product.category);
  if (!category) throw new Error('Official category is missing from the database.');
  const materials = [product.materials, product.finishing ? `Finishing: ${product.finishing}` : null].filter(Boolean).join('\n');
  if (materials.length > 2000) throw new Error('Combined materials and finishing exceeds the existing 2,000-character field.');
  return { id: sourceIdentity(product.sourceKey), name: product.name.trim(), sku: product.sku.trim().toUpperCase(),
    category_id: category.id, description: product.description || '', materials,
    width: product.dimensionsCm.width ?? 0, depth: product.dimensionsCm.depth ?? 0, height: product.dimensionsCm.height ?? 0,
    price: product.price.myr, price_basis: product.price.basis === 'unknown' ? 'fixed' : product.price.basis,
    status: 'draft', availability: product.availability ?? 'unavailable', featured: false, images };
}
