// O motor do docx no pacote (spec #21080, T23170): ele só carrega quando um docx abre, e na versão fixa 2.39.0.
//
// O Vite faz um pedaço à parte para cada `import()`. Então "só carrega ao abrir um docx" é: nenhuma janela chega ao
// @docx-editor.dev/core pelos imports estáticos, a partir do main.tsx dela. Ele só entra por um `import()` (o
// `DocxViewer`, que já é lazy no `viewers.ts`, e o `docxEngine`). O `import type` some no build e não conta.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dir, "../../..");
const ENGINE = "@docx-editor.dev/core";
const VERSION = "2.39.0";
const scanners = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(p) && existsSync(p)) return p;
  }
  return null;
}

/** Os arquivos que a janela carrega de saída (os imports estáticos), e os `import()` que saem deles. */
function staticGraph(entry: string) {
  const seen = new Set<string>();
  const engineFrom: string[] = [];
  const dynamic: { from: string; to: string }[] = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imp of scanners[file.endsWith(".tsx") ? "tsx" : "ts"].scanImports(readFileSync(file, "utf8"))) {
      const local = imp.path.startsWith(".") ? resolveLocal(file, imp.path) : null;
      if (imp.kind === "dynamic-import") {
        if (local) dynamic.push({ from: file, to: local });
        continue;
      }
      if (imp.path === ENGINE || imp.path.startsWith(`${ENGINE}/`)) engineFrom.push(path.relative(APP, file));
      if (local) stack.push(local);
    }
  }
  return { files: seen, engineFrom, dynamic };
}

/** O fecho, seguindo também os `import()`: onde o motor de fato entra. */
function reachesEngine(entry: string, done = new Set<string>()): boolean {
  if (done.has(entry)) return false;
  done.add(entry);
  const g = staticGraph(entry);
  if (g.engineFrom.length) return true;
  return g.dynamic.some((d) => reachesEngine(d.to, done));
}

const WINDOWS = readdirSync(path.join(APP, "ui"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(APP, "ui", d.name, "main.tsx")))
  .map((d) => d.name);

describe("o motor do docx só carrega quando um docx abre", () => {
  test("há janelas para conferir, e as Notas estão entre elas", () => {
    expect(WINDOWS).toContain("notes");
  });

  for (const w of WINDOWS) {
    test(`a janela ${w} não traz o motor de saída`, () => {
      const g = staticGraph(path.join(APP, "ui", w, "main.tsx"));
      expect(g.engineFrom).toEqual([]);
    });
  }

  test("nas Notas, o motor chega só por um import() (senão este teste não prova nada)", () => {
    const entry = path.join(APP, "ui/notes/main.tsx");
    expect(staticGraph(entry).engineFrom).toEqual([]);
    expect(reachesEngine(entry)).toBe(true);
  });
});

describe(`o motor do docx na versão fixa ${VERSION}`, () => {
  test("o package.json pede a versão exata, sem ^ nem ~", () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
    expect(pkg.dependencies?.[ENGINE] ?? pkg.devDependencies?.[ENGINE]).toBe(VERSION);
  });

  test("o bun.lock resolve a mesma versão", () => {
    const lock = readFileSync(path.join(APP, "bun.lock"), "utf8");
    const resolved = [...lock.matchAll(/"@docx-editor\.dev\/core@([^"]+)"/g)].map((m) => m[1]);
    expect(resolved.length).toBeGreaterThan(0);
    expect(new Set(resolved)).toEqual(new Set([VERSION]));
  });
});
