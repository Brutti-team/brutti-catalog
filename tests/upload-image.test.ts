import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), optimize: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: calls.getUser }, from: calls.from, storage: { from: calls.storageFrom } }),
}));
vi.mock("../src/lib/image-optimization", () => ({ optimizeImageForUpload: calls.optimize }));

const userId = "90000000-0000-4000-8000-000000000001";
const original = new File(["unit-only source"], "Actual-product-photo.png", { type: "image/png" });
const optimized = new File(["unit-only optimized output"], "Actual-product-photo.webp", { type: "image/webp" });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://unit-only.example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "unit-only-public-key");
  calls.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  calls.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: userId }, error: null }) }) }) });
  calls.optimize.mockResolvedValue(optimized);
  calls.upload.mockResolvedValue({ error: null });
  calls.storageFrom.mockReturnValue({
    upload: calls.upload,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://unit-only.example.supabase.co/storage/v1/object/public/product-images/${path}` } }),
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated optimized image upload", () => {
  it("uploads only the optimized WebP under the authenticated user and fresh UUID", async () => {
    const { uploadImage } = await import("../src/lib/catalog");
    const image = await uploadImage(original);
    expect(calls.optimize).toHaveBeenCalledWith(original);
    expect(calls.storageFrom).toHaveBeenCalledWith("product-images");
    expect(calls.upload).toHaveBeenCalledWith(`${userId}/${image.id}.webp`, optimized, { contentType: "image/webp", upsert: false });
    expect(image.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(image).toMatchObject({ alt: "Actual product photo", storagePath: `${userId}/${image.id}.webp`, url: `https://unit-only.example.supabase.co/storage/v1/object/public/product-images/${userId}/${image.id}.webp` });
    expect(calls.getUser.mock.invocationCallOrder.at(-1)).toBeLessThan(calls.optimize.mock.invocationCallOrder[0]);
  });

  it("requires admin membership before optimization or storage writes", async () => {
    calls.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
    const { uploadImage } = await import("../src/lib/catalog");
    await expect(uploadImage(original)).rejects.toThrow(/administrator/);
    expect(calls.optimize).not.toHaveBeenCalled();
    expect(calls.storageFrom).not.toHaveBeenCalled();
  });

  it("never sends the source image when optimization fails", async () => {
    calls.optimize.mockRejectedValue(new Error("Choose a valid JPEG, PNG or WebP image."));
    const { uploadImage } = await import("../src/lib/catalog");
    await expect(uploadImage(original)).rejects.toThrow(/valid JPEG/);
    expect(calls.upload).not.toHaveBeenCalled();
  });

  it("reports storage failure without returning an image record", async () => {
    calls.upload.mockResolvedValue({ error: { message: "Bucket denied upload" } });
    const { uploadImage } = await import("../src/lib/catalog");
    await expect(uploadImage(original)).rejects.toThrow(/Could not upload this image.*Bucket denied upload/);
  });
});
