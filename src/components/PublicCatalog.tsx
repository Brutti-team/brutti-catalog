import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Mail,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { Category, Product } from "../lib/types";
import { publicAssetUrl } from "../lib/assets";
import "./public.css";

interface Props {
  products: Product[];
  categories: Category[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAdmin: () => void;
}

const configuredEmail = (import.meta.env.VITE_ENQUIRY_EMAIL || "").trim();
const enquiryEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail)
  ? configuredEmail
  : null;

const availabilityLabels = {
  available: "Available",
  "made-to-order": "Made to order",
  unavailable: "Currently unavailable",
};
const price = (value: number | null) =>
  value === null
    ? "Price on enquiry"
    : `RM ${new Intl.NumberFormat("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)}`;
function currentProductId() {
  const match = window.location.hash.match(/^#\/product\/([^/?#]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
function FurnitureImage({
  src,
  alt,
  className = "",
  eager = false,
}: {
  src?: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <img
      src={publicAssetUrl(src)}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      onError={(event) => {
        if (!event.currentTarget.src.endsWith("/images/placeholder.svg"))
          event.currentTarget.src = publicAssetUrl("/images/placeholder.svg");
      }}
    />
  );
}

export default function PublicCatalog({
  products,
  categories,
  loading,
  error,
  onRetry,
  onAdmin,
}: Props) {
  const [productId, setProductId] = useState(currentProductId);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [sort, setSort] = useState("curated");
  const [imageIndex, setImageIndex] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => {
    const changeRoute = () => {
      setProductId(currentProductId());
      setImageIndex(0);
      setMobileMenu(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", changeRoute);
    return () => window.removeEventListener("hashchange", changeRoute);
  }, []);
  const published = useMemo(
    () => products.filter((product) => product.status === "published"),
    [products],
  );
  const product =
    productId === null
      ? undefined
      : published.find((item) => item.id === productId);
  const categoryName = (id: string) =>
    categories.find((item) => item.id === id)?.name || "Furniture";
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = published.filter(
      (item) =>
        (category === "all" || item.categoryId === category) &&
        (!featuredOnly || item.featured) &&
        (!text ||
          `${item.name} ${item.sku} ${item.description} ${item.materials}`
            .toLowerCase()
            .includes(text)),
    );
    return [...list].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "price"
          ? (a.price ?? Infinity) - (b.price ?? Infinity)
          : Number(b.featured) - Number(a.featured),
    );
  }, [published, query, category, featuredOnly, sort]);
  const browseCollection = (featured = false) => {
    setFeaturedOnly(featured);
    setMobileMenu(false);
    if (productId !== null) {
      window.location.hash = "/catalog";
      window.setTimeout(
        () =>
          document
            .getElementById("pub-collection")
            ?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } else
      document
        .getElementById("pub-collection")
        ?.scrollIntoView({ behavior: "smooth" });
  };
  const resetFilters = () => {
    setQuery("");
    setCategory("all");
    setFeaturedOnly(false);
  };
  const related = product
    ? published
        .filter(
          (item) =>
            item.id !== product.id && item.categoryId === product.categoryId,
        )
        .slice(0, 3)
    : [];
  const card = (item: Product) => (
    <a
      href={`#/product/${encodeURIComponent(item.id)}`}
      className="pub-product-card"
      key={item.id}
    >
      <div className="pub-card-image">
        <FurnitureImage
          src={item.images[0]?.url}
          alt={item.images[0]?.alt || item.name}
        />
        {item.featured && (
          <span className="pub-featured-tag">
            <Sparkles size={11} /> Featured
          </span>
        )}
        <span className="pub-card-open" aria-hidden="true">
          <ArrowUpRight size={20} />
        </span>
      </div>
      <div className="pub-card-meta">
        <span>{categoryName(item.categoryId)}</span>
        <span className={`pub-availability pub-${item.availability}`}>
          <i />
          {availabilityLabels[item.availability]}
        </span>
      </div>
      <div className="pub-card-bottom">
        <h3>{item.name}</h3>
        <span>{price(item.price)}</span>
      </div>
      <p className="pub-card-material">{item.materials}</p>
    </a>
  );

  return (
    <div className="pub-app">
      <a
        className="pub-skip-link"
        href="#pub-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("pub-main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="pub-header">
        <a
          href="#/catalog"
          className="pub-wordmark"
          aria-label="Brutti catalog home"
        >
          <img src={publicAssetUrl("/images/brutti-wordmark.svg")} alt="Brutti" className="pub-official-logo" />
          <small>THE FURNITURE COLLECTION</small>
        </a>
        <nav
          id="pub-mobile-nav"
          className={mobileMenu ? "pub-nav pub-nav-open" : "pub-nav"}
          aria-label="Main navigation"
        >
          <button className="pub-nav-active" onClick={() => browseCollection()}>
            Collection
          </button>
          <button onClick={() => browseCollection(true)}>
            Featured pieces
          </button>
          <button
            onClick={() => {
              document
                .getElementById("pub-story")
                ?.scrollIntoView({ behavior: "smooth" });
              setMobileMenu(false);
            }}
          >
            Our philosophy
          </button>
        </nav>
        <div className="pub-header-actions">
          <button className="pub-admin-link" onClick={onAdmin}>
            Manage catalog <ArrowUpRight size={15} />
          </button>
          <button
            className="pub-menu-toggle"
            aria-expanded={mobileMenu}
            aria-controls="pub-mobile-nav"
            aria-label={mobileMenu ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            {mobileMenu ? <X size={22} /> : <SlidersHorizontal size={22} />}
          </button>
        </div>
      </header>

      <main id="pub-main" tabIndex={-1}>
        {productId === null && (
          <>
            <section className="pub-hero">
              <div className="pub-hero-copy">
                <p className="pub-eyebrow">
                  <span /> THE BRUTTI COLLECTION · VOL. 01
                </p>
                <h1>
                  Good design.
                  <br />
                  <em>Better living.</em>
                </h1>
                <p className="pub-hero-description">
                  Considered furniture for the spaces you call home. Natural
                  materials, quiet details, enduring character.
                </p>
                <button
                  className="pub-primary-button"
                  onClick={() => browseCollection()}
                >
                  Explore the collection <ArrowRight size={17} />
                </button>
                <div className="pub-hero-footnote">
                  <span className="pub-hero-line" /> Thoughtfully selected.
                  Beautifully simple.
                </div>
              </div>
              <div className="pub-hero-visual">
                <FurnitureImage
                  src="/images/hero.jpg"
                  alt="A warm, considered living space with natural wood furniture"
                  eager
                />
                <div className="pub-hero-image-label">
                  <span>A LITTLE MORE HOME.</span>
                  <ArrowUpRight size={23} />
                </div>
                <span className="pub-hero-number">
                  01 / THE ART OF EVERYDAY
                </span>
              </div>
            </section>
            <div className="pub-values-strip">
              <span>
                <Check size={15} /> Considered materials
              </span>
              <span>
                <Check size={15} /> Purposeful design
              </span>
              <span>
                <Check size={15} /> Spaces with character
              </span>
              <span className="pub-strip-location">
                BENUA BRUTTI SDN. BHD. <ArrowDown size={14} />
              </span>
            </div>
            <section id="pub-collection" className="pub-collection">
              <div className="pub-section-heading">
                <div>
                  <p className="pub-eyebrow">FIND YOUR NEXT FAVOURITE</p>
                  <h2>
                    The collection<span>.</span>
                  </h2>
                </div>
                <p>
                  Pieces to make a space your own.
                  <br />
                  Explore, discover, and make room.
                </p>
              </div>
              <div className="pub-collection-tools">
                <label className="pub-search">
                  <Search size={18} />
                  <span className="pub-sr-only">Search the catalog</span>
                  <input
                    type="search"
                    placeholder="Search furniture, materials…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      <X size={15} />
                    </button>
                  )}
                </label>
                <label className="pub-sort">
                  <span>Sort by</span>
                  <select
                    aria-label="Sort products"
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                  >
                    <option value="curated">Curated selection</option>
                    <option value="name">Name: A–Z</option>
                    <option value="price">Price: low to high</option>
                  </select>
                  <ChevronDown size={15} />
                </label>
              </div>
              <div className="pub-filter-row">
                <div
                  className="pub-category-filters"
                  aria-label="Filter by category"
                >
                  <button
                    aria-pressed={category === "all"}
                    className={category === "all" ? "pub-filter-active" : ""}
                    onClick={() => setCategory("all")}
                  >
                    All furniture <span>{published.length}</span>
                  </button>
                  {categories.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={category === item.id}
                      className={
                        category === item.id ? "pub-filter-active" : ""
                      }
                      onClick={() => setCategory(item.id)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
                <button
                  className={`pub-featured-filter ${featuredOnly ? "pub-filter-featured-active" : ""}`}
                  aria-pressed={featuredOnly}
                  onClick={() => setFeaturedOnly(!featuredOnly)}
                >
                  <Sparkles size={14} /> Featured only
                </button>
              </div>
              <div className="pub-results-label" role="status">
                {loading
                  ? "Loading the collection…"
                  : `${filtered.length} ${filtered.length === 1 ? "piece" : "pieces"}${query ? ` matching “${query}”` : " in the collection"}`}
                {(query || category !== "all" || featuredOnly) && (
                  <button onClick={resetFilters}>
                    Clear filters <X size={12} />
                  </button>
                )}
              </div>
              {loading ? (
                <div
                  className="pub-products-grid"
                  aria-label="Loading products"
                  aria-busy="true"
                >
                  {Array.from({ length: 6 }, (_, index) => (
                    <div className="pub-skeleton-card" key={index}>
                      <div />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="pub-empty-state" role="alert">
                  <h3>The collection is taking a moment.</h3>
                  <p>{error}</p>
                  <button className="pub-primary-button" onClick={onRetry}>
                    Try again <ArrowRight size={16} />
                  </button>
                </div>
              ) : filtered.length ? (
                <div className="pub-products-grid">{filtered.map(card)}</div>
              ) : (
                <div className="pub-empty-state">
                  <Search size={28} />
                  <h3>No pieces found.</h3>
                  <p>Try another search or explore a different category.</p>
                  <button className="pub-primary-button" onClick={resetFilters}>
                    View all furniture <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          </>
        )}
        {productId !== null && (
          <section className="pub-detail-section">
            <a href="#/catalog" className="pub-back-link">
              <ArrowLeft size={16} /> Back to the collection
            </a>
            {loading ? (
              <div className="pub-detail-loading" aria-busy="true">
                <div className="pub-skeleton-card">
                  <div />
                </div>
                <div>
                  <div className="pub-skeleton-line" />
                  <div className="pub-skeleton-line" />
                  <div className="pub-skeleton-line" />
                </div>
              </div>
            ) : error ? (
              <div className="pub-empty-state" role="alert">
                <h2>We couldn’t load this piece.</h2>
                <p>{error}</p>
                <button className="pub-primary-button" onClick={onRetry}>
                  Try again <ArrowRight size={16} />
                </button>
              </div>
            ) : !product ? (
              <div className="pub-empty-state">
                <h2>This piece isn’t in the collection.</h2>
                <p>It may be unpublished or no longer available.</p>
                <a href="#/catalog" className="pub-primary-button">
                  Explore the collection <ArrowRight size={16} />
                </a>
              </div>
            ) : (
              <>
                <div className="pub-product-detail">
                  <div className="pub-detail-gallery">
                    <div className="pub-detail-main-image">
                      <FurnitureImage
                        src={
                          (product.images[imageIndex] || product.images[0])?.url
                        }
                        alt={
                          (product.images[imageIndex] || product.images[0])
                            ?.alt || product.name
                        }
                        eager
                      />
                      {product.featured && (
                        <span className="pub-featured-tag">
                          <Sparkles size={12} /> Featured piece
                        </span>
                      )}
                    </div>
                    {product.images.length > 1 && (
                      <div
                        className="pub-gallery-thumbnails"
                        aria-label="Product image gallery"
                      >
                        {product.images.map((item, index) => (
                          <button
                            key={item.id}
                            aria-label={`View image ${index + 1}: ${item.alt || product.name}`}
                            aria-pressed={imageIndex === index}
                            className={
                              imageIndex === index ? "pub-thumbnail-active" : ""
                            }
                            onClick={() => setImageIndex(index)}
                          >
                            <FurnitureImage src={item.url} alt="" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="pub-detail-copy">
                    <p className="pub-eyebrow">
                      {categoryName(product.categoryId)} · {product.sku}
                    </p>
                    <h1>{product.name}</h1>
                    <div
                      className={`pub-detail-availability pub-availability pub-${product.availability}`}
                    >
                      <i />
                      {availabilityLabels[product.availability]}
                    </div>
                    <p className="pub-detail-description">
                      {product.description}
                    </p>
                    <p className="pub-detail-price">
                      {price(product.price)}
                      {product.price !== null && (
                        <small>
                          Indicative price · Confirm details on enquiry
                        </small>
                      )}
                    </p>
                    {enquiryEmail ? (
                      <a
                        className="pub-primary-button pub-enquiry-button"
                        href={`mailto:${enquiryEmail}?subject=${encodeURIComponent(`Product enquiry: ${product.name} (${product.sku})`)}&body=${encodeURIComponent(`Hello Brutti team,\n\nI would like to know more about ${product.name} (${product.sku}).\n\nThank you.`)}`}
                      >
                        <Mail size={16} /> Enquire about this piece{" "}
                        <ArrowUpRight size={17} />
                      </a>
                    ) : (
                      <button
                        className="pub-primary-button pub-enquiry-button"
                        disabled
                      >
                        <Mail size={16} /> Enquiries coming soon
                      </button>
                    )}
                    <p className="pub-enquiry-note">
                      {enquiryEmail
                        ? "Opens your email app. No enquiry is sent by this catalog."
                        : "An enquiry contact has not been configured yet."}
                    </p>
                    <div className="pub-specifications">
                      <h2>The details</h2>
                      <dl>
                        <div>
                          <dt>Materials</dt>
                          <dd>{product.materials}</dd>
                        </div>
                        <div>
                          <dt>Dimensions</dt>
                          <dd>
                            {product.width} W × {product.depth} D ×{" "}
                            {product.height} H cm
                          </dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{categoryName(product.categoryId)}</dd>
                        </div>
                        <div>
                          <dt>Product reference</dt>
                          <dd>{product.sku}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="pub-detail-promise">
                      <span className="pub-promise-symbol">b.</span>
                      <p>
                        A considered addition to your everyday.
                        <br />
                        <span>Designed to feel right at home.</span>
                      </p>
                    </div>
                  </div>
                </div>
                {related.length > 0 && (
                  <section className="pub-related">
                    <div className="pub-section-heading">
                      <div>
                        <p className="pub-eyebrow">A LITTLE MORE INSPIRATION</p>
                        <h2>In good company.</h2>
                      </div>
                      <a href="#/catalog">
                        View the collection <ArrowRight size={16} />
                      </a>
                    </div>
                    <div className="pub-products-grid">{related.map(card)}</div>
                  </section>
                )}
              </>
            )}
          </section>
        )}
        <section className="pub-story" id="pub-story">
          <div>
            <p className="pub-eyebrow">LESS, BUT BETTER</p>
            <h2>
              A home is a feeling.
              <br />
              <em>Make room for it.</em>
            </h2>
          </div>
          <div>
            <p>
              We believe beautiful spaces begin with thoughtful choices.
              Furniture with warmth, purpose, and room for the way you live.
            </p>
            <button onClick={() => browseCollection()}>
              Find your piece <ArrowRight size={18} />
            </button>
          </div>
        </section>
      </main>
      <footer className="pub-footer">
        <div>
          <a href="#/catalog" className="pub-wordmark">
            <img src={publicAssetUrl("/images/brutti-wordmark.svg")} alt="Brutti" className="pub-official-logo" />
          </a>
          <p>
            BENUA BRUTTI SDN. BHD.
            <br />
            Furniture for a more considered everyday.
          </p>
        </div>
        <div className="pub-footer-right">
          {enquiryEmail ? (
            <a href={`mailto:${enquiryEmail}`}>
              Let’s make room. <ArrowUpRight size={15} />
            </a>
          ) : (
            <span className="pub-footer-enquiry">Enquiries coming soon.</span>
          )}
          <small>
            © {new Date().getFullYear()} Benua Brutti Sdn. Bhd.
          </small>
        </div>
      </footer>
    </div>
  );
}
