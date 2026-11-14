"""Self-hosted image-to-3D GPU worker for Brutti Catalog.

Run on a private Linux NVIDIA GPU host. The worker is not suitable for
GitHub Pages or Supabase Edge Functions (those do not run CUDA inference).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
import hmac
import io
import json
import os
from pathlib import Path
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

APP_DIR = Path(os.getenv("BRUTTI_3D_DATA_DIR", "./worker-data")).resolve()
MODEL_REPO_DIR = Path(os.getenv("TRELLIS_REPO_DIR", "../TRELLIS.2")).resolve()
IMAGE_PREFIX = os.getenv("BRUTTI_3D_IMAGE_PREFIX", "").strip()
WORKER_TOKEN = os.getenv("BRUTTI_3D_WORKER_TOKEN", "").strip()
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_GLB_BYTES = 48 * 1024 * 1024
LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trellis")
@asynccontextmanager
async def lifespan(_app: FastAPI):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    for status_file in APP_DIR.glob("*/status.json"):
        try:
            data = json.loads(status_file.read_text(encoding="utf-8"))
            if data.get("status") in ("processing", "queued"):
                save_status(status_file.parent, "failed", 0)
        except (OSError, ValueError, KeyError):
            pass
    yield

app = FastAPI(
    title="Brutti Catalog Open-Source 3D Worker",
    docs_url=None, redoc_url=None,
    lifespan=lifespan,
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirects are not allowed")


class TaskRequest(BaseModel):
    job_id: str = Field(min_length=36, max_length=36)
    image_url: str = Field(min_length=30, max_length=2000)


def verify(bearer: str | None) -> None:
    if not WORKER_TOKEN or len(WORKER_TOKEN) < 24:
        raise HTTPException(status_code=503, detail="Set BRUTTI_3D_WORKER_TOKEN")
    if not bearer or not bearer.startswith("Bearer ") or not hmac.compare_digest(bearer[7:], WORKER_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def job_directory(job_id: str) -> Path:
    try:
        UUID(job_id, version=4)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid job ID")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id):
        raise HTTPException(status_code=422, detail="Invalid job ID")
    return APP_DIR / job_id.lower()


def load_status(folder: Path) -> dict:
    try:
        return json.loads((folder / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="Unknown job")


def save_status(folder: Path, status: str, progress: int = 0) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / "status.json.tmp"
    tmp.write_text(json.dumps({"status": status, "progress": progress}), encoding="utf-8")
    tmp.replace(folder / "status.json")


def validate_image_url(image_url: str) -> None:
    if not IMAGE_PREFIX.startswith("https://"):
        raise HTTPException(status_code=503, detail="Set BRUTTI_3D_IMAGE_PREFIX")
    parsed = urlsplit(image_url)
    base = urlsplit(IMAGE_PREFIX)
    if parsed.scheme != "https" or parsed.netloc != base.netloc or not parsed.path.startswith(base.path):
        raise HTTPException(status_code=422, detail="Image must come from Brutti Catalog's public image bucket")
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Unsupported image URL")
    if "/../" in parsed.path or "%2f" in parsed.path.lower() or "%2e" in parsed.path.lower():
        raise HTTPException(status_code=422, detail="Unsafe image path")


def download_image(image_url: str) -> Image.Image:
    validate_image_url(image_url)
    opener = build_opener(NoRedirect())
    request = Request(image_url, headers={"User-Agent": "BruttiCatalog3DWorker/1.0"})
    with opener.open(request, timeout=15) as response:
        if not (response.headers.get("Content-Type", "").lower().startswith("image/")):
            raise ValueError("URL did not return an image")
        data = response.read(MAX_IMAGE_BYTES + 1)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Photo is empty or larger than 5 MB")
    try:
        image = Image.open(io.BytesIO(data))
        image.verify()
        original = Image.open(io.BytesIO(data))
        if original.width * original.height > 32_000_000:
            raise ValueError("Photo resolution is too large")
        # TRELLIS.2 accepts an alpha-masked foreground. Do not discard the
        # alpha channel when staff upload a transparent product cutout.
        return original.convert("RGBA" if "A" in original.getbands() else "RGB")
    except UnidentifiedImageError as error:
        raise ValueError("Unsupported photo format") from error


_pipeline = None


def generate_model(image: Image.Image, output: Path) -> None:
    """Real TRELLIS.2 single-image inference, based on the official repo sample."""
    global _pipeline
    sys.path.insert(0, str(MODEL_REPO_DIR))
    import torch
    import o_voxel
    from trellis2.pipelines import Trellis2ImageTo3DPipeline

    if not torch.cuda.is_available():
        raise RuntimeError("NVIDIA CUDA GPU is unavailable")
    if _pipeline is None:
        _pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        _pipeline.cuda()

    with torch.inference_mode():
        mesh = _pipeline.run(image)[0]
        mesh.simplify(16_777_216)
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=150_000,
            texture_size=1024,
            remesh=True,
            remesh_band=1,
            remesh_project=0,
            verbose=False,
        )
        # Keep embedded textures for Brutti's Three.js GLB viewer.
        glb.export(str(output), extension_webp=True)

    with output.open("rb") as handle:
        if handle.read(4) != b"glTF":
            raise ValueError("Inference did not produce a valid GLB")
    if not 20 <= output.stat().st_size <= MAX_GLB_BYTES:
        raise ValueError("Generated model is larger than 48 MB; reduce the texture resolution")


def work(folder: Path, image_url: str) -> None:
    try:
        save_status(folder, "processing", 5)
        image = download_image(image_url)
        save_status(folder, "processing", 15)
        output = folder / "model.glb"
        generate_model(image, output)
        save_status(folder, "completed", 100)
    except Exception:
        # Never expose internal paths or stack traces to the caller.
        save_status(folder, "failed", 0)


@app.get("/health")
def health(authorization: str | None = Header(default=None)):
    verify(authorization)
    if not IMAGE_PREFIX.startswith("https://") or not MODEL_REPO_DIR.is_dir():
        raise HTTPException(status_code=503, detail="Configure 3D model files and image prefix")
    try:
        import torch
        if not torch.cuda.is_available() or torch.cuda.get_device_properties(0).total_memory < 24 * 1024 ** 3:
            raise RuntimeError("A CUDA GPU with at least 24 GB VRAM is required")
    except Exception:
        raise HTTPException(status_code=503, detail="NVIDIA GPU with 24GB VRAM is not ready")
    return {"status": "healthy", "engine": "TRELLIS.2", "model": "microsoft/TRELLIS.2-4B"}


@app.post("/jobs")
def create_job(body: TaskRequest, authorization: str | None = Header(default=None)):
    verify(authorization)
    folder = job_directory(body.job_id)
    validate_image_url(body.image_url)
    with LOCK:
        if (folder / "status.json").exists():
            return {"job_id": body.job_id, **load_status(folder)}
        # Keep a single active GPU job per service, no surprise parallel inference.
        pending = sum(
            1 for file in APP_DIR.glob("*/status.json")
            if json.loads(file.read_text(encoding="utf-8")).get("status") in ("queued", "processing")
        )
        if pending >= 3:
            raise HTTPException(status_code=429, detail="GPU queue is full")
        save_status(folder, "queued", 0)
        EXECUTOR.submit(work, folder, body.image_url)
    return {"job_id": body.job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def status(job_id: str, authorization: str | None = Header(default=None)):
    verify(authorization)
    folder = job_directory(job_id)
    result = load_status(folder)
    return {**result, "model_ready": result["status"] == "completed" and (folder / "model.glb").exists()}


@app.get("/jobs/{job_id}/model")
def model(job_id: str, authorization: str | None = Header(default=None)):
    verify(authorization)
    folder = job_directory(job_id)
    if load_status(folder)["status"] != "completed" or not (folder / "model.glb").exists():
        raise HTTPException(status_code=409, detail="Model is not ready")
    file = folder / "model.glb"
    if file.stat().st_size > MAX_GLB_BYTES:
        raise HTTPException(status_code=413, detail="Model exceeds 48 MB")
    return FileResponse(file, media_type="model/gltf-binary", filename="generated-model.glb")
