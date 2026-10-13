# Brutti Catalog

The existing React, Vite and TypeScript catalog for **Benua Brutti Sdn. Bhd.** The dashboard and public catalog design are preserved. The application uses Supabase only, with no demo login, sample-product fallback or browser-only product persistence.

**Live public reads are verified; authenticated production acceptance and real product import are pending. Nothing has been deployed.** Work remains on `feat/catalog-phase-one` and draft PR #1; changes are limited to this repository.

## Existing backend — do not recreate it

Use the existing Benua Brutti project **`lgdjoxafleqnbomtfzqt`**, URL **`https://lgdjoxafleqnbomtfzqt.supabase.co`**.

The owner reports that `phase_one_brutti_catalog_secure_schema` and `real_brutti_categories_and_draft_validation` are already applied. Read-only checks on 13 October 2026 confirmed the seven categories, working public product reads (zero anonymous-visible products), expected baseline columns and restricted administrator membership reads. The owner confirms the first administrator still needs to be created. Full schema/RLS and bucket configuration still require owner SQL inspection; restricted public bucket metadata does not prove a missing bucket. **Do not create another project or blindly rerun these migrations.**

Live probes found `price_basis`, `display_order`, the import ledger and the optional capability RPC absent from the exposed schema. Two additive proposals are prepared and tested locally, but **neither has been applied to production**. Schema changes, administrator provisioning, imports and live write tests require explicit approval.

Official categories: Racks & Shelves; Tables & Kitchen Counters; Displays & Panels; Beds & Bunk Beds; Reception Counters; Displays & Mementos; Rentals.

## Local development and secure configuration

Use Node 24 LTS (minimum 22.12), npm and the existing checkout; no extra worktree is needed.

```sh
npm ci --cache .npm-cache --no-audit --no-fund
cp .env.example .env.local
# Enter the PUBLIC Supabase client key securely, then:
npm run dev -- --port 5173 --strictPort
```

Set `VITE_SUPABASE_URL` to the existing project URL. Set **either** `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY` to its public browser key from Supabase project settings. Cloud environments can inject these variables through environment settings instead of a local file. Restart Vite after changes; hosted builds also need the variables at build time.

All `VITE_` variables are public in the browser bundle. Never provide a service-role key, `sb_secret_` key, database password or other private credential. Build-time and browser guards reject privileged/malformed keys; RLS remains the security boundary. `.env.local` is ignored by Git. Missing configuration/backend failures show an error, never invented data. The current cloud URL/public-key bindings have already passed real reads; GitHub Actions bindings are separate settings.

Routes during review: `/admin/`, `/catalog/`, `/#/admin`, `/#/catalog`, `/#/product/<id>` and `/#/catalog/product/<id>`. Static entry files and refreshed product hash routes are tested. `npm run build:pages` prepares the existing `/brutti-catalog/` base. `npm run build:site` prepares an additive website artifact with `/admin/`, `/catalog/` and `/catalog-assets/`; [docs/website-integration.md](docs/website-integration.md) explains review assembly. These builds do not change the live `brutti.my` website.

Optionally configure `VITE_ENQUIRY_EMAIL` to an approved business email. Without it, enquiries are disabled. The action opens a mailto draft; there is no server-side email delivery or checkout.

## Inspect before schema changes or importing

With public environment values present:

```sh
node --env-file=.env.local scripts/inspect-backend.mjs
# If variables are already injected, omit --env-file.
npm run verify:live -- --output docs/live-verification.json.local
```

This performs **read-only** public REST/OpenAPI requests, checks the official category names and checks for leaked unpublished records. Public reads cannot establish total product/admin counts, full policies or bucket configuration. If OpenAPI inspection is disabled, use the owner SQL inspection rather than assuming the schema.

Run [supabase/inspection/current-schema.sql](supabase/inspection/current-schema.sql) in the existing project's trusted SQL editor. It is a read-only transaction that reports columns, constraints, RLS, policies, the admin-check function, categories, counts and the product bucket. Review those structural results before considering additions. No application/startup/CI script applies SQL to production.

## Invite the first administrator

1. Obtain approval for the actual authorized staff email and account provisioning. Public Auth settings currently report signup enabled with email confirmation required; owner review is needed to disable public signups unless separately approved. Configure email delivery, confirmation/password policy, Site URL and exact allowed redirect URLs for the approved catalog host. For local root review, recovery uses `http://localhost:5173/?auth=recovery`. When entering `/admin/`, recovery uses that same pathname plus `?auth=recovery`. Do not point production emails at an unapproved host.
2. Use the trusted **Supabase Dashboard → Authentication → Users → Invite user** flow. The invitation destination must load the catalog entry so its SDK receives the invite token fragment. For future combined hosting, use the approved `https://brutti.my/admin/?auth=invite`, not the website root. For the separate Pages host, use its `/brutti-catalog/admin/?auth=invite` entry only after that build is approved and deployed. If a custom redirect is needed, use Supabase's trusted server-side `inviteUserByEmail` with the approved `redirectTo`. Private admin keys stay exclusively in that trusted server, never this frontend.
3. Copy the invited user's UUID from Authentication. In the project's trusted SQL editor, grant membership to that existing user:

   ```sql
   insert into public.catalog_admins (user_id)
   values ('REPLACE-WITH-INVITED-USER-UUID'::uuid)
   on conflict (user_id) do nothing;
   ```

4. The staff member opens their personal invitation link and sets their own password. No default password is supplied. Invite/recovery completion requires a successful matching SDK callback session and server-side `getUser()` verification; an expired link cannot reuse an unrelated cached session. Afterward, verify sign-in and sign-out. A signed-in account without `catalog_admins` membership receives **Admin access required**.
5. **Forgot password?** sends a Supabase recovery email without revealing account existence. Configure redirect allowlists/SMTP and test actual delivery before launch. The completion screen uses existing access-card styling. Current callbacks support Supabase's default implicit token-fragment flow; a custom PKCE/code-only email integration would need a separate reviewed callback implementation.

The database independently enforces admin writes. To revoke catalog membership, delete that user's `catalog_admins` row through trusted SQL and follow the project's session/account offboarding process. Revocation applies to subsequent database operations; do not rely on hiding UI controls as security.

## Product and image management

Overview statistics, product/category CRUD, duplicate, archive, delete, search/filter/sort, image uploads/order/removal/previews and Draft/Published/Archived controls use database records. Unknown dimensions are zero for Draft only; publishing requires verified positive dimensions, a description, materials and at least one image. Unknown price stays null. Materials and finishing share the existing materials field; imports preserve an explicit `Finishing:` label without changing the editor layout.

Photos use `product-images`, up to eight JPEG/PNG/WebP sources, each at most 20 MB, 40 megapixels and 16,384 pixels per edge. The browser checks actual file bytes, handles EXIF orientation, preserves transparency and converts to WebP at quality 85 with a maximum 1,800-pixel edge. Output must be genuine WebP and at most 5 MB. Uploads require a verified admin and a user UUID path prefix; they never overwrite objects. Successful photos append to current editor state, preserving concurrent edits/removals. Save is disabled during upload. Partial failures retain successful uploads for review. Replace a photo by adding the replacement, moving it to the desired position/cover and removing the old reference, then save.

**The expected bucket is public; live configuration needs owner verification.** Public Draft/Archived photo URLs are downloadable if known. Only upload photos intended for public distribution. The reviewed management proposal enables guarded cleanup after replacement/deletion and for newly uploaded photos removed before Save or discarded. It checks admin authorization and all product references, including shared duplicate photos; transaction locks and restrictive Storage policies protect concurrent references. No Storage metadata is deleted directly through SQL. Without the reviewed server capability, or after network/authorization loss, cleanup fails closed and shows a warning where possible. An interrupted browser can still leave unused files for owner review.

Public pages render Published products only. Realtime notifications trigger fresh RLS-filtered reads, never payload merging, and the existing 30-second visible-tab polling/visibility refresh remains a fallback. The management proposal adds only products/categories to an already-existing Realtime publication. Without that addition or with a disconnected socket, polling still works. Publishing needs no frontend deployment. Stale overlapping responses cannot overwrite a newer refresh. Optional display order is enabled only when the server advertises support; its field clearly indicates unavailable setup on the current backend.

## Actual 104-page PDF import

The real **Brutti Catalogue 2025.pdf has not been supplied to this checkout**. No actual products or photographs have been extracted/imported. [docs/catalogue-import.md](docs/catalogue-import.md) explains the prepared extractor, evidence review, manifest validation and insert-only Draft importer.

The importer is offline-validation-only by default. Write mode needs a reviewed real manifest, inspected/approved additional schema, an authenticated approved administrator and verified photo bytes. A durable ledger prevents repeated imports from overwriting staff edits or recreating staff-deleted products. The proposed SQL is [supabase/proposals/catalogue-import.sql](supabase/proposals/catalogue-import.sql), **not an applied migration**. It adds accurate starting-price semantics and import provenance; do not apply it before inspecting the existing database.

Generate the offline HTML preview with `node scripts/preview-catalogue.mjs catalogue-review.local/manifest.json catalogue-preview.local`. It labels unknown facts, displays source evidence and reports validation/duplicates without writes. Obtain explicit approval for the concrete reviewed preview before importing; manifest flags are not permission. [supabase/proposals/catalogue-management.sql](supabase/proposals/catalogue-management.sql) separately prepares ordering, guarded cleanup and Realtime support without inserting products or recreating categories.

The frontend remains compatible with the reported existing schema: it sends no new price column for existing records until the column is returned by the database. With the reviewed addition installed, imported starting prices display **Starting from RM…** in the existing cards/details/preview and survive staff edits. No fixed price is inferred from a starting price.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:pages
npm run build:site
npm run build:configured
npm run test:e2e
npm run test:db
```

Playwright uses an intercepted test backend on port 5190, no demo mode and **no live production writes**. Install Chromium with `npx playwright install chromium` if `/usr/bin/chromium` is unavailable, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Checks include admin denial, expired/invite/recovery callbacks, Draft creation, product editing, upload race regression, publishing/archiving/public filters and desktop/mobile/landscape overflow. Browser screenshots are generated under ignored `test-results/`; they show test fixtures, not imported Brutti products.

The database suite runs both existing migrations and both pending proposals in a disposable PostgreSQL 17 Docker container with no network/ports. It checks constraints, RLS/admin roles, Draft completeness, import rerun safety, shared image protection, real two-session cleanup/reference races and Realtime publication additions. It never contacts Supabase. Docker must be available.

PDF helper tests:

```sh
python3 -m venv .venv.local
.venv.local/bin/python -m pip install --cache-dir .pip-cache.local -r scripts/pdf-requirements.txt
.venv.local/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

Unit/mock-browser/local-SQL success does **not** establish live Supabase CRUD, email delivery, storage or actual PDF import. Run the live acceptance procedure in [docs/production-readiness.md](docs/production-readiness.md) before deployment approval.

The existing GitHub workflow validates TypeScript, lint, unit tests, browser regressions, local database policies, PDF helpers and both static builds. A separate push/manual job performs read-only public Supabase checks before a configured Pages build; it needs the GitHub repository's public URL/key bindings. A source-only build does not establish configured hosting readiness. Deployment remains disabled. In proxy-based cloud shells, use `NODE_USE_ENV_PROXY=1` for native Node live checks, preserving TLS verification. Do not merge or deploy before explicit approval and verified production prerequisites.
