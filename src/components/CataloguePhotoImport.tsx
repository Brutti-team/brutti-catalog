import { useState } from "react";
import { AlertTriangle, FileArchive, Images, LoaderCircle, ShieldCheck } from "lucide-react";
import Modal from "./Modal";
import { attachBruttiCataloguePhotos, type PhotoImportProgress, type PhotoImportResult } from "../lib/catalogue-photo-import";
import "./catalogue-photo-import.css";

export default function CataloguePhotoImport({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: (result: PhotoImportResult) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<PhotoImportProgress | null>(null);
  const [result, setResult] = useState<PhotoImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const complete = await attachBruttiCataloguePhotos(file, setProgress);
      setProgress({ completed: complete.total, total: complete.total,
        attached: complete.attached, skipped: complete.skipped,
        current: "Final verification complete" });
      if (complete.ready === complete.total && complete.errors.length === 0) {
        // Full, verified success: parent refreshes, announces a toast, then we close.
        await onDone(complete);
        onClose();
      } else {
        // Partial outcomes should never masquerade as complete or auto-dismiss.
        setResult(complete);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to process the photo upload.");
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Attach original catalogue photos" onClose={() => { if (!busy) onClose(); }}>
      <div className="catalog-bulk-upload">
        <div className="bulk-upload-intro">
          <span className="bulk-upload-symbol"><Images size={22} /></span>
          <div>
            <h3>One file. All 96 products.</h3>
            <p>Select the Brutti 2025 ZIP containing 96 WebP photos. Photos are securely matched by SKU and saved to Supabase Storage. Previously attached photos are kept.</p>
          </div>
        </div>
        <label className="bulk-upload-file">
          <FileArchive size={22} aria-hidden="true" />
          <span>{file ? file.name : "Choose the Brutti photo package ZIP"}</span>
          <input type="file" accept=".zip,application/zip" disabled={busy}
            onChange={e => { setFile(e.target.files?.[0] ?? null); setProgress(null); setResult(null); setError(""); }} />
        </label>
        <div className="bulk-upload-safe">
          <ShieldCheck size={16} />
          <span>Drafts only. No existing product photos or staff edits are overwritten. Every file is checked against the original image digest before upload.</span>
        </div>
        {progress && <div className="bulk-upload-progress" role="status">
          <div className="bulk-upload-progress-label"><strong>{progress.completed} / {progress.total}</strong><span>{progress.current}</span></div>
          <progress value={progress.completed} max={progress.total} aria-label="Catalogue photo upload progress" />
          <p>Attached: {progress.attached} · Existing items skipped: {progress.skipped}</p>
        </div>}
        {error && <p className="bulk-upload-error" role="alert"><AlertTriangle size={16} /> {error}</p>}
        {result && <div className="bulk-upload-result bulk-upload-incomplete" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>{result.ready} of {result.total} product photos verified</strong>
            <p>{result.attached} added in this attempt · {result.skipped} skipped (may already have photos) · {result.errors.length} errors. The popup stays open because the full set is not yet confirmed.</p>
            {result.errors.length > 0 && <details>
              <summary>View errors and retry safely</summary>
              <ul>{result.errors.slice(0, 25).map((line, index) => <li key={index}>{line}</li>)}</ul>
            </details>}
          </div>
        </div>}
        <div className="bulk-upload-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Close</button>
          <button type="button" className="button primary" disabled={!file || busy}
            onClick={() => { void upload(); }}>
            {busy ? <LoaderCircle size={16} className="bulk-upload-spinner" /> : <Images size={16} />}
            {busy ? "Uploading photos…" : result ? "Retry remaining photos" : "Attach photos to Draft products"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
