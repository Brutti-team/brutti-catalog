import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../src/lib/types";
import {
  deleteCategory,
  deleteProduct,
  getAuthState,
  isDemoMode,
  loadCatalog,
  resetDemo,
  saveCategory,
  saveProduct,
  signIn,
  signOut,
  subscribeAuth,
  uploadImage,
  validateProduct,
} from "../src/lib/catalog";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo catalog", () => {
  it("seeds eight products including six published products and four categories", async () => {
    const data = await loadCatalog();
    expect(isDemoMode).toBe(true);
    expect(data.products).toHaveLength(8);
    expect(
      data.products.filter((product) => product.status === "published"),
    ).toHaveLength(6);
    expect(data.categories.map((category) => category.name)).toEqual([
      "Seating",
      "Tables",
      "Storage",
      "Workspace",
    ]);
    expect(
      data.products.every((product) =>
        product.images[0]?.url.startsWith("/images/"),
      ),
    ).toBe(true);
  });

  it("persists edits across reads without mutating the seed data", async () => {
    const original = (await loadCatalog()).products[0];
    await saveProduct({ ...original, name: "Edited chair", price: null });
    expect((await loadCatalog()).products[0].name).toBe("Edited chair");
    await resetDemo();
    expect((await loadCatalog()).products[0].name).toBe(original.name);
  });

  it("rejects duplicate SKUs ignoring case and whitespace", async () => {
    const original = (await loadCatalog()).products[0];
    await expect(
      saveProduct({
        ...original,
        id: crypto.randomUUID(),
        sku: ` ${original.sku.toLowerCase()} `,
      }),
    ).rejects.toThrow(/SKU.*already/i);
  });

  it("deletes a product without affecting other products", async () => {
    const product = (await loadCatalog()).products[0];
    await deleteProduct(product.id);
    const data = await loadCatalog();
    expect(data.products).toHaveLength(7);
    expect(data.products.some((item) => item.id === product.id)).toBe(false);
  });

  it("refuses category deletion when products still use it", async () => {
    const data = await loadCatalog();
    await expect(deleteCategory(data.categories[0].id)).rejects.toThrow(
      /products/i,
    );
    expect((await loadCatalog()).categories).toHaveLength(4);
  });

  it("creates and deletes an unused category while rejecting duplicate names", async () => {
    const category = {
      id: crypto.randomUUID(),
      name: "Lighting",
      description: "Soft lighting",
    };
    await saveCategory(category);
    expect((await loadCatalog()).categories).toContainEqual(category);
    await expect(
      saveCategory({
        ...category,
        id: crypto.randomUUID(),
        name: " lighting ",
      }),
    ).rejects.toThrow(/already/i);
    await deleteCategory(category.id);
    expect((await loadCatalog()).categories).toHaveLength(4);
  });

  it("preserves malformed saved data and gives an actionable error", async () => {
    await loadCatalog();
    const key = localStorage.key(0)!;
    localStorage.setItem(key, "{broken");
    await expect(loadCatalog()).rejects.toThrow(/reset.*demo/i);
    expect(localStorage.getItem(key)).toBe("{broken");
  });

  it("rejects saved records with missing fields before rendering them", async () => {
    await loadCatalog();
    const key = localStorage.key(0)!;
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        data: { products: [{ id: "invalid", images: [] }], categories: [] },
      }),
    );
    await expect(loadCatalog()).rejects.toThrow(/reset.*demo/i);
  });

  it("reports storage quota failures instead of claiming the edit saved", async () => {
    const product = (await loadCatalog()).products[0];
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await expect(saveProduct({ ...product, name: "Unsaved" })).rejects.toThrow(
      /storage.*full|quota/i,
    );
    expect((await loadCatalog()).products[0].name).toBe(product.name);
  });

  it("exposes demo access without pretending to check passwords", async () => {
    expect(await getAuthState()).toMatchObject({
      authenticated: true,
      isAdmin: true,
    });
    const listener = vi.fn();
    const unsubscribe = subscribeAuth(listener);
    await signIn("", "");
    await signOut();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("product and upload validation", () => {
  let product: Product;
  beforeEach(async () => {
    product = (await loadCatalog()).products[0];
  });

  it("accepts optional pricing and valid positive dimensions", () => {
    expect(() => validateProduct({ ...product, price: null })).not.toThrow();
  });

  it.each(["name", "sku", "categoryId"] as const)(
    "rejects missing %s",
    (field) => {
      expect(() => validateProduct({ ...product, [field]: " " })).toThrow();
    },
  );

  it.each([0, -1, NaN, Infinity])("rejects invalid dimensions %s", (width) => {
    expect(() => validateProduct({ ...product, width })).toThrow(/dimensions/i);
  });

  it("rejects dimensions outside the database limit", () => {
    expect(() => validateProduct({ ...product, height: 100000 })).toThrow(
      /dimensions/i,
    );
  });

  it.each([-1, NaN, Infinity])("rejects invalid price %s", (price) => {
    expect(() => validateProduct({ ...product, price })).toThrow(/price/i);
  });

  it("requires an image and description before publication", () => {
    expect(() =>
      validateProduct({ ...product, status: "published", images: [] }),
    ).toThrow(/image/i);
    expect(() =>
      validateProduct({ ...product, status: "published", description: "" }),
    ).toThrow(/description/i);
    expect(() =>
      validateProduct({
        ...product,
        status: "draft",
        images: [],
        description: "",
      }),
    ).not.toThrow();
  });

  it("rejects descriptions and materials longer than the database limits", () => {
    expect(() =>
      validateProduct({ ...product, description: "a".repeat(10001) }),
    ).toThrow(/description/i);
    expect(() =>
      validateProduct({ ...product, materials: "a".repeat(2001) }),
    ).toThrow(/materials/i);
  });

  it("rejects image URLs that cannot be used safely as image sources", () => {
    expect(() =>
      validateProduct({
        ...product,
        images: [{ id: "bad", alt: "", url: "javascript:alert(1)" }],
      }),
    ).toThrow(/image/i);
  });

  it("rejects unsupported image types before reading file contents", async () => {
    await expect(
      uploadImage(new File(["svg"], "image.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow(/JPEG.*PNG.*WebP/i);
  });

  it("rejects images larger than 5MB", async () => {
    await expect(
      uploadImage(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).rejects.toThrow(/5 MB/i);
  });

  it("returns a preview data URL for a valid demo image", async () => {
    const image = await uploadImage(
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        "chair.png",
        { type: "image/png" },
      ),
    );
    expect(image.url).toMatch(/^data:image\/png;base64,/);
    expect(image.alt).toBe("chair");
    expect(image.storagePath).toBeUndefined();
  });
});
