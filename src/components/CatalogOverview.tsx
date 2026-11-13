import { ArrowRight, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import type { CatalogData, Product } from "../lib/types";
import LastChange from "./LastChange";
import SafeImage from "./SafeImage";

type ProductFilter = {
  status?: Product["status"];
  categoryId?: string;
  view?: "gallery";
};

type Props = {
  data: CatalogData;
  counts: Record<Product["status"] | "withPhotos", number>;
  loading: boolean;
  busy: boolean;
  sync: { checking: boolean; failed: boolean; updatedAt: number | null };
  onRefresh: () => void;
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
  onProducts: (filter?: ProductFilter) => void;
  onCategories?: () => void;
  onHistory: () => void;
};

// Pandan is the studio's default catalog photograph until staff feature or publish a piece.
const studioPhotoSku = "BRT25-P024";
const syncTime = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "numeric",
  minute: "2-digit",
});

export default function CatalogOverview({
  data, counts, loading, busy, sync, onRefresh, onAddProduct, onEditProduct, onProducts, onCategories, onHistory,
}: Props) {
  const { products, categories } = data;
  const total = products.length;
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  const productsByCategory = new Map<string, number>();
  for (const product of products) {
    productsByCategory.set(product.categoryId, (productsByCategory.get(product.categoryId) ?? 0) + 1);
  }
  const directory = categories.map(category => ({
    ...category,
    count: productsByCategory.get(category.id) ?? 0,
  })).sort((a, b) => b.count - a.count).slice(0, 7);

  const photographed = products.filter(product => product.images[0]?.url);
  const byRecent = [...products].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const photo = photographed.find(product => product.featured && product.status !== "archived")
    ?? photographed.find(product => product.status === "published")
    ?? photographed.find(product => product.sku === studioPhotoSku && product.status === "draft")
    ?? byRecent.find(product => product.status !== "archived" && product.images[0]?.url)
    ?? photographed[0];
  const recent = byRecent.slice(0, 4);
  const drafts = products.filter(product => product.status === "draft");
  const checks = [
    { label: "Dimensions not confirmed", count: drafts.filter(product => ![product.width, product.depth, product.height].every(value => Number.isFinite(value) && value > 0)).length },
    { label: "Material details missing", count: drafts.filter(product => !product.materials.trim()).length },
    { label: "Descriptions incomplete", count: drafts.filter(product => !product.description.trim()).length },
  ];
  const draftFilter = () => onProducts({ status: "draft" });
  const formatCount = (count: number) => loading ? "—" : count.toLocaleString("en-MY");

  return (
    <div className="catalog-overview">
      <div className={photo ? "overview-lead" : "overview-lead overview-lead-no-photo"}>
        <div className="overview-lead-copy">
          <header className="overview-intro">
            <h1>Catalog overview</h1>
          </header>
          <section className="overview-metrics" aria-label="Collection snapshot">
            <div className="overview-total">
              <button type="button" className="overview-metric overview-metric-total" aria-label="Total products, view all products"
                aria-describedby="overview-total-count" disabled={loading} onClick={() => onProducts()}>
                <strong className="overview-metric-value" id="overview-total-count">{formatCount(total)}</strong>
                <span>Total products</span>
              </button>
              <span className="overview-photo-count">{formatCount(counts.withPhotos)} with photos</span>
            </div>
            <div className="overview-status-metrics" role="group" aria-label="Publishing status">
              {([
                { label: "Drafts", status: "draft" },
                { label: "Published", status: "published" },
                { label: "Archived", status: "archived" },
              ] as const).map(({ label, status }) => (
                <button type="button" className="overview-metric" key={status} aria-label={`${label}, view ${label.toLowerCase()}`}
                  aria-describedby={`overview-count-${status}`} disabled={loading} onClick={() => onProducts({ status })}>
                  <strong className="overview-metric-value" id={`overview-count-${status}`}>{formatCount(counts[status])}</strong>
                  <span>{label}</span>
                </button>
              ))}
              {onCategories ? (
                <button type="button" className="overview-metric" aria-label="Categories, view categories"
                  aria-describedby="overview-category-count" disabled={loading} onClick={onCategories}>
                  <strong className="overview-metric-value" id="overview-category-count">{formatCount(categories.length)}</strong>
                  <span>Categories</span>
                </button>
              ) : (
                <div className="overview-metric">
                  <strong className="overview-metric-value">{formatCount(categories.length)}</strong>
                  <span>Categories</span>
                </div>
              )}
            </div>
          </section>
          <div className="overview-lead-actions">
            <button type="button" className="overview-add" disabled={loading || busy} onClick={onAddProduct}>
              <Plus size={17} strokeWidth={1.6} aria-hidden="true" />
              Add product
            </button>
            <button type="button" className="overview-text-action" disabled={loading} onClick={draftFilter}>
              Review drafts <ArrowRight size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
        </div>
        {photo && (
          <figure className="overview-photo">
            <button type="button" aria-label={`Edit ${photo.name}`} onClick={() => onEditProduct(photo)}>
              <SafeImage src={photo.images[0].url} alt="" />
              <span className="overview-photo-caption">
                <span>
                  <strong>{photo.name}</strong>
                  <small>{[photo.sku, categoryNames.get(photo.categoryId)].filter(Boolean).join(" · ")}</small>
                </span>
                <ArrowUpRight size={17} strokeWidth={1.6} aria-hidden="true" />
              </span>
            </button>
          </figure>
        )}
      </div>

      <div className="overview-workspace">
        <section className="overview-recent" aria-labelledby="overview-recent-title">
          <header className="overview-section-heading">
            <h2 id="overview-recent-title">Recent products</h2>
            <button type="button" className="overview-text-action" onClick={() => onProducts({ view: "gallery" })}>
              Open gallery <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </header>
          <ul className="overview-rows">
            {recent.map(product => (
              <li key={product.id}>
                <button type="button" className="overview-product-row" aria-label={`Open ${product.name || "Untitled product"}`}
                  onClick={() => onEditProduct(product)}>
                  <SafeImage src={product.images[0]?.url} alt="" loading="lazy" />
                  <span className="catalog-recent-title">
                    <strong>{product.name || "Untitled product"}</strong>
                    <small>{[product.sku, categoryNames.get(product.categoryId) || "Uncategorised"].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={`overview-product-status is-${product.status}`}>{product.status}</span>
                  <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {!recent.length && <p className="overview-empty">{loading ? "Loading products…" : "No products added yet"}</p>}
        </section>

        <div className="overview-index">
          <section className="overview-workflow" aria-labelledby="overview-workflow-title">
            <header className="overview-section-heading">
              <h2 id="overview-workflow-title">Publishing workflow</h2>
              <span className="overview-section-note">Draft checks</span>
            </header>
            <ul className="overview-checks" aria-label="Details to verify">
              {checks.map(check => (
                <li className="overview-row" key={check.label}>
                  <span>{check.label}</span>
                  <strong>{formatCount(check.count)}</strong>
                </li>
              ))}
            </ul>
          </section>
          <section className="overview-categories" aria-labelledby="overview-categories-title">
            <header className="overview-section-heading">
              <h2 id="overview-categories-title">By category</h2>
              {onCategories && (
                <button type="button" className="overview-text-action" aria-label="Manage categories" onClick={onCategories}>
                  Manage <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />
                </button>
              )}
            </header>
            <ul className="overview-rows">
              {directory.map(category => (
                <li key={category.id}>
                  <button type="button" className="overview-row" onClick={() => onProducts({ categoryId: category.id })}
                    aria-label={`View ${category.name}, ${category.count} products`}>
                    <span className="overview-category-name">{category.name}</span>
                    <strong>{formatCount(category.count)}</strong>
                  </button>
                </li>
              ))}
            </ul>
            {!directory.length && <p className="overview-empty">{loading ? "Loading categories…" : "No categories yet"}</p>}
          </section>
        </div>
      </div>

      <LastChange authenticated refreshKey={data} onHistory={onHistory} />

      <div className="overview-sync" aria-label="Automatic catalog updates" data-error={sync.failed}>
        <div className="overview-sync-status">
          <strong>{sync.failed ? "Sync needs attention" : sync.checking ? "Checking for updates…" : "Auto-sync enabled"}</strong>
          <span>Checks every 30 seconds while this tab is visible</span>
        </div>
        <div className="overview-sync-tools">
          {sync.updatedAt ? (
            <time dateTime={new Date(sync.updatedAt).toISOString()}>Updated {syncTime.format(sync.updatedAt)} MYT</time>
          ) : <span>Waiting for first sync</span>}
          <button type="button" className="overview-text-action" aria-label="Refresh catalog now"
            disabled={loading || sync.checking} onClick={onRefresh}>
            <RefreshCw size={15} strokeWidth={1.6} aria-hidden="true" /> Refresh now
          </button>
        </div>
      </div>
    </div>
  );
}
