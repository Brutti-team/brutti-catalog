# Brutti Catalogue 2025 — real Draft import and photo attachment

Updated 14 October 2026. **Real import completed** in Supabase project `lgdjoxafleqnbomtfzqt` (Brutti Catalog). No demo data and no site merge.

## Live record status

- **96 unique newly assigned SKUs** `BRT25-P002` through `BRT25-P104` (with eight source divider pages excluded).
- All **96 items are Draft**; all start as unavailable to avoid claiming stock.
- **Seven real category assignments**: Racks 15, Tables and Kitchen Counters 23, Displays and Panels 19, Beds 7, Reception Counters 15, Displays and Mementos 16, Rentals 1.
- Source descriptions and photos are from the real 104-page *Brutti Catalogue 2025.pdf*. **33 pages** have specific description and photographed evidence; **63 pages** contain repeated/copy-pasted headers, dimensions or material claims. Those copied claims were excluded; practical, clearly descriptive working names were assigned using photographic visual evidence, not fake official model names.
- Nine distinct printed starting prices stored with `price_basis = 'starting-from'`. Repeated generic RM797 entries are *not* treated as confirmed prices. Other prices are null.
- Original dimensions are not mapped to numeric width/depth/height unless absolutely verified; unverified values remain 0 in Draft (publishing requires positive valid dimensions).
- The initial SQL import was verified in Supabase with exactly **96 Draft records, 96 different SKUs, zero initial images**. An additive unique index on normalized SKU prevents accidental repeats.
- The server Activity Log records the SQL import as a System action because trusted owner-side SQL was used, **not** as a browser user.

## Original product photos

All 96 original source-photo candidates are available in a private user conversation file:
`Brutti_Catalogue_2025_Admin_Photo_Upload.zip` (~5.4 MB).
The bundle is **ZIP_STORED** (uncompressed), with 96 WebP photos under `photos/page-###.webp` and `manifest.json` mapping each photo to a real catalog SKU and SHA-256 digest.

For the user to attach the photos to these existing Drafts:

1. Download that ZIP from the ChatGPT conversation, **without modifying it or unzipping it**.
2. Sign in to the already approved staging at `https://brutti-team.github.io/brutti-catalog/admin/`.
3. Open **Products**, then **Bulk import photos**.
4. Select the ZIP and press **Attach photos to Draft products**.
5. Keep the browser tab open. The app validates all 96 photos before making uploads and shows per-item progress, completion and retry errors.
6. After upload, refresh Products and inspect actual thumbnails, images, name and category against the original PDF. Fix uncertain descriptions and dimensions manually before any publishing.

## Safety

- Files upload through the signed-in administrator's existing Supabase Auth session; no service-role key is used.
- The ZIP may contain only the 96 expected WebP images and manifest. Hashes, SKUs, source page numbers, content types and total size are verified by the browser **before** any upload starts.
- Only existing Draft products matching an imported SKU may receive their first image. Existing product images and published products are skipped, not overwritten.
- The importer uses `product-images` Storage with user-scoped paths and no overwrite. A partly interrupted import is safely retryable: the app re-checks existing bytes of previously uploaded objects before reusing them.
- No uploaded images are added to public catalog product pages until a Draft is explicitly published by staff.
- The importer never creates a new product, changes prices, or bypasses review gates. Unknown/mismatched printed material and dimensions remain unverified.

## Outstanding release gates

This import deliberately does **not** mean every factual field is verified. Staff should review the images, labels, price bases and dimensional details of at least 63 visually classified items, then use the existing editor to correct products individually before publishing. The new upload workflow is a user-initiated action; the browser cannot read the user's ChatGPT local file without selecting it.

Do not merge PR #1 or change `brutti.my` without separate approval.
