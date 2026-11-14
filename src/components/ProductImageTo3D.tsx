import { useEffect, useState } from "react";
import { AlertCircle, Check, LoaderCircle, WandSparkles } from "lucide-react";
import SafeImage from "./SafeImage";
import type { ProductImage } from "../lib/types";
import { downloadGenerated3D, photo3DRequest, type Photo3DJob } from "../lib/photo-to-3d";

type Props = {
  productId: string;
  productName: string;
  photos: readonly ProductImage[];
  saved: boolean;
  disabled: boolean;
  onGenerated: (file: File) => Promise<void>;
};

export default function ProductImageTo3D({
  productId, productName, photos, saved, disabled, onGenerated
}: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string[]>(() => photos.slice(0, 4).map(photo => photo.id));
  const [job, setJob] = useState<Photo3DJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const ids = new Set(photos.map(photo => photo.id));
    setSelected(current => {
      const stillPresent = current.filter(id => ids.has(id)).slice(0, 4);
      return stillPresent.length ? stillPresent : photos.slice(0, 4).map(photo => photo.id);
    });
  }, [photos]);

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
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) :
      current.length < 4 ? [...current, id] : current);
    setImported(false);
  };

  async function generate() {
    if (disabled || loading || !selected.length || !configured) return;
    if (!window.confirm("Generate a real 3D model from these product photos? This uses paid Meshy API credits. Continue?")) return;
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

  async function useModel() {
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
          <p>Use the product photos already added above. No second upload. A mesh with depth and textures is generated for 360° viewing.</p>
        </div>
        <WandSparkles size={22} aria-hidden="true" />
      </div>

      {!saved ? (
        <p className="product-ai3d-note">Save this product as a draft first, then reopen Edit Product to generate 3D.</p>
      ) : photos.length === 0 ? (
        <p className="product-ai3d-note">Add and save at least one clear product photo first.</p>
      ) : (
        <>
          <p className="product-ai3d-label">Choose 1–4 photos of the same {productName || "product"} (front view first)</p>
          <div className="product-ai3d-photos" role="group" aria-label="Photos to use for real 3D">
            {photos.map((photo, index) => {
              const active = selected.includes(photo.id);
              return (
                <button key={photo.id} type="button" className={`product-ai3d-photo${active ? " is-selected" : ""}`}
                  aria-label={`Use photo ${index + 1} for 3D generation`}
                  aria-pressed={active}
                  disabled={disabled || loading || inProgress}
                  onClick={() => toggle(photo.id)}>
                  <SafeImage src={photo.url} alt={photo.alt || `Photo ${index + 1}`} />
                  {active && <span className="product-ai3d-check"><Check size={13} /></span>}
                </button>
              );
            })}
          </div>
          <p className="product-ai3d-tip">More angles improve shape accuracy. AI estimates unseen sides, so review the result before saving. The original product photos stay unchanged.</p>
          {configured === null ? (
            <p className="product-ai3d-note"><LoaderCircle size={14} className="spin" /> Checking 3D generation service…</p>
          ) : !configured ? (
            <p className="product-ai3d-note" role="status"><AlertCircle size={15} /> AI generation is not connected yet. An administrator must set the MESHY_API_KEY secret in Brutti Catalog Supabase.</p>
          ) : (
            <>
              {inProgress && <div className="product-ai3d-progress" role="status">
                <LoaderCircle size={16} className="spin" />
                <span>Meshy is generating your real 3D model… {job?.progress !== undefined ? `${Math.round(job.progress)}%` : "Checking progress"}</span>
              </div>}
              {job?.status === "failed" && <p className="product-ai3d-note" role="alert">{job.error || job.failureReason || "Generation failed. Try clearer photos."}</p>}
              {ready && <div className="product-ai3d-ready">
                <Check size={17} aria-hidden="true" />
                <span>3D model generated. Preview it before publishing.</span>
                <button type="button" className="button primary" disabled={disabled || importing}
                  onClick={() => void useModel()}>{importing ? "Opening model…" : imported ? "Open model again" : "Preview generated 3D"}</button>
              </div>}
              {imported && <p className="product-ai3d-confirm">The generated model is loaded in the 3D viewer below. Click Save product to keep it.</p>}
              {!inProgress && (
                <button className="button secondary product-ai3d-generate" type="button"
                  disabled={disabled || loading || importing || !selected.length}
                  onClick={() => void generate()}>
                  {loading ? <LoaderCircle size={16} className="spin" /> : <WandSparkles size={16} />}
                  {loading ? "Starting generation…" : ready ? "Generate another 3D (uses credits)" : "Generate 3D from selected photos"}
                </button>
              )}
              <p className="product-ai3d-charge">A generation uses Meshy API credits only when you confirm the Generate action. No automatic paid jobs.</p>
            </>
          )}
        </>
      )}
      {error && <p className="product-ai3d-error" role="alert">{error}</p>}
    </div>
  );
}
