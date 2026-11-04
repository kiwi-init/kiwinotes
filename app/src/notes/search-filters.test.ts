// T2660: a busca com filtros no engine, e o trecho sem o frontmatter (revisão #2654).
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Vault } from "./vault.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string>) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "kn-search-")), "V");
  dirs.push(path.dirname(root));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  const v = new Vault({ root, trash: async () => {} });
  await v.open();
  return v;
}

test("frase exata, path:, tag:, e as exclusões", async () => {
  const v = await vault({
    "Projetos/2026/Plano.md": "#projeto Reunião de segunda: decidimos o orçamento.",
    "Projetos/Antigo.md": "#projeto #velho reunião antiga, rascunho",
    "Pessoas/Ana.md": "Reunião com a Ana sobre o orçamento decidido",
  });
  const paths = (q: string) => v.search(q).map((h) => h.path).sort();
  expect(paths('"decidimos o orcamento"')).toEqual(["Projetos/2026/Plano.md"]);
  expect(paths("reuniao path:projetos")).toEqual(["Projetos/2026/Plano.md", "Projetos/Antigo.md"]);
  expect(paths("reuniao -path:projetos")).toEqual(["Pessoas/Ana.md"]);
  expect(paths("tag:projeto -tag:velho")).toEqual(["Projetos/2026/Plano.md"]);
  expect(paths("reuniao -rascunho")).toEqual(["Pessoas/Ana.md", "Projetos/2026/Plano.md"]);
  expect(paths('reuniao -"com a ana"')).toEqual(["Projetos/2026/Plano.md", "Projetos/Antigo.md"]);
  expect(paths("-rascunho")).toEqual([]);
});

test("o trecho não sai do frontmatter", async () => {
  const v = await vault({ "A.md": "---\ntags: [projeto]\ntitle: projeto\n---\nO corpo da nota sobre o projeto.\n" });
  const [hit] = v.search("tag:projeto");
  expect(hit!.snippet.startsWith("O corpo")).toBe(true);
  expect(v.search("projeto")[0]!.snippet).not.toContain("tags:");
});

test("o modelo usa o relógio do vault (revisão #2654)", async () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "kn-search-")), "V");
  dirs.push(path.dirname(root));
  mkdirSync(path.join(root, "Modelos"), { recursive: true });
  writeFileSync(path.join(root, "Modelos", "D.md"), "{{date}}");
  const v = new Vault({ root, trash: async () => {}, now: () => new Date(2026, 0, 2, 10).getTime() });
  await v.open();
  expect((await v.create("", "Dia", "", "Modelos/D.md")).content).toBe("2026-01-02");
});
