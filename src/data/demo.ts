import type { CatalogData, Product } from "../lib/types";

const createdAt = "2026-09-14T08:00:00.000Z";
const ids = {
  seating: "10000000-0000-4000-8000-000000000001",
  tables: "10000000-0000-4000-8000-000000000002",
  storage: "10000000-0000-4000-8000-000000000003",
  workspace: "10000000-0000-4000-8000-000000000004",
};

function product(
  index: number,
  values: Omit<Product, "id" | "createdAt" | "updatedAt">,
): Product {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt,
    updatedAt: createdAt,
    ...values,
  };
}

export const demoCatalog: CatalogData = {
  categories: [
    {
      id: ids.seating,
      name: "Seating",
      description:
        "Thoughtfully shaped chairs, stools and sofas for everyday living.",
    },
    {
      id: ids.tables,
      name: "Tables",
      description:
        "Gathering places, made with honest materials and considered proportions.",
    },
    {
      id: ids.storage,
      name: "Storage",
      description: "Quietly functional pieces that bring order to your space.",
    },
    {
      id: ids.workspace,
      name: "Workspace",
      description: "Comfortable, purposeful furniture for a more focused day.",
    },
  ],
  products: [
    product(1, {
      name: "Senar Lounge Chair",
      sku: "BR-SEA-001",
      categoryId: ids.seating,
      description:
        "A sculptural lounge chair with a gently reclined seat and generous, enveloping proportions. Senar brings a quiet moment of comfort to a reading corner, living room or hospitality space. Its refined silhouette balances warmth with a distinctly contemporary presence.",
      materials:
        "Solid oak frame · woven natural upholstery · high-density foam",
      width: 78,
      depth: 82,
      height: 76,
      price: 1890,
      status: "published",
      availability: "available",
      featured: true,
      images: [
        {
          id: "senar-main",
          url: "/images/lounge-chair.jpg",
          alt: "Senar lounge chair in a thoughtfully styled interior",
        },
      ],
    }),
    product(2, {
      name: "Nala Bar Stool",
      sku: "BR-SEA-002",
      categoryId: ids.seating,
      description:
        "Nala makes everyday gatherings feel effortless. A beautifully simple bar stool with a rounded seat and carefully positioned footrest, suited to kitchen islands, cafés and relaxed dining spaces. Made for conversation that lasts a little longer.",
      materials: "Solid ash · natural oil finish · powder-coated footrest",
      width: 43,
      depth: 43,
      height: 75,
      price: 590,
      status: "published",
      availability: "available",
      featured: false,
      images: [
        {
          id: "nala-main",
          url: "/images/stool.svg",
          alt: "Nala bar stool with a warm timber finish",
        },
      ],
    }),
    product(3, {
      name: "Ruma Modular Sofa",
      sku: "BR-SEA-003",
      categoryId: ids.seating,
      description:
        "A soft landing at the end of the day. Ruma combines deep seats, generous cushions and an understated profile to create an inviting centrepiece. Its modular construction allows the composition to grow and adapt with your home.",
      materials:
        "Textured linen-blend upholstery · kiln-dried hardwood frame · resilient foam",
      width: 240,
      depth: 96,
      height: 78,
      price: 5890,
      status: "published",
      availability: "made-to-order",
      featured: true,
      images: [
        {
          id: "ruma-main",
          url: "/images/sofa.svg",
          alt: "Ruma modular sofa in a calm, neutral living space",
        },
      ],
    }),
    product(4, {
      name: "Garis Dining Table",
      sku: "BR-TAB-001",
      categoryId: ids.tables,
      description:
        "Designed around the simple pleasure of sharing a meal. Garis pairs a broad timber surface with clean, architectural legs. Its softly eased edges and timeless proportions make it equally at home in a family dining room or a collaborative workspace.",
      materials: "Solid European oak · water-based matte finish",
      width: 180,
      depth: 90,
      height: 75,
      price: 3290,
      status: "published",
      availability: "made-to-order",
      featured: true,
      images: [
        {
          id: "garis-main",
          url: "/images/dining-table.svg",
          alt: "Garis dining table with a natural wood surface",
        },
      ],
    }),
    product(5, {
      name: "Bulat Coffee Table",
      sku: "BR-TAB-002",
      categoryId: ids.tables,
      description:
        "Soft curves, strong character. Bulat is a compact coffee table with a rounded form that makes a living space feel more open. Place it beside a lounge chair or at the heart of your seating arrangement for books, objects and daily rituals.",
      materials: "Oak veneer over engineered wood · solid oak base",
      width: 80,
      depth: 80,
      height: 38,
      price: null,
      status: "published",
      availability: "available",
      featured: false,
      images: [
        {
          id: "bulat-main",
          url: "/images/coffee-table.jpg",
          alt: "Bulat coffee table styled with a simple ceramic object",
        },
      ],
    }),
    product(6, {
      name: "Kisi Sideboard",
      sku: "BR-STO-001",
      categoryId: ids.storage,
      description:
        "A considered home for the things you love. Kisi offers generous concealed storage behind beautifully proportioned fronts. Subtle detailing and a low, balanced silhouette bring a sense of ease to dining rooms, hallways and living spaces.",
      materials: "Walnut veneer · solid timber legs · soft-close hinges",
      width: 160,
      depth: 42,
      height: 76,
      price: 2790,
      status: "published",
      availability: "unavailable",
      featured: false,
      images: [
        {
          id: "kisi-main",
          url: "/images/sideboard.jpg",
          alt: "Kisi sideboard with understated timber detailing",
        },
      ],
    }),
    product(7, {
      name: "Temu Writing Desk",
      sku: "BR-WOR-001",
      categoryId: ids.workspace,
      description:
        "A workspace that feels at home. Temu is a compact writing desk with a generous surface and a discreet drawer for the essentials. Clean lines and warm materials create a comfortable place to think, work and make.",
      materials: "Solid oak · oak veneer · concealed soft-close drawer",
      width: 120,
      depth: 60,
      height: 75,
      price: 1490,
      status: "draft",
      availability: "made-to-order",
      featured: false,
      images: [
        {
          id: "temu-main",
          url: "/images/desk.svg",
          alt: "Temu writing desk with a minimal workspace arrangement",
        },
      ],
    }),
    product(8, {
      name: "Langit Open Shelf",
      sku: "BR-STO-002",
      categoryId: ids.storage,
      description:
        "An open framework for your favourite books, plants and collected objects. Langit uses a light, vertical silhouette to create useful storage without overwhelming a room. This archived design remains in the management collection for reference.",
      materials: "Powder-coated steel frame · oak shelves",
      width: 90,
      depth: 35,
      height: 180,
      price: 1190,
      status: "archived",
      availability: "unavailable",
      featured: false,
      images: [
        {
          id: "langit-main",
          url: "/images/shelf.svg",
          alt: "Langit open shelf with books and decorative objects",
        },
      ],
    }),
  ],
};
