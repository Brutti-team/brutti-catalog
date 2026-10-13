import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import {
  normalizeBasePath,
  writeStaticEntrypoints,
} from "./scripts/static-build.ts";
import { assertBuildCredentials } from "./scripts/build-credentials.ts";

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
        async writeBundle() {
          await writeStaticEntrypoints(outDir, entryDirectory);
        },
      },
    ],
    build: { outDir },
    test: { include: ["tests/**/*.test.ts"], environment: "node" },
  };
});
