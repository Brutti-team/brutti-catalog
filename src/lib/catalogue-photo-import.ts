import { catalogClient, getAuthState } from "./catalog";

export type PhotoImportProgress = {
  completed: number;
  total: number;
  attached: number;
  skipped: number;
  current: string;
};
export type PhotoImportResult = {
  attached: number;
  skipped: number;
  errors: string[];
};
type ZipItem = { sku: string; page: number; file: string; sha256: string };
type ImportManifest = {
  version: number;
  source: string;
  sourcePdfSha256: string;
  items: ZipItem[];
};
type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  status: string;
  images: unknown;
};

const maxZipBytes = 35 * 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const photoPath = /^photos\/page-(\d{3})\.webp$/;
const skuPattern = /^BRT25-P(\d{3})$/;
const shaPattern = /^[a-f0-9]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

/** This uploader accepts our generated uncompressed, locally verified ZIP only. */
async function readStoredZip(file: File): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  if (file.size < 100 || file.size > maxZipBytes || !file.name.toLowerCase().endsWith(".zip"))
    throw new Error("Choose the Brutti Admin Photo Upload ZIP (maximum 35 MB).");
  const source = await file.arrayBuffer();
  const view = new DataView(source);
  const out = new Map<string, Uint8Array<ArrayBuffer>>();
  let offset = 0;
  while (offset + 30 <= view.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const uncompressed = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x0009 || method !== 0 || compressed !== uncompressed)
      throw new Error("Invalid or compressed ZIP. Use the dedicated Brutti photo upload file.");
    const start = offset + 30 + nameLength + extraLength;
    if (start > view.byteLength || compressed > maxImageBytes || start + compressed > view.byteLength)
      throw new Error("Invalid or oversized ZIP entry.");
    const name = decoder.decode(new Uint8Array(source.slice(offset + 30, offset + 30 + nameLength)));
    if (name !== "manifest.json" && !photoPath.test(name))
      throw new Error("The ZIP contains a file that is not part of the Brutti photo package.");
    if (out.has(name)) throw new Error("Duplicate ZIP entries are not allowed.");
    out.set(name, new Uint8Array(source.slice(start, start + compressed)));
    if (out.size > 100) throw new Error("The ZIP has too many files.");
    offset = start + compressed;
  }
  if (view.byteLength - offset < 22 || view.getUint32(offset, true) !== 0x02014b50)
    throw new Error("ZIP structure is invalid or incomplete.");
  return out;
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseManifest(entries: Map<string, Uint8Array<ArrayBuffer>>): ImportManifest {
  const raw = entries.get("manifest.json");
  if (!raw || raw.byteLength > 160000) throw new Error("The ZIP manifest is missing or too large.");
  let value: ImportManifest;
  try {
    value = JSON.parse(decoder.decode(raw)) as ImportManifest;
  } catch {
    throw new Error("Unable to parse the photo manifest.");
  }
  if (value.version !== 1 || value.source !== "Brutti Catalogue 2025.pdf" ||
      !shaPattern.test(value.sourcePdfSha256) || !Array.isArray(value.items) ||
      value.items.length !== 96 || entries.size !== 97)
    throw new Error("This is not the approved 96-photo Brutti Catalogue 2025 package.");
  const seen = new Set<string>();
  const pages = new Set<number>();
  for (const item of value.items) {
    const sku = item.sku?.match(skuPattern);
    const photo = item.file?.match(photoPath);
    if (!sku || !photo || !shaPattern.test(item.sha256) ||
        Number(sku[1]) !== item.page || Number(photo[1]) !== item.page ||
        item.page < 1 || item.page > 104 || seen.has(item.sku) || pages.has(item.page))
      throw new Error("The ZIP manifest has invalid or duplicate product references.");
    seen.add(item.sku);
    pages.add(item.page);
    const bytes = entries.get(item.file);
    if (!bytes || bytes.byteLength > maxImageBytes ||
        decoder.decode(bytes.slice(0, 4)) !== "RIFF" ||
        decoder.decode(bytes.slice(8, 12)) !== "WEBP")
      throw new Error(`The photo for ${item.sku} is missing or not a valid WebP file.`);
  }
  return value;
}

export async function attachBruttiCataloguePhotos(
  file: File,
  onProgress: (progress: PhotoImportProgress) => void,
): Promise<PhotoImportResult> {
  const access = await getAuthState();
  if (!access.authenticated || !access.isAdmin)
    throw new Error("Please sign in using an approved Brutti Catalog admin account.");

  const db = catalogClient();
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) throw new Error("Your admin session has expired. Sign in again.");
  const entries = await readStoredZip(file);
  const manifest = parseManifest(entries);

  // Verify *all* file digests BEFORE any uploads. Never accept a changed image.
  onProgress({ completed: 0, total: 96, attached: 0, skipped: 0, current: "Verifying 96 original WebP photos" });
  for (const item of manifest.items) {
    const bytes = entries.get(item.file)!;
    if (await sha256Hex(bytes) !== item.sha256)
      throw new Error(`Image integrity check failed for ${item.sku}; nothing uploaded.`);
  }

  // Check the real product identities and existing edits before beginning any upload.
  const existing = new Map<string, ProductRecord>();
  for (let i = 0; i < manifest.items.length; i += 25) {
    const chunk = manifest.items.slice(i, i + 25).map(item => item.sku);
    const { data, error } = await db.from("products")
      .select("id,sku,name,status,images").in("sku", chunk);
    if (error) throw new Error(`Cannot validate existing catalog products: ${error.message}`);
    for (const record of (data || []) as ProductRecord[]) existing.set(record.sku, record);
  }
  if (manifest.items.some(item => !existing.has(item.sku)))
    throw new Error("One or more original product SKUs are missing. No photo uploads started.");

  let attached = 0, skipped = 0;
  const errors: string[] = [];
  const bucket = db.storage.from("product-images");
  for (const [index, item] of manifest.items.entries()) {
    const record = existing.get(item.sku)!;
    onProgress({ completed: index, total: 96, attached, skipped, current: item.sku });
    if (record.status !== "draft" || (Array.isArray(record.images) && record.images.length > 0)) {
      skipped++;
      continue;
    }
    const bytes = entries.get(item.file)!;
    const storagePath = `${user.id}/brutti2025/${item.sku}/${item.sha256}.webp`;
    try {
      const objectData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const { error: uploadError } = await bucket.upload(storagePath, new Blob([objectData], { type: "image/webp" }), {
        contentType: "image/webp", upsert: false,
      });
      if (uploadError) {
        // Reruns may encounter a previously uploaded object from an interrupted session;
        // never trust a generic 400/409 without verifying bytes.
        if (String(uploadError.statusCode) !== "409" &&
            !/already exists|duplicate/i.test(uploadError.message)) throw uploadError;
        const { data: stored, error: downloadError } = await bucket.download(storagePath);
        if (downloadError || !stored ||
            await sha256Hex(new Uint8Array(await stored.arrayBuffer())) !== item.sha256)
          throw new Error("Existing stored file does not match the original photo.");
      }
      const photo = {
        id: crypto.randomUUID(),
        storagePath,
        url: bucket.getPublicUrl(storagePath).data.publicUrl,
        alt: record.name,
      };
      const { data: updated, error: updateError } = await db.from("products")
        .update({ images: [photo] })
        .eq("id", record.id)
        .eq("status", "draft")
        .filter("images", "eq", "[]")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (updated) attached++;
      else skipped++; // Concurrent edit/publish; do not overwrite another user's changes.
    } catch (error) {
      errors.push(`${item.sku}: ${error instanceof Error ? error.message : "Upload failed"}`);
    }
    onProgress({ completed: index + 1, total: 96, attached, skipped, current: item.sku });
  }
  return { attached, skipped, errors };
}
