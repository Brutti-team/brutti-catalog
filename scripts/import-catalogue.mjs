import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { backendConfig } from './backend-config.mjs';
import { CATEGORY_NAMES, draftRow, sourceIdentity, validateManifest } from './import-manifest.mjs';

// Default is offline validation. --apply is an explicit write operation, never called by CI/startup.
try {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const manifestPath = args.find(a => !a.startsWith('--'));
  if (!manifestPath || args.some(a => a.startsWith('--') && a !== '--apply')) throw new Error('Usage: node scripts/import-catalogue.mjs path/to/manifest.json [--apply]');
  const root = await realpath(dirname(resolve(manifestPath)));
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  const evidence = JSON.parse(await readFile(resolve(root, 'evidence.json'), 'utf8'));
  const products = validateManifest(manifest, evidence);
  // Validate every file before making any remote connection or uploading anything.
  const files = new Map();
  for (const product of products) for (const image of product.images) {
    if (files.has(image.file)) continue;
    const path = await realpath(resolve(root, image.file));
    if (!path.startsWith(root + sep)) throw new Error('Photo path escapes the evidence directory.');
    const bytes = await readFile(path);
    if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WEBP') throw new Error('Photo must be WebP and at most 5 MB.');
    files.set(image.file, bytes);
  }
  // Also validate row length/conversion during dry run using category-name placeholders.
  for (const p of products) draftRow(p, CATEGORY_NAMES.map(name => ({ id: name, name })), []);
  if (!apply) {
    console.log(`Validated ${products.length} reviewed products and ${files.size} unique photographs. Offline check only; no writes.`);
  } else {
    const { url, key } = backendConfig();
    const token = process.env.CATALOG_ADMIN_ACCESS_TOKEN;
    if (!token) throw new Error('An approved administrator’s short-lived access token is required in secure environment settings. No service-role keys.');
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { throw new Error('Invalid administrator access token.'); }
    if (claims.role !== 'authenticated') throw new Error('Only an authenticated administrator token may be used.');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error: userError } = await client.auth.getUser(token);
    if (userError || !user) throw new Error('Administrator session could not be verified.');
    const { data: admin, error: adminError } = await client.from('catalog_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (adminError || !admin) throw new Error('Verified catalog_admins membership is required.');
    // Fails before uploads if inspected/approved schema additions are not installed.
    const [{ error: columnError }, { data: ledger, error: ledgerError }, { data: categories, error: categoryError }] = await Promise.all([
      client.from('products').select('id,price_basis').limit(1),
      client.from('catalog_imports').select('source_key,product_id'),
      client.from('categories').select('id,name'),
    ]);
    if (columnError || ledgerError || categoryError) throw new Error('Import schema is not verified/ready. Inspect the existing schema and review the proposal; do not rerun prior migrations.');
    if (categories.length !== 7 || CATEGORY_NAMES.some(name => !categories.some(c => c.name === name))) throw new Error('Database must contain exactly the seven approved categories.');
    let inserted = 0, skipped = 0;
    for (const product of products) {
      const sourceKey = `brutti-catalogue-2025:${product.sourceKey}`;
      if (ledger.some(record => record.source_key === sourceKey)) { skipped++; continue; }
      const id = sourceIdentity(product.sourceKey);
      const images = [];
      for (const [index, image] of product.images.entries()) {
        const bytes = files.get(image.file);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const storagePath = `${user.id}/imports/${id}/${digest}.webp`;
        const bucket = client.storage.from('product-images');
        const { error } = await bucket.upload(storagePath, bytes, { contentType: 'image/webp', upsert: false });
        if (error && String(error.statusCode) !== '409' && String(error.statusCode) !== '400' && error.message !== 'The resource already exists') throw new Error(`Photo upload failed for ${product.sourceKey}; this product was not written. Earlier completed imports remain.`);
        // A 400 is not enough to establish an existing object; download and verify bytes.
        const { data: stored, error: downloadError } = await bucket.download(storagePath);
        if (downloadError || !stored || createHash('sha256').update(Buffer.from(await stored.arrayBuffer())).digest('hex') !== digest) throw new Error('Uploaded/existing image bytes could not be verified.');
        images.push({ id: `${id}-${index}`, storagePath, url: bucket.getPublicUrl(storagePath).data.publicUrl, alt: image.alt });
      }
      const { data, error } = await client.rpc('import_catalogue_draft', { p_source_key: sourceKey, p_document_sha256: manifest.documentSha256,
        p_source_pages: product.pages, p_price_source_text: product.price.sourceText || '', p_product: draftRow(product, categories, images) });
      if (error) throw new Error(`Import refused for ${product.sourceKey}. Check constraints/schema and review existing SKU/identity; existing products were not overwritten.`);
      if (data === 'inserted') inserted++; else if (data === 'skipped') skipped++; else throw new Error('Unexpected import result; stop for inspection.');
    }
    console.log(`Import finished: ${inserted} Draft products inserted; ${skipped} previously imported records skipped. Staff edits and deletions preserved.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
