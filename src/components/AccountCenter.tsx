import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, Save, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import {
  getAccountSummary, initials, listCatalogActivity, listCatalogStaff,
  roleLabel, updateOwnDisplayName, updateStaffRole,
  type AccountSummary, type ActivityEntry, type StaffMember, type StaffRole,
} from "../lib/account-center";
import { requestPasswordReset } from "../lib/catalog";
import "./account-center.css";

type View = "profile" | "users" | "activity";

const roleOptions: { value: StaffRole | "none"; title: string }[] = [
  { value: "super_admin", title: "Super Admin" },
  { value: "admin", title: "Admin" },
  { value: "editor", title: "Editor" },
  { value: "none", title: "No access" },
];

function dateText(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown"
    : new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(date) + " MYT";
}
function actionText(event: ActivityEntry): string {
  return event.action.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export default function AccountCenter({
  view, onProfileChanged,
}: {
  view: View;
  onProfileChanged?: (displayName: string) => void;
}) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<ActivityEntry[]>([]);
  const [draftRoles, setDraftRoles] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setPending(true); setError(""); setMessage("");
    try {
      const current = await getAccountSummary();
      setAccount(current);
      setDisplayName(current.displayName);
      if (view === "users") {
        setMembers(await listCatalogStaff());
        setDraftRoles({});
      } else if (view === "activity") {
        setEvents(await listCatalogActivity());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load this page.");
    } finally {
      setPending(false);
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("profile"); setError(""); setMessage("");
    try {
      const saved = await updateOwnDisplayName(displayName);
      setDisplayName(saved);
      setAccount(prev => prev ? { ...prev, displayName: saved } : prev);
      onProfileChanged?.(saved);
      setMessage("Your profile has been updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save your profile.");
    } finally { setBusyId(null); }
  }

  async function sendReset() {
    if (!account) return;
    setBusyId("reset"); setError(""); setMessage("");
    try {
      await requestPasswordReset(account.email);
      setMessage("If email delivery is available, a password reset link will arrive in your inbox.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request a password reset.");
    } finally { setBusyId(null); }
  }

  async function saveMember(user: StaffMember) {
    const requested = draftRoles[user.user_id] ?? (user.role ?? "none");
    const role = requested === "none" ? null : requested as StaffRole;
    if (!window.confirm(`Change access for ${user.email} to ${role ? roleLabel(role) : "No access"}?`)) return;
    setBusyId(user.user_id); setError(""); setMessage("");
    try {
      await updateStaffRole(user.user_id, role);
      setMembers(await listCatalogStaff());
      setDraftRoles({});
      setMessage(`Access updated for ${user.email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update access.");
    } finally { setBusyId(null); }
  }

  return (
    <section className="account-center">
      <div className="account-heading">
        <div>
          <span className="eyebrow">YOUR BRUTTI WORKSPACE</span>
          <h1>{view === "profile" ? "My profile." : view === "users" ? "Your people." : "Activity history."}</h1>
          <p>{view === "profile"
            ? "Your name, account and access in one simple place."
            : view === "users"
              ? "Manage who can work on the catalog. Every person signs in with their own account."
              : "A trustworthy record of changes made by your team."}</p>
        </div>
        <button type="button" className="button secondary" disabled={pending || busyId !== null} onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      {error && <div className="notice error" role="alert"><AlertCircle size={18} /> {error}</div>}
      {message && <div className="account-success" role="status"><CheckCircle2 size={17} /> {message}</div>}
      {pending && <p className="account-muted" role="status">Loading your workspace…</p>}
      {view === "profile" && account && !pending && (
        <div className="account-cards">
          <div className="account-identity">
            <div className="account-initials">{initials(account.displayName)}</div>
            <div className="account-identity-body">
              <h2>{account.displayName}</h2>
              <p>{account.email}</p>
              <span className="account-role"><ShieldCheck size={15} /> {roleLabel(account.role)}</span>
            </div>
          </div>
          <form className="account-settings" onSubmit={(e) => { void saveProfile(e); }}>
            <h3>Personal details</h3>
            <label htmlFor="account-name">Display name</label>
            <input id="account-name" autoComplete="name" maxLength={80} minLength={2} required
              value={displayName} onChange={e => setDisplayName(e.target.value)} />
            <label htmlFor="account-email">Login email</label>
            <input id="account-email" value={account.email} readOnly aria-describedby="account-email-hint" />
            <p id="account-email-hint" className="account-hint">Your login email is managed securely through Supabase Auth.</p>
            <div className="account-profile-actions">
              <button className="button primary" disabled={busyId !== null}><Save size={16} /> Save profile</button>
              <button type="button" className="button secondary" onClick={() => void sendReset()} disabled={busyId !== null}>Reset password</button>
            </div>
          </form>
          <div className="account-mini">
            <Clock3 size={19} />
            <div><strong>Last sign in</strong><p>{dateText(account.lastSignIn)}</p></div>
          </div>
        </div>
      )}
      {view === "users" && !pending && account && (
        account.role !== "super_admin" || !account.managementReady
          ? <div className="account-empty"><ShieldCheck size={28} /><h2>Super Admin only</h2>
              <p>Secure team management will be available after the reviewed role migration is approved and installed.</p></div>
          : <div className="account-table-wrap">
              <div className="account-table-title"><UsersRound size={19} /><strong>Catalog users</strong><span>{members.length}</span></div>
              <p className="account-hint account-table-hint">Invite new people through Supabase Authentication first. You can then assign their catalog role here. Never share passwords.</p>
              <div className="account-scroll"><table className="account-table">
                <thead><tr><th>Person</th><th>Last login</th><th>Access</th><th /></tr></thead>
                <tbody>{members.map(user => {
                  const draft = draftRoles[user.user_id] ?? user.role ?? "none";
                  return <tr key={user.user_id}>
                    <td><strong>{user.display_name || user.email.split("@")[0]}</strong><span>{user.email}</span>
                    {account.id === user.user_id && <small>Your account</small>}</td>
                    <td>{dateText(user.last_sign_in_at)}</td>
                    <td><select aria-label={`Role for ${user.email}`} value={draft}
                      disabled={account.id === user.user_id || busyId !== null}
                      onChange={e => setDraftRoles(prev => ({ ...prev, [user.user_id]: e.target.value }))}>
                      {roleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.title}</option>)}
                    </select></td>
                    <td><button type="button" className="button secondary"
                      disabled={account.id === user.user_id || busyId !== null || draft === (user.role || "none")}
                      onClick={() => void saveMember(user)}>Save</button></td>
                  </tr>;
                })}</tbody>
              </table></div>
              {!members.length && <p className="account-muted">No invited users found.</p>}
            </div>
      )}
      {view === "activity" && !pending && account && (
          <div className="account-table-wrap">
              <div className="account-table-title"><Clock3 size={19}/><strong>Recent changes</strong><span>{events.length}</span></div>
              {!events.length ? <div className="account-empty"><Clock3 size={24}/><p>No activity has been recorded yet.</p></div> : (
              <div className="account-timeline">{events.map(item => <div className="account-event" key={item.id}>
                <div className="account-event-dot" /><div className="account-event-main">
                  <strong>{actionText(item)}</strong><span>{item.resource_name || item.resource_type}</span>
                  <p>By {item.actor_email || "System"} · {dateText(item.created_at)}</p>
                </div>
              </div>)}</div>)}
            </div>
      )}
      <div className="account-privacy"><UserRound size={15} /> Every session is connected to a unique Supabase user ID. Activity actors are written by database triggers, not by the browser.</div>
    </section>
  );
}
