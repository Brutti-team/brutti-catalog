import SafeImage from "./components/SafeImage";
import { formatProductPrice } from "./lib/price";
import { publicAssetUrl } from "./lib/assets";
import { resolveAppRoute } from "./lib/routes";
import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import {
  LayoutDashboard,
  Package,
  Images,
  Layers,
  ArrowUpRight,
  Plus,
  Search,
  SlidersHorizontal,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
  Copy,
  Archive,
  Trash2,
  ChevronRight,
  ArrowRight,
  Leaf,
  Menu,
  X,
  LogOut,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ExternalLink,
  Moon,
  Sun,
  UsersRound,
  History,
} from "lucide-react";
import type { Product, Category, CatalogData } from "./lib/types";
import {
  loadCatalog,
  subscribeCatalog,
  saveProduct,
  deleteProduct,
  saveCategory,
  deleteCategory,
  signIn,
  signOut,
  getAuthState,
  subscribeAuth,
  initialPasswordIntent,
  hasPasswordCallbackSession,
  completePassword,
  requestPasswordReset,
} from "./lib/catalog";
import ProductEditor from "./components/ProductEditor";
import PublicCatalog from "./components/PublicCatalog";
import Modal from "./components/Modal";
import AccountCenter from "./components/AccountCenter";
import CataloguePhotoImport from "./components/CataloguePhotoImport";
import LastChange from "./components/LastChange";
import { getAccountSummary, initials, roleLabel, type StaffRole } from "./lib/account-center";
import { useAdminTheme } from "./lib/admin-theme";

type Tab = "overview" | "products" | "categories" | "profile" | "users" | "activity";
const label = (s: string) =>
  s
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
function newProduct(categoryId = ""): Product {
  return {
    id: crypto.randomUUID(),
    name: "",
    sku: "",
    categoryId,
    description: "",
    materials: "",
    width: 0,
    depth: 0,
    height: 0,
    price: null,
    status: "draft",
    availability: "available",
    featured: false,
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function App() {
  const { theme, toggleTheme } = useAdminTheme();
  const [passwordIntent, setPasswordIntent] = useState(initialPasswordIntent);
  const [callbackVerified, setCallbackVerified] = useState(false);
  const [route, setRoute] = useState(() => resolveAppRoute(window.location));
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<CatalogData>({
    products: [],
    categories: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState({
    authenticated: false,
    isAdmin: false,
    email: "",
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [accountRole, setAccountRole] = useState<StaffRole | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountsReady, setAccountsReady] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("recent");
  const [productView, setProductView] = useState<"table" | "gallery">(() => {
    try { return window.localStorage.getItem("brutti-catalog-product-view") === "gallery" ? "gallery" : "table"; }
    catch { return "table"; }
  });
  const changeProductView = (next: "table" | "gallery") => {
    setProductView(next);
    try { window.localStorage.setItem("brutti-catalog-product-view", next); }
    catch { /* Keep the selected view in this session. */ }
  };
  const [editor, setEditor] = useState<Product | null>(null);
  const [photoImportOpen, setPhotoImportOpen] = useState(false);
  const [catEditor, setCatEditor] = useState<Category | null>(null);
  const [catName, setCatName] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const catalogRequest = useRef(0);
  const authRequest = useRef(0);
  const refresh = useCallback(async (background = false) => {
    const request = ++catalogRequest.current;
    if (!background) setLoading(true);
    setError(null);
    try {
      const next = await loadCatalog();
      if (request === catalogRequest.current) setData(next);
    } catch (e) {
      if (request === catalogRequest.current)
        setError(e instanceof Error ? e.message : "Unable to load the catalog.");
    } finally {
      if (request === catalogRequest.current) setLoading(false);
    }
  }, []);
  const refreshAuth = useCallback(async () => {
    const request = ++authRequest.current;
    try {
      const a = await getAuthState();
      const callback = initialPasswordIntent ? a.authenticated && await hasPasswordCallbackSession() : false;
      if (request !== authRequest.current) return;
      setAuth({ ...a, email: a.email || "" });
      setCallbackVerified(callback);
      if (!a.isAdmin) setData(current => ({ ...current, products: current.products.filter(product => product.status === 'published') }));
    } catch (e) {
      if (request !== authRequest.current) return;
      setAuth({ authenticated: false, isAdmin: false, email: "" });
      setCallbackVerified(false);
      setData(current => ({ ...current, products: current.products.filter(product => product.status === 'published') }));
      setError(e instanceof Error ? e.message : "Unable to verify access.");
    } finally {
      if (request === authRequest.current) setAuthLoading(false);
    }
  }, []);
  useEffect(() => () => {
    ++catalogRequest.current;
    ++authRequest.current;
  }, []);
  useEffect(() => {
    const fn = () => setRoute(resolveAppRoute(window.location));
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    void refresh();
    void refreshAuth();
    const unsub = subscribeAuth(() => {
      void refreshAuth();
      void refresh();
    });
    return unsub;
  }, [refresh, refreshAuth]);
  useEffect(() => subscribeCatalog(() => refresh(true)), [refresh]);
  useEffect(() => {
    let active = true;
    if (!auth.isAdmin) return;
    void getAccountSummary().then(info => {
      if (!active) return;
      setAccountRole(info.role);
      setAccountsReady(info.managementReady);
      setAccountName(info.displayName);
    }).catch(() => {
      if (active) {
        setAccountRole(null);
        setAccountsReady(false);
      }
    });
    return () => { active = false; };
  }, [auth.isAdmin, auth.email]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), toast.startsWith("Upload completed") ? 7000 : 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const navigate = (dest: string) => {
    window.location.hash = dest;
    setMobileNav(false);
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    setMobileNav(false);
    setSearch("");
    setStatus("all");
    setCategory("all");
    setMenu(null);
  };
  async function persist(p: Product) {
    const saved = await saveProduct(p);
    await refresh();
    setToast(saved.cleanupWarning || `${saved.name} saved`);
    return saved;
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setActionError("");
    try {
      const result = await fn();
      await refresh();
      setToast(result && typeof result === 'object' && 'cleanupWarning' in result && typeof result.cleanupWarning === 'string'
        ? result.cleanupWarning : message);
    } catch (e) {
      setActionError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
      setMenu(null);
    }
  }
  function editCategory(c: Category) {
    setCatEditor(c);
    setCatName(c.name);
    setCatDescription(c.description);
    setActionError("");
  }
  async function submitCategory(e: FormEvent) {
    e.preventDefault();
    if (!catEditor) return;
    setBusy(true);
    setActionError("");
    try {
      await saveCategory({
        ...catEditor,
        name: catName.trim(),
        description: catDescription.trim(),
      });
      await refresh();
      setCatEditor(null);
      setToast("Category saved");
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Unable to save category.",
      );
    } finally {
      setBusy(false);
    }
  }
  const publicRoute =
    route.startsWith("#/catalog") || route.startsWith("#/product/");
  if (publicRoute && !passwordIntent)
    return (
      <>
        <PublicCatalog
          products={data.products}
          categories={data.categories}
          loading={loading}
          error={error}
          onRetry={() => void refresh()}
          onAdmin={() => navigate("/admin")}
        />
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={17} />
            {toast}
          </div>
        )}
      </>
    );
  if (authLoading)
    return (
      <div className="admin-app admin-access-shell" data-theme={theme}>
      <div className="access-page">
        <LoaderCircle className="spin" />
        <p>Preparing your workspace…</p>
      </div>
      </div>
    );
  if (passwordIntent)
    return <div className="admin-app admin-access-shell" data-theme={theme}><PasswordAccess intent={passwordIntent} verified={callbackVerified} onDone={async () => {
      setPasswordIntent(null);
      const clean = new URL(window.location.href);
      clean.searchParams.delete("auth");
      clean.hash = "/admin";
      window.history.replaceState(null, "", clean);
      setRoute("#/admin");
      await refreshAuth();
    }} /></div>;
  if (!auth.isAdmin)
    return (
      <div className="admin-app admin-access-shell" data-theme={theme}>
      <Login
        setupError={error || actionError}
        authenticated={auth.authenticated}
        onSuccess={async () => {
          await refreshAuth();
          await refresh();
        }}
        onCatalog={() => navigate("/catalog")}
      />
      </div>
    );
  const publishedCount = data.products.filter((p) => p.status === "published").length;
  const draftCount = data.products.filter((p) => p.status === "draft").length;
  const archivedCount = data.products.filter((p) => p.status === "archived").length;
  const withPhotos = data.products.filter((p) => p.images.length > 0).length;
  const photoCoverage = data.products.length ? Math.round(withPhotos / data.products.length * 100) : 0;
  const liveCoverage = data.products.length ? Math.round(publishedCount / data.products.length * 100) : 0;
  const stats = [
    {
      title: "Total products",
      value: data.products.length,
      detail: "Products in this workspace",
      icon: Package,
    },
    {
      title: "Published",
      value: data.products.filter((p) => p.status === "published").length,
      detail: "Visible in your public catalog",
      icon: CheckCircle2,
    },
    {
      title: "Drafts",
      value: data.products.filter((p) => p.status === "draft").length,
      detail: "Waiting for final review",
      icon: Pencil,
    },
    {
      title: "Categories",
      value: data.categories.length,
      detail: "Collection groups",
      icon: Layers,
    },
  ];
  const categoryInsights = data.categories.map(item => ({
    ...item, count: data.products.filter(product => product.categoryId === item.id).length,
  })).sort((a, b) => b.count - a.count);
  const maxCategoryCount = Math.max(1, ...categoryInsights.map(item => item.count));
  const filtered = data.products
    .filter((p) => {
      const needle = search.toLowerCase();
      return (
        `${p.name} ${p.sku} ${p.materials}`.toLowerCase().includes(needle) &&
        (status === "all" || p.status === status) &&
        (category === "all" || p.categoryId === category)
      );
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "price"
          ? (a.price ?? Infinity) - (b.price ?? Infinity)
          : sort === "display-order"
            ? (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <div className="admin-app" data-theme={theme}>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <a
          href="#/admin"
          className="brand"
          onClick={() => switchTab("overview")}
        >
          <img src={publicAssetUrl("/images/brutti-wordmark.svg")} alt="Brutti" className="brutti-official-logo" />
        </a>
        <div className="workspace-label">
          <span className="workspace-symbol" aria-hidden="true"><Layers size={17} /></span>
          <span className="workspace-meta">
            <strong>Catalog Workspace</strong>
            <small>Product management</small>
          </span>
          <span className="workspace-indicator" aria-label="Current workspace"><span aria-hidden="true" /></span>
        </div>
        <nav aria-label="Admin navigation">
          <span className="nav-group-label">MANAGE</span>
          {(
            [
              { id: "overview", text: "Overview", icon: LayoutDashboard },
              { id: "products", text: "Products", icon: Package },
              { id: "categories", text: "Categories", icon: Layers },
            ] as const
          ).filter((n) => accountRole !== "editor" || n.id !== "categories").map((n) => (
            <button
              key={n.id}
              className={`nav-item ${tab === n.id ? "active" : ""}`}
              onClick={() => switchTab(n.id)}
            >
              <span className="nav-icon" aria-hidden="true"><n.icon size={18} /></span>
              {n.text}
              {n.id === "products" && (
                <span className="nav-count">{data.products.length}</span>
              )}
            </button>
          ))}
          {auth.isAdmin && (
            <span className="nav-group-label nav-group-second">TEAM</span>
          )}
          {accountsReady && accountRole === "super_admin" && (
            <button className={`nav-item ${tab === "users" ? "active" : ""}`}
              onClick={() => switchTab("users")}>
              <span className="nav-icon" aria-hidden="true"><UsersRound size={18} /></span> Users
            </button>
          )}
          {auth.isAdmin && (
            <button className={`nav-item ${tab === "activity" ? "active" : ""}`}
              onClick={() => switchTab("activity")}>
              <span className="nav-icon" aria-hidden="true"><History size={18} /></span> Activity log
            </button>
          )}
          <span className="nav-group-label nav-group-second">EXPLORE</span>
          <button className="nav-item" onClick={() => navigate("/catalog")}>
            <span className="nav-icon" aria-hidden="true"><ArrowUpRight size={18} /></span>
            Public catalog
            <ExternalLink size={13} className="nav-trailing" />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <LastChange
            authenticated={auth.isAdmin}
            refreshKey={data}
            onHistory={() => switchTab("activity")}
          />
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="admin-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label={mobileNav ? "Close navigation" : "Open navigation"}
              onClick={() => setMobileNav(!mobileNav)}
            >
              {mobileNav ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{label(tab)}</strong>
          </div>
          <div className="topbar-actions">
            <span className="connection-pill">
              <span />
              Supabase connected
            </span>
            <button
              className="catalog-link"
              onClick={() => navigate("/catalog")}
            >
              View catalog <ArrowUpRight size={15} />
            </button>
            <button
              type="button"
              className="theme-toggle"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={theme === "dark"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
              <span className="theme-label">{theme === "dark" ? "Dark" : "Light"}</span>
            </button>
            <button
              type="button"
              className={`header-profile ${tab === "profile" ? "active" : ""}`}
              aria-label="Open my profile"
              title="My profile"
              onClick={() => switchTab("profile")}
            >
              <span className="profile-avatar" aria-hidden="true">{initials(accountName || auth.email.split("@")[0] || "BB")}</span>
              <span className="profile-copy">
                <strong>{accountName || auth.email.split("@")[0] || "Your profile"}</strong>
                <small>{roleLabel(accountRole)}</small>
              </span>
            </button>
            <button
              type="button"
              className="header-signout"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => {
                void signOut().catch((e) => setActionError(e instanceof Error ? e.message : "Sign out failed."));
              }}
            >
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="admin-content">
          {tab === "profile" || tab === "users" || tab === "activity" ? (
            <AccountCenter view={tab} onProfileChanged={setAccountName} />
          ) : (<>
          {tab === "overview" ? (
            <section className="catalog-command" aria-labelledby="catalog-overview-title">
              <div className="catalog-command-content">
                <div className="catalog-command-eyebrow"><span className="catalog-command-live-dot" /> BRUTTI CATALOG <span aria-hidden="true">/</span> ADMIN WORKSPACE</div>
                <h1 id="catalog-overview-title">Your collection.<br /><span>Under control.</span></h1>
                <p>Organise your work, review products and manage what your customers see.</p>
                <div className="catalog-command-actions">
                  <button type="button" className="catalog-hero-primary" disabled={loading || busy}
                    onClick={() => setEditor(newProduct(data.categories[0]?.id))}>
                    <Plus size={17} aria-hidden="true" /> Add product
                  </button>
                  <button type="button" className="catalog-hero-secondary"
                    onClick={() => { switchTab("products"); setStatus(draftCount > 0 ? "draft" : "all"); }}>
                    {draftCount > 0 ? "Review drafts" : "View products"} <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="catalog-command-insight" aria-label="Drafts awaiting review">
                <span>WORK QUEUE</span>
                <strong>{loading ? "—" : draftCount.toLocaleString("en-MY")}</strong>
                <small>products awaiting review</small>
                <div className="catalog-command-insight-foot"><span className="catalog-command-insight-dot" /> {publishedCount} published</div>
              </div>
            </section>
          ) : tab === "products" ? (
            <section className="catalog-product-hero" aria-labelledby="catalog-products-title">
              <div className="catalog-product-hero-main">
                <span className="catalog-product-hero-eyebrow"><span className="catalog-hero-pulse" aria-hidden="true" /> PRODUCT MANAGEMENT <span aria-hidden="true">/</span> BRUTTI WORKSPACE</span>
                <h1 id="catalog-products-title">Products</h1>
                <p>Organise, review and manage your collection from one workspace.</p>
                <div className="catalog-product-hero-meta">
                  <span><Package size={14} aria-hidden="true" /> {data.products.length} products</span>
                  <span><Images size={14} aria-hidden="true" /> {withPhotos} with photos</span>
                  <span><Layers size={14} aria-hidden="true" /> {data.categories.length} categories</span>
                </div>
              </div>
              <div className="catalog-product-hero-side">
                <div className="catalog-product-hero-status">
                  <span>REVIEW QUEUE</span>
                  <div><strong>{draftCount}</strong><span>Draft products</span></div>
                </div>
                <button className="catalog-products-add-button" type="button" disabled={loading || busy}
                  onClick={() => setEditor(newProduct(data.categories[0]?.id))}>
                  <Plus size={17} aria-hidden="true" /> Add product
                </button>
              </div>
            </section>
          ) : (
            <div className="page-heading catalog-management-heading">
              <div>
                <span className="eyebrow">BRUTTI CATALOG WORKSPACE</span>
                <h1>Categories</h1>
                <p>Manage how customers discover your collections.</p>
              </div>
              <button className="button primary" disabled={loading || busy}
                onClick={() => editCategory({ id: crypto.randomUUID(), name: "", description: "" })}>
                <Plus size={17} /> Add category
              </button>
            </div>
          )}
          {(error || actionError) && !catEditor && (
            <div className="notice error" role="alert">
              <AlertCircle size={18} />
              <span>{error || actionError}</span>
              {error && (
                <button onClick={() => void refresh()}>Try again</button>
              )}
            </div>
          )}
          {tab === "overview" && (
            <>
              <div className="stats-grid overview-stats">
                {stats.map((s) => (
                  <article className="stat-card overview-stat" key={s.title}>
                    <div>
                      <span>{s.title}</span>
                      <span className="overview-stat-icon"><s.icon size={19} aria-hidden="true" /></span>
                    </div>
                    <strong>{loading ? "—" : s.value}</strong>
                    <p>{s.detail}</p>
                  </article>
                ))}
              </div>
              <div className="catalog-operations" aria-label="Catalog readiness">
                <section className="catalog-health-card">
                  <header className="catalog-studio-panel-head">
                    <div>
                      <span className="catalog-studio-kicker">PUBLISHING PIPELINE</span>
                      <h2>Catalog readiness</h2>
                      <p>Know exactly what is ready before it goes public.</p>
                    </div>
                    <span className="catalog-readiness-chip"><CheckCircle2 size={14} aria-hidden="true" /> {withPhotos} photos ready</span>
                  </header>
                  <div className="catalog-status-summary" aria-label="Product publishing status">
                    <div><span className="catalog-summary-dot is-draft" /><strong>{draftCount}</strong><small>Draft</small></div>
                    <div><span className="catalog-summary-dot is-published" /><strong>{publishedCount}</strong><small>Published</small></div>
                    <div><span className="catalog-summary-dot is-archived" /><strong>{archivedCount}</strong><small>Archived</small></div>
                  </div>
                  <div className="catalog-progress-row">
                    <div><span>Product photos</span><strong>{withPhotos} / {data.products.length}</strong></div>
                    <progress max={100} value={photoCoverage} aria-label="Products with photos" />
                    <small>{photoCoverage}% of products have an image</small>
                  </div>
                  <div className="catalog-progress-row">
                    <div><span>Published products</span><strong>{publishedCount} / {data.products.length}</strong></div>
                    <progress max={100} value={liveCoverage} aria-label="Published products" />
                    <small>{liveCoverage}% of the catalog is public</small>
                  </div>
                </section>
                <section className="catalog-insights-card">
                  <header className="catalog-studio-panel-head">
                    <div>
                      <span className="catalog-studio-kicker">COLLECTION BREAKDOWN</span>
                      <h2>Top categories</h2>
                      <p>Products grouped by category.</p>
                    </div>
                    <button type="button" className="catalog-chart-action" onClick={() => switchTab("categories")}
                      aria-label="Manage categories"><ArrowUpRight size={18} aria-hidden="true" /></button>
                  </header>
                  <div className="catalog-category-bars">
                    {categoryInsights.slice(0, 5).map((item, index) => (
                      <button type="button" className="catalog-category-bar" key={item.id}
                        onClick={() => { switchTab("products"); setCategory(item.id); }}
                        aria-label={`View ${item.name} products`}>
                        <span className="catalog-category-name">{item.name}</span>
                        <span className="catalog-category-track"><span style={{ width: `${(item.count / maxCategoryCount) * 100}%` }} className={index === 0 ? "leading" : ""} /></span>
                        <strong>{item.count}</strong>
                      </button>
                    ))}
                    {!categoryInsights.length && <span className="catalog-empty-hint">No categories yet.</span>}
                  </div>
                </section>
              </div>
            </>
          )}
          {tab !== "categories" ? (
            <section className={`table-panel ${tab === "overview" ? "overview-collection" : "catalog-products-panel"}`}>
              <div className="panel-heading">
                <div>
                  <h2>
                    {tab === "overview" ? "The collection" : "All products"}{" "}
                    <span>{data.products.length}</span>
                  </h2>
                  <p>
                    {tab === "overview"
                      ? "Recently updated products in your workspace."
                      : "All your products in one place."}
                  </p>
                </div>
                {tab === "overview" && (
                  <button
                    className="text-button"
                    onClick={() => switchTab("products")}
                  >
                    View all products <ArrowRight size={15} />
                  </button>
                )}
                {tab === "products" && (
                  <button type="button" className="button secondary catalog-import-trigger"
                    aria-label="Bulk import photos"
                    disabled={loading || busy}
                    onClick={() => setPhotoImportOpen(true)}>
                    <Images size={18} aria-hidden="true" /> Bulk import photos
                  </button>
                )}
              </div>
              {tab === "products" && (
                <div className="catalog-product-controls">
                  <div className="catalog-status-tabs" role="group" aria-label="Quick product status filters">
                    {[
                      { id: "all", title: "All", total: data.products.length },
                      { id: "draft", title: "Draft", total: draftCount },
                      { id: "published", title: "Published", total: publishedCount },
                      { id: "archived", title: "Archived", total: archivedCount },
                    ].map(item => (
                      <button type="button" key={item.id}
                        className={`catalog-status-tab ${status === item.id ? "selected" : ""}`}
                        aria-pressed={status === item.id} onClick={() => setStatus(item.id)}>
                        {item.title} <span>{item.total}</span>
                      </button>
                    ))}
                  </div>
                  <div className="catalog-view-switch" role="group" aria-label="Product display mode">
                    <button type="button" aria-label="Table view" aria-pressed={productView === "table"}
                      className={productView === "table" ? "selected" : ""} onClick={() => changeProductView("table")}>
                      <List size={17} aria-hidden="true" /><span>Table</span>
                    </button>
                    <button type="button" aria-label="Gallery view" aria-pressed={productView === "gallery"}
                      className={productView === "gallery" ? "selected" : ""} onClick={() => changeProductView("gallery")}>
                      <Grid2X2 size={17} aria-hidden="true" /><span>Gallery</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="table-toolbar">
                <div className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="Search products"
                    placeholder="Search by product name, SKU or material…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="filters">
                  {tab === "overview" && (
                    <>
                      <label className="sr-only" htmlFor="status-filter">Filter by status</label>
                      <select id="status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="all">All statuses</option>
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                      </select>
                    </>
                  )}
                  <label className="sr-only" htmlFor="category-filter">
                    Filter by category
                  </label>
                  <select
                    id="category-filter"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">All categories</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <label className="sort-field">
                    <SlidersHorizontal size={15} />
                    <select
                      aria-label="Sort products"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="recent">Latest updated</option>
                      <option value="name">Name A–Z</option>
                      <option value="price">Price low–high</option>
                      <option value="display-order">Display order</option>
                    </select>
                  </label>
                </div>
              </div>
              {tab === "products" && (
                <div className="catalog-products-filter-summary" role="status">
                  <span><strong>{filtered.length}</strong> matching {filtered.length === 1 ? "product" : "products"}</span>
                  {(search || status !== "all" || category !== "all") && (
                    <button type="button" onClick={() => { setSearch(""); setStatus("all"); setCategory("all"); }}>
                      <X size={13} aria-hidden="true" /> Clear filters
                    </button>
                  )}
                  <span className="catalog-products-summary-hint">Select a product to view and edit its details</span>
                </div>
              )}
              {tab === "products" && productView === "gallery" ? (
                <div className="catalog-gallery">
                  {loading ? Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} />)
                    : filtered.map(p => (
                      <button className="catalog-gallery-card" type="button" key={p.id}
                        onClick={() => setEditor(p)} aria-label={`Edit ${p.name}`}>
                        <div className="catalog-gallery-photo">
                          <SafeImage src={p.images[0]?.url || "/images/placeholder.svg"} alt="" loading="lazy" decoding="async" />
                          <span className={`status-badge status-${p.status}`}><i />{label(p.status)}</span>
                        </div>
                        <div className="catalog-gallery-body">
                          <span className="catalog-gallery-category">{data.categories.find(c => c.id === p.categoryId)?.name || "Uncategorised"}</span>
                          <strong>{p.name}</strong>
                          <span className="catalog-gallery-sku">{p.sku}</span>
                          <div className="catalog-gallery-bottom"><span>{formatProductPrice(p)}</span><span><Pencil size={15} aria-hidden="true" /> Edit</span></div>
                        </div>
                      </button>
                    ))}
                </div>
              ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Availability</th>
                      <th>Price</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 4 }, (_, i) => (
                          <tr key={i}>
                            <td colSpan={6}>
                              <div className="skeleton" />
                            </td>
                          </tr>
                        ))
                      : filtered
                          .slice(0, tab === "overview" ? 6 : filtered.length)
                          .map((p) => (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="product-cell"
                                  onClick={() => setEditor(p)}
                                >
                                  <SafeImage
                                    src={p.images[0]?.url || "/images/placeholder.svg"}
                                    alt=""
                                  />
                                  <span>
                                    <strong>{p.name}</strong>
                                    <small>
                                      {p.sku}
                                      {p.featured && (
                                        <span
                                          className="featured-dot"
                                          title="Featured product"
                                        >
                                          {" "}
                                          · FEATURED
                                        </span>
                                      )}
                                    </small>
                                    <span className="catalog-product-updated">Updated {new Intl.DateTimeFormat("en-MY", { month: "short", day: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(p.updatedAt))}</span>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <span className="catalog-table-category">
                                  {data.categories.find(
                                    (c) => c.id === p.categoryId,
                                  )?.name || "Uncategorised"}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`status-badge status-${p.status}`}
                                >
                                  <i />
                                  {label(p.status)}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`availability ${p.availability === "unavailable" ? "muted" : ""}`}
                                >
                                  {label(p.availability)}
                                </span>
                              </td>
                              <td className="price-cell">{formatProductPrice(p)}</td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    className="icon-button edit-row"
                                    aria-label={`Edit ${p.name}`}
                                    onClick={() => setEditor(p)}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <div className="action-menu">
                                    <button
                                      className="icon-button"
                                      aria-label={`More actions for ${p.name}`}
                                      aria-expanded={menu === p.id}
                                      onClick={() =>
                                        setMenu(menu === p.id ? null : p.id)
                                      }
                                    >
                                      <MoreHorizontal size={18} />
                                    </button>
                                    {menu === p.id && (
                                      <div className="dropdown">
                                        <button
                                          onClick={() => {
                                            setEditor({
                                              ...structuredClone(p),
                                              id: crypto.randomUUID(),
                                              name: `${p.name} (copy)`,
                                              sku: `${p.sku}-COPY`,
                                              status: "draft",
                                              createdAt:
                                                new Date().toISOString(),
                                            });
                                            setMenu(null);
                                          }}
                                        >
                                          <Copy size={14} />
                                          Duplicate
                                        </button>
                                        <button
                                          disabled={busy}
                                          onClick={() =>
                                            void action(
                                              () =>
                                                saveProduct({
                                                  ...p,
                                                  status:
                                                    p.status === "archived"
                                                      ? "draft"
                                                      : "archived",
                                                }),
                                              "Product status updated",
                                            )
                                          }
                                        >
                                          <Archive size={14} />
                                          {p.status === "archived"
                                            ? "Restore to draft"
                                            : "Archive"}
                                        </button>
                                        <button
                                          className="danger-text"
                                          disabled={busy}
                                          onClick={() => {
                                            if (
                                              window.confirm(
                                                `Delete ${p.name}? This cannot be undone.`,
                                              )
                                            )
                                              void action(
                                                () => deleteProduct(p.id),
                                                "Product deleted",
                                              );
                                          }}
                                        >
                                          <Trash2 size={14} />
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                  </tbody>
                </table>
              </div>
              )}
              {!loading && !filtered.length && (
                <div className="empty-state">
                  <Package size={30} />
                  <h3>
                    {search || status !== "all" || category !== "all"
                      ? "No pieces found"
                      : "Your collection starts here"}
                  </h3>
                  <p>
                    {search || status !== "all" || category !== "all"
                      ? "Try a different search or clear your filters."
                      : "Add your first product to begin."}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (search || status !== "all" || category !== "all") {
                        setSearch("");
                        setStatus("all");
                        setCategory("all");
                      } else setEditor(newProduct());
                    }}
                  >
                    {search || status !== "all" || category !== "all"
                      ? "Clear filters"
                      : "Add a product"}
                  </button>
                </div>
              )}
              <footer className="table-footer">
                <span>
                  Showing{" "}
                  {Math.min(
                    filtered.length,
                    tab === "overview" ? 6 : filtered.length,
                  )}{" "}
                  of {data.products.length} products
                </span>
                <span>
                  <Leaf size={12} /> Brutti Catalog Workspace
                </span>
              </footer>
            </section>
          ) : (
            <section className="category-grid">
              {loading ? (
                <div className="skeleton" />
              ) : (
                data.categories.map((c, index) => {
                  const items = data.products.filter(
                    (p) => p.categoryId === c.id,
                  );
                  return (
                    <article className="category-card" key={c.id}>
                      <div className="category-cover">
                        <SafeImage
                          src={
                            items.find((p) => p.images.length)?.images[0].url ||
                            "/images/hero.jpg"
                          }
                          alt=""
                        />
                        <span>0{index + 1}</span>
                      </div>
                      <div className="category-card-body">
                        <div className="section-title">
                          <h2>{c.name}</h2>
                          <span className="category-count">
                            {items.length} pieces
                          </span>
                        </div>
                        <p>
                          {c.description ||
                            "A thoughtful category for your collection."}
                        </p>
                        <div className="category-card-actions">
                          <button type="button" className="text-button"
                            onClick={() => { switchTab("products"); setCategory(c.id); }}>
                            View products <ArrowRight size={14} aria-hidden="true" />
                          </button>
                          <button
                            className="text-button"
                            onClick={() => editCategory(c)}
                          >
                            <Pencil size={14} />
                            Edit category
                          </button>
                          <button
                            className="icon-button danger-text"
                            disabled={busy || items.length > 0}
                            title={
                              items.length
                                ? "Move all products before deleting this category"
                                : "Delete category"
                            }
                            aria-label={`Delete ${c.name}`}
                            onClick={() => {
                              if (
                                window.confirm(`Delete the ${c.name} category?`)
                              )
                                void action(
                                  () => deleteCategory(c.id),
                                  "Category deleted",
                                );
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
              {!loading && !data.categories.length && (
                <div className="empty-state">
                  <Layers size={30} />
                  <h3>Give every piece a place.</h3>
                  <p>Add your first category to organise your products.</p>
                </div>
              )}
            </section>
          )}
          <footer className="workspace-footer">
            <span>© {new Date().getFullYear()} Benua Brutti Sdn. Bhd.</span>
            <span>Thoughtfully crafted in Sabah, Malaysia.</span>
          </footer>
          </>)}
        </div>
      </main>
      {photoImportOpen && (
        <CataloguePhotoImport
          onClose={() => setPhotoImportOpen(false)}
          onDone={async ({ ready, total, attached, skipped }) => {
            await refresh(true);
            setToast(`Upload completed: ${ready}/${total} photos ready · ${attached} newly attached, ${skipped} already linked.`);
          }}
        />
      )}
      {editor && (
        <ProductEditor
          key={editor.id}
          product={editor}
          categories={data.categories}
          orderingEnabled={data.capabilities?.ordering === true}
          onSave={persist}
          onClose={(warning) => { setEditor(null); if (warning) setToast(warning); }}
        />
      )}{" "}
      {catEditor && (
        <Modal
          title={catEditor.name ? "Edit category" : "Add category"}
          onClose={() => !busy && setCatEditor(null)}
        >
          <form className="category-form" onSubmit={submitCategory}>
            <label>
              Category name
              <input
                required
                maxLength={80}
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="e.g. Seating"
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={500}
                rows={3}
                value={catDescription}
                onChange={(e) => setCatDescription(e.target.value)}
                placeholder="What belongs in this collection?"
              />
            </label>
            {actionError && (
              <div className="notice error" role="alert">
                {actionError}
              </div>
            )}
            <div className="button-row justify-end">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setCatEditor(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save category"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Login({
  authenticated,
  onSuccess,
  onCatalog,
  setupError,
}: {
  authenticated: boolean;
  onSuccess: () => Promise<void>;
  onCatalog: () => void;
  setupError: string | null;
}) {
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="access-page">
      <a href="#/catalog" className="brand">
        <img src={publicAssetUrl("/images/brutti-wordmark.svg")} alt="Brutti" className="brutti-official-logo" />
      </a>
      <div className="access-card">
        <ShieldCheck size={25} />
        <span className="eyebrow">THE CATALOG WORKSPACE</span>
        <h1>{authenticated ? "Admin access required" : "Welcome back."}</h1>
        <p className="muted">
          {authenticated
            ? "Your account does not have catalog administrator access. Ask the workspace owner to grant your user access."
            : "Sign in with your Supabase administrator account to manage the collection."}
        </p>
        {setupError && (
          <div className="notice error" role="alert">
            {setupError}
          </div>
        )}
        {authenticated ? (
          <button
            className="button secondary"
            onClick={() => {
              void signOut().catch((e) =>
                setError(e instanceof Error ? e.message : "Sign out failed."),
              );
            }}
          >
            Sign out
          </button>
        ) : (
          <form onSubmit={submit}>
            <label>
              Email
              <input
                autoComplete="username"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={async () => {
              setError(""); setResetSent(false);
              if (!email.trim()) { setError("Enter your email address first."); return; }
              setBusy(true);
              try { await requestPasswordReset(email); setResetSent(true); }
              catch (e) { setError(e instanceof Error ? e.message : "Unable to send reset email."); }
              finally { setBusy(false); }
            }}>Forgot password?</button>
            {resetSent && <p role="status" className="muted">If this account exists, a password reset link has been sent.</p>}
          </form>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="text-button" onClick={onCatalog}>
          Explore the public catalog <ArrowUpRight size={16} />
        </button>
        <p className="tiny muted">
          Access is enforced by Supabase Auth and database policies. Accounts
          cannot grant themselves admin access.
        </p>
      </div>
    </div>
  );
}


function PasswordAccess({ intent, verified, onDone }: { intent: "invite" | "recovery"; verified: boolean; onDone: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try { await completePassword(password); await onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to set password."); }
    finally { setBusy(false); }
  }
  return <div className="access-page">
    <a href="#/catalog" className="brand"><img src={publicAssetUrl("/images/brutti-wordmark.svg")} alt="Brutti" className="brutti-official-logo" /></a>
    <div className="access-card">
      <ShieldCheck size={25} /><span className="eyebrow">THE CATALOG WORKSPACE</span>
      <h1>{intent === "invite" ? "Set your password." : "Reset your password."}</h1>
      <p className="muted">Choose a password for your Supabase account. Administrator access is granted separately by the workspace owner.</p>
      {verified ? <form onSubmit={submit}>
        <label>New password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        <button className="button primary full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form> : <div className="notice error" role="alert">This link is expired or invalid. Request a new link and try again.</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="text-button" disabled={busy} onClick={() => void onDone()}>Back to sign in</button>
    </div>
  </div>;
}
