# Product-accurate 3D for Brutti Catalog

This is a **frontend-only, opt-in visual capability**. Existing product records, Supabase Auth, Storage, RLS, and staff editing flows are unchanged.

## Important: 3D must match the real furniture

Do not display a made-up generic 3D kiosk for an unrelated product. A single photograph cannot establish the hidden geometry on the back and sides. Create the model using a verified CAD/SketchUp/Blender source or manually review a photo-based reconstruction using multiple real product views.

## Add one approved product model

1. Start with a real, approved product SKU already present in the Catalog.
2. Export a **GLB** file, with its textures embedded, and compare it with the actual product photos. Check silhouette, surfaces, dimensions, edges, hardware, material colors and model orientation. Optimize it for mobile.
3. Add the file under `public/models/`, e.g. `public/models/your-approved-sku.glb`. Do not overwrite existing catalog photos.
4. In `src/lib/product-models.ts`, add an entry to `approvedModels` with the exact uppercased product SKU:

```ts
const approvedModels: Record<string, ProductModelAsset> = {
  "VERIFIED-PRODUCT-SKU": {
    src: "models/your-approved-sku.glb",
    hotspots: [
      { label: "Verified finish detail", position: "0m 0.8m 0m", normal: "0m 1m 0m" }
    ]
  },
};
```

Only include hotspots if you have checked their coordinates against the model.

5. Build the site and test **360° rotation, mouse wheel zoom, touch pinch, fullscreen, reset, poster image, hotspots and model accuracy** on desktop and mobile. Confirm no console/network failures, missing GLB 404s or route regressions. If file loading fails, the viewer clearly reports that rather than showing a fake model.
6. Review and merge via pull request; deployment requires the separate normal release checks.

## Product detail behavior

- Every Published product displays its original authenticated catalog image references in the Photo gallery.
- A **360° 3D** tab activates only when that SKU has an approved GLB entry. Otherwise it reads **Coming soon**. It never switches to a random different product.
- The page keeps its original images, details, price/enquiry logic, routes and staff permissions.
- A model asset is part of the frontend build. It is not generated from a JPG automatically.
- The 3D renderer loads on demand via pinned `@google/model-viewer` 4.4.0 CDN, so model functionality requires internet access to that library. If the CDN is blocked, the original photo gallery remains accessible.

## No new backend

Do not add or create a database, Supabase project or backend service for this feature. The existing catalog already has its own database for real product/image administration. This upgrade does not touch any of its data or schema. To make staff GLB uploads persistent in the future, a separately approved storage/metadata workflow would be needed; do not pretend an in-browser file preview publishes a 3D model.

## Regression checks

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build:pages
npm run build:site
```

Also test staff login and CRUD with a safe test account, public no-order navigation, mobile scroll and product media view, using appropriate protected environments. Do not publish real draft products simply to make 3D examples visible.
