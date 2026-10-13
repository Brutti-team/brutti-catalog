import SafeImage from "./SafeImage";
import { useState, useRef, type FormEvent } from "react";
import {
  ImagePlus,
  ArrowLeft,
  ArrowRight,
  X,
  Eye,
  Save,
  LoaderCircle,
} from "lucide-react";
import type { Product, Category } from "../lib/types";
import { uploadImage, validateProduct, isDemoMode } from "../lib/catalog";
import Modal from "./Modal";
export default function ProductEditor({
  product,
  categories,
  onSave,
  onClose,
}: {
  product: Product;
  categories: Category[];
  onSave: (p: Product) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Product>(structuredClone(product));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = <K extends keyof Product>(key: K, value: Product[K]) =>
    setDraft((p) => ({ ...p, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      validateProduct(draft);
      setBusy(true);
      await onSave({ ...draft, updatedAt: new Date().toISOString() });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save product. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addImages(files: FileList | null) {
    if (!files) return;
    setError("");
    if (draft.images.length + files.length > 8) {
      setError("Add up to 8 images per product.");
      return;
    }
    setUploading(true);
    try {
      const next = [];
      for (const file of Array.from(files)) next.push(await uploadImage(file));
      update("images", [...draft.images, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function move(index: number, step: number) {
    const images = [...draft.images];
    [images[index], images[index + step]] = [
      images[index + step],
      images[index],
    ];
    update("images", images);
  }
  return (
    <Modal
      title={product.name ? "Edit product" : "Create product"}
      wide
      onClose={() => {
        if (busy || uploading) return;
        if (
          JSON.stringify(draft) !== JSON.stringify(product) &&
          !window.confirm("Discard your unsaved product changes?")
        )
          return;
        onClose();
      }}
    >
      <form onSubmit={submit} className="editor-form">
        <div className="editor-columns">
          <div className="editor-primary">
            <section className="form-section">
              <h3>Product details</h3>
              <p className="muted">
                Good furniture deserves a thoughtful introduction.
              </p>
              <label>
                Product name <span>*</span>
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  placeholder="e.g. Senar Lounge Chair"
                  onChange={(e) => update("name", e.target.value)}
                />
              </label>
              <div className="field-pair">
                <label>
                  SKU <span>*</span>
                  <input
                    required
                    maxLength={64}
                    value={draft.sku}
                    placeholder="BR-CHR-001"
                    onChange={(e) => update("sku", e.target.value)}
                  />
                </label>
                <label>
                  Category <span>*</span>
                  <select
                    required
                    value={draft.categoryId}
                    onChange={(e) => update("categoryId", e.target.value)}
                  >
                    <option value="">Select a category</option>
                    {categories.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Description
                <textarea
                  rows={4}
                  maxLength={5000}
                  value={draft.description}
                  placeholder="Tell the story, the details, and what makes it special."
                  onChange={(e) => update("description", e.target.value)}
                />
              </label>
              <label>
                Materials
                <input
                  maxLength={500}
                  value={draft.materials}
                  placeholder="e.g. Reclaimed timber, natural oil finish"
                  onChange={(e) => update("materials", e.target.value)}
                />
              </label>
              <div className="section-label">
                Dimensions <span className="muted">in centimetres</span>
              </div>
              <div className="field-trio">
                {(["width", "depth", "height"] as const).map((key) => (
                  <label key={key}>
                    {key[0].toUpperCase() + key.slice(1)}
                    <input
                      aria-label={`${key} in centimetres`}
                      type="number"
                      min={0.1}
                      max={10000}
                      step="0.1"
                      value={draft[key]}
                      onChange={(e) => update(key, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
              <label>
                Price <span className="muted">optional · MYR</span>
                <div className="price-input">
                  <span>RM</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.price ?? ""}
                    placeholder="Leave blank for price on enquiry"
                    onChange={(e) =>
                      update(
                        "price",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </div>
              </label>
            </section>
            <section className="form-section">
              <div className="section-title">
                <h3>Product images</h3>
                <span className="muted">{draft.images.length}/8</span>
              </div>
              <p className="muted">
                The first image is your cover. JPEG, PNG or WebP, up to 5 MB
                each.
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => void addImages(e.target.files)}
              />
              <button
                type="button"
                className="upload-zone"
                disabled={uploading || busy}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <ImagePlus size={27} />
                )}
                <strong>
                  {uploading ? "Uploading images…" : "Click to add images"}
                </strong>
                <span>Choose multiple images from your device</span>
              </button>
              <div className="image-editor-grid">
                {draft.images.map((img, index) => (
                  <div className="image-editor-item" key={img.id}>
                    <div className="image-editor-photo">
                      <SafeImage src={img.url} alt={img.alt || draft.name} />
                      {index === 0 && <span>Cover</span>}
                      <button
                        type="button"
                        className="image-remove"
                        aria-label={`Remove image ${index + 1}`}
                        onClick={() =>
                          update(
                            "images",
                            draft.images.filter((i) => i.id !== img.id),
                          )
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      aria-label={`Image ${index + 1} description`}
                      placeholder="Image description"
                      value={img.alt}
                      onChange={(e) =>
                        update(
                          "images",
                          draft.images.map((i) =>
                            i.id === img.id ? { ...i, alt: e.target.value } : i,
                          ),
                        )
                      }
                    />
                    <div className="image-order">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Move image ${index + 1} earlier`}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <span>
                        {index + 1} of {draft.images.length}
                      </span>
                      <button
                        type="button"
                        disabled={index === draft.images.length - 1}
                        aria-label={`Move image ${index + 1} later`}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="tiny muted">
                {isDemoMode
                  ? "Demo uploads stay in this browser. Large collections may exceed browser storage."
                  : "Uploaded photos are public assets. Avoid confidential images; unused uploads can be removed from Supabase Storage."}
              </p>
            </section>
          </div>
          <aside className="editor-side">
            <section className="form-section">
              <h3>Publishing</h3>
              <label>
                Status
                <select
                  value={draft.status}
                  onChange={(e) =>
                    update("status", e.target.value as Product["status"])
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <p className="tiny muted">
                Only published products appear in the public catalog.
              </p>
              <label>
                Availability
                <select
                  value={draft.availability}
                  onChange={(e) =>
                    update(
                      "availability",
                      e.target.value as Product["availability"],
                    )
                  }
                >
                  <option value="available">Available</option>
                  <option value="made-to-order">Made to order</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={draft.featured}
                  onChange={(e) => update("featured", e.target.checked)}
                />
                <span>
                  Feature this product
                  <small>Give it a place in the spotlight.</small>
                </span>
              </label>
            </section>
            <section className="editor-note">
              <span className="eyebrow">A LITTLE GUIDANCE</span>
              <h3>Ready for its close-up?</h3>
              <p>
                Add a clear cover image, a considered description, and accurate
                dimensions before publishing.
              </p>
            </section>
            <button
              type="button"
              className="button secondary full"
              onClick={() => setPreview(!preview)}
            >
              <Eye size={16} />
              {preview ? "Hide preview" : "Preview product"}
            </button>
            {preview && (
              <article className="editor-preview">
                {draft.images[0] ? (
                  <SafeImage
                    src={draft.images[0].url}
                    alt={draft.images[0].alt || draft.name}
                  />
                ) : (
                  <div className="preview-placeholder">
                    <ImagePlus />
                  </div>
                )}
                <span className="eyebrow">
                  {categories.find((c) => c.id === draft.categoryId)?.name ||
                    "YOUR CATEGORY"}
                </span>
                <h3>{draft.name || "Your product name"}</h3>
                <p>
                  {draft.price === null
                    ? "Price on enquiry"
                    : new Intl.NumberFormat("en-MY", {
                        style: "currency",
                        currency: "MYR",
                      }).format(draft.price)}
                </p>
                <p className="tiny muted">
                  {draft.description ||
                    "Your thoughtful product story will appear here."}
                </p>
              </article>
            )}
          </aside>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <footer className="editor-footer">
          <span className="tiny muted">
            {isDemoMode
              ? "Demo workspace · saved to this browser"
              : "Connected workspace · changes saved to Supabase"}
          </span>
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              disabled={busy || uploading}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || uploading}
              type="submit"
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}{" "}
              {busy ? "Saving…" : "Save product"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
