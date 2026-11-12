import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";
import "./components/admin-workspace.css";
import "./components/admin-enterprise.css";
import "./components/admin-studio.css";
import "./components/admin-products.css";
import "./components/catalog-sidebar.css";
import "./components/catalog-collection.css";
import "./components/catalog-overview-colors.css";
import "./components/catalog-overview-experience.css";
import "./components/category-actions-premium.css";
import "./components/catalog-heritage-overview.css";
import "./components/catalog-login-premium.css";
import "./components/catalog-sidebar-premium.css";
import "./components/catalog-login-reference.css";
import "./components/brutti-staff-login-v2.css";
import "./components/brutti-staff-dashboard-v2.css";
import "./components/brutti-refined-classic.css";
import "./components/brutti-os-modern-2026.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
