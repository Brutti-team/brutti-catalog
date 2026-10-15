import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { backendConfig } from './backend-config.mjs';
import { CATEGORY_NAMES } from './import-manifest.mjs';

const TEST_PHOTO = Buffer.from('UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAIAAUAmJQBOgCgAAP73DQEB5w7s87bUAA==', 'base64');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const requireOk = (result, reason) => { if (result.error) throw new Error(reason); return result.data; };

/** Never uses broad deletes or touches identities outside this one verification run. */
export async function cleanupOwnedArtifacts(client, owned) {
  const checks = [], remainingArtifacts = [];
  for (const [table, kind, id, attempted] of [
    ['products', 'product', owned.productId, owned.productAttempted],
    ['categories', 'category', owned.categoryId, owned.categoryAttempted],
  ]) {
    if (!attempted) continue;
    try {
      const result = await client.from(table).delete().eq('id', id).select('id').maybeSingle();
      requireOk(result, 'Cleanup API refused the isolated record.');
      // A zero-row delete may be a policy denial. Confirm absence with the same verified admin.
      if (!result.data) {
        const remaining = await client.from(table).select('id').eq('id', id).maybeSingle();
        if (remaining.error || remaining.data) throw new Error('Cleanup could not establish absence.');
      }
      checks.push({ id: `cleanup-${kind}`, status: 'passed' });
    } catch {
      checks.push({ id: `cleanup-${kind}`, status: 'failed', detail: 'Only this run’s isolated record remains or could not be checked.' });
      remainingArtifacts.push({ kind, id });
    }
  }
  if (owned.storageAttempted) {
    try {
      const bucket = client.storage.from('product-images');
      requireOk(await bucket.remove([owned.storagePath]), 'Storage cleanup refused.');
      const probe = await bucket.download(owned.storagePath);
      if (!probe.error || !['400','404'].includes(String(probe.error.statusCode))) throw new Error('Photo absence could not be verified.');
      // Permission/bucket errors are not proof that the object was removed.
      if (String(probe.error.statusCode) === '400' && !['Object not found','The resource was not found','Not Found'].includes(probe.error.message)) throw new Error('Photo absence could not be verified.');
      checks.push({ id: 'cleanup-photo', status: 'passed' });
    } catch {
      checks.push({ id: 'cleanup-photo', status: 'failed', detail: 'This run’s photo remains or could not be checked.' });
      remainingArtifacts.push({ kind: 'photo', path: owned.storagePath });
    }
  }
  return { checks, remainingArtifacts };
}

/** Called ONLY by verify-live.mjs --write-test; never by app/startup/CI.
 * Creates a temporary category, Draft and distributable 2×2 WebP; briefly
 * publishes the clearly labelled verification product, then removes its own
 * records/photo. An approved real administrator is mandatory before any write.
 */
export async function runWriteVerification({ url, key, token, makeClient = createClient }) {
  const checks = [];
  let client, publicClient, user;
  try {
    backendConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key });
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (claims.role !== 'authenticated') throw new Error('Not a user session.');
    client = makeClient(url, key, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
    publicClient = makeClient(url, key, options);
    const session = await client.auth.getUser(token);
    user = requireOk(session, 'Session not verified.')?.user;
    if (!user) throw new Error('Session not verified.');
    const membership = requireOk(await client.from('catalog_admins').select('user_id').eq('user_id', user.id).maybeSingle(), 'Membership not verified.');
    if (!membership || membership.user_id !== user.id) throw new Error('Administrator required.');
    const categories = requireOk(await client.from('categories').select('id,name'), 'Categories not verified.');
    if (categories.length !== 7 || CATEGORY_NAMES.some(name => !categories.some(category => category.name === name))) throw new Error('Existing categories do not match.');
    checks.push({ id: 'verified-administrator-preflight', status: 'passed' });
  } catch {
    return { status: 'blocked', checks, cleanup: 'not-needed', detail: 'Verified existing-project administrator and seven categories are required; no writes attempted.' };
  }

  const runId = randomUUID();
  const owned = { productId: randomUUID(), categoryId: randomUUID(), storagePath: `${user.id}/verification/${runId}.webp`, productAttempted: false, categoryAttempted: false, storageAttempted: false };
  let step = 'category-create', failed = false;
  const passed = id => { checks.push({ id, status: 'passed' }); };
  const productRead = async (reader, select = 'id,status') => requireOk(await reader.from('products').select(select).eq('id', owned.productId).maybeSingle(), 'Product read failed.');
  try {
    owned.categoryAttempted = true;
    const category = requireOk(await client.from('categories').insert({ id: owned.categoryId, name: `Verification ${runId.slice(0,12)}`, description: 'Temporary integration verification; removed after run.' }).select('id').single(), 'Category insert failed.');
    if (category.id !== owned.categoryId) throw new Error('Category identity mismatch.');
    passed(step);
    step = 'category-edit';
    requireOk(await client.from('categories').update({ description: 'Temporary verification edited.' }).eq('id', owned.categoryId).select('id').single(), 'Category edit failed.');
    passed(step);

    step = 'webp-upload-and-bytes'; owned.storageAttempted = true;
    const bucket = client.storage.from('product-images');
    requireOk(await bucket.upload(owned.storagePath, TEST_PHOTO, { contentType: 'image/webp', upsert: false }), 'Photo upload failed.');
    const downloaded = requireOk(await bucket.download(owned.storagePath), 'Photo download failed.');
    if (!downloaded || !Buffer.from(await downloaded.arrayBuffer()).equals(TEST_PHOTO)) throw new Error('Uploaded bytes mismatch.');
    const imageUrl = bucket.getPublicUrl(owned.storagePath).data.publicUrl;
    passed(step);

    step = 'draft-create-and-admin-persistence'; owned.productAttempted = true;
    const product = { id: owned.productId, name: 'Temporary integration verification — not a Brutti product', sku: `VERIFY-${runId}`, category_id: owned.categoryId,
      description: 'Clearly labelled temporary verification; automatically removed.', materials: 'Verification fixture only.', width: 2, depth: 2, height: 2, price: null,
      status: 'draft', availability: 'unavailable', featured: false,
      images: [{ id: runId, url: imageUrl, alt: 'Temporary 2×2 verification image, not furniture.', storagePath: owned.storagePath }] };
    requireOk(await client.from('products').insert(product).select('id').single(), 'Draft insert failed.');
    const persisted = await productRead(client, 'id,status,name,images');
    if (persisted?.id !== owned.productId || persisted.status !== 'draft' || persisted.name !== product.name) throw new Error('Draft persistence failed.');
    passed(step);
    step = 'draft-public-isolation';
    if (await productRead(publicClient)) throw new Error('Draft leaked to public.');
    passed(step);

    step = 'product-edit-persistence';
    requireOk(await client.from('products').update({ description: 'Temporary verification edit persisted.' }).eq('id', owned.productId).select('id').single(), 'Product edit failed.');
    if ((await productRead(client, 'id,description'))?.description !== 'Temporary verification edit persisted.') throw new Error('Edit not persisted.');
    passed(step);
    step = 'publish-public-visibility';
    requireOk(await client.from('products').update({ status: 'published' }).eq('id', owned.productId).select('id').single(), 'Publish failed.');
    if ((await productRead(publicClient))?.status !== 'published') throw new Error('Published product not visible.');
    passed(step);
    step = 'published-image-display';
    const publicPhoto = requireOk(await publicClient.storage.from('product-images').download(owned.storagePath), 'Public photo denied.');
    if (!publicPhoto || !Buffer.from(await publicPhoto.arrayBuffer()).equals(TEST_PHOTO)) throw new Error('Public photo bytes mismatch.');
    passed(step);
    step = 'unpublish-public-isolation';
    requireOk(await client.from('products').update({ status: 'draft' }).eq('id', owned.productId).select('id').single(), 'Unpublish failed.');
    if (await productRead(publicClient)) throw new Error('Unpublished row leaked.');
    passed(step);
    step = 'archive-public-isolation';
    requireOk(await client.from('products').update({ status: 'archived' }).eq('id', owned.productId).select('id').single(), 'Archive failed.');
    if (await productRead(publicClient)) throw new Error('Archived row leaked.');
    passed(step);
  } catch {
    failed = true;
    checks.push({ id: step, status: 'failed', detail: 'Live API did not confirm this operation. Raw responses and credentials are not logged.' });
  }

  // Recheck authorization before interpreting policy-filtered cleanup responses.
  let stillAdmin = false;
  try {
    const verified = await client.auth.getUser(token);
    const membership = await client.from('catalog_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    stillAdmin = !verified.error && verified.data?.user?.id === user.id && !membership.error && membership.data?.user_id === user.id;
  } catch { /* Cleanup is blocked, never silently claimed. */ }
  if (!stillAdmin) return { status: 'failed', checks, cleanup: 'blocked', runId,
    remainingArtifacts: [owned.productAttempted && { kind: 'product', id: owned.productId }, owned.categoryAttempted && { kind: 'category', id: owned.categoryId }, owned.storageAttempted && { kind: 'photo', path: owned.storagePath }].filter(Boolean),
    detail: 'Administrator access was lost. A trusted owner must inspect and clean only these verification identities.' };
  const cleanup = await cleanupOwnedArtifacts(client, owned);
  return { status: failed || cleanup.remainingArtifacts.length ? 'failed' : 'passed', checks: [...checks, ...cleanup.checks], cleanup: cleanup.remainingArtifacts.length ? 'failed' : 'passed', runId, remainingArtifacts: cleanup.remainingArtifacts };
}
