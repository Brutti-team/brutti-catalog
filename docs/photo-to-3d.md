# Brutti Catalog — real photo-to-3D generation

The staff **Edit Product → Real 3D model** section now offers a real geometric Image-to-3D pipeline, not CSS photo tilt. It does not automatically charge credits or generate unrequested models.

## Production setup (Brutti Catalog Supabase only)

1. In [Brutti Catalog Edge Function Secrets](https://supabase.com/dashboard/project/lgdjoxafleqnbomtfzqt/functions/secrets), set **MESHY_API_KEY** to a valid paid Meshy developer API key. Never paste the key into the frontend, GitHub repository, a photo URL or a support ticket.
2. The deployed `catalog-image-to-3d` function keeps that key server-side. `catalog_3d_jobs` stores non-secret task metadata; anonymous and authenticated clients have no direct grants; the function checks valid Supabase Auth and `catalog_admins` membership.
3. Open a **saved** product with at least one already-saved product image. Select 1–4 photos, preferably front, side and back views of the **same physical item**. The first selected image guides the front view.
4. Click **Generate 3D from selected photos** and explicitly confirm Meshy credit usage. The task continues on Meshy and its job state is retained in Supabase. Reopen Edit Product to resume status checking.
5. When ready, click **Preview generated 3D**. The function checks task ownership, downloads a GLB from the allowed provider asset host and passes it into the existing viewer and model packaging workflow.
6. Rotate the mesh to check shape and texture. Click **Save product** to store the generated model using the existing private `product-models` bucket. The customer sees **Interactive 3D** only if the product is published **and actually has** a saved 3D model.

## Limits and safety

- Up to four source photos per generation; maximum three generation attempts per staff member per rolling 24-hour period.
- One active provider task per product. No model is saved or published automatically.
- Provider charges may apply per attempt, even if the result is unsatisfactory. A request timeout can occur after the provider accepted the task: check the Meshy dashboard before retrying.
- Source product photos remain unchanged. One photograph cannot uniquely determine unseen geometry: generated surfaces and texture can contain approximations. Always review before publishing.
- Generated GLB must fit the existing model package limit (50 MB; network download proxy limits GLB to 48 MB).
- No automatic daily jobs, scheduled generation, Lovable credits, or Brutti OS changes.
- If `MESHY_API_KEY` is absent, the UI states the configuration requirement and never submits a chargeable generation request.

## Troubleshooting

- **Generate option not enabled:** check that the product was saved, model storage capability exists, and the Supabase secret `MESHY_API_KEY` is present. Do not enter the key into a browser field.
- **403:** sign in with the correct Brutti Catalog staff account. The server uses `catalog_admins`, not editable profile metadata.
- **Failed generation:** use clean photos of the same item from multiple angles; inspect Meshy task status and available credits.
- **Download/preview error:** verify the GLB is available, the provider signed URL has not expired, WebGL 2 is available, and the file remains under 48 MB.
- **Cannot Save:** inspect browser console/network, Auth session, RLS policies and product-model storage permissions. Reopen the product after concurrent edits.

Provider API: https://docs.meshy.ai/en/api/multi-image-to-3d
