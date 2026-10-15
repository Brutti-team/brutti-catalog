// Source limits are checked before decoding, which can allocate much more memory
// than the compressed file. The storage bucket still accepts at most 5 MB.
export const MAX_SOURCE_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_SOURCE_EDGE = 16_384;
const MAX_OUTPUT_SIZE = 5 * 1024 * 1024;
const MAX_OUTPUT_EDGE = 1800;
const WEBP_QUALITY = 0.85;

class ImageOptimizationError extends Error {}

type ImageHeader = { type: string; width: number; height: number };
const invalidImage = () => new ImageOptimizationError("Choose a valid JPEG, PNG or WebP image. Its contents must match its file type.");

function matches(bytes: Uint8Array, offset: number, expected: number[] | string): boolean {
  const sequence = typeof expected === "string"
    ? Array.from(expected, character => character.charCodeAt(0))
    : expected;
  return sequence.every((byte, index) => bytes[offset + index] === byte);
}

function readImageHeader(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || !matches(bytes, 12, "IHDR")) throw invalidImage();
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (matches(bytes, 0, [255, 216, 255])) {
    // Skip length-delimited metadata, including EXIF, to reach the JPEG frame.
    let offset = 2;
    const frames = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw invalidImage();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalidImage();
      if (frames.includes(marker)) {
        if (length < 8) throw invalidImage();
        return { type: "image/jpeg", width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
    throw invalidImage();
  }
  if (matches(bytes, 0, "RIFF") && matches(bytes, 8, "WEBP")) {
    if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) throw invalidImage();
    const chunkLength = view.getUint32(16, true);
    if (20 + chunkLength > bytes.length) throw invalidImage();
    const uint24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    if (matches(bytes, 12, "VP8X") && chunkLength === 10 && bytes.length >= 30) {
      return { type: "image/webp", width: uint24(24) + 1, height: uint24(27) + 1 };
    }
    if (matches(bytes, 12, "VP8 ") && chunkLength >= 10 && matches(bytes, 23, [157, 1, 42])) {
      return { type: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (matches(bytes, 12, "VP8L") && chunkLength >= 5 && bytes[20] === 0x2f) {
      const dimensions = view.getUint32(21, true);
      return { type: "image/webp", width: (dimensions & 0x3fff) + 1, height: ((dimensions >>> 14) & 0x3fff) + 1 };
    }
  }
  throw invalidImage();
}

function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new ImageOptimizationError("This image has invalid dimensions. Choose another image.");
  if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS)
    throw new ImageOptimizationError("Choose an image of at most 40 megapixels and 16,384 pixels per side.");
}

/** Decode orientation, resize and encode actual upload bytes; never upload a fallback. */
export async function optimizeImageForUpload(file: File): Promise<File> {
  if (!file.size || file.size > MAX_SOURCE_IMAGE_SIZE)
    throw new ImageOptimizationError("Each source image must be between 1 byte and 20 MB.");
  if (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw invalidImage();
  const header = readImageHeader(new Uint8Array(await file.arrayBuffer()));
  if (file.type && file.type !== header.type) throw invalidImage();
  checkDimensions(header.width, header.height);
  if (typeof createImageBitmap !== "function" || typeof document === "undefined")
    throw new ImageOptimizationError("This browser cannot perform image optimization. Use a current browser to upload images.");

  let bitmap: ImageBitmap;
  try {
    // Native decoding applies EXIF rotation/mirroring before dimensions and drawing.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageOptimizationError("Could not decode this image. Choose a valid JPEG, PNG or WebP image.");
  }
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkDimensions(bitmap.width, bitmap.height);
    if (!((bitmap.width === header.width && bitmap.height === header.height) ||
      (bitmap.width === header.height && bitmap.height === header.width)))
      throw new ImageOptimizationError("The decoded image dimensions do not match its file header. Choose another image.");
    const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ImageOptimizationError("This browser cannot optimize this image. Use a current browser to upload images.");
    // An unfilled canvas preserves PNG/WebP transparency.
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      try { canvas!.toBlob(resolve, "image/webp", WEBP_QUALITY); }
      catch { reject(new ImageOptimizationError("Could not optimize this image as WebP. Choose another image or use a current browser.")); }
    });
    if (!blob || !blob.size || blob.type !== "image/webp")
      throw new ImageOptimizationError("This browser could not encode this image as WebP. Use a current browser to upload images.");
    if (blob.size > MAX_OUTPUT_SIZE)
      throw new ImageOptimizationError("The optimized WebP exceeds the 5 MB storage limit. Choose a smaller image.");
    try {
      if (readImageHeader(new Uint8Array(await blob.arrayBuffer())).type !== "image/webp") throw invalidImage();
    } catch {
      throw new ImageOptimizationError("This browser could not encode a valid WebP image. Use a current browser to upload images.");
    }
    const name = `${file.name.replace(/\.[^.]+$/, "") || "product-image"}.webp`;
    return new File([blob], name, { type: "image/webp" });
  } catch (error) {
    if (error instanceof ImageOptimizationError) throw error;
    throw new ImageOptimizationError("Could not optimize this image. Choose a smaller image or use a current browser.");
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
