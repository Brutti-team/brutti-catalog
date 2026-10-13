import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));

function pngWithDimensions(width: number, height: number): Uint8Array {
  const bytes = png.slice();
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function webpHeader(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"));
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  bytes[16] = 10;
  for (let offset = 0; offset < 3; offset++) {
    bytes[24 + offset] = ((width - 1) >>> (offset * 8)) & 255;
    bytes[27 + offset] = ((height - 1) >>> (offset * 8)) & 255;
  }
  return bytes;
}

function jpegHeader(width = 1, height = 1): Uint8Array {
  return Uint8Array.of(255, 216, 255, 192, 0, 11, 8, height >>> 8, height & 255, width >>> 8, width & 255, 1, 1, 17, 0, 255, 217);
}

function image(bytes: Uint8Array = png, type = "image/png", name = "original-photo.png") {
  return new File([new Uint8Array(bytes)], name, { type });
}

let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let decode: ReturnType<typeof vi.fn>;
let draw: ReturnType<typeof vi.fn>;
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };

beforeEach(() => {
  bitmap = { width: 1, height: 1, close: vi.fn() };
  decode = vi.fn().mockResolvedValue(bitmap);
  draw = vi.fn();
  canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => ({ drawImage: draw })),
    toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([webpHeader()], { type: "image/webp" }))),
  };
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
});
afterEach(() => vi.unstubAllGlobals());

describe("upload image optimization", () => {
  it("exposes the client image optimization entrypoint", async () => {
    await expect(import("../src/lib/image-optimization")).resolves.toHaveProperty("optimizeImageForUpload", expect.any(Function));
  });

  it.each([
    ["PNG", png, "image/png"],
    ["JPEG", jpegHeader(), "image/jpeg"],
    ["WebP", webpHeader(), "image/webp"],
  ])("turns supported %s into a canonical WebP File", async (_format, bytes, type) => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    const source = image(bytes as Uint8Array, type as string, "product.original.png");
    const result = await optimizeImageForUpload(source);
    expect(result).toBeInstanceOf(File);
    expect(result).not.toBe(source);
    expect(result.type).toBe("image/webp");
    expect(result.name).toBe("product.original.webp");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(webpHeader());
    expect(decode).toHaveBeenCalledWith(source, { imageOrientation: "from-image" });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it.each([
    [3600, 2400, 1800, 1200],
    [2400, 3600, 1200, 1800],
    [800, 400, 800, 400],
    [1, 12000, 1, 1800],
  ])("preserves the aspect ratio of %sx%s without upscaling", async (width, height, expectedWidth, expectedHeight) => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    bitmap.width = width; bitmap.height = height;
    await optimizeImageForUpload(image(pngWithDimensions(width, height)));
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, expectedWidth, expectedHeight);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.85);
  });

  it("uses the orientation-aware decoded dimensions for the output", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    bitmap.width = 1200; bitmap.height = 2400;
    await optimizeImageForUpload(image(jpegHeader(2400, 1200), "image/jpeg"));
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 900, 1800);
  });

  it.each([
    [new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png"],
    [new TextEncoder().encode("GIF89a"), "image/jpeg"],
    [png, "image/jpeg"],
    [png.slice(0, 12), "image/png"],
    [webpHeader().slice(0, 28), "image/webp"],
    [Uint8Array.of(255, 216, 255, 225, 255, 255), "image/jpeg"],
  ])("rejects spoofed, unsupported or truncated bytes before decoding", async (bytes, type) => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    await expect(optimizeImageForUpload(image(bytes, type))).rejects.toThrow(/valid JPEG, PNG or WebP/i);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects an unsupported declared type even when its bytes are PNG", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    await expect(optimizeImageForUpload(image(png, "image/svg+xml"))).rejects.toThrow(/JPEG, PNG or WebP/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("detects supported bytes when the browser provides no MIME type", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    expect((await optimizeImageForUpload(image(png, ""))).type).toBe("image/webp");
  });

  it("rejects empty files and sources above 20 MB before decoding", async () => {
    const { optimizeImageForUpload, MAX_SOURCE_IMAGE_SIZE } = await import("../src/lib/image-optimization");
    expect(MAX_SOURCE_IMAGE_SIZE).toBe(20 * 1024 * 1024);
    for (const bytes of [new Uint8Array(), new Uint8Array(MAX_SOURCE_IMAGE_SIZE + 1)]) {
      await expect(optimizeImageForUpload(image(bytes))).rejects.toThrow(/20 MB/);
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it("accepts the 20 MB source boundary and keeps the storage file below 5 MB", async () => {
    const { optimizeImageForUpload, MAX_SOURCE_IMAGE_SIZE } = await import("../src/lib/image-optimization");
    const bytes = new Uint8Array(MAX_SOURCE_IMAGE_SIZE); bytes.set(png);
    expect((await optimizeImageForUpload(image(bytes))).size).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it.each([[0, 1], [1, 0], [10000, 4001], [16385, 1]])("rejects unsafe %sx%s header dimensions before decoding", async (width, height) => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    await expect(optimizeImageForUpload(image(pngWithDimensions(width, height)))).rejects.toThrow(/40 megapixels|dimensions/i);
    expect(decode).not.toHaveBeenCalled();
  });

  it("accepts exactly 40 megapixels", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    bitmap.width = 10000; bitmap.height = 4000;
    await optimizeImageForUpload(image(pngWithDimensions(10000, 4000)));
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 1800, 720);
  });

  it("fails clearly when the browser cannot decode and never encodes the original", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    decode.mockRejectedValue(new Error("Invalid source data"));
    await expect(optimizeImageForUpload(image())).rejects.toThrow(/decode this image/i);
    expect(draw).not.toHaveBeenCalled();
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it("fails clearly if browser image optimization is unavailable", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(optimizeImageForUpload(image())).rejects.toThrow(/browser.*image optimization/i);
  });

  it("rechecks decoded dimensions and releases the bitmap on rejection", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    bitmap.width = 10000; bitmap.height = 5000;
    await expect(optimizeImageForUpload(image())).rejects.toThrow(/40 megapixels/i);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
  });

  it("rejects decoded dimensions that do not match the source header or its orientation", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    bitmap.width = 2; bitmap.height = 1;
    await expect(optimizeImageForUpload(image())).rejects.toThrow(/dimensions.*match/i);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
  });

  it.each([
    null,
    new Blob([png], { type: "image/png" }),
    new Blob([png], { type: "image/webp" }),
    new Blob([], { type: "image/webp" }),
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/webp" }),
  ])("rejects failed, fallback, spoofed or oversized encoder output", async blob => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    canvas.toBlob.mockImplementation((callback: BlobCallback) => callback(blob));
    await expect(optimizeImageForUpload(image())).rejects.toThrow(/WebP|5 MB/);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("releases image memory when canvas drawing fails", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    draw.mockImplementation(() => { throw new Error("out of memory"); });
    await expect(optimizeImageForUpload(image())).rejects.toThrow(/optimize this image/i);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("shows a clear optimization error for unexpected browser failures", async () => {
    const { optimizeImageForUpload } = await import("../src/lib/image-optimization");
    draw.mockImplementation(() => { throw new Error("WebP graphics driver exception"); });
    await expect(optimizeImageForUpload(image())).rejects.toThrow("Could not optimize this image. Choose a smaller image or use a current browser.");
  });
});
