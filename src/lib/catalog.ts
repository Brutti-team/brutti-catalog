import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CatalogData, Category, Product, ProductImage } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 8;
let client: SupabaseClient | undefined;

function supabase(): SupabaseClient {
  if (!url || !key)
    throw new Error(
      "Brutti Catalog database is not connected. Configure both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY with a dedicated Brutti Supabase project.",
    );
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
  status: Product["status"];
  availability: Product["availability"];
  featured: boolean;
  images: ProductImage[];
  created_at: string;
  updated_at: string;
};

function fromRow(row: ProductRow): Product {
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
    status: row.status,
    availability: row.availability,
    featured: row.featured,
    images: row.images ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(product: Product): ProductRow {
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
    status: product.status,
    availability: product.availability,
    featured: product.featured,
    images: product.images,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  };
}

export async function loadCatalog(): Promise<CatalogData> {
  const db = supabase();
  const [products, categories] = await Promise.all([
    db.from("products").select("*").order("created_at", { ascending: false }),
    db.from("categories").select("*").order("name"),
  ]);
  if (products.error)
    throw backendError(products.error.message, "load products");
  if (categories.error)
    throw backendError(categories.error.message, "load categories");
  return {
    products: (products.data as ProductRow[]).map(fromRow),
    categories: categories.data as Category[],
  };
}

/** Throws a user-facing Error when the supplied product cannot be saved. */
export function validateProduct(product: Product): void {
  if (product.name.trim().length < 2 || product.name.length > 120)
    throw new Error("Product name must contain 2–120 characters.");
  if (!product.sku.trim() || product.sku.length > 64)
    throw new Error("SKU is required and must contain at most 64 characters.");
  if (!product.categoryId.trim())
    throw new Error("Choose a category for this product.");
  if (
    ![product.width, product.depth, product.height].every(
      (value) => Number.isFinite(value) && value > 0 && value < 100000,
    )
  )
    throw new Error(
      "Dimensions must be positive numbers below 100,000 centimetres.",
    );
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

export async function saveProduct(product: Product): Promise<Product> {
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
  const { data, error } = await supabase()
    .from("products")
    .upsert(toRow(saved))
    .select("*")
    .single();
  if (error) throw backendError(error.message, "save this product");
  return fromRow(data as ProductRow);
}

export async function deleteProduct(id: string): Promise<void> {
  await requireAdmin();
  const { error } = await supabase().from("products").delete().eq("id", id);
  if (error) throw backendError(error.message, "delete this product");
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
  return data as Category;
}

export async function deleteCategory(id: string): Promise<void> {
  await requireAdmin();
  const { error } = await supabase().from("categories").delete().eq("id", id);
  if (error)
    throw backendError(
      error.message,
      "delete this category. Move any assigned products first",
    );
}

export async function uploadImage(file: File): Promise<ProductImage> {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Choose a JPEG, PNG or WebP image.");
  if (!file.size || file.size > MAX_IMAGE_SIZE)
    throw new Error("Each image must be between 1 byte and 5 MB.");
  const id = crypto.randomUUID();
  const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  const userId = await requireAdmin();
  const storagePath = `${userId}/${id}.${extension}`;
  const bucket = supabase().storage.from("product-images");
  const { error } = await bucket.upload(storagePath, file, {
    contentType: file.type,
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
