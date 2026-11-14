import { useEffect, useState } from "react";
import { AlertCircle, Check, LoaderCircle, WandSparkles } from "lucide-react";
import SafeImage from "./SafeImage";
import type { ProductImage } from "../lib/types";
import { downloadGenerated3D, photo3DRequest, type Photo3DJob } from "../lib/photo-to-3d";

type Props = {
  productId: string;
  productName: string;
  photos: readonly ProductImage[];
  savedPhotoIds: readonly string[];
  saved: boolean;
  disabled: boolean;
  onGenerated: (file: File) => Promise<void>;
};

export default function ProductImageTo3D({
  productId, productName, photos, savedPhotoIds, saved, disabled, onGenerated
}: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string[]>(() => photos.filter(photo => savedPhotoIds.includes(photo.id)).slice(0, 1).map(photo => photo.id));
  const savedIdsKey = savedPhotoIds.join(",");
  const eligibleIds = new Set(savedPhotoIds);
  const eligiblePhotos = photos.filter(photo => eligibleIds.has(photo.id));
  const unsavedCount = photos.length - eligiblePhotos.length;
  const [job, setJob] = useState<Photo3DJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const validIds = new Set(savedIdsKey.split(",").filter(Boolean));
    const eligible = photos.filter(photo => validIds.has(photo.id));
    setSelected(current => {
      const stillPresent = current.filter(id => validIds.has(id) && photos.some(photo => photo.id === id)).slice(0, 1);
      const next = stillPresent.length ? stillPresent : eligible.slice(0, 1).map(photo => photo.id);
      return next.length === current.length && next.every((id, index) => current[index] === id) ? current : next;
    });
  }, [photos, savedIdsKey]);

  useEffect(() => {
    if (!saved) { setConfigured(null); return; }
    let cancelled = false;
    void photo3DRequest("config", productId).then(result => {
      if (!cancelled) { setConfigured(result.configured === true); setJob(result.job ?? null); }
    }).catch(cause => {
      if (!cancelled) { setConfigured(false); setError(cause instanceof Error ? cause.message : "Cannot check 3D setup."); }
    });
    return () => { cancelled = true; };
  }, [saved, productId]);

  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !["creating", "processing"].includes(jobStatus || "")) return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await photo3DRequest("status", productId, { jobId });
        if (!cancelled && result.job) { setJob(result.job); setError(""); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not check 3D progress.");
      }
    };
    void check();
    const interval = window.setInterval(() => { void check(); }, 8000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [jobId, jobStatus, productId]);

  const toggle = (id: string) => {
    setSelected(current => current.includes(id) ? current : [id]);
    setImported(false);
  };

  async function generate() {
    if (disabled || loading || !selected.length || !configured || selected.some(id => !eligibleIds.has(id))) return;
    if (!window.confirm("Generate a real 3D model using the connected open-source GPU worker? GPU hosting may have a cost. Continue?")) return;
    setError("");
    setImported(false);
    setLoading(true);
    try {
      const result = await photo3DRequest("start", productId, { imageIds: selected });
      setJob(result.job ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start 3D generation.");
    } finally { setLoading(false); }
  }

  async function importGeneratedModel() {
    if (!job || job.status !== "ready" || disabled || importing) return;
    setError("");
    setImporting(true);
    try {
      const file = await downloadGenerated3D(productId, job.id);
      await onGenerated(file);
      setImported(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open generated 3D.");
    } finally { setImporting(false); }
  }

  const inProgress = job?.status === "creating" || job?.status === "processing";
  const ready = job?.status === "ready";

  return (
    <div className="product-ai3d">
      <div className="product-ai3d-head">
        <div>
          <span className="product-ai3d-eyebrow">PHOTO TO 3D</span>
          <h4>Generate a real 3D model</h4>
          <p>Choose an existing photo above and generate a true 3D mesh with the connected open-source GPU worker. No re-upload or fake tilt.</p>
        </div>
        <WandSparkles size={22} aria-hidden="true" />
      </div>

      {!saved ? (
        <p className="product-ai3d-note">Save this product as a draft first, then reopen Edit Product to generate 3D.</p>
      ) : photos.length === 0 ? (
        <p className="product-ai3d-note">Add and save at least one clear product photo first.</p>
      ) : (
        <>
          <p className="product-ai3d-label">Choose one clear photo of {productName || "the product"} (front or three-quarter view)</p>
          {unsavedCount > 0 && <p className="product-ai3d-note" role="status">{unsavedCount} newly added photo(s) need Save Product before they can be used for 3D.</p>}
          {eligiblePhotos.length === 0 && <p className="product-ai3d-note">Save the product photos first, then reopen Edit Product to generate 3D.</p>}
          <div className="product-ai3d-photos" role="group" aria-label="Photos to use for real 3D">
            {photos.map((photo, index) => {
              const savedPhoto = eligibleIds.has(photo.id);
              const active = savedPhoto && selected.includes(photo.id);
              return (
                <button key={photo.id} type="button" className={`product-ai3d-photo${active ? " is-selected" : ""}`}
                  aria-label={`Use photo ${index + 1} for 3D generation${savedPhoto ? "" : " (save photo first)"}`}
                  aria-pressed={active}
                  disabled={disabled || loading || inProgress || !savedPhoto}
                  onClick={() => toggle(photo.id)}>
                  <SafeImage src={photo.url} alt={photo.alt || `Photo ${index + 1}`} />
                  {active && <span className="product-ai3d-check"><Check size={13} /></span>}
                </button>
              );
            })}
          </div>
          <p className="product-ai3d-tip">TRELLIS.2 uses one reference photo per generation. It estimates unseen sides, so check the shape and texture carefully before saving. Your original photos stay unchanged.</p>
          {configured === null ? (
            <p className="product-ai3d-note"><LoaderCircle size={14} className="spin" /> Checking 3D generation service…</p>
          ) : !configured ? (
            <div className="product-ai3d-setup" role="status">
              <p className="product-ai3d-note"><AlertCircle size={15} /> Open-source GPU worker is not connected yet.</p>
              <p className="product-ai3d-tip">No Meshy needed. Set up TRELLIS.2 on a Linux NVIDIA GPU host (24 GB+ VRAM), expose it through private HTTPS, then set <strong>BRUTTI_3D_WORKER_URL</strong> and <strong>BRUTTI_3D_WORKER_TOKEN</strong> in the Brutti Catalog Supabase Edge Function secrets.</p>
              <div className="product-ai3d-setup-links">
                <a href="https://github.com/Brutti-team/brutti-catalog/tree/main/worker/open3d" target="_blank" rel="noreferrer">1. GPU worker setup</a>
                <a href="https://supabase.com/dashboard/project/lgdjoxafleqnbomtfzqt/functions/secrets" target="_blank" rel="noreferrer">2. Connect worker secrets</a>
                <button type="button" disabled={loading} onClick={() => {
                  setLoading(true);
                  void photo3DRequest("config", productId).then(result => {
                    setConfigured(result.configured === true);
                    setJob(result.job ?? null);
                    setError("");
                  }).catch(cause => setError(cause instanceof Error ? cause.message : "Cannot recheck the connection."))
                    .finally(() => setLoading(false));
                }}>Recheck connection</button>
              </div>
            </div>
          ) : (
            <>
              {inProgress && <div className="product-ai3d-progress" role="status">
                <LoaderCircle size={16} className="spin" />
                <span>Open-source GPU worker is building your 3D model… {job?.progress !== undefined ? `${Math.round(job.progress)}%` : "Checking progress"}</span>
              </div>}
              {job?.status === "failed" && <p className="product-ai3d-note" role="alert">{job.error || job.failureReason || "Generation failed. Try clearer photos."}</p>}
              {ready && <div className="product-ai3d-ready">
                <Check size={17} aria-hidden="true" />
                <span>3D model generated. Preview it before publishing.</span>
                <button type="button" className="button primary" disabled={disabled || importing}
                  onClick={() => void importGeneratedModel()}>{importing ? "Opening model…" : imported ? "Open model again" : "Preview generated 3D"}</button>
              </div>}
              {imported && <p className="product-ai3d-confirm">The generated model is loaded in the 3D viewer below. Click Save product to keep it.</p>}
              {!inProgress && (
                <button className="button secondary product-ai3d-generate" type="button"
                  disabled={disabled || loading || importing || !selected.length}
                  onClick={() => void generate()}>
                  {loading ? <LoaderCircle size={16} className="spin" /> : <WandSparkles size={16} />}
                  {loading ? "Starting generation…" : ready ? "Generate another 3D" : "Generate 3D from selected photos"}
                </button>
              )}
              <p className="product-ai3d-charge">No Meshy or Lovable credits. Generation uses the connected GPU and may incur hosting costs. Every job requires your confirmation.</p>
            </>
          )}
        </>
      )}
      {error && <p className="product-ai3d-error" role="alert">{error}</p>}
    </div>
  );
}
