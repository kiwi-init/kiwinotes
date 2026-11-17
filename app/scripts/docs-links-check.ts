// Os links dos docs (spec #13895, T13933): cada link relativo dos .md do repo (o README, o AGENTS.md, o CHANGELOG e os
// docs) aponta para um arquivo que existe. Os links para fora (https, mailto) e as âncoras sozinhas ficam de fora: este
// script não usa a rede. Ele também guarda a `main` dos prints: nada em `docs/evidence/` (eles vão para o branch
// `evidence`, veja o AGENTS.md). Sai com exit 1 e a lista quando algo falhou.
//
//   bun scripts/docs-links-check.ts
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(import.meta.dir, "..", "..");
const listed = spawnSync("git", ["ls-files", "-z", "--", "*.md"], { cwd: repo, encoding: "utf8" });
if (listed.status !== 0) throw new Error(listed.stderr);
const files = listed.stdout.split("\0").filter((f) => f && !f.includes("node_modules/"));

/** Os links de um markdown: `[texto](alvo)` e `![alt](alvo)`, fora dos blocos de código. */
export function linksOf(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const plain = line.replace(/`[^`]*`/g, "");
    for (const m of plain.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]!);
  }
  return out;
}

const broken: string[] = [];
let checked = 0;
for (const file of files) {
  const text = readFileSync(join(repo, file), "utf8");
  for (const target of linksOf(text)) {
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]!.split("?")[0]!);
    if (!path) continue;
    checked++;
    const abs = path.startsWith("/") ? join(repo, path) : join(repo, dirname(file), path);
    if (!existsSync(abs)) broken.push(`${file}: ${target}`);
  }
}
console.log(`${files.length} arquivos .md, ${checked} links relativos conferidos`);
// Os prints não voltam à main (revisão do #548): sem o guarda, os 69 MB voltariam aos poucos, um PR por vez.
const evidence = spawnSync("git", ["ls-files", "--", "docs/evidence"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
if (evidence.length) {
  console.log(`${evidence.length} arquivos em docs/evidence/: os prints vão para o branch evidence (AGENTS.md)\n${evidence.slice(0, 10).map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
if (broken.length) {
  console.log(`${broken.length} quebrados:\n${broken.map((b) => `  ${b}`).join("\n")}`);
  process.exit(1);
}
console.log("nenhum link quebrado");
