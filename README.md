# Brutti Catalog

The existing React, Vite and TypeScript catalog for **Benua Brutti Sdn. Bhd.** The dashboard and public catalog design are preserved. The application uses Supabase only, with no demo login, sample-product fallback or browser-only product persistence.

**Production verification and real product import are pending. Nothing has been deployed.** Work is on `feat/catalog-phase-one`; changes are limited to this repository.

## Existing backend — do not recreate it

Use the existing Benua Brutti project **`lgdjoxafleqnbomtfzqt`**, URL **`https://lgdjoxafleqnbomtfzqt.supabase.co`**.

The owner reports that `phase_one_brutti_catalog_secure_schema` and `real_brutti_categories_and_draft_validation` are already applied, with seven categories, zero products, zero catalog administrators and one image bucket. These are owner-reported facts; live inspection requires the public key. **Do not create another project or blindly rerun these migrations.** The repository SQL files document the expected schema and support isolated local tests.

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

All `VITE_` variables are public in the browser bundle. Never provide a service-role key, `sb_secret_` key, database password or other private credential. Browser configuration rejects known privileged keys; RLS remains the security boundary. `.env.local` is ignored by Git. Missing configuration/backend failures show an error, never invented data.

Routes during review: `/#/admin`, `/#/catalog`, `/#/product/<id>`. These hash routes work on static hosting. Clean `brutti.my/admin` and `/catalog` require the later integration described in [docs/website-integration.md](docs/website-integration.md).

Optionally configure `VITE_ENQUIRY_EMAIL` to an approved business email. Without it, enquiries are disabled. The action opens a mailto draft; there is no server-side email delivery or checkout.

## Inspect before schema changes or importing

With public environment values present:

```sh
node --env-file=.env.local scripts/inspect-backend.mjs
# If variables are already injected, omit --env-file.
```

This performs **read-only** public REST/OpenAPI requests, checks the official category names and checks for leaked unpublished records. Public reads cannot establish total product/admin counts, full policies or bucket configuration. If OpenAPI inspection is disabled, use the owner SQL inspection rather than assuming the schema.

Run [supabase/inspection/current-schema.sql](supabase/inspection/current-schema.sql) in the existing project's trusted SQL editor. It is a read-only transaction that reports columns, constraints, RLS, policies, the admin-check function, categories, counts and the product bucket. Review those structural results before considering additions. No application/startup/CI script applies SQL to production.

## Invite the first administrator

1. Choose the actual authorized staff email. In the existing Supabase project's Authentication settings, disable public signups unless separately approved. Configure email delivery, confirmation/password policy, Site URL and allowed redirect URLs for the approved review host. Local review may use `http://localhost:5173/`; whitelist the exact reset redirect `http://localhost:5173/?auth=recovery`. Do not point production invitation emails at an unapproved host.
2. Use the trusted **Supabase Dashboard → Authentication → Users → Invite user** flow. Its invitation destination must be the catalog's approved root URL, where the SDK can receive the invite token fragment. If invitations need a custom redirect, use Supabase's trusted server-side `inviteUserByEmail` with the approved `redirectTo`. Private admin keys stay exclusively in that trusted server, never this frontend.
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

Photos use `product-images`, up to eight JPEG/PNG/WebP images, each at most 5 MB. Uploads require a verified admin and a user UUID path prefix. Successful photos append to current editor state, preserving concurrent staff edits/removals. Save is disabled during upload. Partial failures retain successfully uploaded images for review. Replace a photo by adding the replacement, moving it to the desired position/cover and removing the old reference, then save.

**The bucket is public:** Draft/Archived photo URLs are downloadable if known. Only upload photos intended for public distribution. Removing a photo/product or cancelling can leave unreferenced files; no destructive cleanup runs automatically. Review storage references before manual cleanup, especially duplicated products sharing photos.

Public pages render Published products only and re-read the database every 30 seconds while visible, also when a tab becomes visible again. Publishing/unpublishing therefore needs no new GitHub deployment, although an already open tab can take up to 30 seconds to reflect it. No Realtime publication setting is required.

## Actual 104-page PDF import

The real **Brutti Catalogue 2025.pdf has not been supplied to this checkout**. No actual products or photographs have been extracted/imported. [docs/catalogue-import.md](docs/catalogue-import.md) explains the prepared extractor, evidence review, manifest validation and insert-only Draft importer.

The importer is offline-validation-only by default. Write mode needs a reviewed real manifest, inspected/approved additional schema, an authenticated approved administrator and verified photo bytes. A durable ledger prevents repeated imports from overwriting staff edits or recreating staff-deleted products. The proposed SQL is [supabase/proposals/catalogue-import.sql](supabase/proposals/catalogue-import.sql), **not an applied migration**. It adds accurate starting-price semantics and import provenance; do not apply it before inspecting the existing database.

The frontend remains compatible with the reported existing schema: it sends no new price column for existing records until the column is returned by the database. With the reviewed addition installed, imported starting prices display **Starting from RM…** in the existing cards/details/preview and survive staff edits. No fixed price is inferred from a starting price.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:db
```

Playwright uses an intercepted test backend on port 5190, no demo mode and **no live production writes**. Install Chromium with `npx playwright install chromium` if `/usr/bin/chromium` is unavailable, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Checks include admin denial, expired/invite/recovery callbacks, Draft creation, product editing, upload race regression, publishing/archiving/public filters and desktop/mobile/landscape overflow. Browser screenshots are generated under ignored `test-results/`; they show test fixtures, not imported Brutti products.

The database suite runs both existing migrations and the pending import proposal in a disposable PostgreSQL 17 Docker container with no network/ports, then checks constraints, RLS/admin roles, Draft completeness, rerun safety and staff edit/deletion preservation. It never contacts Supabase. Docker must be available.

PDF helper tests:

```sh
python3 -m venv .venv.local
.venv.local/bin/python -m pip install --cache-dir .pip-cache.local -r scripts/pdf-requirements.txt
.venv.local/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

Unit/mock-browser/local-SQL success does **not** establish live Supabase CRUD, email delivery, storage or actual PDF import. Run the live acceptance procedure in [docs/production-readiness.md](docs/production-readiness.md) before deployment approval.

The existing GitHub workflow validates TypeScript, unit tests, browser regressions, local database policies, PDF helper tests and the build. Deployment remains disabled. Do not merge or deploy before explicit approval and verified production prerequisites.
