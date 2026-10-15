import { Component, type ReactNode } from "react";
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="access-page">
          <div className="access-card">
            <span className="eyebrow">BRUTTI CATALOG</span>
            <h1>Something needs a little care.</h1>
            <p className="muted">
              The catalog could not be displayed. Your saved data has not been
              reset. Reload the page to try again, or check the setup guide.
            </p>
            <button
              className="button primary full"
              onClick={() => window.location.reload()}
              style={{ marginTop: 24 }}
            >
              Reload catalog
            </button>
          </div>
        </main>
      );
    return this.props.children;
  }
}
