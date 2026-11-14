import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  normalizeBasePath,
  writeStaticEntrypoints,
} from "./scripts/static-build.ts";
import { assertBuildCredentials } from "./scripts/build-credentials.ts";

const installedPackages = resolve(dirname(fileURLToPath(import.meta.url)), 'node_modules');

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (command === 'build') assertBuildCredentials(env);
  const siteArtifact = mode === "site";
  const base = normalizeBasePath(
    env.VITE_BASE_PATH ||
      (siteArtifact
        ? "/catalog-assets/"
        : env.GITHUB_PAGES === "true"
          ? "/brutti-catalog/"
          : "/"),
  );
  if (siteArtifact && base === "/")
    throw new Error(
      "The site artifact needs a distinct VITE_BASE_PATH, such as /catalog-assets/.",
    );
  const entryDirectory = resolve(siteArtifact ? "dist-site" : "dist");
  const outDir = siteArtifact
    ? resolve(entryDirectory, base.slice(1))
    : entryDirectory;

  return {
    base,
    plugins: [
      react(),
      {
        name: "brutti-static-entry-documents",
        apply: "build",
        async generateBundle() {
          const licenses = await Promise.all([
            'three/LICENSE',
            'occt-import-js/dist/license.occt-import-js.txt',
            'occt-import-js/dist/license.occt.txt',
          ].map(path => readFile(resolve(installedPackages, path), 'utf8')));
          this.emitFile({ type: 'asset', fileName: 'model-decoder-licenses.txt', source: [
            'Three.js and the model decoders',
            ...licenses,
            'OCCT 0.0.23 bindings and source: https://github.com/kovacsv/occt-import-js/tree/v0.0.23',
            'Rhino3dm 8.35.0, MIT: https://github.com/mcneel/rhino3dm/blob/main/LICENSE',
          ].join('\n\n') });
        },
        async writeBundle() {
          await writeStaticEntrypoints(outDir, entryDirectory);
        },
      },
    ],
    build: { outDir },
    test: { include: ["tests/**/*.test.ts"], environment: "node" },
  };
});
