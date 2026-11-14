import { useId, useMemo, useState } from "react";
import {
  Archive, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight,
  ChartNoAxesCombined, Images, Layers3, Package, Pencil, ShieldCheck
} from "lucide-react";
import SafeImage from "./SafeImage";
import type { Product, Category } from "../lib/types";

type StatusFilter = "all" | "draft" | "published" | "archived";
type Days = 7 | 30 | 90;

interface Props {
  products: Product[];
  categories: Category[];
  loading: boolean;
  asOfMs: number;
  canManageCategories: boolean;
  onOpenProducts: (status: StatusFilter) => void;
  onOpenCategory: (categoryId: string) => void;
  onManageCategories: () => void;
}

/** Date-bucket the current products' most recent update in Malaysian local time.
 * This is NOT an audit log and intentionally never invents events or growth. */
function mytDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (part: string) => parts.find(item => item.type === part)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

export function getUpdateActivity(
  products: readonly Pick<Product, "updatedAt">[], days: number, asOfMs: number
): { keys: string[]; cumulative: number[]; total: number } {
  const period = Math.max(1, Math.min(90, Math.trunc(days)));
  const today = mytDateKey(new Date(asOfMs));
  const todayUtc = Date.parse(today + "T00:00:00Z");
  const keys = Array.from({ length: period }, (_, index) =>
    new Date(todayUtc - (period - 1 - index) * 86_400_000).toISOString().slice(0, 10));
  const counts = new Map(keys.map(key => [key, 0]));
  for (const product of products) {
    const timestamp = Date.parse(product.updatedAt);
    if (!Number.isFinite(timestamp) || timestamp > asOfMs) continue;
    const key = mytDateKey(new Date(timestamp));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let running = 0;
  const cumulative = keys.map(key => (running += counts.get(key) ?? 0));
  return { keys, cumulative, total: running };
}

const shortDate = (dateKey: string): string =>
  new Intl.DateTimeFormat("en-MY", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(dateKey + "T12:00:00Z"));

function ActivityChart({ products, days, asOfMs }: {
  products: Product[]; days: Days; asOfMs: number
}) {
  const gradientId = useId().replace(/:/g, "");
  const activity = useMemo(() => getUpdateActivity(products, days, asOfMs), [products, days, asOfMs]);
  const yBase = 167, yTop = 28, xStart = 16, xEnd = 618;
  const max = Math.max(1, activity.total);
  const coordinates = activity.cumulative.map((value, index) => ({
    x: xStart + index / Math.max(1, activity.cumulative.length - 1) * (xEnd - xStart),
    y: yBase - value / max * (yBase - yTop),
  }));
  const line = coordinates.map((point, index) =>
    (index === 0 ? "M " : " L ") + point.x.toFixed(2) + " " + point.y.toFixed(2)).join("");
  const last = coordinates[coordinates.length - 1] ?? { x: xEnd, y: yBase };
  const first = coordinates[0] ?? { x: xStart, y: yBase };
  const fill = line + " L " + last.x + " " + yBase + " L " + first.x + " " + yBase + " Z";
  const ticks = [...new Set([0, .25, .5, .75, 1].map(f =>
    Math.round(f * (activity.keys.length - 1))))];

  return (
    <div className="brutti-activity-chart">
      <svg viewBox="0 0 640 195" role="img"
        aria-label={"Cumulative number of catalog products whose latest update was in the past " + days + " days: " + activity.total}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#39835C" stopOpacity=".31" />
            <stop offset="100%" stopColor="#39835C" stopOpacity=".012" />
          </linearGradient>
        </defs>
        <path d={"M " + xStart + " " + yBase + " H " + xEnd} stroke="currentColor" strokeOpacity=".11" strokeWidth="1" />
        <path d={fill} fill={"url(#" + gradientId + ")"} />
        <path d={line} fill="none" stroke="#28533F" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        {activity.total > 0 && (
          <>
            <circle cx={last.x} cy={last.y} r="9" fill="#28533F" fillOpacity=".12" />
            <circle cx={last.x} cy={last.y} r="4.3" fill="#28533F" stroke="#fff" strokeWidth="2" />
          </>
        )}
      </svg>
      <div className="brutti-activity-ticks" aria-hidden="true">
        {ticks.map(index => <span key={index}>{shortDate(activity.keys[index])}</span>)}
      </div>
      {activity.total === 0 && (
        <p className="brutti-activity-empty">No products have a latest update within this period.</p>
      )}
    </div>
  );
}

export default function CatalogOverviewStudio({
  products, categories, loading, asOfMs, canManageCategories,
  onOpenProducts, onOpenCategory, onManageCategories,
}: Props) {
  const [days, setDays] = useState<Days>(30);
  const total = products.length;
  const drafts = products.filter(product => product.status === "draft");
  const published = products.filter(product => product.status === "published").length;
  const archived = products.filter(product => product.status === "archived").length;
  const withPhotos = products.filter(product => product.images.length > 0).length;
  const activeInPeriod = getUpdateActivity(products, days, asOfMs).total;
  const incompleteDimensions = drafts.filter(product =>
    ![product.width, product.depth, product.height].every(value => Number.isFinite(value) && value > 0)).length;
  const missingMaterials = drafts.filter(product => !product.materials.trim()).length;
  const incompleteDescriptions = drafts.filter(product => !product.description.trim()).length;
  const categoryInsights = categories.map(category => ({
    ...category,
    count: products.filter(product => product.categoryId === category.id).length,
    photo: products.find(product =>
      product.categoryId === category.id && product.images.length > 0)?.images[0],
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const maxCategoryCount = Math.max(1, ...categoryInsights.map(item => item.count));
  const featuredPhoto = products.find(product => product.images.length)?.images[0];

  const cards = [
    { title: "Total Products", value: total, caption: "Across all categories", icon: Package, status: "all" as const },
    { title: "Categories", value: categories.length, caption: "Collection groups", icon: Layers3, status: "categories" as const },
    { title: "Drafts", value: drafts.length, caption: "Awaiting final review", icon: Pencil, status: "draft" as const },
    { title: "Published", value: published, caption: "Live in public catalog", icon: CheckCircle2, status: "published" as const },
    { title: "Archived", value: archived, caption: "Stored from public view", icon: Archive, status: "archived" as const },
  ];

  return (
    <section className="brutti-glass-overview" aria-label="Collection overview">
      <div className="brutti-glass-backdrop" aria-hidden="true">
        {featuredPhoto && <SafeImage src={featuredPhoto.url} alt="" loading="lazy" />}
      </div>
      <div className="brutti-glass-topline">
        <div>
          <span className="brutti-glass-kicker">BRUTTI COLLECTION / OVERVIEW</span>
          <h2>Collection snapshot</h2>
        </div>
        <span className="brutti-glass-live"><span aria-hidden="true" /> Live inventory</span>
      </div>
      <div className="overview-stats brutti-glass-kpis">
        {cards.map((card, index) => (
          <button type="button" className="overview-stat brutti-glass-kpi" key={card.title}
            disabled={loading}
            aria-label={"View " + card.title.toLowerCase()}
            onClick={() => card.status === "categories" ? onManageCategories() : onOpenProducts(card.status)}>
            {index === 0 && featuredPhoto && <SafeImage className="brutti-glass-kpi-photo" src={featuredPhoto.url} alt="" loading="lazy" />}
            <span className="brutti-glass-kpi-head">
              <span className="brutti-glass-icon"><card.icon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="brutti-glass-kpi-title">{card.title}</span>
            </span>
            <strong>{loading ? "—" : card.value}</strong>
            <span className="brutti-glass-kpi-caption">{card.caption}</span>
          </button>
        ))}
      </div>
      <div className="brutti-glass-panels atelier-workbench">
        <section className="brutti-activity-panel atelier-review" aria-labelledby="brutti-activity-title">
          <div className="brutti-glass-panel-heading">
            <div className="brutti-glass-panel-title">
              <ChartNoAxesCombined size={21} aria-hidden="true" />
              <div>
                <h2 id="brutti-activity-title">Catalog activity</h2>
                <p>Products by their latest update date. Based on saved records.</p>
              </div>
            </div>
            <label className="brutti-activity-range">
              <span className="sr-only">Activity time range</span>
              <select value={days} onChange={event => setDays(Number(event.target.value) as Days)}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
          </div>
          <div className="brutti-activity-layout">
            <ActivityChart products={products} days={days} asOfMs={asOfMs} />
            <aside className="brutti-activity-summary" aria-label="Publishing overview">
              <strong className="brutti-activity-big">{loading ? "—" : drafts.length}</strong>
              <span>Products in review</span>
              <div className="brutti-activity-summary-rule" />
              <strong className="brutti-activity-updated">{activeInPeriod}</strong>
              <span>Products last updated in {days} days</span>
              <button type="button" onClick={() => onOpenProducts("draft")}>
                Review drafts <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </aside>
          </div>
          <div className="brutti-activity-readiness">
            <div>
              <span><Images size={14} aria-hidden="true" /> With photos <strong>{withPhotos} / {total}</strong></span>
              <progress value={withPhotos} max={Math.max(1, total)} aria-label="Products with photos" />
            </div>
            <div>
              <span><ShieldCheck size={14} aria-hidden="true" /> Published <strong>{published} / {total}</strong></span>
              <progress value={published} max={Math.max(1, total)} aria-label="Published products" />
            </div>
          </div>
        </section>
        <section className="brutti-category-panel atelier-categories" aria-labelledby="brutti-category-title">
          <div className="brutti-glass-panel-heading">
            <div className="brutti-glass-panel-title">
              <Layers3 size={21} aria-hidden="true" />
              <div>
                <h2 id="brutti-category-title">Categories</h2>
                <p>Explore your collection by category.</p>
              </div>
            </div>
            {canManageCategories && (
              <button type="button" className="brutti-category-manage" onClick={onManageCategories}>
                Manage categories <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="brutti-category-list">
            {categoryInsights.slice(0, 5).map(item => (
              <button type="button" key={item.id} className="atelier-category-row brutti-category-row"
                onClick={() => onOpenCategory(item.id)}
                aria-label={"View " + item.name + ", " + item.count + " products"}>
                <span className="brutti-category-image">
                  {item.photo ? <SafeImage src={item.photo.url} alt="" loading="lazy" /> :
                    <Layers3 size={21} aria-hidden="true" />}
                </span>
                <span className="brutti-category-name">
                  <strong>{item.name}</strong>
                  <span className="atelier-category-track"><span style={{ width: item.count / maxCategoryCount * 100 + "%" }} /></span>
                </span>
                <span className="brutti-category-count">{item.count} <span>products</span></span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
            {!categoryInsights.length && <p className="brutti-category-empty">No categories yet.</p>}
          </div>
          {categoryInsights.length > 5 && <button type="button" className="brutti-all-categories" onClick={onManageCategories}>
            View all {categoryInsights.length} categories <ArrowRight size={14} aria-hidden="true" />
          </button>}
        </section>
      </div>
      <div className="brutti-review-strip atelier-checklist" aria-label="Missing draft product information">
        <div className="brutti-review-strip-title">
          <span>Details to verify</span>
          <strong>Draft review</strong>
        </div>
        <button type="button" onClick={() => onOpenProducts("draft")}>
          Dimensions not confirmed <strong>{incompleteDimensions}</strong><ChevronRight size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onOpenProducts("draft")}>
          Material details missing <strong>{missingMaterials}</strong><ChevronRight size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onOpenProducts("draft")}>
          Descriptions incomplete <strong>{incompleteDescriptions}</strong><ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
