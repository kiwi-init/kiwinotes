// O índice da busca pelo sentido de uma pasta de notas (T6013): os vetores dos trechos de cada nota, pela versão
// dela. Ficam em `<dados do app>/folders/<chave>/semantic/`, fora do cofre, e só os vetores: o texto das notas não é
// copiado (o trecho do resultado é refeito da nota, no cofre). A fila anda em segundo plano, um lote por vez.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { noteChunks } from "./chunks.ts";
import type { SemanticEngine } from "./engine.ts";
import type { Embedder } from "./embedder.ts";

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
}

interface Stored {
  version: string;
  vectors: Float32Array[];
}

const FILE = "vectors.bin";
/** Muda quando o formato do arquivo ou o modelo muda: um arquivo de outro formato é jogado fora e refeito. */
const FORMAT = "kiwi-semantic-1:multilingual-e5-small@761b726";
const BATCH = 8;
const SAVE_EVERY_MS = 5_000;

/** O que fica no arquivo: o cabeçalho JSON (caminho, versão e quantos vetores) e os vetores em Float32, em ordem. */
export function encodeIndex(dim: number, notes: ReadonlyMap<string, Stored>): Uint8Array {
  const entries = [...notes].map(([p, s]) => [p, s.version, s.vectors.length] as const);
  const header = new TextEncoder().encode(JSON.stringify({ format: FORMAT, dim, entries }));
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

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export interface SemanticIndexOptions {
  dir: string;
  engine: Pick<SemanticEngine, "start" | "loaded">;
  dim?: number;
  /** Entre um lote e outro: a indexação cede a vez (os testes passam um que não espera). */
  pause?(): Promise<void>;
  now?(): number;
}

export class SemanticIndex {
  private notes = new Map<string, Stored>();
  private wanted = new Map<string, SemanticDocument>();
  private queue: string[] = [];
  private running: Promise<void> | null = null;
  private loaded: Promise<void> | null = null;
  private dirty = false;
  private lastSave = 0;
  private closed = false;
  private readonly dim: number;
  private readonly file: string;
  private readonly pause: () => Promise<void>;
  private readonly now: () => number;
  /** Quantos trechos passaram pelo modelo nesta sessão (os testes conferem que uma nota igual não volta à fila). */
  embedded = 0;

  constructor(private readonly o: SemanticIndexOptions) {
    this.dim = o.dim ?? 384;
    this.file = path.join(o.dir, FILE);
    this.pause = o.pause ?? (() => new Promise((r) => setTimeout(r, 25)));
    this.now = o.now ?? Date.now;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const bytes = await readFile(this.file).catch(() => null);
      const stored = bytes ? decodeIndex(new Uint8Array(bytes), this.dim) : null;
      if (stored) for (const [p, s] of stored) if (!this.notes.has(p)) this.notes.set(p, s);
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
        this.dirty = true;
      }
    const model = await this.o.engine.start();
    if (!model || this.closed) return this.save(true);
    this.queue = [...this.wanted.values()].filter((d) => this.notes.get(d.path)?.version !== d.version).map((d) => d.path);
    while (this.queue.length && !this.closed) {
      const batch = this.queue.splice(0, BATCH);
      for (const p of batch) await this.embedNote(model, p);
      await this.save(false);
      await this.pause();
    }
    await this.save(true);
  }

  private async embedNote(model: Embedder, p: string): Promise<void> {
    const d = this.wanted.get(p);
    if (!d || this.notes.get(p)?.version === d.version) return;
    const chunks = noteChunks(d.title, d.content);
    const vectors: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += BATCH) vectors.push(...(await model.embed(chunks.slice(i, i + BATCH), "passage")));
    this.embedded += chunks.length;
    // A nota pode ter mudado enquanto o modelo rodava: só fica se ainda é a mesma versão.
    if (this.wanted.get(p)?.version !== d.version || this.closed) return;
    this.notes.set(p, { version: d.version, vectors });
    this.dirty = true;
  }

  private async save(force: boolean): Promise<void> {
    if (!this.dirty || (!force && this.now() - this.lastSave < SAVE_EVERY_MS)) return;
    this.dirty = false;
    this.lastSave = this.now();
    await mkdir(this.o.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, encodeIndex(this.dim, this.notes));
    await rename(tmp, this.file);
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
      if (Number.isFinite(best)) out.push({ path: p, score: best, chunk });
    }
    return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
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
    this.dirty = false;
    await rm(this.o.dir, { recursive: true, force: true });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.queue = [];
    await this.idle();
  }
}
