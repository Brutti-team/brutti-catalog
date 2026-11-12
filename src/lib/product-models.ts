import type { Product } from "./types";

/**
 * Approved product-specific 3D models. Only add a SKU after its geometry,
 * textures, and visible details have been checked against real product photos.
 *
 * Put GLB files under public/models/, then register them here. Do not use a
 * generic kiosk or furniture mesh for unrelated products.
 *
 * Example (replace with a REAL approved product and file):
 * "REAL-SKU": { src: "models/real-product.glb", hotspots: [
 *   { label: "Stone countertop", position: "0m 1m 0m", normal: "0m 1m 0m" }
 * ] },
 */
export interface ProductModelHotspot {
  label: string;
  position: string;
  normal: string;
}

export interface ProductModelAsset {
  src: string;
  hotspots?: ProductModelHotspot[];
}

const approvedModels: Record<string, ProductModelAsset> = {};

export function modelForProduct(product: Pick<Product, "sku">): ProductModelAsset | null {
  return approvedModels[product.sku.trim().toUpperCase()] ?? null;
}

export function catalogModelUrl(path: string): string {
  // Only publish approved assets bundled with this catalog.
  if (!/^models\/[a-zA-Z0-9/_-]+\.glb$/.test(path) || path.includes("..")) {
    throw new Error("Invalid catalog 3D model asset path");
  }
  return `${import.meta.env.BASE_URL}${path}`;
}
