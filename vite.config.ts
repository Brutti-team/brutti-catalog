import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // GitHub Pages serves this demo from /brutti-catalog/, not the domain root.
  base: process.env.GITHUB_PAGES === "true" ? "/brutti-catalog/" : "/",
  plugins: [react()],
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
