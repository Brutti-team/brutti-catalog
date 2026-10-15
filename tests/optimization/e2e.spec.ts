import { expect, test } from "@playwright/test";

// This suite runs only against the configured Playwright backend placeholder.
// Native browser decode/encode is real; all backend traffic is intercepted.
const endpoint = "https://catalog-browser-test.supabase.co";
const user = { id: "90000000-0000-4000-8000-000000000001", email: "optimization-test@example.invalid", role: "authenticated", aud: "authenticated" };
const token = `e30.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated" })).toString("base64url")}.test`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem("sb-catalog-browser-test-auth-token", JSON.stringify({ access_token: token, refresh_token: "test-only-refresh", token_type: "bearer", expires_at: 4102444800, expires_in: 3600, user }));
  }, { user, token });
  await page.route(`${endpoint}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/auth/v1/user" ? user : path.endsWith("catalog_admins") ? { user_id: user.id } : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/#/catalog");
});

test("native JPEG, PNG and WebP encoding resizes without losing transparent backgrounds", async ({ page }) => {
  const results = await page.evaluate(async () => {
    const modulePath = "/src/lib/image-optimization.ts";
    const { optimizeImageForUpload } = await import(/* @vite-ignore */ modulePath);
    const output = [];
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      const source = document.createElement("canvas");
      source.width = 3000; source.height = 2000;
      const context = source.getContext("2d")!;
      context.fillStyle = "#cf4d36"; context.fillRect(100, 100, 2800, 1800);
      const blob = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), type, 1));
      const file = await optimizeImageForUpload(new File([blob], "source-image.photo", { type }));
      const decoded = await createImageBitmap(file);
      const probe = document.createElement("canvas"); probe.width = 1; probe.height = 1;
      const probeContext = probe.getContext("2d")!;
      probeContext.drawImage(decoded, 0, 0);
      output.push({ sourceType: type, type: file.type, name: file.name, width: decoded.width, height: decoded.height, size: file.size, alpha: probeContext.getImageData(0, 0, 1, 1).data[3], magic: Array.from(new Uint8Array(await file.slice(0, 12).arrayBuffer())) });
      decoded.close(); source.width = source.height = 0;
    }
    return output;
  });
  for (const result of results) {
    expect(result).toMatchObject({ type: "image/webp", name: "source-image.webp", width: 1800, height: 1200 });
    expect(result.size).toBeGreaterThan(0);
    expect(result.size).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(Buffer.from(result.magic.slice(0, 4)).toString()).toBe("RIFF");
    expect(Buffer.from(result.magic.slice(8, 12)).toString()).toBe("WEBP");
    expect(result.alpha).toBe(result.sourceType === "image/jpeg" ? 255 : 0);
  }
});

test("native optimization applies EXIF rotation and mirroring and removes the source metadata", async ({ page }) => {
  const results = await page.evaluate(async () => {
    const modulePath = "/src/lib/image-optimization.ts";
    const { optimizeImageForUpload } = await import(/* @vite-ignore */ modulePath);
    const source = document.createElement("canvas"); source.width = 80; source.height = 40;
    const context = source.getContext("2d")!;
    context.fillStyle = "red"; context.fillRect(0, 0, 40, 40);
    context.fillStyle = "blue"; context.fillRect(40, 0, 40, 40);
    const jpeg = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), "image/jpeg", 1));
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const results = [];
    for (const orientation of [6, 2]) {
      // JPEG APP1: Exif header + a little-endian TIFF IFD containing Orientation.
      const exif = Uint8Array.of(255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0);
      const file = new File([bytes.slice(0, 2), exif, bytes.slice(2)], "oriented.jpg", { type: "image/jpeg" });
      const optimized = await optimizeImageForUpload(file);
      const decoded = await createImageBitmap(optimized);
      const probe = document.createElement("canvas"); probe.width = decoded.width; probe.height = decoded.height;
      const probeContext = probe.getContext("2d")!; probeContext.drawImage(decoded, 0, 0);
      const top = Array.from(probeContext.getImageData(20, 10, 1, 1).data);
      const far = Array.from(probeContext.getImageData(orientation === 6 ? 20 : 60, orientation === 6 ? 60 : 10, 1, 1).data);
      // Walk RIFF chunks to inspect metadata rather than searching compressed data.
      const output = new Uint8Array(await optimized.arrayBuffer());
      const view = new DataView(output.buffer); const chunks = [];
      for (let offset = 12; offset + 8 <= output.length;) {
        chunks.push(String.fromCharCode(...output.slice(offset, offset + 4)));
        const length = view.getUint32(offset + 4, true); offset += 8 + length + (length & 1);
      }
      results.push({ orientation, width: decoded.width, height: decoded.height, top, far, chunks });
      decoded.close();
    }
    return results;
  });
  expect(results[0]).toMatchObject({ orientation: 6, width: 40, height: 80 });
  expect(results[0].top[0]).toBeGreaterThan(200);
  expect(results[0].top[2]).toBeLessThan(40);
  expect(results[0].far[2]).toBeGreaterThan(200);
  expect(results[1]).toMatchObject({ orientation: 2, width: 80, height: 40 });
  expect(results[1].top[2]).toBeGreaterThan(200);
  expect(results[1].far[0]).toBeGreaterThan(200);
  for (const result of results) {
    expect(result.chunks).not.toContain("EXIF");
    expect(result.chunks).not.toContain("XMP ");
  }
});

test("a PNG source above the bucket limit becomes a WebP within the 5 MB bucket limit", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/image-optimization.ts";
    const { optimizeImageForUpload } = await import(/* @vite-ignore */ modulePath);
    const source = document.createElement("canvas"); source.width = source.height = 2000;
    const context = source.getContext("2d")!;
    const pixels = context.createImageData(2000, 2000);
    let seed = 123456789;
    for (let index = 0; index < pixels.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels.data[index + channel] = seed & 255;
      }
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const png = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), "image/png"));
    const optimized = await optimizeImageForUpload(new File([png], "large-source.png", { type: "image/png" }));
    const decoded = await createImageBitmap(optimized);
    const result = { sourceSize: png.size, outputSize: optimized.size, type: optimized.type, width: decoded.width, height: decoded.height };
    decoded.close(); return result;
  });
  expect(result.sourceSize).toBeGreaterThan(5 * 1024 * 1024);
  expect(result.sourceSize).toBeLessThanOrEqual(20 * 1024 * 1024);
  expect(result.outputSize).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(result.outputSize).toBeLessThan(result.sourceSize);
  expect(result).toMatchObject({ type: "image/webp", width: 1800, height: 1800 });
});

test("native upload retains authenticated storage ownership and sends only WebP bytes", async ({ page }) => {
  let uploadedPath = "", upsert = "";
  let uploadBody: Buffer = Buffer.alloc(0);
  await page.route(`${endpoint}/storage/v1/object/product-images/**`, route => {
    uploadedPath = new URL(route.request().url()).pathname;
    uploadBody = route.request().postDataBuffer()!;
    upsert = route.request().headers()["x-upsert"];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: uploadedPath.replace("/storage/v1/object/", "") }) });
  });
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/catalog.ts";
    const { uploadImage } = await import(/* @vite-ignore */ modulePath);
    const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 10;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 10);
    const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    return uploadImage(new File([png], "Original-product-photo.png", { type: "image/png" }));
  });
  expect(uploadedPath).toBe(`/storage/v1/object/product-images/${user.id}/${result.id}.webp`);
  expect(upsert).toBe("false");
  expect(uploadBody.toString("latin1")).toContain('filename="Original-product-photo.webp"');
  expect(uploadBody.toString("latin1")).toContain("Content-Type: image/webp");
  const signature = uploadBody.indexOf(Buffer.from("RIFF"));
  expect(signature).toBeGreaterThan(0);
  expect(uploadBody.subarray(signature + 8, signature + 12).toString()).toBe("WEBP");
  expect(result.alt).toBe("Original product photo");
  expect(result.storagePath).toBe(`${user.id}/${result.id}.webp`);
});

test("spoofed files and unavailable WebP encoding fail before any storage request", async ({ page }) => {
  let writes = 0;
  await page.route(`${endpoint}/storage/v1/**`, route => { writes++; return route.abort(); });
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/catalog.ts";
    const { uploadImage } = await import(/* @vite-ignore */ modulePath);
    const failures = [];
    for (const text of ["<svg xmlns='http://www.w3.org/2000/svg'/>", "GIF89a"]) {
      try { await uploadImage(new File([text], "spoofed.png", { type: "image/png" })); }
      catch (error) { failures.push((error as Error).message); }
    }
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    const originalEncoder = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) { originalEncoder.call(this, callback, "image/png"); };
    try { await uploadImage(new File([png], "valid.png", { type: "image/png" })); }
    catch (error) { failures.push((error as Error).message); }
    finally { HTMLCanvasElement.prototype.toBlob = originalEncoder; }
    return failures;
  });
  expect(result).toHaveLength(3);
  expect(result[0]).toMatch(/valid JPEG, PNG or WebP/);
  expect(result[1]).toMatch(/valid JPEG, PNG or WebP/);
  expect(result[2]).toMatch(/encode.*WebP/);
  expect(writes).toBe(0);
});
