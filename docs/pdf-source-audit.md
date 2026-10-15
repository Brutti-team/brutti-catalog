# Original Brutti Catalogue 2025 — preliminary source audit (14 Oct 2026)

**Purpose:** Evidence review only. No records, images or schema changes have been imported/applied to Supabase.

The owner’s original `Brutti Catalogue 2025.pdf` was located in the ChatGPT file Library, materialized for offline inspection, and checked with embedded-text extraction plus visual spot checks. **It is not committed to this repository and is not available in the Codex checkout.** The source PDF is 104 pages (~102.7 MiB) and was exported by Canva.

## Findings to resolve before import

- 104 page-by-page review entries, including **8 pages without selectable text**. These should be visually assessed as separators/graphics, not assumed empty products.
- Product titles are **not unique identifiers**: preliminary extraction finds approximately 50 distinct nonempty first-line labels. In particular, **TOLUNGKU appears on 31 pages**, **CAUNTER on 9**, and **MOMENTO on 4**. Some could be distinct designs; neither deduplicate nor insert by title alone.
- Visual spot check of **PDF page 50** showed a title `CAUNTER`, a Sabah wooden-map/memento image, and reused mattress text. Its name, classification, description and dimensions cannot be trusted without manual review.
- Some pages explicitly give `PRICE STARTING FROM RM…`, others omit an amount. Treat `starting from` as a distinct price basis and **leave unknown prices null**. Do not invent fixed prices.
- `get_images()` counts PDF image objects, including decorative assets. These counts are *not* reliable product-photo counts; identify each true product photo from rendered visual evidence.
- Grouping into seven official categories is pending human validation. Do not infer that all repeated template pages represent distinct products.

## Safe next actions

1. Use the original PDF in a trusted/offline importer checkout (owner must securely supply it; do not add the 103 MiB PDF to Git).
2. Render source pages and create a human-reviewed product-photo manifest with page references, source image evidence, verified names, prices, categories and dimensions.
3. Mark ambiguous/mismatched records **exclude / clarification needed** until approved. Do not create samples.
4. Verify current production schema, Admin Auth, image Storage, price-basis/import-ledger proposals and RLS before approving any write.
5. Only after explicit approval of the exact manifest may the importer write **Draft-only** records, with duplicate identities and staff edits protected.

This audit adds no production data and does not authorize merge, deployment or import.
