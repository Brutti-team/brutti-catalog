# Real photo-to-3D for Brutti Catalog (without Meshy)

Image-to-3D runs on an **optional self-hosted TRELLIS.2 GPU worker**. The product gallery and Supabase model storage remain unchanged.

1. Use the setup guide at [worker/open3d/README.md](../worker/open3d/README.md) on a Linux NVIDIA GPU machine (24 GB+ VRAM).
2. Expose that service via secured HTTPS and store the service bearer token privately. Configure the matching token on both sides.
3. In Brutti Catalog Supabase Edge Function secrets, set `BRUTTI_3D_WORKER_URL` and `BRUTTI_3D_WORKER_TOKEN` to your GPU service URL and shared token. No `MESHY_API_KEY` is used.
4. Reopen a saved product in Edit Product, choose **one original saved photo**, and click Generate 3D. Review the genuine GLB preview and Save Product.
5. If no GPU server is configured, the UI displays **Open-source GPU worker is not connected yet** and keeps existing photo browsing and uploaded 3D models available.

The open-source code itself has no per-generation Meshy fees, but a GPU host may cost money. The photo-to-3D model estimates unseen surfaces and may differ from the real product. Do not automatically publish generated models without review.

## Security and reliability
- Only logged-in catalog staff can request generation through the Supabase Edge Function.
- Generated model jobs are tracked in the existing private `catalog_3d_jobs` table under RLS and server-only grants.
- One active job per product; three requests per staff account per 24 hours.
- The GPU worker restricts source URLs to the saved public Brutti product images bucket.
- No browser-side GPU token, no direct public worker API, and no Lovable credits.
- Model size is limited to 48 MB for browser import and remains a private package until Save Product.
- If a job is interrupted, inspect worker logs and restart it deliberately; do not silently regenerate models.

## Verification
Pull request CI tests the UI with a mocked worker, tests the Python worker API without a GPU, and compiles the site. Actual inference requires the configured CUDA hardware and installed TRELLIS.2 checkpoint.

## Licensing
TRELLIS.2 repository has an MIT license; dependent packages and the published project materials may have separate terms and disclaimers. Obtain appropriate company approval for commercial model generation after reviewing them.
