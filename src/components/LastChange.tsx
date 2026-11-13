import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, History } from "lucide-react";
import { getLatestCatalogActivity, type ActivityEntry } from "../lib/account-center";
import type { CatalogData } from "../lib/types";

type RecordStatus = "not-enabled" | "loading" | "ready" | "empty" | "error";

/** Dates are always shown in Brutti's local Malaysia time zone. */
export function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)} MYT`;
}

export function activityLabel(event: Pick<ActivityEntry, "action" | "resource_type">): string {
  const translated: Record<string, string> = {
    products_created: "Product added",
    products_updated: "Product edited",
    products_deleted: "Product deleted",
    categories_created: "Category added",
    categories_updated: "Category edited",
    categories_deleted: "Category deleted",
    product_published: "Product published",
    product_draft: "Product moved to draft",
    product_archived: "Product archived",
    staff_role_changed: "Staff access changed",
    staff_access_revoked: "Staff access removed",
  };
  return translated[event.action] ?? event.action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function LastChange({
  authenticated,
  refreshKey,
  onHistory,
}: {
  authenticated: boolean;
  refreshKey: CatalogData;
  onHistory: () => void;
}) {
  const [latest, setLatest] = useState<ActivityEntry | null>(null);
  const [status, setStatus] = useState<RecordStatus>("not-enabled");

  useEffect(() => {
    let mounted = true;
    if (!authenticated) return;
    // Do not fabricate actor/time from product timestamps while audit is absent.
    void getLatestCatalogActivity().then(record => {
      if (!mounted) return;
      setLatest(record);
      setStatus(record ? "ready" : "empty");
    }).catch(() => {
      if (!mounted) return;
      setLatest(null);
      setStatus("error");
    });
    return () => { mounted = false; };
  }, [authenticated, refreshKey]);

  const canRead = authenticated;
  const visibleStatus = authenticated ? (status === "not-enabled" ? "loading" : status) : "not-enabled";

  return (
    <section className="catalog-last-activity" aria-label="Latest catalog change">
      <div className="catalog-last-activity-heading">
        <span className="catalog-last-activity-icon"><History size={18} aria-hidden="true" /></span>
        <div>
          <span className="catalog-last-activity-kicker">ACTIVITY SNAPSHOT</span>
          <h2>Latest change</h2>
        </div>
      </div>
      {visibleStatus === "ready" && latest ? (
        <div className="catalog-last-activity-details">
          <strong title={activityLabel(latest)}>{activityLabel(latest)}</strong>
          <span className="catalog-last-activity-resource" title={latest.resource_name || latest.resource_type}>
            {latest.resource_name || latest.resource_type}
          </span>
          <span className="catalog-last-activity-meta">
            <span title={latest.actor_email}>By {latest.actor_email || "System"}</span>
            <span className="catalog-last-activity-separator" aria-hidden="true">·</span>
            <time dateTime={latest.created_at}>
              <Clock3 size={13} aria-hidden="true" /> {formatActivityTime(latest.created_at)}
            </time>
          </span>
        </div>
      ) : (
        <p className="catalog-last-activity-placeholder">
          {visibleStatus === "loading" ? "Checking latest changes…"
            : visibleStatus === "empty" ? "No changes recorded yet."
              : visibleStatus === "error" ? "Activity history is temporarily unavailable."
                : "Recording will start after your administrator account is verified."}
        </p>
      )}
      {canRead && <button type="button" className="catalog-last-activity-action" onClick={onHistory}>
        View activity log <ArrowUpRight size={15} aria-hidden="true" />
      </button>}
    </section>
  );
}
