import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CatalogCapabilities, CatalogData, Category, Product, ProductImage } from "./types";
import { optimizeImageForUpload } from "./image-optimization";
import { subscribeCatalogRefresh } from "./catalog-refresh";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim() ?? "";

export type PasswordIntent = "invite" | "recovery";
export function readPasswordIntent(location: { hash: string; search: string }): PasswordIntent | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const type = hash.get("type") || new URLSearchParams(location.search).get("auth");
  return type === "invite" || type === "recovery" ? type : null;
}
// Capture before createClient processes and clears Supabase's callback fragment.
export const initialPasswordIntent = typeof window === "undefined" ? null : readPasswordIntent(window.location);

export function readPasswordCallbackToken(location: { hash: string; search: string }): string | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  if (hash.has("error") || hash.has("error_code") || query.has("error") || query.has("error_code")) return null;
  if (!["invite", "recovery"].includes(hash.get("type") || "") || !hash.get("refresh_token")) return null;
  return hash.get("access_token");
}
const initialCallbackToken = typeof window === "undefined" ? null : readPasswordCallbackToken(window.location);

export async function hasPasswordCallbackSession(): Promise<boolean> {
  if (!initialCallbackToken) return false;
  // getSession waits for the SDK's callback processing; compare with the captured
  // token so an unrelated cached session cannot authorize this completion form.
  const { data: { session }, error } = await supabase().auth.getSession();
  return !error && session?.access_token === initialCallbackToken;
}


export function assertBrowserKey(value: string): void {
  if (value.startsWith("sb_secret_")) throw new Error("Use a public Supabase browser key, never a secret or service-role key.");
  const payload = value.split(".")[1];
  if (payload) {
    try {
      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      if (decoded.role && decoded.role !== "anon") throw new Error("privileged");
    } catch {
      throw new Error("Use a valid public Supabase browser key, never a secret or service-role key.");
    }
  }
}
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 8;
let client: SupabaseClient | undefined;

function supabase(): SupabaseClient {
  if (!url || !key)
    throw new Error(
      "Brutti Catalog database is not connected. Configure both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY with a dedicated Brutti Supabase project.",
    );
  assertBrowserKey(key);
  if (!client) client = createClient(url, key);
  return client;
}

function backendError(message: string, operation: string): Error {
  return new Error(`Could not ${operation}. ${message}`);
}

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  category_id: string;
  description: string;
  materials: string;
  width: number;
  depth: number;
  height: number;
  price: number | null;
  price_basis?: Product['priceBasis'];
  display_order?: number;
  status: Product["status"];
  availability: Product["availability"];
  featured: boolean;
  images: ProductImage[];
  created_at: string;
  updated_at: string;
};

let observedPriceBasis = false;
function fromRow(row: ProductRow): Product {
  if (Object.hasOwn(row, 'price_basis')) observedPriceBasis = true;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    categoryId: row.category_id,
    description: row.description,
    materials: row.materials,
    width: Number(row.width),
    depth: Number(row.depth),
    height: Number(row.height),
    price: row.price === null ? null : Number(row.price),
    ...(row.price_basis ? { priceBasis: row.price_basis } : {}),
    ...(row.display_order !== undefined ? { displayOrder: row.display_order } : {}),
    status: row.status,
    availability: row.availability,
    featured: row.featured,
    images: row.images ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(product: Product, capabilities: CatalogCapabilities): ProductRow {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category_id: product.categoryId,
    description: product.description,
    materials: product.materials,
    width: product.width,
    depth: product.depth,
    height: product.height,
    price: product.price,
    ...(capabilities.priceBasis && product.priceBasis ? { price_basis: product.priceBasis } : {}),
    ...(capabilities.ordering ? { display_order: product.displayOrder ?? 0 } : {}),
    status: product.status,
    availability: product.availability,
    featured: product.featured,
    images: product.images,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

async function loadCapabilities(db: SupabaseClient): Promise<CatalogCapabilities> {
  // A reviewed additive proposal enables these features. Legacy projects remain usable.
  try {
    const { data, error } = await db.rpc('catalog_capabilities');
    if (!error && data && typeof data === 'object') return {
      ordering: data.ordering === true,
      imageCleanup: data.imageCleanup === true,
      priceBasis: data.priceBasis === true || observedPriceBasis,
    };
  } catch { /* Missing RPC or unavailable optional capability: fail closed. */ }
  return { ordering: false, imageCleanup: false, priceBasis: observedPriceBasis };
}

export async function loadCatalog(): Promise<CatalogData> {
  const db = supabase();
  const [products, categories, capabilities] = await Promise.all([
    db.from("products").select("*").order("created_at", { ascending: false }),
    db.from("categories").select("*").order("name"),
    loadCapabilities(db),
  ]);
  if (products.error)
    throw backendError(products.error.message, "load products");
  if (categories.error)
    throw backendError(categories.error.message, "load categories");
  const mapped = (products.data as ProductRow[]).map(fromRow);
  return {
    products: mapped,
    categories: categories.data as Category[],
    capabilities: { ...capabilities, priceBasis: capabilities.priceBasis || observedPriceBasis },
  };
}

/** Throws a user-facing Error when the supplied product cannot be saved. */
export function validateProduct(product: Product): void {
  if (product.displayOrder !== undefined &&
    (!Number.isInteger(product.displayOrder) || product.displayOrder < 0 || product.displayOrder > 1000000))
    throw new Error('Display order must be a whole number from 0 to 1,000,000.');
  if (product.priceBasis !== undefined && !['fixed', 'starting-from'].includes(product.priceBasis))
    throw new Error('Choose a valid price basis.');
  if (product.name.trim().length < 2 || product.name.length > 120)
    throw new Error("Product name must contain 2–120 characters.");
  if (!product.sku.trim() || product.sku.length > 64)
    throw new Error("SKU is required and must contain at most 64 characters.");
  if (!product.categoryId.trim())
    throw new Error("Choose a category for this product.");
  if (
    ![product.width, product.depth, product.height].every(
      (value) => Number.isFinite(value) && value >= 0 && value < 100000,
    )
  )
    throw new Error("Dimensions must be valid numbers below 100,000 centimetres.");
  // Incomplete dimensions from the PDF are allowed in Draft, not in live listings.
  if (
    product.status === "published" &&
    [product.width, product.depth, product.height].some((value) => value <= 0)
  )
    throw new Error("Confirm all three product dimensions before publishing.");
  if (
    product.price !== null &&
    (!Number.isFinite(product.price) ||
      product.price < 0 ||
      product.price > 9999999999.99)
  )
    throw new Error(
      "Price must be between RM 0 and RM 9,999,999,999.99, or left empty.",
    );
  if (product.description.length > 10000)
    throw new Error("Description must contain at most 10,000 characters.");
  if (product.materials.length > 2000)
    throw new Error("Materials must contain at most 2,000 characters.");
  if (!["draft", "published", "archived"].includes(product.status))
    throw new Error("Choose a valid product status.");
  if (
    !["available", "made-to-order", "unavailable"].includes(
      product.availability,
    )
  )
    throw new Error("Choose a valid availability status.");
  if (product.images.length > MAX_PRODUCT_IMAGES)
    throw new Error(`A product can have at most ${MAX_PRODUCT_IMAGES} images.`);
  if (
    product.images.some(
      (image) =>
        !image.url ||
        !image.id ||
        !/^(?:https?:\/\/|\/(?!\/)|data:image\/(?:jpeg|png|webp);base64,)/i.test(
          image.url,
        ),
    )
  )
    throw new Error(
      "Each product image needs a valid JPEG, PNG or WebP preview or an HTTP image URL.",
    );
  if (product.status === "published") {
    if (!product.images.length)
      throw new Error("Add at least one image before publishing.");
    if (!product.description.trim())
      throw new Error("Add a description before publishing.");
    if (!product.materials.trim())
      throw new Error("Add materials before publishing.");
  }
}

export interface CatalogMutationOutcome { cleanupWarning?: string }
export type ProductSaveResult = Product & CatalogMutationOutcome;

/** Discarded editor uploads still use the same admin/RLS/reference safeguards. */
export async function cleanupAbandonedImages(images: ProductImage[]): Promise<CatalogMutationOutcome> {
  if (!images.length) return {};
  const warning = { cleanupWarning: 'Some unused images may remain. Ask the workspace owner to review storage.' };
  try {
    await requireAdmin();
    if (!(await loadCapabilities(supabase())).imageCleanup) return warning;
    const result = await cleanupImages(images, 'saved');
    return result.cleanupWarning ? warning : {};
  } catch { return warning; }
}

/** Accept only canonical URLs for this project's bucket and safe, matching object paths. */
function storagePathForImage(image: ProductImage): string | null {
  const prefix = `${new URL(url).origin}/storage/v1/object/public/product-images/`;
  if (!image.url.startsWith(prefix)) return null;
  const path = image.url.slice(prefix.length);
  if (path.length > 1024 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
      path.split('/').some(part => part === '.' || part === '..') ||
      (image.storagePath !== undefined && image.storagePath !== path)) return null;
  return path;
}

async function cleanupImages(images: ProductImage[], operation: 'saved' | 'deleted'): Promise<CatalogMutationOutcome> {
  if (!images.length) return {};
  const paths = new Set<string>();
  let failed = false;
  for (const image of images) {
    const path = storagePathForImage(image);
    if (path) paths.add(path);
    else if (image.storagePath) failed = true;
  }
  try {
    if (paths.size) await requireAdmin();
    for (const path of paths) {
      try {
        // The helper checks every product status, including duplicates and shared photos.
        // A restrictive Storage policy checks again when the API performs the deletion.
        const { data: removable, error: checkError } = await supabase().rpc(
          'can_remove_catalog_image', { p_storage_path: path },
        );
        if (checkError) { failed = true; continue; }
        if (removable !== true) continue;
        const { data: removed, error } = await supabase().storage.from('product-images').remove([path]);
        if (error || !removed?.some(object => object.name === path)) failed = true;
      } catch { failed = true; }
    }
  } catch { failed = true; }
  return failed ? { cleanupWarning: `Product ${operation}; some unused images may remain.` } : {};
}

export async function saveProduct(product: Product): Promise<ProductSaveResult> {
  validateProduct(product);
  const saved = {
    ...product,
    name: product.name.trim(),
    sku: product.sku.trim().toUpperCase(),
    description: product.description.trim(),
    materials: product.materials.trim(),
    updatedAt: new Date().toISOString(),
  };
  await requireAdmin();
  const db = supabase();
  const capabilities = await loadCapabilities(db);
  let previous: ProductRow | null = null;
  if (capabilities.imageCleanup) {
    const { data, error } = await db.from('products').select('*').eq('id', product.id).maybeSingle();
    if (error) throw backendError(error.message, 'check this product before saving');
    previous = data as ProductRow | null;
  }
  const { data, error } = await db
    .from("products")
    .upsert(toRow(saved, capabilities))
    .select("*")
    .single();
  if (error) throw backendError(error.message, "save this product");
  if (!data) throw new Error('This product was not saved. Please sign in again and retry.');
  const result = fromRow(data as ProductRow);
  const retained = new Set(result.images.map(storagePathForImage).filter(Boolean));
  const removed = (previous?.images ?? []).filter(image => {
    const path = storagePathForImage(image);
    return path ? !retained.has(path) : !result.images.some(current => current.url === image.url && current.storagePath === image.storagePath);
  });
  return { ...result, ...(capabilities.imageCleanup ? await cleanupImages(removed, 'saved') : {}) };
}

export async function deleteProduct(id: string): Promise<CatalogMutationOutcome> {
  await requireAdmin();
  const db = supabase();
  const capabilities = await loadCapabilities(db);
  const { data, error } = await db.from("products").delete().eq("id", id).select('id,images').maybeSingle();
  if (error) throw backendError(error.message, "delete this product");
  if (!data) throw new Error('This product was not deleted. It may no longer exist, or your session may have expired. Please refresh and sign in again.');
  return capabilities.imageCleanup ? cleanupImages(data.images ?? [], 'deleted') : {};
}

export async function saveCategory(category: Category): Promise<Category> {
  const saved = {
    ...category,
    name: category.name.trim(),
    description: category.description.trim(),
  };
  if (!saved.name || saved.name.length > 80)
    throw new Error("Category name must contain 1–80 characters.");
  if (saved.description.length > 2000)
    throw new Error(
      "Category description must contain at most 2,000 characters.",
    );
  await requireAdmin();
  const { data, error } = await supabase()
    .from("categories")
    .upsert(saved)
    .select("*")
    .single();
  if (error) throw backendError(error.message, "save this category");
  if (!data) throw new Error('This category was not saved. Please sign in again and retry.');
  return data as Category;
}

export async function deleteCategory(id: string): Promise<void> {
  await requireAdmin();
  const { data, error } = await supabase().from("categories").delete().eq("id", id).select('id').maybeSingle();
  if (error)
    throw backendError(
      error.message,
      "delete this category. Move any assigned products first",
    );
  if (!data) throw new Error('This category was not deleted. Please refresh and sign in again.');
}

export function subscribeCatalog(
  callback: () => Promise<void> | void,
  visibility: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  let active = true;
  let pending = false;
  let queued = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (!active || (visibility && visibility.visibilityState !== 'visible')) return;
    if (pending) { queued = true; return; }
    pending = true;
    try { await callback(); } catch { /* The app reports load errors; keep future refreshes available. */ }
    finally {
      pending = false;
      if (queued && active) { queued = false; void run(); }
    }
  };
  const notify = () => {
    if (!active) return;
    clearTimeout(debounce);
    // Never merge event payloads: every event triggers a fresh RLS-filtered catalog read.
    debounce = setTimeout(() => { debounce = undefined; void run(); }, 150);
  };
  const stopPolling = visibility ? subscribeCatalogRefresh(run, visibility) : () => undefined;
  let channel: ReturnType<SupabaseClient['channel']> | undefined;
  try {
    channel = supabase().channel(`catalog-updates-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, notify)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, notify)
      .subscribe(() => { /* Polling stays available on errors, timeouts and disconnects. */ });
  } catch { /* Legacy or unavailable realtime channels retain the polling fallback. */ }
  return () => {
    active = false; queued = false; clearTimeout(debounce); stopPolling();
    if (channel) {
      try { void supabase().removeChannel(channel).catch(() => undefined); } catch { /* Already disconnected. */ }
    }
  };
}

export async function uploadImage(file: File): Promise<ProductImage> {
  const userId = await requireAdmin();
  const optimized = await optimizeImageForUpload(file);
  const id = crypto.randomUUID();
  const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  const storagePath = `${userId}/${id}.webp`;
  const bucket = supabase().storage.from("product-images");
  const { error } = await bucket.upload(storagePath, optimized, {
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw backendError(error.message, "upload this image");
  return {
    id,
    alt,
    storagePath,
    url: bucket.getPublicUrl(storagePath).data.publicUrl,
  };
}

export async function getAuthState(): Promise<{
  authenticated: boolean;
  isAdmin: boolean;
  email?: string;
}> {
  const {
    data: { user },
    error,
  } = await supabase().auth.getUser();
  if (error) {
    if (error.name === "AuthSessionMissingError")
      return { authenticated: false, isAdmin: false };
    throw backendError(error.message, "verify your session");
  }
  if (!user) return { authenticated: false, isAdmin: false };
  const { data, error: adminError } = await supabase()
    .from("catalog_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminError) throw backendError(adminError.message, "verify admin access");
  return { authenticated: true, isAdmin: Boolean(data), email: user.email };
}

async function requireAdmin(): Promise<string> {
  const state = await getAuthState();
  if (!state.authenticated || !state.isAdmin)
    throw new Error(
      "A signed-in catalog administrator is required for this action.",
    );
  const {
    data: { user },
    error,
  } = await supabase().auth.getUser();
  if (error || !user)
    throw new Error(
      "Your session could not be verified. Please sign in again.",
    );
  return user.id;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw backendError(error.message, "sign in");
}

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut();
  if (error) throw backendError(error.message, "sign out");
}

export function subscribeAuth(callback: () => void): () => void {
  // Session verification in a listener must happen after Supabase releases its auth lock.
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let active = true;
  try {
    const {
      data: { subscription },
    } = supabase().auth.onAuthStateChange(() => {
      if (!active) return;
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (active) callback();
      }, 0);
      pending.add(timer);
    });
    return () => {
      active = false;
      pending.forEach(clearTimeout);
      pending.clear();
      subscription.unsubscribe();
    };
  } catch {
    // loadCatalog/getAuthState report configuration errors through the app's error UI.
    return () => undefined;
  }
}


export async function requestPasswordReset(email: string): Promise<void> {
  const redirect = new URL(window.location.pathname, window.location.origin);
  redirect.searchParams.set("auth", "recovery");
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect.toString() });
  if (error) throw backendError(error.message, "send password reset email");
}

export async function completePassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
  if (!await hasPasswordCallbackSession()) throw new Error("This link is expired or invalid. Request a new link and try again.");
  const db = supabase();
  // getUser verifies with Auth; a fragment or a locally cached session is insufficient.
  const { data: { user }, error: sessionError } = await db.auth.getUser();
  if (sessionError || !user) throw new Error("This link is expired or invalid. Request a new link and try again.");
  const { error } = await db.auth.updateUser({ password });
  if (error) throw backendError(error.message, "set your password");
}
