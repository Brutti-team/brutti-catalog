# Real photo-to-3D for Brutti Catalog (without Meshy)

Image-to-3D supports two non-Meshy options. The product gallery and Supabase model storage remain unchanged.

## Use it today without your own GPU: Microsoft TRELLIS.2 demo

The public [Microsoft TRELLIS.2 Space on Hugging Face](https://huggingface.co/spaces/microsoft/TRELLIS.2) runs on Hugging Face ZeroGPU, subject to availability and per-account daily GPU quotas.

1. Open a **saved** product in Catalog → Edit Product → Real 3D model.
2. Select the already-saved reference photo and click **Download original product photo**.
3. Click **Open Microsoft TRELLIS.2 demo**. In the external demo, upload that image, click **Generate**, and when ready **Extract GLB** and download its .glb file.
4. Back in Catalog, click **Import generated GLB**. Preview the genuine textured 3D model and rotate to check the geometry.
5. Click **Save Product** to persist the GLB. No 3D appears publicly until the product is actually saved and published.

This is a **manual demo workflow**, not automatic inference from GitHub Pages. Photos are only sent to Hugging Face by the user when uploaded into its separate website. Free ZeroGPU quotas are not guaranteed, and Hugging Face may require sign-in, be temporarily busy, or have usage limits. Do not upload non-public/private customer images.

## Optional: Automatic one-click generation on your own GPU worker


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
