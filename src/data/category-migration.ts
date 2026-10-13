import type { CatalogData } from "../lib/types";
import { bruttiCategories } from "./categories";

/**
 * Upgrade data saved by the original four-category demo.
 * Preserve user-added products, categories and field edits. The original
 * sample-only Seating grouping maps to Rentals for demonstration purposes;
 * sample products are never actual rental availability claims.
 */
const legacyCategories = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Seating",
    destination: "Rentals",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Tables",
    destination: "Tables & Kitchen Counters",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Storage",
    destination: "Racks & Shelves",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Workspace",
    destination: "Tables & Kitchen Counters",
  },
] as const;

const byName = (name: string) => name.trim().toLocaleLowerCase("en");

export function upgradeDemoCategories(data: CatalogData): CatalogData {
  const originals = new Map<string, (typeof legacyCategories)[number]>(
    legacyCategories.map((category) => [category.id, category]),
  );
  // Do not rename a category if the user edited its name in the old demo.
  const replaced = new Map<string, string>();
  for (const category of data.categories) {
    const legacy = originals.get(category.id);
    if (legacy && byName(category.name) === byName(legacy.name))
      replaced.set(category.id, legacy.destination);
  }

  const retained = data.categories.filter((category) => !replaced.has(category.id));

  // Reuse any category users already made with the approved name, so they do
  // not lose products linked to that category.
  const approved = bruttiCategories.map(
    (category) =>
      retained.find((existing) => byName(existing.name) === byName(category.name)) ??
      { ...category },
  );
  const categoryIds = new Map(approved.map((category) => [category.name, category.id]));

  const extra = retained.filter(
    (category) => !approved.some((item) => item.id === category.id),
  );
  return {
    categories: [...approved, ...extra],
    products: data.products.map((product) => {
      const targetName = replaced.get(product.categoryId);
      return targetName
        ? { ...product, categoryId: categoryIds.get(targetName)! }
        : product;
    }),
  };
}
