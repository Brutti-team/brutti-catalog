# Real catalogue extraction and import

No PDF is currently attached and no production import has run. These tools prepare actual evidence without generating product facts. Obtain the original **Brutti Catalogue 2025.pdf**, confirm the expected 104 pages, and keep extraction output under an ignored `*.local` directory. Review any PDF/image licensing before redistribution.

## Extract evidence

Install the pinned Python helpers from the README, then:

```sh
.venv.local/bin/python scripts/extract-catalogue.py '/path/Brutti Catalogue 2025.pdf' catalogue-review.local
```

The tool checks 104 pages, stores the document SHA-256, writes sorted page text, page renders and deduplicated embedded image candidates. WebP photos are limited to 1800 pixels at quality 85 with source resolution recorded. It refuses to overwrite an existing review directory. A rerun uses a new directory, preserving staff review work.

Image candidates may be logos, decorations or composites rather than furniture photos. Page renders preserve the visual source for checking names, prices, dimensions and photo association. Scanned/vector pages may need manual transcription or reviewed crops; extraction is not OCR or an automated product classifier. Stop and adapt the evidence workflow after inspecting the actual PDF if its representation requires that. Never call an unreviewed image candidate an approved product photo.

`manifest.json` starts with `reviewed: false` and **zero products**. Extraction does not connect to Supabase.

## Review the actual pages

Assign each distinct product a stable human-reviewed `sourceKey` that remains unchanged across corrected PDF exports. Merge duplicate product pages into one product with multiple source pages/photos. Do not merge distinct models because names match. Deduplicate repeated images within each product; an approved image can be shared across genuinely related variants. Check the cover photo/order.

Fill each manifest product with these fields:

| Field | Required review |
| --- | --- |
| `sourceKey` | Unique lowercase letters/digits/hyphens, 1–80 characters; never rename after import. |
| `name` | Actual printed product name, 2–120 characters. |
| `sku` | Existing real SKU, or an explicitly staff-assigned unique inventory code, up to 64 characters. Assigned codes are management identifiers, not claimed PDF facts. |
| `category` | One of the seven official category names. Classification is a staff review decision. |
| `reviewed` | `true` only after checking all fields/photos against the source. |
| `pages` | Nonempty array of actual PDF page numbers, 1–104. |
| `description`, `materials`, `finishing` | Actual verified text, or **null** if absent/unknown. Never fill with invented marketing copy. Finishing is preserved in the existing materials field with a label. |
| `dimensionsCm` | Object containing `width`, `depth`, `height`; verified values converted to centimetres, or **null** individually. Retain original units/conversion notes with the review evidence. |
| `availability` | Verified `available`, `made-to-order`, `unavailable`, or **null** if unknown. Null imports as unavailable so availability is not invented. |
| `price` | Object with `myr`, `basis`, `sourceText`. Use `basis: "starting-from"` for printed starting prices, `"fixed"` only for explicitly fixed prices, or `"unknown"` and `myr: null`. Keep exact printed `sourceText` for non-null prices. Up to two decimal places. |
| `images` | 1–8 approved objects `{ "file": "images/<extracted-pixel-hash>.webp", "alt": "verified image description" }`, in cover-first order. Files must occur in the product's source pages in evidence.json. |

Top-level `version` remains 1, `source` remains `brutti-catalogue-2025`, and `documentSha256` must match evidence.json. Set top-level `reviewed: true` only after the entire selection is approved. Unknown Draft dimensions become zero; unknown price remains null. Imported products are always Draft, never Featured.

Validate **offline** before any writes:

```sh
node scripts/import-catalogue.mjs catalogue-review.local/manifest.json
```

Validation checks duplicate identities/SKUs/photo references, field bounds, official categories, page provenance, path traversal/symlinks, WebP byte signatures and 5 MB size limits. It cannot replace human verification of product facts. Do not commit unreviewed extracts, personal information or access tokens.

## Inspect and approve the schema prerequisite

Use the existing project's read-only inspection first. Review the reported schema/RLS against [../supabase/proposals/catalogue-import.sql](../supabase/proposals/catalogue-import.sql), then decide whether that proposal should be adapted/applied in the trusted SQL editor. This repository does not apply it automatically.

The proposal adds `products.price_basis` (`fixed` / `starting-from`) and an admin-only `catalog_imports` ledger, plus an invoker-security insert RPC. Starting-price semantics must exist before priced imports. The frontend reads the new column when available and preserves it during edits; it remains compatible with the current schema until then. The ledger keeps document digest, source pages and exact price text. Staff editing an imported starting price retains its starting-price basis. Changing that basis itself currently requires a trusted reviewed database update; there is no new editor control, to preserve the existing UI.

The proposal has only been tested against a disposable local database. Do not infer that the production schema matches it or blindly execute it. The two already-applied migrations are not import prerequisites to replay.

## Approved write-mode execution

After schema, admin access and real manifest review are verified, an approved catalog administrator supplies their **short-lived authenticated access token** as `CATALOG_ADMIN_ACCESS_TOKEN` through secure runtime environment configuration. Do not paste it into chat, commands/history, source files or logs. This is an authorized user token, not a service-role key. Remove the temporary binding afterward. Public URL/key variables remain required.

```sh
node --env-file=.env.local scripts/import-catalogue.mjs catalogue-review.local/manifest.json --apply
```

The script verifies the token with Supabase Auth, checks `catalog_admins`, checks import-schema availability and exactly seven categories before uploading. Storage keys are deterministic per user/product/photo, uploads never replace existing objects and downloaded bytes must match their digest. Product IDs derive from the stable source key, excluding the PDF digest so a re-export cannot create duplicates.

The RPC serializes concurrent runs of each source key and atomically inserts a Draft plus its ledger entry. It never upserts existing products. Already imported source keys are skipped, preserving staff edits and staff-deleted products. An existing untracked product ID or SKU conflict causes failure requiring review; it does not overwrite that product. Never delete ledger entries to force an import through. Corrections after import are normal staff edits, not rerun overwrite operations.

Uploads and database inserts cannot share a transaction. A failed/interrupted run may leave orphaned photos; reruns verify/reuse identical photo objects, and ledger-committed products are skipped. A different importing administrator can leave additional unused copies. Review orphaned files manually; no cleanup deletes referenced assets. Keep console success counts and verify the actual Drafts in another browser before publishing any product.
