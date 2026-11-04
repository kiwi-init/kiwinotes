// O texto dos anexos na busca (T2709, spec #2457 ponto 3): o helper lê as imagens e os PDFs com o Vision e o PDFKit
// do macOS (`kiwi-helper --ocr`), 100% no Mac, e o `notes.search` passa a achar a nota que contém o anexo.
//
// - Uma fila de um arquivo por vez, rodando com `taskpolicy -b` (a prioridade de fundo do macOS: CPU e disco
//   cedem para o resto). O 1º arquivo de uma sessão leva mais (o Vision aquece); os seguintes, ~1 s.
// - Pausa com a bateria baixa e fora da tomada, e tenta de novo depois.
// - O texto fica em `<dados do app>/ocr/<sha256 do arquivo>.json`, fora do vault: o mesmo arquivo nunca é lido duas
//   vezes, nem depois de renomeado ou movido.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isAttachmentName } from "../shared/attachments.ts";
import { approxWord, wordsOf } from "../shared/fuzzy.ts";
import { fold } from "../store/text.ts";
import { listAttachments, resolveAttachment } from "./attachments.ts";
import { inside } from "./paths.ts";
import type { NoteMeta, SearchHit } from "./vault.ts";
import { parseLinks } from "../shared/wikilinks.ts";
import { oneSpace, parseQuery } from "../shared/query.ts";

/** O que o helper devolve por arquivo. */
export interface OcrLine {
  file: string;
  text?: string;
  method?: string;
  pages?: number;
  ms?: number;
  error?: string;
}

export interface OcrRunner {
  run(absPaths: string[]): Promise<OcrLine[]>;
}

/** O que fica no cache, por hash do arquivo. */
export interface OcrEntry {
  text: string;
  method: string;
  pages: number;
  ms: number;
}

/** A bateria abaixo disto e fora da tomada: a fila espera. */
export const LOW_BATTERY = 20;
/** Quanto a fila espera antes de olhar a bateria de novo. */
export const BATTERY_RETRY_MS = 5 * 60_000;
/** O primeiro arquivo aquece o Vision (até ~1,5 min em fundo no M1 Pro): o limite é folgado. */
const RUN_TIMEOUT_MS = 10 * 60_000;

/** `kiwi-helper --ocr`, em prioridade de fundo (`taskpolicy -b`), um arquivo por vez. */
export function helperRunner(helper: string): OcrRunner {
  return {
    run: (absPaths) =>
      new Promise((resolve, reject) => {
        const p = spawn("/usr/sbin/taskpolicy", ["-b", helper, "--ocr", ...absPaths], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const timer = setTimeout(() => p.kill("SIGKILL"), RUN_TIMEOUT_MS);
        p.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
        p.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
        p.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        p.on("exit", (code) => {
          clearTimeout(timer);
          if (code !== 0) return reject(new Error(`kiwi-helper --ocr exited with ${code}: ${err.trim().slice(0, 300)}`));
          const lines: OcrLine[] = [];
          for (const l of out.split("\n")) {
            if (!l.trim()) continue;
            try {
              lines.push(JSON.parse(l) as OcrLine);
            } catch {
              // uma linha que não é JSON (um aviso do sistema): fica de fora
            }
          }
          resolve(lines);
        });
      }),
  };
}

/** `pmset -g batt`: a bateria está baixa e fora da tomada? Sem bateria (um Mac de mesa) ou sem resposta, não. */
export function lowBattery(pmsetOutput: string, below = LOW_BATTERY): boolean {
  if (!/Battery Power/.test(pmsetOutput)) return false;
  const m = /(\d{1,3})%;\s*discharging/.exec(pmsetOutput);
  return m ? Number(m[1]) < below : false;
}

export function pmsetBattery(): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("/usr/bin/pmset", ["-g", "batt"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    p.on("error", () => resolve(""));
    p.on("exit", () => resolve(out));
  });
}

const sha256 = async (abs: string) => createHash("sha256").update(await readFile(abs)).digest("hex");

/** O trecho em volta do primeiro termo, numa linha só. */
export function snippetOf(text: string, term: string, radius = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = fold(flat).indexOf(term);
  const start = Math.max(0, (at < 0 ? 0 : at) - radius);
  const end = Math.min(flat.length, (at < 0 ? 0 : at) + term.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** "na imagem foto.png" ou "no PDF contrato.pdf". */
export const whereLabel = (p: string) => {
  const name = p.split("/").at(-1)!;
  return /\.pdf$/i.test(name) ? `no PDF ${name}` : `na imagem ${name}`;
};

export interface OcrOptions {
  /** A raiz do vault. */
  root: string;
  /** `<dados do app>/ocr`. */
  cacheDir: string;
  /** Sem ele (o helper não existe neste build), o índice fica parado e a busca segue só com as notas. */
  runner: OcrRunner | null;
  /** O interruptor das Configurações. */
  enabled(): Promise<boolean>;
  /** A saída do `pmset -g batt` (nos testes, de mentira). */
  battery?(): Promise<string>;
  /** Espera (nos testes, na hora). */
  sleep?(ms: number): Promise<void>;
}

export class OcrIndex {
  /** Anexo (relativo ao vault) → o hash e o texto, quando já lido. */
  private byPath = new Map<string, { hash: string; entry: OcrEntry | null }>();
  private queue: string[] = [];
  private running: Promise<void> | null = null;
  private readonly battery: () => Promise<string>;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Quantos arquivos o helper leu nesta sessão, e quanto tempo levou (para o relatório do custo). */
  readonly stats = { read: 0, cached: 0, failed: 0, ms: 0 };

  private runner: OcrRunner | null;

  constructor(private readonly o: OcrOptions) {
    this.runner = o.runner;
    this.battery = o.battery ?? pmsetBattery;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** O helper que lê (o app e o headless sabem onde ele está). Sem ele, a fila não anda. */
  setRunner(runner: OcrRunner | null): void {
    this.runner = runner;
  }

  /** Põe na fila (sem repetir). O que não é anexo fica de fora. */
  enqueue(paths: readonly string[]): void {
    for (const p of paths) if (isAttachmentName(p) && !this.queue.includes(p)) this.queue.push(p);
    this.running ??= this.drain().finally(() => {
      this.running = null;
      // Algo entrou enquanto a fila terminava.
      if (this.queue.length) this.enqueue([]);
    });
  }

  /** Todos os anexos do vault (na abertura): os que já estão no cache não vão ao helper. */
  async scan(): Promise<void> {
    this.enqueue(await listAttachments(this.o.root));
  }

  /** Espera a fila esvaziar (testes e o relatório de custo). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      if (!this.runner || !(await this.o.enabled())) {
        this.queue = [];
        return;
      }
      if (lowBattery(await this.battery())) {
        await this.sleep(BATTERY_RETRY_MS);
        continue;
      }
      const rel = this.queue.shift()!;
      await this.one(rel).catch((e) => {
        this.stats.failed++;
        console.error(`[ocr] ${rel}:`, e instanceof Error ? e.message : e);
      });
    }
  }

  private async one(rel: string): Promise<void> {
    let abs: string;
    let hash: string;
    try {
      abs = inside(this.o.root, rel);
      hash = await sha256(abs);
    } catch {
      this.byPath.delete(rel); // sumiu (apagado, renomeado): o caminho novo chega pelo watcher
      return;
    }
    const cacheFile = path.join(this.o.cacheDir, `${hash}.json`);
    const cached = await readFile(cacheFile, "utf8").then((t) => JSON.parse(t) as OcrEntry, () => null);
    if (cached) {
      this.byPath.set(rel, { hash, entry: cached });
      this.stats.cached++;
      return;
    }
    const [line] = await this.runner!.run([abs]);
    if (!line || line.error !== undefined || typeof line.text !== "string") throw new Error(line?.error ?? "no answer from the helper");
    const entry: OcrEntry = { text: line.text, method: line.method ?? "none", pages: line.pages ?? 0, ms: line.ms ?? 0 };
    await mkdir(this.o.cacheDir, { recursive: true, mode: 0o700 });
    await writeFile(cacheFile, JSON.stringify(entry), { mode: 0o600 });
    this.byPath.set(rel, { hash, entry });
    this.stats.read++;
    this.stats.ms += entry.ms;
  }

  /** O texto lido de um anexo, se já tem. */
  textOf(rel: string): string | null {
    return this.byPath.get(rel)?.entry?.text ?? null;
  }

  /**
   * Os anexos cujo texto tem todos os termos e nenhum dos excluídos, com o trecho do primeiro. Os termos em `loose` (as
   * palavras soltas, não as "frases") aceitam erro de digitação, como no `notes.search` (T2966); o anexo achado assim
   * vem com `approx`.
   */
  match(terms: readonly string[], not: readonly string[] = [], loose: readonly string[] = []): { path: string; snippet: string; approx?: boolean }[] {
    if (!terms.length) return [];
    const out: { path: string; snippet: string; approx?: boolean }[] = [];
    const memos = new Map<string, Map<string, boolean>>();
    for (const [p, v] of this.byPath) {
      const text = v.entry?.text;
      if (!text) continue;
      // O OCR devolve uma linha por linha lida: uma "frase" que atravessa duas linhas da imagem tem que casar, então
      // as quebras viram um espaço, como no `inText` das notas (#98, T2789).
      const folded = oneSpace(fold(text));
      if (not.some((t) => folded.includes(t))) continue;
      let approx = false;
      let near: string | undefined;
      let words: Set<string> | undefined;
      const ok = terms.every((t, i) => {
        if (folded.includes(t)) return true;
        if (!loose.includes(t)) return false;
        let memo = memos.get(t);
        if (!memo) memos.set(t, (memo = new Map()));
        const w = approxWord(t, (words ??= new Set(wordsOf(folded))), memo);
        if (!w) return false;
        approx = true;
        if (i === 0) near = w;
        return true;
      });
      if (ok) out.push({ path: p, snippet: snippetOf(text, near ?? terms[0]!), ...(approx ? { approx: true } : {}) });
    }
    return out.sort((a, b) => Number(!!a.approx) - Number(!!b.approx) || a.path.localeCompare(b.path));
  }
}

/**
 * A busca nos anexos, em notas: cada anexo que casa vira as notas que o embutem (`![[foto.png]]`), com o trecho
 * "na imagem foto.png: …". As que a busca de texto já achou ficam como estão; as novas entram depois delas.
 */
export async function attachmentHits(
  ocr: Pick<OcrIndex, "match">,
  vault: { root: string; notesContaining(text: string): NoteMeta[]; get(path: string): Promise<{ content: string }> },
  query: string,
  already: readonly SearchHit[],
  limit: number,
): Promise<SearchHit[]> {
  // A mesma leitura da busca (T2660): palavras e "frases" têm que estar no texto do anexo, e o `-` exclui. Os filtros
  // de nota (`tag:`, `#`, `path:`) são da nota, não da imagem: com eles, a busca fica só nas notas.
  const q = parseQuery(query);
  if (q.tags.length || q.paths.length || q.notTags.length || q.notPaths.length) return [];
  const terms = [...q.words, ...q.phrases].map((t) => fold(t));
  if (!terms.length) return [];
  const not = q.notText.map((t) => fold(t));
  const matches = ocr.match(terms, not, q.words.map((t) => fold(t)));
  if (!matches.length) return [];
  const files = await listAttachments(vault.root);
  const seen = new Set(already.map((h) => h.path));
  const out: SearchHit[] = [];
  for (const m of matches) {
    const name = m.path.split("/").at(-1)!;
    for (const meta of vault.notesContaining(name.replace(/\.[a-z0-9]+$/i, ""))) {
      if (seen.has(meta.path) || out.length + already.length >= limit) continue;
      const note = await vault.get(meta.path).catch(() => null);
      if (!note || !parseLinks(note.content).some((l) => resolveAttachment(l.target, files) === m.path)) continue;
      seen.add(meta.path);
      out.push({ path: meta.path, title: meta.title, snippet: `${whereLabel(m.path)}: ${m.snippet}`, score: 0.5, ...(m.approx ? { approx: true } : {}) });
    }
  }
  return out;
}
