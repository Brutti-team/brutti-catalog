import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, History } from "lucide-react";
import { getLatestCatalogActivity, type ActivityEntry, type StaffRole } from "../lib/account-center";
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
  managementReady,
  role,
  refreshKey,
  onHistory,
}: {
  authenticated: boolean;
  managementReady: boolean;
  role: StaffRole | null;
  refreshKey: CatalogData;
  onHistory: () => void;
}) {
  const [latest, setLatest] = useState<ActivityEntry | null>(null);
  const [status, setStatus] = useState<RecordStatus>("not-enabled");

  useEffect(() => {
    let mounted = true;
    if (!authenticated || !managementReady || !role) return;
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
  }, [authenticated, managementReady, role, refreshKey]);

  const canRead = authenticated && managementReady && Boolean(role);
  const visibleStatus = canRead ? status === "not-enabled" ? "loading" : status : "not-enabled";

  return (
    <section className="sidebar-last-change" aria-label="Latest catalog change">
      <div className="last-change-heading">
        <span className="last-change-icon"><History size={15} aria-hidden="true" /></span>
        <span>LAST CHANGE</span>
      </div>
      {visibleStatus === "ready" && latest ? (
        <div className="last-change-details">
          <strong title={activityLabel(latest)}>{activityLabel(latest)}</strong>
          <p title={latest.resource_name || latest.resource_type}>
            {latest.resource_name || latest.resource_type}
          </p>
          <span className="last-change-by" title={latest.actor_email}>
            By {latest.actor_email || "System"}
          </span>
          <time dateTime={latest.created_at}>
            <Clock3 size={12} aria-hidden="true" /> {formatActivityTime(latest.created_at)}
          </time>
        </div>
      ) : (
        <p className="last-change-placeholder" role="status">
          {visibleStatus === "loading" ? "Checking latest changes…"
            : visibleStatus === "empty" ? "No changes recorded yet."
              : visibleStatus === "error" ? "Activity history is temporarily unavailable."
                : "Recording will start once Activity Log is enabled."}
        </p>
      )}
      {canRead && <button type="button" className="last-change-link" onClick={onHistory}>
        View history <ArrowUpRight size={13} aria-hidden="true" />
      </button>}
    </section>
  );
}
