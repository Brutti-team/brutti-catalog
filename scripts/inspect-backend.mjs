import { backendConfig, requestJson } from './backend-config.mjs';

// Public-key-only inspection. No Auth sign-in, SQL execution, or writes.
try {
  const { url, key } = backendConfig();
  const headers = { apikey: key };
  const [schema, categories, products] = await Promise.all([
    requestJson(`${url}/rest/v1/`, { ...headers, Accept: 'application/openapi+json' }),
    requestJson(`${url}/rest/v1/categories?select=id,name&order=name`, headers),
    requestJson(`${url}/rest/v1/products?select=id,status&limit=1000`, headers),
  ]);
  const expected = ['Racks & Shelves', 'Tables & Kitchen Counters', 'Displays & Panels', 'Beds & Bunk Beds', 'Reception Counters', 'Displays & Mementos', 'Rentals'];
  const names = categories.map(c => c.name);
  const missing = expected.filter(name => !names.includes(name));
  const unexpected = names.filter(name => !expected.includes(name));
  const productColumns = Object.keys(schema.definitions?.products?.properties || {});
  const unpublishedVisible = products.some(p => p.status !== 'published');
  console.log(JSON.stringify({ project: url, categories: names, missing, unexpected,
    productColumns, anonymouslyVisibleProductsInFirst1000: products.length,
    unpublishedVisible,
    note: 'Anonymous reads cannot prove total products/admins, bucket policies, or full RLS. Run the owner-only read-only inspection SQL before schema/import changes.' }, null, 2));
  if (missing.length || unexpected.length || unpublishedVisible || !productColumns.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
