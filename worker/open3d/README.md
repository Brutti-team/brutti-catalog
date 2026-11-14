# Brutti Catalog — self-hosted open-source photo-to-3D GPU worker

This optional GPU service runs **real** single-image-to-3D inference with [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2) and produces a GLB with a 360° mesh and embedded textures. It is **not** Meshy and does not use Lovable credits. It is not a CSS photo-tilt filter.

## Hardware and limitations

- Linux + NVIDIA CUDA GPU with **at least 24 GB VRAM** is required by the TRELLIS.2 project; tested with A100/H100.
- A GPU machine must be powered on, connected to the internet and reachable through HTTPS. Neither free GitHub Pages nor Supabase Edge Functions can execute CUDA inference. Cloud GPUs may cost money.
- The official model takes **one** reference photo. Other catalog photos remain in the product gallery. Hidden surfaces are estimated, not measured. Inspect geometry before publishing.
- TRELLIS.2 code and model repo declare MIT licensing; **review the separate dependencies/weights and project usage terms before commercial use**. The research project website includes a non-commercial material disclaimer; obtain appropriate approval for company use if necessary.
- This worker is a reference implementation, not a pre-provisioned GPU. Test inference on the actual host before using customer-facing models.

## 1. Prepare the GPU host

Install NVIDIA drivers, CUDA Toolkit 12.4, Git, Conda, and Python according to the **current** [TRELLIS.2 setup](https://github.com/microsoft/TRELLIS.2#installation) on the GPU host. For example:

```bash
git clone --recursive https://github.com/microsoft/TRELLIS.2.git ~/TRELLIS.2
cd ~/TRELLIS.2
# Follow upstream README to install dependencies and compile CUDA extensions.
# Pin a reviewed commit of TRELLIS.2 before production.
```

In the matching Python environment where `trellis2`, `o_voxel`, CUDA and the model checkpoints work:

```bash
cd /path/to/brutti-catalog/worker/open3d
python -m pip install -r requirements.txt
export TRELLIS_REPO_DIR="$HOME/TRELLIS.2"
export BRUTTI_3D_DATA_DIR="/data/brutti-3d"
export BRUTTI_3D_IMAGE_PREFIX="https://lgdjoxafleqnbomtfzqt.supabase.co/storage/v1/object/public/product-images/"
export BRUTTI_3D_WORKER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
# Save that token in the GPU host secret manager and Supabase Edge Secrets.
uvicorn app:app --host 127.0.0.1 --port 8081 --workers 1
```

Place an HTTPS reverse proxy (or authenticated Cloudflare Tunnel) in front of `127.0.0.1:8081` and **do not** expose the internal HTTP port publicly. Keep one Uvicorn worker process to avoid duplicate GPU model loading. Keep the data directory persistent across restarts. Use HTTPS and the shared bearer token; rotate compromised tokens. Disable the host's CORS for browsers; only Supabase Edge Function should call it.

## 2. Configure Supabase (Brutti Catalog only)

Go to [Brutti Catalog Supabase Edge Secrets](https://supabase.com/dashboard/project/lgdjoxafleqnbomtfzqt/functions/secrets) and add:

- `BRUTTI_3D_WORKER_URL`: Full **HTTPS** origin of the GPU worker, e.g. `https://3d-worker.example.com` (no slash at end).
- `BRUTTI_3D_WORKER_TOKEN`: The random bearer token configured on the GPU host.

Never use `VITE_` variables for the worker token and never commit it into GitHub. No migrations are needed: the existing private `catalog_3d_jobs` table is reused.

## 3. Use in Catalog

Open a **saved** product, choose its most useful reference image under **Real 3D model**, click **Generate 3D from selected photos**, then **Preview generated 3D** and **Save Product** when satisfied. Customer **Interactive 3D** appears only when a published product has a saved model.

- The GPU worker accepts one source photo and runs one model at a time, with a short queue.
- The Supabase Edge Function validates the staff session and image ownership, enforces 3 jobs per staff account per 24 hours and one active task per product.
- Browser clients cannot read job records or obtain the GPU bearer token.
- Generated files >48 MB are rejected before import. Resize textures/export geometry as needed.
- On worker restart, unfinished queued/processing jobs may need operator recovery. Jobs are idempotent by UUID, so retry with the same ID does not queue a second task.
- This code does **not** start an automatic batch generation across the 96 catalog products.

## Health check (server-side only)

```bash
curl -H "Authorization: Bearer $BRUTTI_3D_WORKER_TOKEN" https://YOUR-GPU-WORKER.example/health
```

Expected: `{"status":"healthy","engine":"TRELLIS.2",...}`. A 503 indicates missing GPU, VRAM, model files, or configuration.

## Troubleshooting

- **Worker not connected:** Verify HTTPS, TLS, bearer token, GPU host power, `/health` status, and both Supabase Edge Secrets.
- **GPU job failed:** Inspect GPU service logs and available VRAM. Confirm TRELLIS.2 model dependencies and weights are installed.
- **Image rejected:** Product photo must be saved and publicly retrievable from the Brutti Catalog Storage bucket; the URL must match `BRUTTI_3D_IMAGE_PREFIX`.
- **Generated model invalid/too large:** Export must be a valid GLB up to 48 MB. Adjust triangle or texture resolution.
- **Save Product fails:** Inspect browser console/network, Supabase Auth session, product-model storage RLS, and concurrent edits. The existing model upload path still works independently.
