import { existsSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Uma UI do AppEngine por janela (T1192): `KIWI_UI_WINDOW=settings vite build` faz dist/settings/index.html com os
// assets ao lado, que é o pack da UI (index.html na raiz). O `scripts/ui-build.ts` roda um build por janela e escreve
// o ui.json. Sem a variável (o `vite` do dev, com HMR), todas as janelas saem do mesmo servidor.
export const WINDOWS = ["settings", "history", "notes", "hub", "intro"] as const;

const window = process.env.KIWI_UI_WINDOW;
if (window && !(WINDOWS as readonly string[]).includes(window)) throw new Error(`KIWI_UI_WINDOW=${window}: not a window`);

export default defineConfig({
  plugins: [react()],
  // O Kiwi-cat do Rive na intro (T3154): sem o `ui/intro/kiwi-cat.riv`, o runtime (3 MB) nem entra no pack.
  define: { __KIWI_RIVE_CAT__: JSON.stringify(existsSync(resolve(__dirname, "ui/intro/kiwi-cat.riv"))) },
  assetsInclude: ["**/*.riv"],
  // KaTeX is local for notes (T5558); ELK remains excluded from Mermaid.
  resolve: {
    alias: {
      "elkjs/lib/elk.bundled.js": resolve(__dirname, "ui/stubs/no-elk.ts"),
    },
  },
  root: resolve(__dirname, "ui", window ?? ""),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist", window ?? ""),
    emptyOutDir: true,
    ...(window ? {} : { rollupOptions: { input: Object.fromEntries(WINDOWS.map((w) => [w, resolve(__dirname, "ui", w, "index.html")])) } }),
  },
  server: {
    port: 5178,
    strictPort: true,
  },
});
