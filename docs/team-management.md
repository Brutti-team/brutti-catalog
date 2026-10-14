# Brutti Catalog — staff roles, profiles and audit (review only)

**Status: PR implementation; the role/audit schema is NOT applied to Supabase production or staging.**
**Approved first account:** `integrator.brutti@gmail.com` with existing Auth UUID `b38404cc-fb0a-4877-af13-8b63a765f2cf`.

## User experience

- The existing login continues through Supabase Auth. Every person has a unique user UUID and uses their own credentials.
- **My Profile** is available to an authenticated catalog administrator even before the role migration. It reads identity from Supabase Auth, shows the login email and last sign-in, and supports changing the user's own `full_name` metadata / requesting a password reset. Users cannot change their role or email in this form.
- The signed-in account name and initials are displayed in the sidebar; clicking it opens My Profile. Email alone never implies Super Admin status.
- **Users** becomes available only after the reviewed role RPC is installed and returns `super_admin` for the caller. It lists safe user identity/status fields and changes roles through a server-owned RPC; new invitations are intentionally performed through trusted Supabase Auth instead of exposing an admin secret to the browser.
- **Activity Log** becomes available only after server triggers and role checks are enabled. Entries are written by the database (not by the browser) and show the verified actor email/UUID, object, action and timestamp. Historical edits before activation are not reconstructable.

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
- `public.catalog_activity`: authenticated users have SELECT only with RLS. Triggers write actor data using `auth.uid()` and the server's `auth.users` record; the browser cannot INSERT history.
- Original overly broad `catalog_admins` product/category write policies are replaced with role-aware policies as part of the reviewed **one-time** migration.
- The existing `catalog_admins` membership remains the catalog-login gate and controls Storage uploads. Validate Storage editor permissions before actual activation.

## Migration approval and acceptance

1. Review `supabase/proposals/catalogue-staff-audit.sql` against the LIVE schema. It is a proposal, not an automatic migration. Check role grants, RPC search paths, email bootstrap UUID, Auth, existing policies, Storage handling, other security-advisor warnings and any overlapping catalog proposals.
2. The disposable PostgreSQL suite runs this proposal **locally only** with a synthetic Auth fixture and verifies anonymous role denial, user visibility, blocked self-demotion, blocked Editor promotion and server audit creation.
3. After explicit owner approval, apply via trusted Supabase owner workflow only, then test invited-account login and role read, Profile save, non-admin denial, Editor Draft-only writes, Super Admin role changes, image operations and authentic activity records.
4. Confirm staging functionality and invite/recovery callbacks on the approved GitHub Pages route; do not merge PR #1 or modify `brutti.my` without separate approval.

This feature adds **no public signup role grant, hardcoded browser email authorization or demo audit data**.
