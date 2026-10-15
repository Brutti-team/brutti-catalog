import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Nested entry documents require an absolute, local asset base. */
export function normalizeBasePath(value: string): string {
  const path = value.trim();
  if (
    !/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(path) ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  )
    throw new Error(
      "VITE_BASE_PATH must be a safe absolute path, such as /brutti-catalog/.",
    );
  return path.endsWith("/") ? path : `${path}/`;
}

/** Add concrete Pages entries; never generate a root replacement or 404 rewrite. */
export async function writeStaticEntrypoints(
  assetDirectory: string,
  entryDirectory = assetDirectory,
): Promise<void> {
  const source = join(assetDirectory, "index.html");
  // Fail clearly before creating entries if Vite did not emit its HTML entry.
  await readFile(source, "utf8");
  await Promise.all(
    ["admin", "catalog"].map(async (entry) => {
      const directory = join(entryDirectory, entry);
      await mkdir(directory, { recursive: true });
      await copyFile(source, join(directory, "index.html"));
    }),
  );
  // In the opt-in site artifact only the two entry directories belong to the app.
  if (resolve(assetDirectory) !== resolve(entryDirectory)) await rm(source);
}
