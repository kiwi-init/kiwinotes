import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One HTML entry per native window. Built to dist/<window>/index.html and
// copied into the app as views://ui/<window>/index.html.
export const WINDOWS = ["settings", "history"] as const;

export default defineConfig({
  plugins: [react()],
  resolve: {
    // O lado da janela do RPC do Electrobun (Electroview), da cópia fixada pelo Hutch.
    alias: { "electrobun/view": resolve(__dirname, ".hutch/devkit/api/browser/index.ts") },
  },
  root: resolve(__dirname, "ui"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(WINDOWS.map((w) => [w, resolve(__dirname, "ui", w, "index.html")])),
    },
  },
  server: {
    port: 5178,
    strictPort: true,
  },
});
