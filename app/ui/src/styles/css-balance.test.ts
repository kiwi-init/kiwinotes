// T2778: uma `}` esquecida num CSS da UI não quebra só aquele arquivo. Com o aninhamento de CSS, o Vite junta tudo o que
// vem depois dentro da regra aberta (`.kn-mention-link .kn-themes { … }`), e telas inteiras perdem o estilo sem erro
// nenhum no build. Foi o que aconteceu com a Aparência e o Sobre depois do #95. Aqui, cada CSS fecha o que abre.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const UI = path.resolve(import.meta.dirname, "..", "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? cssFiles(p) : name.endsWith(".css") ? [p] : [];
  });
}

/** A profundidade de chaves no fim, e se em algum ponto fechou mais do que abriu. Sem contar comentário nem string. */
export function braceBalance(css: string): { end: number; negative: boolean } {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  let negative = false;
  for (const ch of code) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) negative = true;
  }
  return { end: depth, negative };
}

test("cada CSS da UI fecha todas as chaves que abre", () => {
  const files = cssFiles(UI);
  expect(files.length).toBeGreaterThan(5);
  const bad = files.map((f) => ({ f: path.relative(UI, f), ...braceBalance(readFileSync(f, "utf8")) })).filter((r) => r.end !== 0 || r.negative);
  expect(bad).toEqual([]);
});

test("o contador pega a chave que falta e ignora as de comentário e de string", () => {
  expect(braceBalance(".a { color: red; /* } */ content: '}';").end).toBe(1);
  expect(braceBalance(".a { } }").negative).toBe(true);
  expect(braceBalance("@media (x) { .a { b: c } }").end).toBe(0);
});
