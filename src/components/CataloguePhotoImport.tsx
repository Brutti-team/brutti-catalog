import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, Images, LoaderCircle, ShieldCheck } from "lucide-react";
import Modal from "./Modal";
import { attachBruttiCataloguePhotos, type PhotoImportProgress, type PhotoImportResult } from "../lib/catalogue-photo-import";
import "./catalogue-photo-import.css";

export default function CataloguePhotoImport({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
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
      setResult(complete);
      await onDone();
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
            <p>Use the original <strong>Brutti_Catalogue_2025_Admin_Photo_Upload.zip</strong> from this chat. Photos are matched by their unique product reference and uploaded to Supabase Storage.</p>
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
        {result && <div className="bulk-upload-result">
          <CheckCircle2 size={19} />
          <div>
            <strong>{result.attached} photos attached successfully</strong>
            <p>{result.skipped} already completed or no longer Draft. {result.errors.length} failed.</p>
            {result.errors.length > 0 && <details>
              <summary>View errors (you can safely retry this ZIP)</summary>
              <ul>{result.errors.slice(0, 25).map((line, index) => <li key={index}>{line}</li>)}</ul>
            </details>}
          </div>
        </div>}
        <div className="bulk-upload-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Close</button>
          <button type="button" className="button primary" disabled={!file || busy}
            onClick={() => { void upload(); }}>
            {busy ? <LoaderCircle size={16} className="bulk-upload-spinner" /> : <Images size={16} />}
            {busy ? "Uploading photos…" : "Attach photos to Draft products"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
