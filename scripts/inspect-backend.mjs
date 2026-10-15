import { pathToFileURL } from 'node:url';
import { backendConfig, readOnlyJson, requestEvidence } from './backend-config.mjs';
import { CATEGORY_NAMES } from './import-manifest.mjs';

export const PRODUCT_COLUMNS = [
  'id', 'name', 'sku', 'category_id', 'description', 'materials', 'width',
  'depth', 'height', 'price', 'status', 'availability', 'featured', 'images',
  'created_at', 'updated_at',
];
const OPTIONAL_COLUMNS = ['price_basis', 'display_order'];

function columnAvailability(result) {
  if (result.ok) return 'available';
  if (result.errorCode === '42703') return 'missing-in-api-schema';
  return 'unverified';
}

// Public-key-only inspection. No Auth sign-in, SQL execution, or writes.
// OpenAPI can be restricted while individual public table reads remain usable.
export async function inspectBackend(config = backendConfig(), options = {}) {
  const { url, key } = config;
  const headers = { apikey: key };
  const read = (path, extraHeaders = {}) => readOnlyJson(`${url}${path}`, { ...headers, ...extraHeaders }, options);
  const [schemaRead, categoryRead, productRead, columnsRead, ...optionalReads] = await Promise.all([
    read('/rest/v1/', { Accept: 'application/openapi+json' }),
    read('/rest/v1/categories?select=id,name&order=name'),
    read('/rest/v1/products?select=id,status&limit=1000'),
    read(`/rest/v1/products?select=${PRODUCT_COLUMNS.join(',')}&limit=0`),
    ...OPTIONAL_COLUMNS.map(column => read(`/rest/v1/products?select=${column}&limit=0`)),
  ]);
  const categoryRows = categoryRead.ok && Array.isArray(categoryRead.data) ? categoryRead.data : null;
  const productRows = productRead.ok && Array.isArray(productRead.data) ? productRead.data : null;
  const categories = categoryRows?.map(category => category.name) ?? [];
  // Categories are editable through the live admin. The original PDF manifest
  // is an import-time snapshot, NOT a permanent constraint on staff categories.
  // Still require real, well-formed, unique public category rows.
  const validCategoryRows = Boolean(categoryRows?.length &&
    categoryRows.every(category =>
      typeof category?.id === 'string' && category.id.trim() &&
      typeof category?.name === 'string' && category.name.trim()) &&
    new Set(categoryRows.map(category => category.id)).size === categoryRows.length &&
    new Set(categories).size === categoryRows.length);
  const missing = CATEGORY_NAMES.filter(name => !categories.includes(name));
  const unexpected = categories.filter(name => !CATEGORY_NAMES.includes(name));
  const openapiColumns = Object.keys(schemaRead.data?.definitions?.products?.properties || {});
  let productColumns = openapiColumns;
  let individualColumnProbes;
  if (!openapiColumns.length) {
    if (columnsRead.ok) productColumns = [...PRODUCT_COLUMNS];
    else {
      // A failed multi-column selection cannot identify which columns exist.
      const results = await Promise.all(PRODUCT_COLUMNS.map(column => read(`/rest/v1/products?select=${column}&limit=0`)));
      productColumns = PRODUCT_COLUMNS.filter((_, index) => results[index].ok);
      individualColumnProbes = Object.fromEntries(PRODUCT_COLUMNS.map((column, index) => [column, {
        ...requestEvidence(results[index]), availability: columnAvailability(results[index]),
      }]));
    }
  }
  const unpublishedVisible = productRows === null ? null : productRows.some(product => product.status !== 'published');
  return {
    inspectedAt: new Date().toISOString(), project: url, readOnly: true,
    requiredReadsPassed: Boolean(validCategoryRows && productRows && columnsRead.ok && !unpublishedVisible),
    categories, missing, unexpected,
    categoryReads: requestEvidence(categoryRead), productReads: requestEvidence(productRead),
    productColumns,
    schema: {
      complete: Boolean(openapiColumns.length), source: openapiColumns.length ? 'openapi' : 'column-probes',
      openapi: requestEvidence(schemaRead), requiredColumns: requestEvidence(columnsRead),
      ...(individualColumnProbes ? { individualColumnProbes } : {}),
      note: openapiColumns.length
        ? 'OpenAPI describes exposed API fields; owner inspection is still needed for constraints, grants and policies.'
        : 'Full schema is unavailable. Successful column probes confirm only the listed selectable API fields; they do not inspect types, constraints, grants or policies.',
    },
    optionalProductColumns: Object.fromEntries(OPTIONAL_COLUMNS.map((column, index) => [column, {
      ...requestEvidence(optionalReads[index]), availability: columnAvailability(optionalReads[index]),
    }])),
    anonymouslyVisibleProductsInFirst1000: productRows?.length ?? null,
    unpublishedVisible,
    note: 'Category additions/renames made in Admin are permitted. Missing/unexpected compare to the original PDF import only. Anonymous reads cannot prove total products/admins, bucket policies, or full RLS. An empty public response does not prove Draft/Archived isolation. Run the owner-only read-only inspection SQL before schema/import changes.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await inspectBackend();
    console.log(JSON.stringify(report, null, 2));
    if (!report.requiredReadsPassed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
