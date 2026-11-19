// O índice da busca pelo sentido de uma pasta de notas (T6013): os vetores dos trechos de cada nota, pela versão
// dela. Ficam em `<dados do app>/folders/<chave>/semantic/`, fora do cofre, e só os vetores: o texto das notas não é
// copiado (o trecho do resultado é refeito da nota, no cofre). A fila anda em segundo plano, um lote por vez.
//
// A CPU (spec #24228): o modelo roda com 1 thread e no máximo `DUTY` do tempo (depois de um lote que levou t, espera
// t × (1 − DUTY) / DUTY), e para enquanto a pessoa usa o Mac ou na bateria (`BackgroundGate`). O arquivo `vectors.bin`
// é o retrato inteiro; o que muda vai para o fim de `vectors.add`, e o retrato só é refeito quando o `.add` cresce.

import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { noteChunks } from "./chunks.ts";
import type { SemanticEngine } from "./engine.ts";
import type { Embedder } from "./embedder.ts";
import type { BackgroundGate } from "./gate.ts";

export interface SemanticDocument {
  path: string;
  title: string;
  version: string;
  content: string;
}

export interface SemanticHit {
  path: string;
  /** A similaridade do melhor trecho (cosseno, de -1 a 1). */
  score: number;
  /** Qual trecho de `noteChunks` casou melhor. */
  chunk: number;
  /** Perto o bastante para entrar sem nenhuma palavra em comum (`NEAR_FLOOR` e `NEAR_MARGIN`). */
  near: boolean;
}

/**
 * O e5 dá entre 0,80 e 0,84 até para o que não tem nada a ver. Medido com o modelo de verdade em 10 notas e 13 buscas
 * (T6013): o que casa fica em 0,835 ou mais e pelo menos 0,025 acima da mediana das notas para aquela busca; as buscas
 * sem nota certa ficaram abaixo de um dos dois. Com poucas notas, a mediana não diz nada e vale só o piso.
 */
export const NEAR_FLOOR = 0.835;
export const NEAR_MARGIN = 0.025;
const MEDIAN_FROM = 5;

interface Stored {
  version: string;
  vectors: Float32Array[];
}

const FILE = "vectors.bin";
/** O que mudou desde o retrato: blocos do mesmo formato, um atrás do outro, com as notas que saíram (`gone`). */
const JOURNAL = "vectors.add";
/** O retrato é refeito quando o `.add` passa disto e da metade do retrato. */
const COMPACT_MIN_BYTES = 8 * 1024 * 1024;
/** A fração do tempo em que o modelo roda, em média, durante a indexação. */
export const DUTY = 0.25;
/** Muda quando o formato do arquivo ou o modelo muda: um arquivo de outro formato é jogado fora e refeito. */
const FORMAT = "kiwi-semantic-1:multilingual-e5-small@761b726";
const BATCH = 8;
/**
 * Trechos por chamada ao modelo. A inferência do ONNX segura a thread do Bun enquanto roda: com 1 thread, 8 trechos
 * prendiam o laço de 100 a 140 ms; 1, de 30 a 50, no mesmo ritmo de trechos por segundo (spec #24228).
 */
export const PER_CALL = 1;
const SAVE_EVERY_MS = 5_000;

/**
 * O que fica no arquivo: o cabeçalho JSON (caminho, versão e quantos vetores) e os vetores em Float32, em ordem. No
 * `.add`, o bloco leva também as notas que saíram (`gone`).
 */
export function encodeIndex(dim: number, notes: ReadonlyMap<string, Stored>, gone: readonly string[] = []): Uint8Array {
  const entries = [...notes].map(([p, s]) => [p, s.version, s.vectors.length] as const);
  const header = new TextEncoder().encode(JSON.stringify(gone.length ? { format: FORMAT, dim, entries, gone } : { format: FORMAT, dim, entries }));
  const count = entries.reduce((sum, [, , n]) => sum + n, 0);
  const pad = (4 - ((4 + header.length) % 4)) % 4;
  const out = new Uint8Array(4 + header.length + pad + count * dim * 4);
  new DataView(out.buffer).setUint32(0, header.length + pad, true);
  out.set(header, 4);
  out.fill(0x20, 4 + header.length, 4 + header.length + pad);
  const floats = new Float32Array(out.buffer, 4 + header.length + pad, count * dim);
  let at = 0;
  for (const s of notes.values())
    for (const v of s.vectors) {
      floats.set(v, at);
      at += dim;
    }
  return out;
}

export function decodeIndex(bytes: Uint8Array, dim: number): Map<string, Stored> | null {
  try {
    if (bytes.length < 4) return null;
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as {
      format?: unknown;
      dim?: unknown;
      entries?: unknown;
    };
    if (header.format !== FORMAT || header.dim !== dim || !Array.isArray(header.entries)) return null;
    const start = 4 + headerLength;
    const copy = bytes.slice(start);
    const floats = new Float32Array(copy.buffer, 0, Math.floor(copy.length / 4));
    const out = new Map<string, Stored>();
    let at = 0;
    for (const e of header.entries as unknown[]) {
      if (!Array.isArray(e) || typeof e[0] !== "string" || typeof e[1] !== "string" || typeof e[2] !== "number") return null;
      const n = e[2];
      if (at + n * dim > floats.length) return null;
      const vectors: Float32Array[] = [];
      for (let i = 0; i < n; i++) vectors.push(floats.subarray(at + i * dim, at + (i + 1) * dim));
      at += n * dim;
      out.set(e[0], { version: e[1], vectors });
    }
    return out;
  } catch {
    // Um arquivo truncado ou de outra versão: o índice é refeito do zero, o cofre é a fonte.
    return null;
  }
}

/**
 * Aplica os blocos do `.add` sobre `into`, em ordem. Um bloco cortado no fim (o app caiu no meio de gravar) e o que vem
 * depois dele ficam de fora; o que veio antes vale. Devolve quantos bytes valeram.
 */
export function applyJournal(bytes: Uint8Array, dim: number, into: Map<string, Stored>): number {
  let at = 0;
  while (at + 4 <= bytes.length) {
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset + at).getUint32(0, true);
    let header: { format?: unknown; dim?: unknown; entries?: unknown; gone?: unknown };
    try {
      header = JSON.parse(new TextDecoder().decode(bytes.subarray(at + 4, at + 4 + headerLength)));
    } catch {
      break;
    }
    if (header.format !== FORMAT || header.dim !== dim || !Array.isArray(header.entries)) break;
    const entries = header.entries as unknown[];
    if (!entries.every((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string" && typeof e[2] === "number")) break;
    const count = (entries as [string, string, number][]).reduce((sum, e) => sum + e[2], 0);
    const end = at + 4 + headerLength + count * dim * 4;
    if (end > bytes.length) break;
    const block = decodeIndex(bytes.subarray(at, end), dim);
    if (!block) break;
    for (const p of Array.isArray(header.gone) ? header.gone : []) if (typeof p === "string") into.delete(p);
    for (const [p, s] of block) into.set(p, s);
    at = end;
  }
  return at;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export interface SemanticIndexOptions {
  dir: string;
  engine: Pick<SemanticEngine, "start" | "loaded">;
  dim?: number;
  /**
   * Entre um lote e outro: a indexação cede a vez, `ms` é a espera para o modelo ficar em `DUTY` do tempo (os testes
   * passam um que não espera).
   */
  pause?(ms: number): Promise<void>;
  /** Para enquanto a pessoa usa o Mac ou na bateria (spec #24228). */
  gate?: Pick<BackgroundGate, "wait">;
  now?(): number;
  /** Quando o retrato é refeito (os testes passam um pequeno). */
  compactMinBytes?: number;
}

export class SemanticIndex {
  private notes = new Map<string, Stored>();
  private wanted = new Map<string, SemanticDocument>();
  private queue: string[] = [];
  private running: Promise<void> | null = null;
  private loaded: Promise<void> | null = null;
  private dirty = false;
  /** O que mudou desde a última gravação: vai para o `.add`. */
  private changed = new Set<string>();
  private gone = new Set<string>();
  /** O tempo do modelo no lote, sem as esperas do portão. */
  private busy = 0;
  private lastSave = 0;
  private closed = false;
  private readonly dim: number;
  private readonly file: string;
  private readonly journal: string;
  private readonly pause: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Quantos trechos passaram pelo modelo nesta sessão (os testes conferem que uma nota igual não volta à fila). */
  embedded = 0;

  constructor(private readonly o: SemanticIndexOptions) {
    this.dim = o.dim ?? 384;
    this.file = path.join(o.dir, FILE);
    this.journal = path.join(o.dir, JOURNAL);
    this.pause = o.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const bytes = await readFile(this.file).catch(() => null);
      const stored = (bytes ? decodeIndex(new Uint8Array(bytes), this.dim) : null) ?? new Map<string, Stored>();
      const add = await readFile(this.journal).catch(() => null);
      if (add) {
        const good = applyJournal(new Uint8Array(add), this.dim, stored);
        // O fim cortado sai, para o próximo bloco não ficar atrás dele.
        if (good < add.length) await writeFile(this.journal, add.subarray(0, good)).catch(() => {});
      }
      for (const [p, s] of stored) if (!this.notes.has(p)) this.notes.set(p, s);
    })();
    return this.loaded;
  }

  /**
   * As notas de agora: o que mudou de versão vai para a fila, o que sumiu sai do índice. Barato quando nada mudou
   * (só compara versões); o modelo só roda em segundo plano.
   */
  sync(documents: Iterable<SemanticDocument>): void {
    if (this.closed) return;
    const next = new Map<string, SemanticDocument>();
    for (const d of documents) next.set(d.path, d);
    this.wanted = next;
    this.running ??= this.drain().finally(() => {
      this.running = null;
      if (!this.closed && this.pending() > 0 && this.o.engine.loaded()) this.sync(this.wanted.values());
    });
  }

  private pending(): number {
    let n = 0;
    for (const [p, d] of this.wanted) if (this.notes.get(p)?.version !== d.version) n++;
    return n;
  }

  private async drain(): Promise<void> {
    await this.load();
    for (const p of [...this.notes.keys()])
      if (!this.wanted.has(p)) {
        this.notes.delete(p);
        this.changed.delete(p);
        this.gone.add(p);
        this.dirty = true;
      }
    if (!(await this.o.engine.start()) || this.closed) return this.save(true);
    this.queue = [...this.wanted.values()].filter((d) => this.notes.get(d.path)?.version !== d.version).map((d) => d.path);
    while (this.queue.length && !this.closed) {
      await this.o.gate?.wait(() => this.closed);
      if (this.closed) break;
      const model = await this.o.engine.start();
      if (!model) break;
      const batch = this.queue.splice(0, BATCH);
      this.busy = 0;
      for (const p of batch) await this.embedNote(model, p);
      const busy = this.busy;
      await this.save(false);
      // O modelo trabalha no máximo `DUTY` do tempo: depois de `busy` ms, espera o resto.
      await this.pause(Math.max(25, (busy * (1 - DUTY)) / DUTY));
    }
    await this.save(true);
  }

  private async embedNote(model: Embedder, p: string): Promise<void> {
    const d = this.wanted.get(p);
    if (!d || this.notes.get(p)?.version === d.version) return;
    const chunks = noteChunks(d.title, d.content);
    const vectors: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += PER_CALL) {
      // O portão a cada chamada, não só entre lotes: uma nota longa não segue rodando depois que o ditado começa.
      await this.o.gate?.wait(() => this.closed);
      if (this.closed) return;
      const t0 = this.now();
      vectors.push(...(await model.embed(chunks.slice(i, i + PER_CALL), "passage")));
      this.busy += this.now() - t0;
    }
    this.embedded += chunks.length;
    // A nota pode ter mudado enquanto o modelo rodava: só fica se ainda é a mesma versão.
    if (this.wanted.get(p)?.version !== d.version || this.closed) return;
    this.notes.set(p, { version: d.version, vectors });
    this.gone.delete(p);
    this.changed.add(p);
    this.dirty = true;
  }

  /** Grava o que mudou no fim do `.add`; o retrato inteiro só quando o `.add` fica grande (`COMPACT_MIN_BYTES`). */
  private async save(force: boolean): Promise<void> {
    if (!this.dirty || (!force && this.now() - this.lastSave < SAVE_EVERY_MS)) return;
    this.dirty = false;
    this.lastSave = this.now();
    const changed = new Map<string, Stored>();
    for (const p of this.changed) {
      const s = this.notes.get(p);
      if (s) changed.set(p, s);
    }
    const gone = [...this.gone];
    this.changed.clear();
    this.gone.clear();
    try {
      await mkdir(this.o.dir, { recursive: true });
      const [snap, add] = await Promise.all([stat(this.file).catch(() => null), stat(this.journal).catch(() => null)]);
      const block = encodeIndex(this.dim, changed, gone);
      const addBytes = (add?.size ?? 0) + block.length;
      if (!snap || (addBytes > (this.o.compactMinBytes ?? COMPACT_MIN_BYTES) && addBytes > snap.size / 2)) await this.compact();
      else await appendFile(this.journal, block);
    } catch (e) {
      // O disco cheio no meio (T7942): o que não foi gravado volta para a próxima vez.
      for (const p of changed.keys()) if (this.notes.has(p)) this.changed.add(p);
      for (const p of gone) if (!this.notes.has(p)) this.gone.add(p);
      this.dirty = true;
      throw e;
    }
  }

  /** O retrato inteiro, por um temporário; depois, o `.add` sai (o que estava nele já está no retrato). */
  private async compact(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    try {
      await writeFile(tmp, encodeIndex(this.dim, this.notes));
      await rename(tmp, this.file);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    await rm(this.journal, { force: true });
  }

  /**
   * As notas mais perto da busca pelo sentido, já com o modelo carregado; sem ele, nada (a busca segue só com as
   * palavras). A nota vale o seu melhor trecho, e só entra a versão que ainda é a da nota.
   */
  async query(text: string, limit: number): Promise<SemanticHit[]> {
    const model = this.o.engine.loaded();
    if (!model || !text.trim()) return [];
    await this.load();
    const [q] = await model.embed([text], "query");
    if (!q) return [];
    const out: SemanticHit[] = [];
    for (const [p, s] of this.notes) {
      if (this.wanted.size && this.wanted.get(p)?.version !== s.version) continue;
      let best = -Infinity;
      let chunk = 0;
      s.vectors.forEach((v, i) => {
        const score = dot(q, v);
        if (score > best) {
          best = score;
          chunk = i;
        }
      });
      if (Number.isFinite(best)) out.push({ path: p, score: best, chunk, near: false });
    }
    out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const median = out.length >= MEDIAN_FROM ? out[Math.floor(out.length / 2)]!.score : -Infinity;
    for (const h of out) h.near = h.score >= NEAR_FLOOR && h.score - median >= NEAR_MARGIN;
    return out.slice(0, limit);
  }

  status(): { notes: number; indexed: number } {
    let indexed = 0;
    for (const [p, d] of this.wanted) if (this.notes.get(p)?.version === d.version) indexed++;
    return { notes: this.wanted.size, indexed };
  }

  /** Espera a fila (os testes e o roteiro da CLI). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Desligado: apaga os vetores desta pasta. */
  async clear(): Promise<void> {
    await this.idle();
    this.notes.clear();
    this.changed.clear();
    this.gone.clear();
    this.dirty = false;
    await rm(this.o.dir, { recursive: true, force: true });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.queue = [];
    await this.idle();
  }
}
