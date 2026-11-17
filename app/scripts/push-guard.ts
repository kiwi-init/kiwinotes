// A guarda de privacidade antes do GitHub (spec #14415, T14423). O `privacy-check` do CI roda depois do push, e só
// conhece os termos que já vazaram. Esta guarda roda no hook `pre-push` (o push nem sai) e no CI de cada PR, sobre os
// commits que sobem, e não só sobre a árvore final, porque as refs dos PRs guardam cada commit:
//
// - **a lista em hash** (`privacy-terms.txt`, a mesma do `privacy-check`);
// - **padrões genéricos**: IDs de nuvem (service account do GCP, `projects/<id>`, `gs://`, ARN e chave da AWS), os
//   segredos que o guardrail do app reconhece pelo formato e nomes de máquina `<nome>.local`. O e-mail de autor dos
//   commits pode ficar (o harry, #14430);
// - **as mensagens dos commits**, com as mesmas regras. As linhas de autoria (`Co-authored-by`) e o e-mail de autor e de
//   committer podem ficar (o harry, #14430), menos um nome de máquina `.local` neles (#14434);
// - **as imagens novas** (png, jpg, webp, gif): o texto delas, por OCR local (o Vision do macOS), passa pelas mesmas
//   regras. Fora do macOS não há OCR; o CI roda em macOS.
//
// Nada do que ela acha vai para a saída: só o arquivo, a linha e o motivo (um log de CI pode ser público).
//
//   bun scripts/push-guard.ts --push                 o hook: lê do stdin as linhas do pre-push
//   bun scripts/push-guard.ts --range <base>..<head> os commits de um PR (o CI, que roda em macOS e faz o OCR)
//   bun scripts/push-guard.ts --line <arquivo> <n>   a linha de exceção para `privacy-exceptions.txt`
//
// **Falso positivo:** uma exceção por arquivo e por linha em `privacy-exceptions.txt`, revisada no PR, e nunca por
// termo. A chave é o SHA-256 do texto da linha, então a exceção vale onde a linha estiver, e só para ela.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { detect } from "../src/guardrail/detector.ts";
import { linesWithTerms, matcher, parseTerms, type Terms } from "./privacy-check.ts";

export interface Hit {
  file: string;
  line: number;
  reason: string;
}

/** Os valores de exemplo que os testes e os docs usam: obviamente falsos, por isso não barram. */
const FAKE_PROJECT = /^prj-exemplo(?:-[a-z0-9-]+)?$/;

const PATTERNS: { reason: string; re: RegExp; ok?: (m: RegExpExecArray) => boolean }[] = [
  {
    reason: "service account do GCP",
    re: /[a-z0-9-]+@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com/gi,
    ok: (m) => FAKE_PROJECT.test(m[1]!.toLowerCase()),
  },
  { reason: "projeto do GCP", re: /\bprojects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/(?:locations|datasets|buckets|serviceAccounts|secrets|zones|regions)\b/gi, ok: (m) => FAKE_PROJECT.test(m[1]!.toLowerCase()) },
  { reason: "bucket gs://", re: /\bgs:\/\/([a-z0-9][a-z0-9._-]{2,62})/gi, ok: (m) => /^(?:exemplo|example)(?:[._-]|$)/.test(m[1]!.toLowerCase()) },
  { reason: "ARN da AWS", re: /\barn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:(\d{12})?:/gi, ok: (m) => !m[1] || /^(?:0{12}|123456789012)$/.test(m[1]) },
  { reason: "nome de máquina .local", re: /\b([A-Za-z0-9][A-Za-z0-9-]*)\.local\b(?![.-]?[A-Za-z0-9])/g, ok: (m) => /^(?:exemplo|example|pessoa|meu-mac|my-mac)$/i.test(m[1]!) },
];

/**
 * Os segredos do guardrail que barram aqui: os que ele reconhece pelo formato (chaves e tokens). Os de contexto (uma
 * senha numa frase, um CPF, um texto que parece aleatório) ficam para o filtro do agente: no código e nos testes, eles
 * dariam falso positivo a toda hora.
 */
const TOKEN_KINDS = new Set<string>([
  "private-key", "aws", "github", "gitlab", "anthropic", "openai", "stripe", "slack", "slack-webhook", "google", "npm",
  "huggingface", "pypi", "jwt", "bearer", "basic", "auth-header", "url-password", "url-token",
]);

/** Os motivos de uma linha: os padrões genéricos e os segredos que o guardrail reconhece pelo formato (os tokens). */
export function lineReasons(text: string): string[] {
  const out = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) if (!p.ok?.(m as RegExpExecArray)) out.add(p.reason);
  }
  for (const f of detect(text)) if (f.verdict === "secret" && TOKEN_KINDS.has(f.kind)) out.add(`segredo (${f.kind})`);
  return [...out];
}

/** As exceções: `arquivo<TAB>sha256 da linha<TAB>motivo`. */
export const lineKey = (file: string, text: string) => `${file}\t${createHash("sha256").update(text.trim()).digest("hex")}`;
export function parseExceptions(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const [file, hash] = line.split("\t");
    if (!file || file.startsWith("#") || !hash) continue;
    keys.add(`${file}\t${hash}`);
  }
  return keys;
}

/** Um `matcher` por lista: a memória das palavras vale para a execução inteira (num range grande, milhões de linhas). */
const matchers = new WeakMap<Terms, ReturnType<typeof matcher>>();
const matcherOf = (terms: Terms) => {
  let m = matchers.get(terms);
  if (!m) matchers.set(terms, (m = matcher(terms)));
  return m;
};

/** O nome de máquina num e-mail ou numa linha de autoria: a autoria pode ficar, o `.local` não (#14434). */
export const machineIn = (text: string): boolean => lineReasons(text).includes("nome de máquina .local");

/** As linhas que barram, num arquivo: a lista em hash e, com `generic`, os padrões. */
export function scanLines(file: string, lines: readonly { n: number; text: string }[], terms: Terms, except: Set<string>, generic = true): Hit[] {
  const hits: Hit[] = [];
  const has = matcherOf(terms);
  for (const { n, text } of lines) {
    if (except.has(lineKey(file, text))) continue;
    const reasons = linesWithTerms(text, terms, has).length ? ["termo da lista (privacy-terms.txt)"] : [];
    if (generic) reasons.push(...lineReasons(text));
    for (const reason of reasons) hits.push({ file, line: n, reason });
  }
  return hits;
}

/** Os arquivos que a guarda não lê: vendorizados ou gerados, com e-mails e nomes que não são nossos. */
export const SKIP = ["app/bun.lock", "app/ui/notes/files/drawio/", "app/scripts/privacy-terms.txt", "app/scripts/privacy-exceptions.txt"];
const IMAGE = /\.(?:png|jpe?g|webp|gif)$/i;

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

/** As linhas que cada commit do range acrescenta, por arquivo (o número é o da linha no commit). */
export function addedLines(cwd: string, range: string[]): Map<string, { n: number; text: string }[]> {
  const out = new Map<string, { n: number; text: string }[]>();
  const log = git(cwd, ["log", "-p", "-U0", "--no-color", "--no-renames", "--format=%x00commit %H", ...range, "--"]);
  let file: string | null = null;
  let n = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (file && SKIP.some((s) => file!.startsWith(s))) file = null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      n = Number(hunk[1]);
      continue;
    }
    if (file && line.startsWith("+") && !line.startsWith("+++")) {
      const list = out.get(file) ?? [];
      list.push({ n, text: line.slice(1) });
      out.set(file, list);
      n++;
    }
  }
  return out;
}

/** Os commits do range: o e-mail do autor e do committer, e a mensagem. */
export function commits(cwd: string, range: string[]): { sha: string; author: string; committer: string; message: string }[] {
  const raw = git(cwd, ["log", "--format=%H%x1f%ae%x1f%ce%x1f%B%x1e", ...range, "--"]);
  return raw
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, author, committer, message] = r.split("\x1f");
      return { sha: sha!, author: author ?? "", committer: committer ?? "", message: message ?? "" };
    });
}

/**
 * Cada versão de imagem que o range acrescenta ou muda, uma vez por blob: um print corrigido num commit seguinte ainda
 * sobe com o commit de antes, porque a ref do PR guarda os dois (revisão do #562).
 */
export function newImages(cwd: string, range: string[]): { file: string; blob: string }[] {
  const raw = git(cwd, ["log", "--format=", "--raw", "--no-abbrev", "--diff-filter=AM", "--no-renames", ...range, "--"]);
  const seen = new Set<string>();
  const out: { file: string; blob: string }[] = [];
  for (const line of raw.split("\n")) {
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [AM]\t(.+)$/.exec(line);
    if (!m || !IMAGE.test(m[2]!) || SKIP.some((s) => m[2]!.startsWith(s)) || seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    out.push({ file: m[2]!, blob: m[1]! });
  }
  return out;
}

/** O texto de uma imagem, pelo Vision do macOS (`ocr.swift`), uma linha por bloco. Fora do macOS: null. */
export function ocrText(file: string): string[] | null {
  if (process.platform !== "darwin") return null;
  const r = spawnSync("swift", [join(import.meta.dir, "ocr.swift"), file], { encoding: "utf8", maxBuffer: 1 << 26 });
  // Só o motivo, a 1ª linha do erro, sem o caminho: quem chama já sabe o arquivo.
  if (r.status !== 0) throw new Error(r.stderr.trim().split("\n")[0]!.replace(/^ocr:\s*/, "") || `o swift saiu com ${r.status}`);
  return r.stdout.split("\n").filter((l) => l.trim());
}

/** Tudo o que barra num range: as linhas novas, as mensagens e, com `ocr`, as imagens novas. */
export function scanRange(cwd: string, range: string[], terms: Terms, except: Set<string>, o: { ocr?: boolean; text?: boolean } = {}): Hit[] {
  const hits: Hit[] = [];
  if (o.text !== false) {
    for (const [file, lines] of addedLines(cwd, range)) hits.push(...scanLines(file, lines, terms, except));
    for (const c of commits(cwd, range)) {
      const at = `commit ${c.sha.slice(0, 8)}`;
      if (machineIn(c.author)) hits.push({ file: at, line: 0, reason: "nome de máquina .local no e-mail de autor" });
      if (machineIn(c.committer)) hits.push({ file: at, line: 0, reason: "nome de máquina .local no e-mail de committer" });
      // As linhas de autoria (Co-authored-by, Signed-off-by) podem ficar (o harry, #14430; o GitHub as escreve no squash),
      // menos um nome de máquina `.local` nelas (#14434).
      const all = c.message.split("\n").map((text, i) => ({ n: i + 1, text }));
      const trailer = (t: string) => /^\s*(?:co-authored-by|signed-off-by|reviewed-by):/i.test(t);
      for (const l of all) if (trailer(l.text) && machineIn(l.text)) hits.push({ file: `${at} (mensagem)`, line: l.n, reason: "nome de máquina .local na autoria" });
      const msg = all.filter((l) => !trailer(l.text));
      hits.push(...scanLines(`${at} (mensagem)`, msg, terms, except));
    }
  }
  if (o.ocr) {
    const dir = mkdtempSync(join(tmpdir(), "push-guard-"));
    try {
      for (const { file, blob } of newImages(cwd, range)) {
        const data = spawnSync("git", ["cat-file", "blob", blob], { cwd, maxBuffer: 1 << 28 });
        if (data.status !== 0) continue;
        const tmp = join(dir, `${blob}${file.slice(file.lastIndexOf("."))}`);
        writeFileSync(tmp, data.stdout);
        // Um erro do OCR barra só aquela imagem, com o arquivo e o motivo, e a guarda segue no resto do range (T16071).
        let text: string[] | null;
        try {
          text = ocrText(tmp);
        } catch (e) {
          hits.push({ file: `${file} (imagem)`, line: 0, reason: `o OCR não leu a imagem: ${(e as Error).message}` });
          continue;
        }
        if (text) hits.push(...scanLines(`${file} (texto da imagem)`, text.map((t, i) => ({ n: i + 1, text: t })), terms, except));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return hits;
}

const ZERO = /^0+$/;

/**
 * O que o pre-push manda (uma linha por ref: `<local ref> <local sha> <remote ref> <remote sha>`), virado em ranges.
 * `known` diz se o sha do remoto existe aqui: num force-push sobre algo que não foi buscado, ele não existe, e o range
 * vira o de um branch novo (o que nenhum ref do remoto tem), em vez de quebrar.
 */
export function pushRanges(stdin: string, remote: string, known: (sha: string) => boolean = () => true): string[][] {
  const out: string[][] = [];
  for (const line of stdin.split("\n")) {
    const [, local, , remoteSha] = line.trim().split(/\s+/);
    if (!local || ZERO.test(local)) continue; // apagar uma ref não sobe nada
    // Um branch novo: os commits que o remoto ainda não tem. Um que já existe: só os novos.
    out.push(!remoteSha || ZERO.test(remoteSha) || !known(remoteSha) ? [local, "--not", `--remotes=${remote}`] : [`${remoteSha}..${local}`]);
  }
  return out;
}

function report(hits: Hit[]): void {
  console.error(`push-guard: ${hits.length} ${hits.length === 1 ? "coisa barra" : "coisas barram"} (veja o AGENTS.md, Privacidade):`);
  for (const h of hits) console.error(`  ${h.file}${h.line ? `:${h.line}` : ""}: ${h.reason}`);
  console.error("Troque pelo valor falso de exemplo, ou peça uma exceção por linha em app/scripts/privacy-exceptions.txt (bun scripts/push-guard.ts --line <arquivo> <n>).");
}

if (import.meta.main) {
  // O repo de onde o push sai (o hook roda na raiz dele); a lista em hash é a deste script.
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const repo = top.status === 0 ? top.stdout.trim() : resolve(import.meta.dir, "..", "..");
  const terms = parseTerms(readFileSync(join(import.meta.dir, "privacy-terms.txt"), "utf8"));
  const exceptionsFile = join(repo, "app", "scripts", "privacy-exceptions.txt");
  const except = parseExceptions(existsSync(exceptionsFile) ? readFileSync(exceptionsFile, "utf8") : "");
  const [mode, a, b] = process.argv.slice(2);
  let hits: Hit[] = [];
  if (mode === "--push") {
    const remote = a ?? "origin";
    const stdin = await new Response(Bun.stdin.stream()).text();
    const known = (sha: string) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo }).status === 0;
    for (const range of pushRanges(stdin, remote, known)) hits.push(...scanRange(repo, range, terms, except, { ocr: process.platform === "darwin" }));
  } else if (mode === "--range" && a) {
    hits = scanRange(repo, [a], terms, except, { ocr: process.platform === "darwin" });
  } else if (mode === "--line" && a && b) {
    const text = readFileSync(join(process.cwd(), a), "utf8").split("\n")[Number(b) - 1] ?? "";
    const file = git(process.cwd(), ["ls-files", "--full-name", a]).trim() || a;
    console.log(`${lineKey(file, text)}\t<o motivo, revisado no PR>`);
    process.exit(0);
  } else {
    console.error("usage: bun scripts/push-guard.ts --push [remote] | --range <base>..<head> | --line <arquivo> <n>");
    process.exit(2);
  }
  if (hits.length) {
    report(hits);
    process.exit(1);
  }
  console.log("push-guard: nada barra");
}
