// Faz as UIs do AppEngine (T1192): um `vite build` por janela, em dist/<janela>/ (index.html na raiz e assets/), e o
// ui.json de cada uma. O Electrobun copia dist/ para views/ui/ do .app: é a UI de fábrica (BuiltInUi). O mesmo
// dist/<janela> é o que o `scripts/ui-publish.ts` assina e publica no canal local.
//
//   bun scripts/ui-build.ts

import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };
import { HELPER_PAGES, UI_DATA_SCHEMA, UI_REQUIRES_CONTRACT, UI_WINDOWS } from "../src/shared/ui-contract.ts";

const appDir = path.resolve(import.meta.dirname, "..");
const dist = path.join(appDir, "dist");
// O seq da UI de fábrica é a hora do build (ms), como o publish faz: uma UI instalada só vale se for mais nova.
const seq = Date.now();

rmSync(dist, { recursive: true, force: true });
for (const window of UI_WINDOWS) {
  const r = spawnSync("bun", ["x", "vite", "build"], { cwd: appDir, stdio: "inherit", env: { ...process.env, KIWI_UI_WINDOW: window } });
  if (r.status !== 0) throw new Error(`ui-build: vite build failed for ${window}`);
  const ui = { uiVersion: pkg.version, requiresContract: UI_REQUIRES_CONTRACT, dataSchema: UI_DATA_SCHEMA, seq };
  writeFileSync(path.join(dist, window, "ui.json"), `${JSON.stringify(ui, null, 2)}\n`);
  console.log(`ui-build: ${window} ${ui.uiVersion} (seq ${seq})`);
}
// As páginas do helper (o gato no overlay, spec #9810): o mesmo build, sem ui.json.
for (const page of HELPER_PAGES) {
  const r = spawnSync("bun", ["x", "vite", "build"], { cwd: appDir, stdio: "inherit", env: { ...process.env, KIWI_UI_WINDOW: page } });
  if (r.status !== 0) throw new Error(`ui-build: vite build failed for ${page}`);
  console.log(`ui-build: ${page} (página do helper)`);
}
