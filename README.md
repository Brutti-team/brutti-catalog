# Brutti Catalog

Production-oriented furniture catalog workspace for **Benua Brutti Sdn. Bhd.**, built with React, Vite and TypeScript. Brutti green, generous spacing and responsive layouts bring the admin workspace and public collection together in one standalone application.

**This project is not yet deployed as a real production catalog.** Changes are confined to `brutti-catalog`; Brutti OS, SEDCO and the existing Brutti website are separate projects.

## What is included

- Admin overview with product, published, draft and category statistics.
- Searchable product table with status/category filters and sorting.
- Product creation, editing, duplication, archiving and deletion; category creation, editing and deletion with assigned-product protection.
- Name, SKU, description, materials, dimensions in centimetres and optional MYR price. Publication and availability are separate: Draft / Published / Archived, and Available / Made to order / Unavailable.
- Multiple image selection, previews, editable image descriptions, cover image ordering and product preview. Up to eight JPEG, PNG or WebP images, each up to 5 MB.
- Public catalog with published product cards, search, category filters, featured products and product detail galleries.
- Mobile navigation, responsive tables and grids, loading, empty and error states.
- Supabase-only product and category persistence, authenticated administration, RLS and image storage integration.

There is no checkout or payment collection. Image resizing/automatic WebP conversion, private draft image storage, advanced roles, bulk imports, password recovery screens and website integration remain future work.

## Run locally

Use **Node.js 22.12 or newer** (Node 24 LTS is recommended) and npm. Start from this existing checkout; each Codex cloud task already has an isolated environment, so an additional worktree is unnecessary unless explicitly requested.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Vite prints the local address, normally `http://localhost:5173`.

Optionally set `VITE_ENQUIRY_EMAIL` in `.env.local` to an approved business contact. Without a valid address, the catalog displays **Enquiries coming soon**. The enquiry action opens the visitor's email application with a `mailto:` draft; the catalog does not submit, deliver or store enquiries. Restart Vite after changing this setting.

| Screen | Local URL |
| --- | --- |
| Admin workspace | `http://localhost:5173/#/admin` |
| Public catalog | `http://localhost:5173/#/catalog` |
| Product detail | `http://localhost:5173/#/product/<product-id>` |

The admin workspace is the default landing page. Use **View catalog** to open the public collection.

## Production-only data model

The Catalog interface uses Supabase only. Demo mode, localStorage product persistence, sample product loading, unsecured demo sign-in, and the Reset Demo action are disabled/removed from the application.

**Current rollout status:** Source code is prepared on `feat/catalog-phase-one`, but it is not deployed or connected to a dedicated Brutti Supabase project yet. Do not claim it is live. The repository's existing `src/data/demo.ts` fixtures (if retained for old tests) are not imported by the production application.

Apply database migrations in order to a **dedicated Brutti** project:
1. `supabase/migrations/202610120001_phase_one_catalog.sql` — Auth/RLS, product/category tables and photo bucket.
2. `supabase/migrations/202610130001_real_catalog_categories.sql` — the seven official Brutti categories and safe validation for incomplete drafts.

Only Brutti staff approved in `catalog_admins` can edit records. Incomplete PDF product details may be saved in Draft with unknown dimensions recorded as zero; publishing requires complete dimensions, description, materials and a real image. Never invent values to publish a draft.

There is no automatic PDF-to-database import. The real 2025 Brutti PDF must be extracted and reviewed (including duplicate names/photo variants), then imported into the dedicated database as Draft with approved images in Storage. Do not seed the eight sample products.

## Configure Supabase

Start with a dedicated development project. A dedicated Brutti project and its administrator must be created/authorized separately. Do not reuse the connected Tumbooh project.

1. Create a dedicated Brutti Catalog Supabase project (development first, then reviewed production) and open its trusted SQL editor.
2. Apply [`supabase/migrations/202610120001_phase_one_catalog.sql`](supabase/migrations/202610120001_phase_one_catalog.sql), then [`supabase/migrations/202610130001_real_catalog_categories.sql`](supabase/migrations/202610130001_real_catalog_categories.sql). Confirm the seven categories are visible before importing actual products.
3. In Supabase Auth, create the intended staff user through the dashboard or a trusted server-side administration tool. Use an email/password account and complete the project's email-confirmation requirements. The frontend provides no self-signup or self-admin route. Disable public signups in project settings unless you need them for another reviewed purpose.
4. Copy the user's **UUID** from the Auth dashboard. As the trusted database owner, grant that existing account membership:

   ```sql
   -- Replace the placeholder with the existing staff user's UUID.
   insert into public.catalog_admins (user_id)
   values ('REPLACE-WITH-STAFF-USER-UUID'::uuid)
   on conflict (user_id) do nothing;
   ```

5. Set the project's URL and **public anon client key** in `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-PUBLIC-ANON-KEY
   ```

6. Restart Vite after changing variables. Visit `/#/admin` and sign in with the staff account. Use the seven preloaded categories, create a real product in Draft, upload real photos, verify all details and then publish. A newly configured database is intentionally empty.

`VITE_` variables are embedded in the browser bundle. **Never put a service-role key, Supabase secret key, database password or other private credential in them.** Store deployment environment values through the approved hosting provider's settings. `.env.local` is ignored by Git.

Configured mode uses real Supabase Auth and RLS rather than demo login. The app checks `catalog_admins` membership for the workspace, and the database independently enforces all writes. Signing in alone does not grant admin access. An invalid or failing configured backend displays errors; it does not silently substitute demo data.

Remove a user's catalog access using trusted SQL:

```sql
delete from public.catalog_admins
where user_id = 'REPLACE-WITH-STAFF-USER-UUID'::uuid;
```

Changes are checked by the database on subsequent operations. For staff offboarding, also follow the project's account/session revocation process.

## Database and image access

The migration creates `categories`, `products`, `catalog_admins`, publication/availability enums, image metadata validation, a server-controlled `updated_at` trigger and indexes. SKU and category-name uniqueness are case-insensitive. A category assigned to any product cannot be deleted. Published products require a description, materials and at least one image; all products require a name, SKU, category and positive dimensions. Optional prices must be nonnegative.

- Anonymous and signed-in non-admin users can read categories and **published products only**.
- Listed catalog administrators can manage all products and categories. Membership is managed only through a trusted database connection; accounts cannot add themselves.
- `is_catalog_admin()` uses `SECURITY DEFINER`, an empty `search_path`, qualified references and restricted execution privileges to avoid recursive membership policies.
- Images use the `product-images` bucket, with 5 MB and JPEG/PNG/WebP restrictions. Uploads require admin membership and use the signed-in user's UUID as the path prefix. Other image writes also require admin membership.

**The image bucket is public.** Anyone with a public asset URL can download that photo, including photos attached to draft or archived products. Storage metadata/listing policies expose only published references to non-admin users, but public download URLs bypass those policies. Removing or archiving a product does not make its photos private, and previously delivered copies may remain in browser/CDN caches. Use only photos intended for public distribution. Confidential draft photos require a separate private-bucket/signed-URL design before production use.

Uploads happen before product saving. Cancelling an editor, removing an image or deleting a product can leave unused files in the bucket. No automatic destructive cleanup runs; administrators can review and remove unused files through Supabase Storage. Do not remove files still referenced by another product.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The production build is written to `dist/`. These commands validate the frontend without requiring Supabase credentials.

Earlier browser tests may still refer to demo fixtures and must be updated before production release. Browser tests use Playwright. Install Chromium if it is not already available, then run:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser suite starts a demo server on port 5190 and a separately configured test server on port 5191. Its configured-mode sign-in check intercepts API rejection responses; it does not verify a real Supabase project. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a custom Chromium executable if needed.

Database constraint and role-policy checks are included separately. With Docker available, run:

```sh
npm run test:db
# Or: sh supabase/tests/check-schema.sh
```

This starts a disposable PostgreSQL 17 container with **no published ports or external network**, creates minimal mock Supabase platform schemas, applies the migration and checks anonymous/member/admin access, denied self-promotion, publication constraints, duplicate SKUs, category references and image upload policies. It removes the container afterwards. The mock schemas are only for this harness; **do not apply `mock_platform.sql` to Supabase**.

For a local Supabase stack, use a trusted local database connection to run `supabase/tests/catalog_rls.sql` after the migration; its fixture transaction rolls back. Never run these fixture checks against a production project. The isolated PostgreSQL checks do not exercise Supabase's HTTP APIs, actual email/password sessions, MIME enforcement or public-download caching. Verify those behaviors in the configured development project before approving production use.

## Hosting and next steps

The current application uses **hash routing** so catalog detail URLs survive reloads on ordinary static hosting. Serve `dist/` with HTTPS and the intended environment variables supplied at build time. If changing to clean `/admin`, `/catalog` or `/product/...` paths, configure an SPA fallback that serves `index.html` for application routes, while preserving real asset paths. Hosting under a subdirectory also requires reviewing Vite's `base` and asset paths; the default targets a standalone site root.

Before production: supply a reviewed Supabase project, apply the migration, create staff accounts and memberships, validate real Auth/RLS/Storage access, curate actual products/photos, review privacy and asset caching, and decide hosting plus website integration. Add monitoring, backup and recovery procedures appropriate to the chosen project. Integration with `brutti.my/admin` or `brutti.my/catalog` is a separate change requiring approval.

**Do not deploy or merge without approval.** No deployment, merge or changes to other Brutti repositories are part of Phase 1.

© Benua Brutti Sdn. Bhd.
