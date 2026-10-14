# Brutti Catalog — profiles, live activity history and proposed staff roles

**Status (14 October 2026): the additive Activity Log migration is APPLIED to Brutti Catalog Supabase. The separate Super Admin/Admin/Editor role migration remains PROPOSED and is NOT applied.**
**Approved first account:** `integrator.brutti@gmail.com` with existing Auth UUID `b38404cc-fb0a-4877-af13-8b63a765f2cf`.

## User experience

- The existing login continues through Supabase Auth. Every person has a unique user UUID and uses their own credentials.
- **My Profile** is available to an authenticated catalog administrator even before the role migration. It reads identity from Supabase Auth, shows the login email and last sign-in, and supports changing the user's own `full_name` metadata / requesting a password reset. Users cannot change their role or email in this form.
- The signed-in account name, initials and role appear in the top-right header beside the catalog and appearance controls; clicking the profile opens the existing My Profile view. My Profile is deliberately removed from sidebar navigation to avoid duplication. Sign out is available in the header. Email alone never implies Super Admin status.
- Admin appearance supports Light and Dark modes through the header toggle. An explicit choice is saved only in this browser's `brutti-catalog-admin-theme` localStorage entry. With no valid saved choice, the workspace follows the system preference on first load. If preference storage is unavailable, switching still works for the current session. Theme styles are scoped to the admin and its editors/account surfaces; public catalog styling stays independent.
- **Users** becomes available only after the reviewed role RPC is installed and returns `super_admin` for the caller. It lists safe user identity/status fields and changes roles through a server-owned RPC; new invitations are intentionally performed through trusted Supabase Auth instead of exposing an admin secret to the browser.
- **Activity Log** is available to approved `catalog_admins` members without requiring the future role migration. Server-owned product/category triggers capture the verified actor email/UUID, item, action and timestamp. The compact sidebar **Last Change** shows the newest record in Malaysia time (MYT), with a link to complete recent history. Historical edits before activation cannot be reconstructed. Historical edits before activation are not reconstructable.

## Proposed permissions (enforced by database policies)

| Role | Profile | Products | Categories | Staff roles | Activity |
| --- | --- | --- | --- | --- | --- |
| Super Admin | Own | CRUD + publish | Manage | Invite via Dashboard, assign/revoke approved user roles | All |
| Admin | Own | CRUD + publish | Manage | No access changes | All |
| Editor | Own | Read public, create/edit Draft only | Read | No access changes | Own entries |
| No role | Auth account exists, no catalog access | Public published only | Public read | None | None |

A user does not receive staff privileges simply by registering or having a matching email. The bootstrap SQL verifies **both** the previously invited UUID and email before granting the first Super Admin role.

## Security model

- `public.catalog_staff_roles`: table grants revoked from browser roles; staff roles are read through a controlled `catalog_my_role()` function and assigned through `catalog_set_staff_role()` (Super Admin only, no self-edits).
- `public.catalog_list_staff()`: only a server-verified Super Admin can list invited account email, display name, role and last sign-in. No password hashes, sessions or tokens are exposed.
- `public.catalog_activity`: **already deployed** with RLS. Only approved catalog administrators can SELECT. Server triggers write audit records using `auth.uid()` and `auth.users`; browser roles cannot INSERT, UPDATE or DELETE history. Production checks verified two triggers, RLS enabled, anonymous SELECT denied and zero historical records before first new action.
- Original overly broad `catalog_admins` product/category write policies are replaced with role-aware policies as part of the reviewed **one-time** migration.
- The existing `catalog_admins` membership remains the catalog-login gate and controls Storage uploads. Validate Storage editor permissions before actual activation.

## Migration approval and acceptance

1. Activity history is live via `supabase/migrations/202610140001_catalog_activity.sql`. Review the **separate** future staff role proposal at `supabase/proposals/catalogue-staff-audit.sql` against the LIVE schema. It is a proposal, not an automatic migration. Check role grants, RPC search paths, email bootstrap UUID, Auth, existing policies, Storage handling, other security-advisor warnings and any overlapping catalog proposals.
2. The disposable PostgreSQL suite tests both the applied audit migration and the future staff role proposal locally with synthetic Auth users. It checks real trigger-generated events, blocked forged history, anonymous role denial, user visibility, blocked self-demotion and blocked Editor promotion.
3. Staff role proposal requires separate explicit owner approval and role/RLS regression testing before applying. Do not replay the already applied Activity Log migration or assume the initial administrator is a Super Admin until the role migration is approved.
4. Confirm staging functionality and invite/recovery callbacks on the approved GitHub Pages route; do not merge PR #1 or modify `brutti.my` without separate approval.

This feature adds **no public signup role grant, hardcoded browser email authorization or demo audit data**.
