// O guarda da privacidade (spec #14082, T14094): nenhum arquivo rastreado do repo traz de volta um termo do trabalho
// do harry, do Mac dele ou de outra pessoa. A lista não fica em texto no repo: `privacy-terms.txt` guarda só o
// SHA-256 de cada termo já normalizado. O script normaliza o texto do mesmo jeito, calcula o hash de cada palavra (e
// de cada sequência de palavras, para os termos de mais de uma) e compara. Sai com exit 1 e o arquivo e a linha
// quando acha um, sem dizer o termo.
//
//   bun scripts/privacy-check.ts            confere o repo
//   bun scripts/privacy-check.ts --hash "termo"   o hash de um termo novo, para pôr na lista
//
// A normalização: sem acento, minúsculas, `termoStore` vira `termo store`, e o resto que não é letra nem número
// separa as palavras. Um termo longo de uma palavra também pega o começo de uma palavra maior (`termoweb`).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * As palavras de um texto, normalizadas como os termos da lista. O `\n` escrito num código (`"\nTERMO"`) separa
 * palavras. Com `camel`, `termoStore` também vira duas; sem ele, não: um hash como `xTrmQ` não vira palavras soltas.
 */
export function words(text: string, camel = true): string[] {
  let t = text.replace(/\\[nrt]/g, " ");
  if (camel) t = t.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export const hashOf = (term: string): string => createHash("sha256").update(words(term).join(" ")).digest("hex");

export type Terms = { hashes: Set<string>; sizes: Set<number>; prefixLengths: Set<number> };

/**
 * A lista: uma linha por termo, `<palavras> <letras> <p|e> <sha256>`; `#` é comentário. `p`: um termo de uma palavra que
 * também pega o começo de uma palavra maior; `e`: só a palavra inteira (os curtos, que apareceriam no meio de um hash).
 */
export function parseTerms(text: string): Terms {
  const t: Terms = { hashes: new Set(), sizes: new Set(), prefixLengths: new Set() };
  for (const line of text.split("\n")) {
    const [n, len, mode, hash] = line.trim().split(/\s+/);
    if (!n || n.startsWith("#") || !hash) continue;
    t.hashes.add(hash);
    t.sizes.add(Number(n));
    if (Number(n) === 1 && mode === "p") t.prefixLengths.add(Number(len));
  }
  return t;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Se uma palavra ou sequência é um termo da lista, com memória: o repo repete muito as mesmas palavras. */
export function matcher(terms: Terms): (key: string, prefix: boolean) => boolean {
  const seen = new Map<string, boolean>();
  return (key, prefix) => {
    const id = `${prefix ? "p" : "e"}${key}`;
    let hit = seen.get(id);
    if (hit === undefined) {
      hit = !prefix && terms.hashes.has(sha(key));
      if (prefix) for (const len of terms.prefixLengths) if (len <= key.length && terms.hashes.has(sha(key.slice(0, len)))) hit = true;
      seen.set(id, hit);
    }
    return hit;
  };
}

/**
 * As linhas (a partir de 1) de um texto que têm um termo da lista: a palavra inteira (sem separar o camelCase), o
 * começo de uma palavra para os termos longos e as sequências de palavras para os termos de mais de uma.
 */
export function linesWithTerms(text: string, terms: Terms, has = matcher(terms)): number[] {
  const out: number[] = [];
  const sizes = [...terms.sizes].filter((n) => n > 1);
  text.split("\n").forEach((line, i) => {
    const plain = words(line, false);
    const w = words(line);
    const hit =
      plain.some((word) => has(word, false)) ||
      (terms.prefixLengths.size > 0 && w.some((word) => has(word, true))) ||
      sizes.some((size) => w.some((_, k) => k + size <= w.length && has(w.slice(k, k + size).join(" "), false)));
    if (hit) out.push(i + 1);
  });
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--hash") {
    const term = args.slice(1).join(" ");
    const w = words(term);
    console.log(`${w.length} ${w.join(" ").length} ${w.length === 1 && w[0]!.length >= 5 ? "p" : "e"} ${hashOf(term)}`);
    process.exit(0);
  }
  const repo = resolve(import.meta.dir, "..", "..");
  const terms = parseTerms(readFileSync(join(import.meta.dir, "privacy-terms.txt"), "utf8"));
  // O drawio é de fora (vendorizado) e tem nomes de emoji e de forma que não são nossos.
  const skip = ["app/ui/notes/files/drawio/", "app/scripts/privacy-terms.txt"];
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(listed.stderr);
  const files = listed.stdout.split("\0").filter((f) => f && !skip.some((s) => f.startsWith(s)));
  const found: string[] = [];
  const has = matcher(terms);
  for (const file of files) {
    const data = readFileSync(join(repo, file));
    if (data.subarray(0, 8000).includes(0)) continue;
    for (const line of linesWithTerms(data.toString("utf8"), terms, has)) found.push(`${file}:${line}`);
  }
  console.log(`${files.length} arquivos, ${terms.hashes.size} termos na lista`);
  if (found.length) {
    console.log(`${found.length} linhas com um termo da lista (veja o AGENTS.md, Privacidade):\n${found.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("nenhum termo da lista");
}
