# Production implementation and verification

Status recorded on **13 October 2026** for existing project `lgdjoxafleqnbomtfzqt`, branch `feat/catalog-phase-one`, draft [PR #1](https://github.com/Brutti-team/brutti-catalog/pull/1). The existing design is preserved. No merge, deployment, production schema change, administrator creation, product import or production write test has been performed.

## Feature status and evidence

| Feature | Status | Evidence and practical limit |
| --- | --- | --- |
| Existing public Supabase connection | Completed and verified | Real HTTP 200 category/product reads; exactly seven official categories and zero anonymous-visible products. Baseline columns readable. This is not a database-wide product count. |
| Public access checks | Completed and verified, limited scope | Sessionless Auth user and anonymous admin-membership reads denied. Public signup enabled; email confirmation required. Full authenticated RLS unverified. |
| Product/category management and refresh | Implemented but not yet verified against production | Unit/browser fixtures and disposable SQL exercise CRUD, duplicate, publish/unpublish/archive, confirmations, categories, filters and stale responses. Real admin CRUD blocked by absent first administrator and write approval. |
| Optimized multiple photos | Implemented but not yet verified against production Storage | Native Chromium checks genuine WebP, orientation/transparency, bounds, previews, upload races, cover/order and multipart bytes. Real Storage upload/delete untested. |
| Ordering, guarded cleanup and Realtime | Implemented but not yet verified against production | Management SQL passes local constraints/RLS and concurrent reference/deletion tests. Live display_order/capability RPC absent. Polling remains available without the proposal. |
| Invitation and password recovery | Implemented but not yet verified | Mock callbacks, expired/cached-session and denial tests pass. Actual email activation, SMTP and sign-in/out require approved staff and owner provisioning. No demo authentication exists. |
| Static admin/catalog routes | Completed and verified locally | Raw static server, no SPA fallback: root/admin/catalog, Pages base, product hashes, refresh and Auth callbacks. Live hosting not updated. |
| Existing website compatibility | Completed and verified for review artifact only | Pages API confirms brutti.my with HTTPS. Additive assembly preserves supplied website bytes/root hash. Build freshness against the live site unverified; website repository unchanged. |
| Actual PDF preparation/import | Blocked by missing source and approval | Original 104-page PDF absent. Evidence extraction, duplicate validation, HTML preview and insert-only Draft importer tested with fixtures only. No real furniture imported. |
| Full schema, bucket and RLS audit | Blocked by missing privileged read access | Public OpenAPI restricted; bucket metadata cannot prove bucket absence. Owner read-only SQL prepared. Never replay owner-reported applied migrations. |

Local verification: **225 unit tests, 37 browser tests and two PDF-helper tests passed**, along with TypeScript, lint, production/Pages/site/configured builds and disposable PostgreSQL suites for schema, policies, import safety, publication and two-session concurrency. Browser/integration fixtures are isolated from production. The build emits a non-failing warning for a roughly 506 kB JavaScript chunk (143 kB gzip).

Regenerate public live evidence without writes:

```sh
NODE_USE_ENV_PROXY=1 npm run verify:live -- --output docs/live-verification.json.local
```

The proxy variable is needed only for proxy-based cloud environments. TLS verification remains enabled. Read-only reports deliberately retain `fullAcceptanceComplete: false` until authenticated/source/hosting acceptance is complete.

The live UI was checked at 1440×1000, 768×1024, 390×844 and 844×390 using actual public responses forwarded through TLS-verifying Node requests. The empty catalog and signed-out admin gate had no overflow. Direct Chromium-to-Supabase TLS is blocked by this cloud machine's certificate trust; no certificate bypass was used. These screenshots do not verify an authenticated dashboard or actual product CRUD/galleries.

## Required owner actions

1. **Read-only schema audit:** run [current-schema.sql](../supabase/inspection/current-schema.sql) in the existing project's trusted SQL editor and provide structural results. It checks actual columns/constraints, grants, RLS, bucket settings, optional functions/triggers and Realtime membership without exporting staff emails/credentials. Public probes found price_basis, display_order, catalog_imports and the capability RPC missing; full private metadata needs owner inspection.
2. **Approve/provision the first administrator:** select the actual staff email, approve account provisioning, review signup/password/SMTP and exact redirect URLs, invite through trusted Supabase Auth and add only the invited UUID to catalog_admins as described in the README. Staff choose their own password. Public signup and sign-in never confer admin membership. No private keys belong in VITE_ values or chat.
3. **Review additive SQL:** after inspection, approve/adapt [catalogue-import.sql](../supabase/proposals/catalogue-import.sql) and [catalogue-management.sql](../supabase/proposals/catalogue-management.sql), then apply through the trusted owner workflow. They do not seed products or recreate categories. Local success is not live compatibility proof. Ordering/automatic cleanup require the capability RPC; without it the client avoids unsupported writes and cleanup. Realtime uses an existing publication only, with polling fallback.
4. **Supply source and approve actual imports:** attach the original PDF in this conversation. Prepare a new offline evidence directory, human-reviewed manifest and HTML preview. Check duplicate identities, photo associations, prices/starting-price labels and unknown facts. Approve that concrete selection before any --apply; review flags alone are not authorization. Imported records remain Draft; the ledger preserves existing staff edits/deletions.
5. **Approve live acceptance writes:** after admin/schema readiness, authorize scoped tests or checks using approved real records. Provide an administrator session through secure environment settings only if automated checks are needed. The opt-in `verify:live -- --write-test` runner temporarily creates a labelled verification record, publishes it and removes its own records/images. This is a production mutation and must not run without explicit approval. Prefer approved real product checks if temporary records are not permitted. A non-admin session is separately needed for live denial tests.
6. **Verify configured GitHub build bindings:** the repository Actions variable `VITE_SUPABASE_URL` and Actions secret `VITE_SUPABASE_PUBLISHABLE_KEY` were saved by the authorized owner on 14 October 2026. Saving the bindings does not by itself prove a configured build or live hosting: review the `verify-production-config` GitHub Actions job on a subsequent branch push. Never use a service-role key. This job is read-only and deployment-free.
7. **Approve hosting after acceptance:** prepare a fresh website artifact plus catalog artifact, review static routes/Auth tests, then obtain separate website-change/deployment and merge approval. Current workflow has no deployment steps. Offline builds do not establish live routes/custom-domain behavior.

## Live acceptance checklist

- Inspect actual grants/policies and bucket MIME/size limits; verify seven official categories without replacements. Anonymous/non-admin reads must exclude controlled Draft/Archived records; mutation/self-grant attempts must be denied.
- Invite the administrator, activate the link, set a password, sign in/out and recover through actual email. Expired links cannot reuse cached sessions. On combined hosting, callbacks must load /admin/, not the existing website root.
- After write approval, persist an approved real Draft/photos, edit from a second browser, reorder/set cover and remove/replace photos. Verify real object bytes/MIME and shared-photo safety. Network/authorization loss can leave unused objects for owner review.
- Publish an approved complete product; verify signed-out visibility/automatic refresh. Unpublish/archive and verify disappearance. Check search/category/details/gallery using actual longest names on desktop/portrait/landscape.
- After import approval, verify Draft source associations, unknown facts and starting prices; rerun with zero duplicate inserts and preserved edits/deletions. Do not seed invented/sample furniture.
- Test an approved combined artifact and deployed URLs only after hosting approval. Record actual outcomes and keep blocked/unrun checks unverified.
