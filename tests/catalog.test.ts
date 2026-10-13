import { describe, expect, it } from "vitest";
import type { Product } from "../src/lib/types";
import { bruttiCategories } from "../src/data/categories";
import { MAX_IMAGE_SIZE, validateProduct } from "../src/lib/catalog";

const sourceDraft: Product = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "Kaanagan Open Concept Wardrobe",
  sku: "BR-2025-002",
  categoryId: bruttiCategories[0].id,
  description: "",
  materials: "",
  width: 0,
  depth: 0,
  height: 0,
  price: null,
  status: "draft",
  availability: "made-to-order",
  featured: false,
  images: [],
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
};

const verifiedProduct: Product = {
  ...sourceDraft,
  description: "Custom-built open concept wardrobe.",
  materials: "Pine wood and steel.",
  width: 140,
  depth: 60,
  height: 180,
  images: [{
    id: "image-1",
    url: "https://example.com/approved-brutti-photo.webp",
    alt: "Kaanagan wardrobe",
  }],
};

describe("official Brutti categories", () => {
  it("has exactly seven unique categories", () => {
    expect(bruttiCategories.map((category) => category.name)).toEqual([
      "Racks & Shelves",
      "Tables & Kitchen Counters",
      "Displays & Panels",
      "Beds & Bunk Beds",
      "Reception Counters",
      "Displays & Mementos",
      "Rentals",
    ]);
    expect(new Set(bruttiCategories.map((category) => category.id)).size).toBe(7);
  });
});

describe("real catalog product validation", () => {
  it("allows incomplete real PDF data as a draft, without inventing dimensions or prices", () => {
    expect(() => validateProduct(sourceDraft)).not.toThrow();
    expect(() => validateProduct({ ...sourceDraft, price: null })).not.toThrow();
  });

  it("prevents publishing a product with unverified dimensions", () => {
    expect(() => validateProduct({
      ...sourceDraft, ...verifiedProduct, width: 0, status: "published"
    })).toThrow(/dimensions/i);
  });

  it("prevents publishing a product without verified description, materials or image", () => {
    expect(() => validateProduct({
      ...verifiedProduct, description: "", status: "published"
    })).toThrow(/description/i);
    expect(() => validateProduct({
      ...verifiedProduct, materials: "", status: "published"
    })).toThrow(/materials/i);
    expect(() => validateProduct({
      ...verifiedProduct, images: [], status: "published"
    })).toThrow(/image/i);
  });

  it("allows a complete real product to publish", () => {
    expect(() => validateProduct({ ...verifiedProduct, status: "published" })).not.toThrow();
  });

  it.each(["name", "sku", "categoryId"] as const)("rejects missing %s", (field) => {
    expect(() => validateProduct({ ...sourceDraft, [field]: " " })).toThrow();
  });

  it.each([-1, NaN, Infinity, 100000])("rejects invalid dimensions %s", (width) => {
    expect(() => validateProduct({ ...sourceDraft, width })).toThrow(/dimensions/i);
  });

  it.each([-1, NaN, Infinity])("rejects invalid price %s", (price) => {
    expect(() => validateProduct({ ...sourceDraft, price })).toThrow(/price/i);
  });

  it("rejects oversized descriptions and materials", () => {
    expect(() => validateProduct({
      ...sourceDraft, description: "a".repeat(10001)
    })).toThrow(/description/i);
    expect(() => validateProduct({
      ...sourceDraft, materials: "a".repeat(2001)
    })).toThrow(/materials/i);
  });

  it("rejects unsafe uploaded image URLs", () => {
    expect(() => validateProduct({
      ...sourceDraft,
      images: [{ id: "bad", alt: "", url: "javascript:alert(1)" }],
    })).toThrow(/image/i);
  });

  it("enforces the approved 5 MB image limit", () => {
    expect(MAX_IMAGE_SIZE).toBe(5 * 1024 * 1024);
  });
});
