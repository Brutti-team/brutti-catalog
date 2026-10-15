import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { generateCataloguePreview } from "../scripts/preview-catalogue.mjs";
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { validateManifest } from "../scripts/import-manifest.mjs";

// All manifest/product/image inputs below are synthetic unit fixtures, never Brutti facts.
const imageBytes = Buffer.from(
  "UklGRi4AAABXRUJQVlA4ICIAAABQAQCdASoCAAIAAUAmJQBOgC6gAP75qLEK84d2edtqAAAA",
  "base64",
);
const pixelHash = createHash("sha256")
  .update("TEST-ONLY source pixels")
  .digest("hex");
const imageFile = `images/${pixelHash}.webp`;
const documentSha256 = "a".repeat(64);
const testDirectories: string[] = [];
const productFixture = () => ({
  sourceKey: "test-only-preview",
  name: "TEST-ONLY preview fixture",
  sku: "TEST-ONLY-PREVIEW",
  category: "Racks & Shelves",
  reviewed: false,
  pages: [12],
  description: null as string | null,
  materials: "TEST-ONLY material",
  finishing: null as string | null,
  dimensionsCm: { width: null, depth: 50, height: null },
  availability: null,
  price: {
    myr: 1234.56,
    basis: "starting-from",
    sourceText: "TEST-ONLY: price starting from RM1,234.56",
  },
  images: [{ file: imageFile, alt: "TEST-ONLY synthetic WebP image" }],
});
const manifestFixture = () => ({
  version: 1,
  source: "brutti-catalogue-2025",
  reviewed: false,
  documentSha256,
  products: [productFixture()],
});
const evidenceFixture = () => ({
  documentSha256,
  pageCount: 104,
  pages: Array.from({ length: 104 }, (_, index) => ({
    page: index + 1,
    textFile: `page-${String(index + 1).padStart(3, "0")}.txt`,
    renderFile: `page-${String(index + 1).padStart(3, "0")}.png`,
    imageCandidates: index === 11 ? [{ file: imageFile }] : [],
  })),
});

async function setup(
  manifest = manifestFixture(),
  evidence = evidenceFixture(),
) {
  const directory = await mkdtemp(join(tmpdir(), "brutti-preview-unit-"));
  testDirectories.push(directory);
  const source = join(directory, "source.local");
  await mkdir(join(source, "images"), { recursive: true });
  await writeFile(join(source, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(source, "evidence.json"), JSON.stringify(evidence));
  await writeFile(join(source, imageFile), imageBytes);
  return {
    directory,
    source,
    manifestPath: join(source, "manifest.json"),
    output: join(directory, "review.local"),
  };
}

afterEach(async () => {
  await Promise.all(
    testDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("allows an offline unreviewed preview while the default importer still requires approval", async () => {
  const manifest = manifestFixture();
  expect(() => validateManifest(manifest, evidenceFixture())).toThrow(
    /reviewed/,
  );
  expect(
    validateManifest(manifest, evidenceFixture(), { requireReviewed: false }),
  ).toEqual(manifest.products);
  const fixture = await setup(manifest);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: true,
    importReady: false,
    productCount: 1,
    checkedImageCount: 1,
  });
  expect(report.reviewBlockers).toHaveLength(2);
  expect(
    JSON.parse(await readFile(join(fixture.output, "validation.json"), "utf8")),
  ).toEqual(report);
  const html = await readFile(join(fixture.output, "index.html"), "utf8");
  expect(html).toContain("Starting from RM");
  expect(html).toContain("TEST-ONLY: price starting from RM1,234.56");
  expect(html).toContain("Unknown — unverified");
  expect(html).toContain('src="data:image/webp;base64,');
  expect(html).toContain('href="#source-page-12"');
});

it("marks a valid selection ready only when both manifest and every product have review recorded", async () => {
  const manifest = manifestFixture();
  manifest.reviewed = true;
  let fixture = await setup(manifest);
  expect(
    (await generateCataloguePreview(fixture.manifestPath, fixture.output))
      .report.importReady,
  ).toBe(false);
  manifest.products[0].reviewed = true;
  fixture = await setup(manifest);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: true,
    importReady: true,
    reviewBlockers: [],
    errors: [],
  });
  expect(report.products[0].unknownFields).toEqual(
    expect.arrayContaining([
      "description",
      "finishing",
      "dimensionsCm.width",
      "dimensionsCm.height",
      "availability",
    ]),
  );
});

it("reports duplicate identities, SKUs and photo references instead of calling invalid data ready", async () => {
  const manifest = manifestFixture();
  manifest.reviewed = true;
  manifest.products[0].reviewed = true;
  manifest.products[0].images.push({ ...manifest.products[0].images[0] });
  manifest.products.push({ ...manifest.products[0] });
  const fixture = await setup(manifest);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({ dataValid: false, importReady: false });
  expect(report.errors.map((error: { code: string }) => error.code)).toEqual(
    expect.arrayContaining([
      "DUPLICATE_SOURCE_KEY",
      "DUPLICATE_SKU",
      "DUPLICATE_IMAGE",
    ]),
  );
  expect(await readFile(join(fixture.output, "index.html"), "utf8")).toContain(
    "Validation failed",
  );
});

it("escapes all source text and creates page links only from verified integer page numbers", async () => {
  const manifest = manifestFixture();
  manifest.products[0].name = "</h2><script>globalThis.TEST_XSS=1</script>";
  manifest.products[0].sku = '"><svg onload=alert(1)>';
  manifest.products[0].materials = "<img src=x onerror=alert(1)>";
  manifest.products[0].price.sourceText = "</script><script>alert(1)</script>";
  manifest.products[0].images[0].alt = '" onerror="alert(1)';
  const fixture = await setup(manifest);
  await generateCataloguePreview(fixture.manifestPath, fixture.output);
  const html = await readFile(join(fixture.output, "index.html"), "utf8");
  expect(html).not.toMatch(/<script|<svg|<img src=x|alt="" onerror/i);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&quot; onerror=&quot;");
  expect(html).toContain("default-src 'none'");
  expect(
    [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
  ).toEqual(["#source-page-12"]);
});

it("refuses existing review directories and output paths outside the ignored .local convention", async () => {
  const fixture = await setup();
  await mkdir(fixture.output);
  await writeFile(
    join(fixture.output, "staff-notes.txt"),
    "TEST-ONLY prior review must survive",
  );
  await expect(
    generateCataloguePreview(fixture.manifestPath, fixture.output),
  ).rejects.toThrow(/exist|overwrite/i);
  expect(await readFile(join(fixture.output, "staff-notes.txt"), "utf8")).toBe(
    "TEST-ONLY prior review must survive",
  );
  await expect(
    generateCataloguePreview(
      fixture.manifestPath,
      join(fixture.directory, "review"),
    ),
  ).rejects.toThrow(/\.local/);
  await expect(
    generateCataloguePreview(
      fixture.manifestPath,
      join(fixture.source, "nested.local"),
    ),
  ).rejects.toThrow(/overlap|outside/i);
});

it("rejects symlink escapes without embedding external source bytes", async () => {
  const fixture = await setup();
  const outside = join(fixture.directory, "outside.webp");
  await writeFile(outside, imageBytes);
  await rm(join(fixture.source, imageFile));
  await symlink(outside, join(fixture.source, imageFile));
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: false,
    importReady: false,
    checkedImageCount: 0,
  });
  expect(report.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "INVALID_IMAGE_FILE",
        message: expect.stringMatching(/escape/),
      }),
    ]),
  );
  expect(
    await readFile(join(fixture.output, "index.html"), "utf8"),
  ).not.toContain(imageBytes.toString("base64"));
  expect(JSON.stringify(report)).not.toContain(outside);
});

it("rejects traversal references even when an invalid evidence candidate repeats them", async () => {
  const manifest = manifestFixture();
  manifest.products[0].images[0].file = "../../outside.webp";
  const evidence = evidenceFixture();
  evidence.pages[11].imageCandidates[0].file = "../../outside.webp";
  const fixture = await setup(manifest, evidence);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: false,
    importReady: false,
    checkedImageCount: 0,
  });
  expect(report.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringMatching(/extracted WebP/),
      }),
    ]),
  );
  const html = await readFile(join(fixture.output, "index.html"), "utf8");
  expect(html).not.toContain('src="data:image/webp');
  expect(html).not.toContain("../../outside.webp");
});

it("keeps an empty extracted manifest empty and blocked rather than creating product examples", async () => {
  const manifest = manifestFixture();
  manifest.products = [];
  const fixture = await setup(manifest);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: false,
    importReady: false,
    productCount: 0,
    checkedImageCount: 0,
  });
  expect(await readFile(join(fixture.output, "index.html"), "utf8")).toContain(
    "No products supplied",
  );
});

it("does not round an invalid source amount into an apparently valid starting price", async () => {
  const manifest = manifestFixture();
  manifest.products[0].price.myr = 1234.567;
  const fixture = await setup(manifest);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({ dataValid: false, importReady: false });
  const html = await readFile(join(fixture.output, "index.html"), "utf8");
  expect(html).toContain("Invalid price — verify source");
  expect(html).not.toContain("Starting from RM 1,234.57");
});

it.each(["pages", "imageCandidates"])(
  "reports malformed %s evidence without abandoning its validation report",
  async (field) => {
    const fixture = await setup();
    const evidence = evidenceFixture();
    const invalid =
      field === "pages"
        ? { ...evidence, pages: "TEST-ONLY invalid page list" }
        : {
            ...evidence,
            pages: evidence.pages.map((page) =>
              page.page === 12
                ? {
                    ...page,
                    imageCandidates: "TEST-ONLY invalid candidate list",
                  }
                : page,
            ),
          };
    await writeFile(
      join(fixture.source, "evidence.json"),
      JSON.stringify(invalid),
    );
    const { report } = await generateCataloguePreview(
      fixture.manifestPath,
      fixture.output,
    );
    expect(report).toMatchObject({
      dataValid: false,
      importReady: false,
      checkedImageCount: 0,
    });
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_EVIDENCE_PAGES" }),
      ]),
    );
    expect(
      JSON.parse(
        await readFile(join(fixture.output, "validation.json"), "utf8"),
      ),
    ).toEqual(report);
  },
);

it.each([
  Buffer.from("TEST-ONLY non-WebP source"),
  Buffer.alloc(5 * 1024 * 1024 + 1),
])("reports invalid or oversized WebP files", async (bytes) => {
  const fixture = await setup();
  await writeFile(join(fixture.source, imageFile), bytes);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: false,
    importReady: false,
    checkedImageCount: 0,
  });
  expect(report.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_IMAGE_FILE" }),
    ]),
  );
});

it("reports malformed JSON without hiding the problem behind a valid empty preview", async () => {
  const fixture = await setup();
  await writeFile(fixture.manifestPath, "{ TEST-ONLY broken JSON");
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report).toMatchObject({
    dataValid: false,
    importReady: false,
    productCount: 0,
  });
  expect(report.errors).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "INVALID_JSON" })]),
  );
  expect(await readFile(join(fixture.output, "index.html"), "utf8")).toContain(
    "No products supplied",
  );
});

it("checks the combined materials field that the importer actually writes", async () => {
  const manifest = manifestFixture();
  manifest.products[0].materials = "a".repeat(1995);
  const changed = {
    ...manifest,
    products: [{ ...manifest.products[0], finishing: "TEST-ONLY finish" }],
  };
  const fixture = await setup(changed);
  const { report } = await generateCataloguePreview(
    fixture.manifestPath,
    fixture.output,
  );
  expect(report.dataValid).toBe(false);
  expect(report.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringMatching(/Combined materials/),
      }),
    ]),
  );
});
