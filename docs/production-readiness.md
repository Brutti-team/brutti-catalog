# Production verification handoff

The code builds and has automated tests against intercepted API fixtures and disposable local PostgreSQL. **Those are not live Supabase acceptance tests.** The existing project, reported applied migrations, seven categories and empty product/admin counts must still be inspected with authorized access.

## Missing inputs

1. Securely configure the existing project's public browser key (`VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`) and URL in environment settings. No private/database/service-role key is needed by the frontend. The configured environment draft does not itself inject values or publish a new environment snapshot.
2. Supply the actual **Brutti Catalogue 2025.pdf**, 104 pages. No real PDF/products/photos are present yet.
3. Choose the first approved staff email, invite/create that Auth user through the trusted dashboard and grant their UUID `catalog_admins` membership. Configure approved Auth redirect URLs and email delivery. No default password exists.
4. Inspect current schema with the read-only SQL and public inspector. Review/adapt the pending import/starting-price proposal before owner application. Nothing has been applied to production by this work.
5. After backend/data acceptance, confirm current website Pages custom domain/DNS and approve the integration approach. A separate deployment approval is still required; current workflow cannot deploy.

## Live acceptance after prerequisites arrive

Use approved real records/photos only. Do not seed tests/sample furniture into production.

- Confirm seven official categories and no unexpected categories. Verify RLS and admin membership grants match the expected schema; check public-key reads never return Draft/Archived rows.
- With no session, verify `/admin` is gated and mutation attempts are denied. With an authenticated non-admin account, verify membership cannot be self-granted and product/category/storage writes are denied.
- Invite the first administrator, complete the link, sign in/out and recover a password. Verify expired links remain invalid even if another session is cached. Test actual email delivery/redirects, not only browser fixtures.
- As admin, save one actual PDF product as Draft, including genuinely unknown fields as null/zero. Open another browser/device and verify persisted content. Upload approved actual photos, change cover/order/alt text, replace/remove references and save. Verify object bytes/MIME and RLS in Storage. Public asset URLs remain downloadable even for Drafts; approve only distributable images.
- Validate the reviewed import manifest, execute only after explicit schema/admin readiness, verify all products are Draft and product/photo/category/price associations match source pages. Rerun to confirm zero duplicates and preserved staff edits. Confirm exact starting-price labels and source provenance.
- Complete verified fields for one approved product, publish and check public visibility from a signed-out browser. The open public tab refreshes within 30 seconds or on becoming visible. Archive it and verify it disappears. Search/category filters, details/gallery/enquiry behavior must use that actual product.
- Check desktop, mobile portrait and landscape with the actual longest names/categories, photos and prices; ensure accessible form/menu behavior. Do not use test-fixture screenshots as proof of production data.
- Confirm backups, monitoring, staff offboarding and storage cleanup ownership before launch. Prepare the website integration artifact and request explicit deployment/merge approval afterward.

Record actual timestamps, counts and outcomes here when performed. Do not mark blocked checks as passed or claim import/deployment success from a build alone.
