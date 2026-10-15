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
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
