# Brutti Catalogue 2025 — real Draft import and photo attachment

Updated 14 October 2026. **Real import completed** in Supabase project `lgdjoxafleqnbomtfzqt` (Brutti Catalog). No demo data and no site merge.

## Live record status

- **96 unique newly assigned SKUs** `BRT25-P002` through `BRT25-P104` (with eight source divider pages excluded).
- All **96 items are Draft**; all start as unavailable to avoid claiming stock.
- **Seven real category assignments**: Racks 15, Tables and Kitchen Counters 23, Displays and Panels 19, Beds 7, Reception Counters 15, Displays and Mementos 16, Rentals 1.
- Source descriptions and photos are from the real 104-page *Brutti Catalogue 2025.pdf*. **33 pages** have specific description and photographed evidence; **63 pages** contain repeated/copy-pasted headers, dimensions or material claims. Those copied claims were excluded; practical, clearly descriptive working names were assigned using photographic visual evidence, not fake official model names.
- Nine distinct printed starting prices stored with `price_basis = 'starting-from'`. Repeated generic RM797 entries are *not* treated as confirmed prices. Other prices are null.
- Original dimensions are not mapped to numeric width/depth/height unless absolutely verified; unverified values remain 0 in Draft (publishing requires positive valid dimensions).
- The initial SQL import created **96 Draft records with 96 distinct SKUs**. A later verified admin upload attached **one original WebP photo to each of the 96 products**. An additive unique index on normalized SKU prevents accidental repeats.
- The server Activity Log records the SQL import as a System action because trusted owner-side SQL was used, **not** as a browser user.

## Original product photos — uploaded and verified

Live read-only checks on **15 October 2026** confirm **96 Draft products, 96 nonempty image arrays, 96 unique image references, and 96 corresponding Storage objects** in the public `product-images` bucket. The images are already in place and should **not** be uploaded again just to complete setup.

The original validated ZIP remains available in the user's file library as `Brutti_Catalogue_2025_Admin_Photo_Upload.zip` for disaster recovery or a controlled, explicitly approved reattachment. The import UI skips existing photos without overwriting them. A complete successful import automatically closes its dialog and shows a success notification; partial failures remain visible for retry.

## Safety

- Files upload through the signed-in administrator's existing Supabase Auth session; no service-role key is used.
- The ZIP may contain only the 96 expected WebP images and manifest. Hashes, SKUs, source page numbers, content types and total size are verified by the browser **before** any upload starts.
- Only existing Draft products matching an imported SKU may receive their first image. Existing product images and published products are skipped, not overwritten.
- The importer uses `product-images` Storage with user-scoped paths and no overwrite. A partly interrupted import is safely retryable: the app re-checks existing bytes of previously uploaded objects before reusing them.
- No uploaded images are added to public catalog product pages until a Draft is explicitly published by staff.
- The importer never creates a new product, changes prices, or bypasses review gates. Unknown/mismatched printed material and dimensions remain unverified.

## Outstanding release gates

Having all 96 photos attached **does not** mean every factual field is verified. Staff should review the images, labels, price bases and dimensional details of at least 63 visually classified items, then use the existing editor to correct products individually before publishing. The upload workflow is only needed for controlled recovery; current Draft products already reference their real photos.

PR #1 was successfully merged into `main` on 15 October 2026. The separate Brutti website workflow was updated to assemble isolated catalog routes; verify the GitHub Pages deployment before declaring the custom-domain routes live.
