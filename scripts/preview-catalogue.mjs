#!/usr/bin/env node
// Offline operator review only. No product inference, network access or import writes.
import { createHash } from "node:crypto";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CATEGORY_NAMES,
  draftRow,
  validateManifest,
} from "./import-manifest.mjs";

const IMAGE_FILE = /^images\/([a-f0-9]{64})\.webp$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sourcePages = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (page) => Number.isInteger(page) && page >= 1 && page <= 104,
          ),
        ),
      ]
    : [];
const displayText = (value) =>
  typeof value === "string"
    ? value
    : value === undefined
      ? ""
      : value !== null && typeof value === "object"
        ? "Invalid structured value — verify source"
        : String(value);
const safeOperatorError = (error) => {
  if (error?.code === "EEXIST")
    return "Output already exists; choose a new *.local directory. Prior reviews were not overwritten.";
  if (error?.code === "ENOENT")
    return "A required source directory or output parent is missing.";
  if (typeof error?.code === "string")
    return "File operation failed; check source/output paths and permissions.";
  return error?.message || "Preview could not be completed.";
};
const escapeHtml = (value) =>
  String(displayText(value) ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

function unknownFields(product) {
  const unknown = [
    "description",
    "materials",
    "finishing",
    "availability",
  ].filter(
    (key) =>
      product[key] === null ||
      product[key] === undefined ||
      product[key] === "",
  );
  for (const key of ["width", "depth", "height"])
    if (
      product.dimensionsCm?.[key] === null ||
      product.dimensionsCm?.[key] === undefined
    )
      unknown.push(`dimensionsCm.${key}`);
  if (
    !product.price ||
    product.price.basis === "unknown" ||
    product.price.myr === null
  )
    unknown.push("price");
  return unknown;
}

function analyseManifest(manifest, evidence, initialErrors) {
  const report = {
    version: 1,
    scope: "offline-operator-review",
    createdAt: new Date().toISOString(),
    documentSha256:
      typeof manifest?.documentSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(manifest.documentSha256)
        ? manifest.documentSha256
        : null,
    productCount: Array.isArray(manifest?.products)
      ? manifest.products.length
      : 0,
    checkedImageCount: 0,
    dataValid: false,
    importReady: false,
    errors: [...initialErrors],
    reviewBlockers: [],
    products: [],
    images: [],
    liveVerification:
      "Not performed. Offline readiness does not authorize import or publication.",
  };
  const addError = (code, message, productIndex = null) =>
    report.errors.push({ code, message, productIndex });
  if (!isObject(manifest) || !isObject(evidence)) {
    if (!report.errors.length)
      addError(
        "INVALID_SOURCE",
        "A manifest object and extracted source evidence are required.",
      );
    return report;
  }
  if (manifest.reviewed !== true)
    report.reviewBlockers.push({
      code: "MANIFEST_NOT_REVIEWED",
      message: "The complete manifest has not been approved.",
    });
  const evidencePages = Array.isArray(evidence.pages) ? evidence.pages : [];
  if (
    evidencePages.length !== 104 ||
    new Set(evidencePages.map((page) => page?.page)).size !== 104 ||
    evidencePages.some(
      (page) =>
        !isObject(page) ||
        !Number.isInteger(page.page) ||
        page.page < 1 ||
        page.page > 104 ||
        !Array.isArray(page.imageCandidates),
    )
  )
    addError(
      "INVALID_EVIDENCE_PAGES",
      "Evidence must contain all 104 distinct source pages with image-candidate lists.",
    );
  try {
    validateManifest(manifest, evidence, { requireReviewed: false });
  } catch (error) {
    addError("INVALID_MANIFEST", error.message);
  }
  const keys = new Set(),
    skus = new Set();
  for (const [index, entry] of (Array.isArray(manifest.products)
    ? manifest.products
    : []
  ).entries()) {
    const product = isObject(entry) ? entry : {};
    if (product.reviewed !== true)
      report.reviewBlockers.push({
        code: "PRODUCT_NOT_REVIEWED",
        productIndex: index,
        message: `Product ${index + 1} has not been approved.`,
      });
    report.products.push({
      index,
      sourceKey:
        typeof product.sourceKey === "string" ? product.sourceKey : null,
      name: typeof product.name === "string" ? product.name : null,
      reviewed: product.reviewed === true,
      pages: sourcePages(product.pages),
      unknownFields: unknownFields(product),
    });
    if (typeof product.sourceKey === "string") {
      if (keys.has(product.sourceKey))
        addError(
          "DUPLICATE_SOURCE_KEY",
          "Repeated product identity; review and merge duplicate source records.",
          index,
        );
      keys.add(product.sourceKey);
    }
    if (typeof product.sku === "string") {
      const sku = product.sku.trim().toUpperCase();
      if (skus.has(sku))
        addError(
          "DUPLICATE_SKU",
          "Repeated staff SKU; assign distinct inventory identities.",
          index,
        );
      skus.add(sku);
    }
    const imageFiles = new Set();
    for (const image of Array.isArray(product.images) ? product.images : []) {
      if (imageFiles.has(image?.file))
        addError(
          "DUPLICATE_IMAGE",
          "Repeated photograph within this product; deduplicate it.",
          index,
        );
      imageFiles.add(image?.file);
    }
    try {
      validateManifest({ ...manifest, products: [entry] }, evidence, {
        requireReviewed: false,
      });
      // The importer combines these fields; validate the exact Draft conversion too.
      draftRow(
        product,
        CATEGORY_NAMES.map((name) => ({ id: name, name })),
        [],
      );
    } catch (error) {
      addError("INVALID_PRODUCT", error.message, index);
    }
  }
  return report;
}

async function readSourceFile(root, relative, maxBytes) {
  let path;
  try {
    path = await realpath(resolve(root, relative));
  } catch {
    throw new Error("Source file is missing or cannot be read.");
  }
  if (!path.startsWith(root + sep))
    throw new Error("Source file symlink escapes the evidence directory.");
  let handle;
  try {
    handle = await open(path, "r");
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes)
      throw new Error(
        "Source file must be a regular file within its size limit.",
      );
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes)
      throw new Error("Source file exceeds its size limit.");
    return bytes;
  } catch (error) {
    throw new Error(safeOperatorError(error), { cause: error });
  } finally {
    await handle?.close();
  }
}

function validateWebp(bytes) {
  if (
    bytes.length < 20 ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    throw new Error(
      "Source photo must be a complete WebP file of at most 5 MB.",
    );
  let offset = 12,
    hasImage = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length)
      throw new Error("Source WebP has a truncated chunk.");
    const kind = bytes.toString("ascii", offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size + (size % 2) > bytes.length)
      throw new Error("Source WebP has a truncated chunk.");
    if ((kind === "VP8 " && size >= 10) || (kind === "VP8L" && size >= 5))
      hasImage = true;
    offset += 8 + size + (size % 2);
  }
  if (!hasImage) throw new Error("Source WebP contains no image payload.");
}

function imageHasProvenance(product, file, evidence) {
  const pages = Array.isArray(evidence?.pages) ? evidence.pages : [];
  return sourcePages(product.pages).some((number) =>
    pages.some(
      (page) =>
        page?.page === number &&
        Array.isArray(page.imageCandidates) &&
        page.imageCandidates.some((candidate) => candidate?.file === file),
    ),
  );
}

export function renderPreviewHtml(
  manifest,
  evidence,
  report,
  embeddedImages = new Map(),
) {
  const unknown = '<span class="unknown">Unknown — unverified</span>';
  const value = (item) =>
    item === null || item === undefined || item === ""
      ? unknown
      : escapeHtml(item);
  const price = (item) => {
    if (item?.basis === "unknown" && item.myr === null) return unknown;
    if (
      !["fixed", "starting-from"].includes(item?.basis) ||
      !Number.isFinite(item?.myr) ||
      item.myr < 0 ||
      item.myr > 9999999999.99 ||
      Math.abs(item.myr * 100 - Math.round(item.myr * 100)) > 0.0001
    )
      return '<span class="unknown">Invalid price — verify source</span>';
    const amount = `RM ${item.myr.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return escapeHtml(
      `${item.basis === "starting-from" ? "Starting from " : ""}${amount}`,
    );
  };
  const dimension = (item) =>
    item === null || item === undefined
      ? unknown
      : Number.isFinite(item) && item > 0 && item < 100000
        ? `${escapeHtml(item)} cm`
        : `<span class="unknown">Invalid — verify: ${escapeHtml(item)}</span>`;
  const usedPages = new Set();
  const cards = (Array.isArray(manifest?.products) ? manifest.products : [])
    .map((entry, index) => {
      const product = isObject(entry) ? entry : {};
      const pages = sourcePages(product.pages);
      pages.forEach((number) => usedPages.add(number));
      const links =
        pages
          .map(
            (number) => `<a href="#source-page-${number}">Page ${number}</a>`,
          )
          .join(", ") ||
        '<span class="unknown">Invalid or missing page references</span>';
      const photos =
        (Array.isArray(product.images) ? product.images : [])
          .map((image) => {
            const file = typeof image?.file === "string" ? image.file : "";
            const bytes =
              IMAGE_FILE.test(file) &&
              imageHasProvenance(product, file, evidence)
                ? embeddedImages.get(file)
                : null;
            const reference = IMAGE_FILE.test(file)
              ? escapeHtml(file)
              : "Invalid source-photo reference";
            return `<figure>${bytes ? `<img src="data:image/webp;base64,${bytes.toString("base64")}" alt="${escapeHtml(image.alt)}">` : '<p class="unknown">Photo not embedded: reference or file failed validation.</p>'}<figcaption>Source photo candidate · ${reference}<br>${value(image?.alt)}</figcaption></figure>`;
          })
          .join("") || '<p class="unknown">No source photos selected.</p>';
      const errors = report.errors
        .filter((error) => error.productIndex === index)
        .map((error) => `<li>${escapeHtml(error.message)}</li>`)
        .join("");
      return `<article><h2>${value(product.name)}</h2><p>${product.reviewed === true ? "Product review recorded" : '<strong class="unknown">Unreviewed product</strong>'}</p>${errors ? `<ul class="errors">${errors}</ul>` : ""}<dl><dt>Source identity</dt><dd>${value(product.sourceKey)}</dd><dt>Staff SKU</dt><dd>${value(product.sku)}</dd><dt>Category</dt><dd>${value(product.category)}</dd><dt>Source pages</dt><dd>${links}</dd><dt>Description</dt><dd>${value(product.description)}</dd><dt>Materials</dt><dd>${value(product.materials)}</dd><dt>Finishing</dt><dd>${value(product.finishing)}</dd><dt>Width / depth / height</dt><dd>${dimension(product.dimensionsCm?.width)} / ${dimension(product.dimensionsCm?.depth)} / ${dimension(product.dimensionsCm?.height)}</dd><dt>Availability</dt><dd>${value(product.availability)}</dd><dt>Price</dt><dd>${price(product.price)}</dd><dt>Exact printed price text</dt><dd>${value(product.price?.sourceText)}</dd></dl><div class="photos">${photos}</div></article>`;
    })
    .join("");
  const issues = report.errors
    .map(
      (error) =>
        `<li>${escapeHtml(error.code)}: ${escapeHtml(error.message)}</li>`,
    )
    .join("");
  const reviews = report.reviewBlockers
    .map((blocker) => `<li>${escapeHtml(blocker.message)}</li>`)
    .join("");
  const pages = [...usedPages]
    .sort((a, b) => a - b)
    .map(
      (number) =>
        `<section id="source-page-${number}"><h3>Source page ${number}</h3><p>Verify the original evidence files: <code>page-${String(number).padStart(3, "0")}.png</code> and <code>page-${String(number).padStart(3, "0")}.txt</code>. Candidate photos alone cannot establish the printed product facts.</p></section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Brutti catalogue source review</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#17221b;background:#f5f6f3;margin:0}main{max-width:1100px;margin:auto;padding:28px}header,article,section{background:white;padding:24px;margin:0 0 20px;border:1px solid #d4dbd4;border-radius:8px}h1,h2,h3{margin-top:0}.unknown,.errors{color:#8a320d;font-weight:600}dl{display:grid;grid-template-columns:180px 1fr;gap:8px 16px}dt{font-weight:600}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.photos{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0;width:240px}img{max-width:100%;height:200px;object-fit:contain}figcaption{font-size:12px;overflow-wrap:anywhere}a{color:#234f40}@media(max-width:600px){main{padding:12px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}}</style></head><body><main><header><h1>Brutti catalogue source review</h1><p><strong>${report.dataValid ? "Offline data validation passed" : "Validation failed"} · ${report.importReady ? "Human review recorded; eligible for the separate offline Draft-import check" : "Import blocked"}</strong></p><p>${report.productCount} supplied product records; ${report.checkedImageCount} validated unique source WebP files.</p><p>Document SHA-256: <code>${value(report.documentSha256)}</code></p><p>No product facts are inferred. Unknown fields remain unverified. Source photographs are candidates for checking against the actual PDF.</p>${issues ? `<h2>Validation errors</h2><ul class="errors">${issues}</ul>` : ""}${reviews ? `<h2>Review required</h2><ul>${reviews}</ul>` : ""}<p>${escapeHtml(report.liveVerification)} Nothing imported.</p></header>${cards || "<section><h2>No products supplied</h2><p>No product facts or example furniture were generated.</p></section>"}${pages}</main></body></html>`;
}

export async function generateCataloguePreview(manifestPath, outputPath) {
  const requestedOutput = resolve(outputPath);
  if (!basename(requestedOutput).endsWith(".local"))
    throw new Error("Use a new ignored *.local output directory.");
  const root = await realpath(dirname(resolve(manifestPath)));
  const output = join(
    await realpath(dirname(requestedOutput)),
    basename(requestedOutput),
  );
  if (
    output === root ||
    output.startsWith(root + sep) ||
    root.startsWith(output + sep)
  )
    throw new Error(
      "Preview output must be outside the source directory; source/output paths cannot overlap.",
    );
  // mkdir is atomic and deliberately refuses previous staff-review directories.
  await mkdir(output);
  const initialErrors = [];
  let manifest = null,
    evidence = null;
  for (const [kind, relative] of [
    ["manifest", basename(resolve(manifestPath))],
    ["evidence", "evidence.json"],
  ]) {
    try {
      const bytes = await readSourceFile(root, relative, 32 * 1024 * 1024);
      let data;
      try {
        data = JSON.parse(bytes.toString("utf8"));
      } catch {
        initialErrors.push({
          code: "INVALID_JSON",
          message: `${kind === "manifest" ? "Manifest" : "Evidence"} is not valid JSON.`,
          productIndex: null,
        });
        continue;
      }
      if (kind === "manifest") manifest = data;
      else evidence = data;
    } catch (error) {
      initialErrors.push({
        code: "INVALID_SOURCE_FILE",
        message: `${kind === "manifest" ? "Manifest" : "Evidence"}: ${error.message}`,
        productIndex: null,
      });
    }
  }
  const report = analyseManifest(manifest, evidence, initialErrors);
  const embeddedImages = new Map();
  for (const [index, entry] of (Array.isArray(manifest?.products)
    ? manifest.products
    : []
  ).entries()) {
    const product = isObject(entry) ? entry : {};
    for (const image of Array.isArray(product.images) ? product.images : []) {
      const file = typeof image?.file === "string" ? image.file : "";
      if (embeddedImages.has(file)) continue;
      if (
        !IMAGE_FILE.test(file) ||
        !imageHasProvenance(product, file, evidence)
      )
        continue;
      try {
        const bytes = await readSourceFile(root, file, MAX_IMAGE_BYTES);
        validateWebp(bytes);
        embeddedImages.set(file, bytes);
        report.images.push({
          file,
          sourcePixelHash: file.match(IMAGE_FILE)[1],
          webpBytesSha256: createHash("sha256").update(bytes).digest("hex"),
          byteLength: bytes.length,
        });
      } catch (error) {
        report.errors.push({
          code: "INVALID_IMAGE_FILE",
          message: error.message,
          productIndex: index,
          file,
        });
      }
    }
  }
  report.checkedImageCount = embeddedImages.size;
  report.dataValid = report.errors.length === 0 && report.productCount > 0;
  report.importReady = report.dataValid && report.reviewBlockers.length === 0;
  await writeFile(
    join(output, "index.html"),
    renderPreviewHtml(manifest, evidence, report, embeddedImages),
    { flag: "wx" },
  );
  await writeFile(
    join(output, "validation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  return { report, outputDirectory: output };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args.some((argument) => argument.startsWith("--")))
      throw new Error(
        "Usage: node scripts/preview-catalogue.mjs source.local/manifest.json new-review.local",
      );
    const { report, outputDirectory } = await generateCataloguePreview(
      args[0],
      args[1],
    );
    console.log(
      `Created offline review in ${outputDirectory}: ${report.productCount} supplied products, ${report.checkedImageCount} checked source photos. ${report.dataValid ? "Data validation passed." : "Validation failed; inspect validation.json."} ${report.importReady ? "Human review recorded." : "Import blocked pending validation/review."} Nothing imported.`,
    );
    if (!report.dataValid) process.exitCode = 1;
  } catch (error) {
    console.error(safeOperatorError(error));
    process.exitCode = 1;
  }
}
