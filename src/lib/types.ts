export type ProductStatus = "draft" | "published" | "archived";
export type Availability = "available" | "made-to-order" | "unavailable";
export interface ProductImage {
  id: string;
  url: string;
  alt: string;
  storagePath?: string;
}
export interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  description: string;
  materials: string;
  width: number;
  depth: number;
  height: number;
  price: number | null;
  /** Optional until inspected/approved price_basis schema addition is installed. */
  priceBasis?: 'fixed' | 'starting-from';
  status: ProductStatus;
  availability: Availability;
  featured: boolean;
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
}
export interface Category {
  id: string;
  name: string;
  description: string;
}
export interface CatalogData {
  products: Product[];
  categories: Category[];
}
