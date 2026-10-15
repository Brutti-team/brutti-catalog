import type { User } from "@supabase/supabase-js";
import { catalogClient, getAuthState } from "./catalog";

export type StaffRole = "super_admin" | "admin" | "editor";
export type AccountSummary = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole | null;
  managementReady: boolean;
  lastSignIn: string | null;
};
export type StaffMember = {
  user_id: string;
  email: string;
  display_name: string;
  role: StaffRole | null;
  last_sign_in_at: string | null;
};
export type ActivityEntry = {
  id: string;
  actor_id: string | null;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_name: string;
  created_at: string;
};

const allowedRoles: StaffRole[] = ["super_admin", "admin", "editor"];

export function isStaffRole(input: unknown): input is StaffRole {
  return typeof input === "string" && allowedRoles.includes(input as StaffRole);
}
export function safeDisplayName(user: Pick<User, "email" | "user_metadata">): string {
  const candidate = user.user_metadata?.full_name;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim().slice(0, 80) : (user.email?.split("@")[0] || "Staff");
}
export function roleLabel(role: StaffRole | null): string {
  return role === "super_admin" ? "Super Admin"
    : role === "editor" ? "Editor"
    : role === "admin" ? "Admin" : "Catalog administrator";
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] || "B").slice(0, 2)).toUpperCase();
}
function isUnavailableFeature(code?: string): boolean {
  return code === "PGRST202" || code === "42883";
}

/** Role is read from server permission tables, never inferred from email. */
export async function getAccountSummary(): Promise<AccountSummary> {
  const db = catalogClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new Error("Please sign in again to view your profile.");
  const { data: result, error: roleError } = await db.rpc("catalog_my_role");
  if (roleError && !isUnavailableFeature(roleError.code))
    throw new Error(`Unable to verify staff permissions: ${roleError.message}`);
  return {
    id: user.id,
    email: user.email || "",
    displayName: safeDisplayName(user),
    role: !roleError && isStaffRole(result) ? result : null,
    managementReady: !roleError,
    lastSignIn: user.last_sign_in_at || null,
  };
}

/** Only the owner's own Auth metadata can be edited from this client. */
export async function updateOwnDisplayName(name: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 80)
    throw new Error("Display name must be between 2 and 80 characters.");
  const db = catalogClient();
  const { data: { user }, error: sessionError } = await db.auth.getUser();
  if (sessionError || !user) throw new Error("Your session has expired. Sign in again.");
  const { error } = await db.auth.updateUser({ data: { full_name: clean } });
  if (error) throw new Error(error.message);
  return clean;
}

export async function listCatalogStaff(): Promise<StaffMember[]> {
  const account = await getAccountSummary();
  if (!account.managementReady || account.role !== "super_admin")
    throw new Error("Super Admin access is required.");
  const { data, error } = await catalogClient().rpc("catalog_list_staff");
  if (error) throw new Error(error.message);
  return (data || []) as StaffMember[];
}
export async function updateStaffRole(userId: string, role: StaffRole | null): Promise<void> {
  const account = await getAccountSummary();
  if (!account.managementReady || account.role !== "super_admin")
    throw new Error("Super Admin access is required.");
  if (account.id === userId) throw new Error("You cannot change your own role.");
  if (role !== null && !isStaffRole(role)) throw new Error("Invalid role.");
  const { error } = await catalogClient().rpc("catalog_set_staff_role", {
    p_user_id: userId, p_role: role,
  });
  if (error) throw new Error(error.message);
}
/** Latest persisted server audit record, not a guessed products.updated_at timestamp. */
export async function getLatestCatalogActivity(): Promise<ActivityEntry | null> {
  const access = await getAuthState();
  if (!access.authenticated || !access.isAdmin)
    throw new Error("An approved catalog administrator is required to view activity.");
  const { data, error } = await catalogClient()
    .from("catalog_activity")
    .select("id,actor_id,actor_email,action,resource_type,resource_name,created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as ActivityEntry | undefined) ?? null;
}

export async function listCatalogActivity(): Promise<ActivityEntry[]> {
  const access = await getAuthState();
  if (!access.authenticated || !access.isAdmin)
    throw new Error("An approved catalog administrator is required to view activity.");
  const { data, error } = await catalogClient()
    .from("catalog_activity")
    .select("id,actor_id,actor_email,action,resource_type,resource_name,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data || []) as ActivityEntry[];
}
