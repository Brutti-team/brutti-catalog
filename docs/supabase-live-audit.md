# Brutti Catalog production read-only access audit — 14 October 2026

**Project:** `lgdjoxafleqnbomtfzqt` (Brutti Catalog, ACTIVE_HEALTHY).
**Scope:** Supabase connector `list_tables`, `list_migrations`, `get_advisors(security)`, read-only `SELECT` through the existing project's owner-authorized connection. **No database modifications, invites, accounts, or Storage writes performed.**

## Verified baseline

| Object | Live observed |
| --- | --- |
| `auth.users` | 0 |
| `public.catalog_admins` | 0 (RLS enabled) |
| `public.categories` | 7 (RLS enabled) |
| `public.products` | 0 (RLS enabled) |
| `storage.buckets` | `product-images`, public, 5 MiB object limit; JPEG/PNG/WebP allowlist |
| `storage.objects` | 0 (RLS enabled) |
| Production migrations | `phase_one_brutti_catalog_secure_schema`, `real_brutti_categories_and_draft_validation` |

Current published-product policy exposes `published` products while an administrator-management policy uses `is_catalog_admin()`. Storage insert requires admin membership and a matching `auth.uid()` path prefix; other Storage policies are configured for authenticated admins. These findings describe policy definitions, not end-to-end authenticated browser acceptance. **Do not replay the two previously applied migrations.**

## Security advisor warnings — review before launch

Supabase Security Advisor reported **two advisory types / four findings**, involving `SECURITY DEFINER` functions `public.is_catalog_admin()` and `public.rls_auto_enable()` executable by `anon` and `authenticated`.

The former checks current `auth.uid()` membership and is referenced in existing RLS policies; the latter is an event-trigger function. Do **not** blindly revoke either function's execution privileges because security-critical RLS/storage behavior could be affected. Evaluate whether the warnings represent actual reachable misuse, and if changes are justified, prepare a separately reviewed, regression-tested migration before applying.

- [Anonymous execution warning](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Authenticated execution warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

## Remaining release gates

1. Obtain owner-approved real staff email and approved `brutti.my/admin/` or separate Pages Auth callback, and create first user using trusted Supabase Authentication invitation (staff sets their own password). Grant exact user UUID in `catalog_admins` through trusted owner SQL. **No user presently exists.**
2. Verify successful real sign-in, callback, password recovery, membership enforcement and RLS (including non-admin failures). This is impossible with zero live Auth users.
3. Review pending owner SQL proposals for ordering, price basis, import ledger and image-cleanup policies *against this live schema*. Apply only with explicit production-schema authorization.
4. Manually verify the real 104-page PDF source audit and approve a specific Draft-only import. PDF resides in ChatGPT Library, not in this GitHub checkout. See [pdf-source-audit.md](pdf-source-audit.md).
5. Review merged-host static artifact and `benua-brutti-website` integration; Pages for this catalog and `brutti.my` are separately hosted. Do not claim `brutti.my/admin` is deployed.
6. Obtain explicit separate approvals for PR merge, website modifications and deployment.

**Read-only audit; not a production go-live approval.**
