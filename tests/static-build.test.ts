import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  normalizeBasePath,
  writeStaticEntrypoints,
} from "../scripts/static-build";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.each([
  ["/", "/"],
  ["/brutti-catalog", "/brutti-catalog/"],
  ["/catalog-assets/", "/catalog-assets/"],
  ["/review/catalog-assets", "/review/catalog-assets/"],
])("normalizes the safe asset base %s", (input, expected) =>
  expect(normalizeBasePath(input)).toBe(expected),
);

it.each([
  "",
  "./",
  "assets/",
  "//example.invalid/",
  "https://example.invalid/",
  "/../",
  "/review/../",
  "/review//assets/",
  "/assets?query=1",
  "/assets#fragment",
  "/assets\\other",
  "/%2e%2e/",
  "/has space/",
])("rejects an unsafe or relative asset base: %s", (input) =>
  expect(() => normalizeBasePath(input)).toThrow("absolute path"),
);

it("creates real direct-refresh entries while preserving the standalone root entry", async () => {
  const output = await mkdtemp(join(tmpdir(), "brutti-standalone-"));
  temporaryDirectories.push(output);
  const html =
    '<html><script src="/brutti-catalog/assets/catalog.js"></script><link href="/brutti-catalog/assets/catalog.css"></html>';
  await writeFile(join(output, "index.html"), html);
  await writeStaticEntrypoints(output);
  for (const entry of ["index.html", "admin/index.html", "catalog/index.html"])
    expect(await readFile(join(output, entry), "utf8")).toBe(html);
  await expect(readFile(join(output, "404.html"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("emits an additive site artifact without replacing an existing website root", async () => {
  const output = await mkdtemp(join(tmpdir(), "brutti-site-"));
  temporaryDirectories.push(output);
  const assets = join(output, "catalog-assets");
  await mkdir(assets);
  const html =
    '<html><script src="/catalog-assets/assets/catalog.js"></script><link href="/catalog-assets/assets/catalog.css"></html>';
  await writeFile(join(output, "index.html"), "existing website root");
  await writeFile(join(assets, "index.html"), html);
  await writeStaticEntrypoints(assets, output);
  expect(await readFile(join(output, "index.html"), "utf8")).toBe(
    "existing website root",
  );
  for (const entry of ["admin/index.html", "catalog/index.html"])
    expect(await readFile(join(output, entry), "utf8")).toBe(html);
  await expect(readFile(join(assets, "index.html"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(join(output, "404.html"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
