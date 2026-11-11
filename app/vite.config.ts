import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// O md4c do react-native-enriched-markdown é CommonJS (`module.exports = createMd4cModule`) dentro de uma pasta
// `"type": "module"`. O build (Rollup) entende; o pré-bundle do dev (esbuild) confia no "type", trata como ESM e o
// `import()` vem sem `default`: o parse falha calado e toda nota fica em texto cru no `vite` de dev (issue 224).
const md4cAsEsm = {
  name: "kiwi-md4c-esm",
  setup(build: { onLoad(o: { filter: RegExp }, cb: (a: { path: string }) => Promise<{ contents: string; loader: "js" }>): void }) {
    build.onLoad({ filter: /react-native-enriched-markdown[\\/]lib[\\/]module[\\/]web[\\/]wasm[\\/]md4c\.js$/ }, async (args) => {
      const code = await readFile(args.path, "utf8");
      // A lib mudou o nome: melhor quebrar o dev aqui do que deixar toda nota em texto cru sem dizer por quê.
      if (!/\bcreateMd4cModule\b/.test(code)) throw new Error(`${args.path}: sem o createMd4cModule; reveja o md4cAsEsm`);
      return { contents: `${code}\nexport default createMd4cModule;\n`, loader: "js" };
    });
  },
};

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
  // O hub também mostra as Notas, com os visualizadores de arquivo (spec #7079): ele leva a mesma pasta `public` das
  // Notas, com o THIRD_PARTY_NOTICES.txt das bibliotecas que vão junto.
  ...(window === "hub" ? { publicDir: resolve(__dirname, "ui", "notes", "public") } : {}),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist", window ?? ""),
    emptyOutDir: true,
    ...(window ? {} : { rollupOptions: { input: Object.fromEntries(WINDOWS.map((w) => [w, resolve(__dirname, "ui", w, "index.html")])) } }),
  },
  optimizeDeps: { esbuildOptions: { plugins: [md4cAsEsm] } },
  server: {
    port: 5178,
    strictPort: true,
  },
});
