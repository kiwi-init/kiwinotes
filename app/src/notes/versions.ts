// O histórico de versões das notas (T2680, spec #2457 ponto 3, item 8 do top 10 do T2512). Fica **fora do vault**, em
// `<dados do app>/history/notes/<id>/<carimbo>.md`, para não sujar o Obsidian (o `history/` de cima é o do ditado, com os
// `AAAA-MM-DD.jsonl`; este fica na subpasta `notes`). Um `index.json` (em `history/notes/`) liga o caminho da nota
// ao id, e o id segue a nota quando ela muda de nome ou de pasta (pelo app ou por fora).
//
// - Grava a cada save que muda o texto, no máximo uma versão a cada `minGapMs` (2 min) por nota. O que chega no meio
//   fica pendente e é gravado quando o intervalo acaba, ao fechar (sair do app) ou antes de um restaurar.
// - A primeira mudança de uma nota sem histórico grava antes o texto de antes (a "versão original"): é ela que se quer
//   de volta quando a edição deu errado.
// - Guarda até `maxCount` (50) versões e até `maxAgeMs` (30 dias) por nota. Uma versão igual à última não entra.
// - Apagar a nota não apaga o histórico: se ela voltar (a Lixeira), ele está lá.
// - Cada pasta guarda o caminho da nota num `note.json` (T7940): com o `index.json` vazio, cortado ou estragado, o índice
//   se refaz pelas pastas, e as versões não somem. As duas escritas vão com `fsync` antes do rename, como o cofre.
// - Uma pasta que ninguém reclama (de antes do `note.json`, com o índice perdido) só perde o que passou dos 30 dias.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export interface VersionInfo {
  /** O nome do arquivo da versão, sem `.md`: o carimbo da hora. */
  id: string;
  at: string;
  size: number;
}

export interface VersionsOptions {
  /** `<dados do app>/history/notes`. */
  dir: string;
  now?: () => number;
  minGapMs?: number;
  maxCount?: number;
  maxAgeMs?: number;
}

export const MIN_GAP_MS = 2 * 60_000;
export const MAX_VERSIONS = 50;
export const MAX_AGE_MS = 30 * 86_400_000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
/** O carimbo da versão (e o nome do arquivo): a hora ISO sem `:` nem `.`, que ordena como texto. */
const stampOf = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, "-");
/** De volta: `2026-11-04T05-10-00-000Z` → `2026-11-04T05:10:00.000Z`. */
export function atOf(id: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:~\d+)?$/.exec(id);
  if (!m) throw new Error(`not a version id: ${id}`);
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}
const isNoteId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{16}$/.test(id);
/** O arquivo, em cada pasta de versões, que diz de que nota ela é (T7940). */
const NOTE_FILE = "note.json";
const isVersionId = (id: unknown): id is string => typeof id === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:~\d+)?$/.test(id);

interface Pending {
  content: string;
  timer: ReturnType<typeof setTimeout>;
}

export class NoteVersions {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly minGapMs: number;
  private readonly maxCount: number;
  private readonly maxAgeMs: number;
  /** path → id. Lido uma vez, gravado a cada mudança. */
  private index: Record<string, string> | null = null;
  /** A hora e o hash da última versão gravada de cada id. */
  private last = new Map<string, { at: number; hash: string }>();
  private pending = new Map<string, Pending>();
  /** Uma escrita por vez (o índice e as versões), na ordem em que chegaram. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(o: VersionsOptions) {
    this.dir = o.dir;
    this.now = o.now ?? Date.now;
    this.minGapMs = o.minGapMs ?? MIN_GAP_MS;
    this.maxCount = o.maxCount ?? MAX_VERSIONS;
    this.maxAgeMs = o.maxAgeMs ?? MAX_AGE_MS;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------- o que o app chama

  /**
   * Um save mudou a nota para `content`. `before` é o texto de antes: se a nota ainda não tem histórico, ele vira a 1ª
   * versão. Respeita o intervalo mínimo: dentro dele, a versão fica pendente.
   */
  record(notePath: string, content: string, before?: string): Promise<void> {
    return this.serial(async () => {
      const id = await this.idFor(notePath, true);
      const known = await this.latest(id);
      // A 1ª mudança de uma nota sem histórico: o texto de antes entra primeiro, e o novo logo em seguida.
      const first = !known && before !== undefined && before !== content;
      if (first) await this.write(id, before, this.now() - 1);
      const last = await this.latest(id);
      if (last && last.hash === hash(content)) return this.cancel(notePath);
      if (!last || first || this.now() - last.at >= this.minGapMs) {
        this.cancel(notePath);
        await this.write(id, content, this.now());
        return;
      }
      // Dentro do intervalo: guarda a mais nova e grava quando o intervalo acabar.
      const wait = Math.max(0, last.at + this.minGapMs - this.now());
      const old = this.pending.get(notePath);
      if (old) clearTimeout(old.timer);
      const timer = setTimeout(() => void this.flush(notePath), wait);
      (timer as { unref?: () => void }).unref?.();
      this.pending.set(notePath, { content, timer });
    });
  }

  /** Grava já o que está pendente (de uma nota, ou de todas). */
  flush(notePath?: string): Promise<void> {
    return this.serial(async () => {
      for (const [p, item] of [...this.pending]) {
        if (notePath !== undefined && p !== notePath) continue;
        this.cancel(p);
        const id = await this.idFor(p, true);
        const last = await this.latest(id);
        if (last && last.hash === hash(item.content)) continue;
        await this.write(id, item.content, this.now());
      }
    });
  }

  /** As versões de uma nota, a mais nova primeiro (o que está pendente entra antes). */
  async list(notePath: string): Promise<VersionInfo[]> {
    await this.flush(notePath);
    return this.serial(async () => {
      const id = await this.idFor(notePath, false);
      if (!id) return [];
      const out: VersionInfo[] = [];
      for (const name of await this.files(id)) {
        const vid = name.slice(0, -3);
        const content = await readFile(path.join(this.noteDir(id), name), "utf8").catch(() => null);
        if (content !== null) out.push({ id: vid, at: atOf(vid), size: Buffer.byteLength(content) });
      }
      return out.reverse();
    });
  }

  /** O texto de uma versão. */
  async get(notePath: string, versionId: unknown): Promise<{ content: string; at: string }> {
    if (!isVersionId(versionId)) throw Object.assign(new Error("bad version id"), { code: "E_BAD_ARGS" });
    const id = await this.serial(() => this.idFor(notePath, false));
    const content = id ? await readFile(path.join(this.noteDir(id), `${versionId}.md`), "utf8").catch(() => null) : null;
    if (content === null) throw Object.assign(new Error(`no version ${versionId} of ${notePath}`), { code: "E_NOT_FOUND" });
    return { content, at: atOf(versionId) };
  }

  /** Grava uma versão agora, sem esperar o intervalo (o restaurar: a volta também é uma versão). */
  snapshot(notePath: string, content: string): Promise<void> {
    return this.serial(async () => {
      this.cancel(notePath);
      const id = await this.idFor(notePath, true);
      const last = await this.latest(id);
      if (!last || last.hash !== hash(content)) await this.write(id, content, this.now());
    });
  }

  /** As notas mudaram de caminho: o histórico vai junto. `map` diz o caminho novo de cada um (ou o mesmo). */
  move(map: (p: string) => string): Promise<void> {
    return this.serial(async () => {
      const index = await this.loadIndex();
      let changed = false;
      const next: Record<string, string> = {};
      // Primeiro o que fica; depois o que se moveu, por cima. Se o caminho novo já tinha um histórico (uma nota apagada
      // ali antes), vale o da nota que se moveu, que é a que existe (revisão #2826). O outro fica sem caminho no índice.
      const moved: [string, string][] = [];
      for (const [p, id] of Object.entries(index)) {
        const to = map(p);
        if (to !== p) {
          changed = true;
          moved.push([to, id]);
        } else next[p] = id;
      }
      for (const [to, id] of moved) next[to] = id;
      // O `note.json` de cada pasta acompanha (T7940): a que se moveu diz o caminho novo, e a que perdeu o caminho para ela
      // não diz mais nenhum, para o índice refeito pelas pastas não a pôr de volta ali.
      const owners = new Set(Object.values(next));
      for (const [to, id] of moved) await this.writeOwner(id, to);
      for (const id of Object.values(index)) if (!owners.has(id)) await this.writeOwner(id, null);
      for (const [p, item] of [...this.pending]) {
        const to = map(p);
        if (to !== p) {
          this.pending.delete(p);
          this.pending.set(to, item);
        }
      }
      if (changed) {
        this.index = next;
        await this.saveIndex();
      }
    });
  }

  /** Grava o que está pendente e para os relógios (ao sair do app). */
  async close(): Promise<void> {
    await this.flush();
  }

  // ---------------------------------------------------------------- interno

  private cancel(notePath: string): void {
    const p = this.pending.get(notePath);
    if (p) clearTimeout(p.timer);
    this.pending.delete(notePath);
  }

  private noteDir(id: string): string {
    return path.join(this.dir, id);
  }

  private async files(id: string): Promise<string[]> {
    const names = await readdir(this.noteDir(id)).catch(() => [] as string[]);
    return names.filter((n) => n.endsWith(".md") && isVersionId(n.slice(0, -3))).sort();
  }

  /**
   * O índice, lido uma vez. Vazio, cortado, `null` ou sem `paths` (um crash logo depois do rename, um sync, uma edição à
   * mão): refeito pelos `note.json` das pastas (T7940). Bom ou refeito, as pastas sem `note.json` que o índice conhece
   * ganham o seu, e as que ninguém reclama passam pela poda dos 30 dias.
   */
  private async loadIndex(): Promise<Record<string, string>> {
    if (this.index) return this.index;
    const raw = await readFile(path.join(this.dir, "index.json"), "utf8").catch(() => null);
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const paths = parsed && typeof parsed === "object" ? (parsed as { paths?: unknown }).paths : undefined;
    const index: Record<string, string> = {};
    const valid = !!paths && typeof paths === "object" && !Array.isArray(paths);
    if (valid) for (const [p, id] of Object.entries(paths as object)) if (isNoteId(id)) index[p] = id;
    const dirs = (await readdir(this.dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && isNoteId(d.name)).map((d) => d.name);
    const known = new Set(Object.values(index));
    let rebuilt = false;
    const claims = new Map<string, string[]>();
    for (const id of dirs) {
      if (known.has(id)) {
        if ((await this.readOwner(id)) === undefined) await this.writeOwner(id, Object.keys(index).find((p) => index[p] === id)!).catch(() => {});
        continue;
      }
      const owner = await this.readOwner(id);
      if (typeof owner === "string") claims.set(owner, [...(claims.get(owner) ?? []), id]);
      else await this.pruneOrphan(id);
    }
    // Duas pastas dizendo a mesma nota (raro: um note.json que não acompanhou um move): fica a do índice, ou a de versão
    // mais nova. As outras largam o caminho e passam pela poda dos 30 dias, como as órfãs (T8073); antes, ficavam no
    // disco para sempre.
    const losers: string[] = [];
    for (const [p, ids] of claims) {
      if (index[p]) {
        losers.push(...ids);
        continue;
      }
      const newest = async (id: string) => (await this.files(id)).at(-1) ?? "";
      let best = ids[0]!;
      for (const id of ids.slice(1)) if ((await newest(id)) > (await newest(best))) best = id;
      losers.push(...ids.filter((id) => id !== best));
      index[p] = best;
      rebuilt = true;
    }
    for (const id of losers) {
      await this.pruneOrphan(id);
      if ((await this.files(id)).length) await this.writeOwner(id, null).catch(() => {});
    }
    this.index = index;
    if (rebuilt || (raw !== null && !valid)) {
      console.warn(`[notes] versions: index.json ${raw === null ? "missing" : "broken"}; rebuilt from ${Object.keys(index).length} folders`);
      await this.saveIndex();
    }
    return this.index;
  }

  private async saveIndex(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.durable(this.dir, "index.json", JSON.stringify({ version: 1, paths: this.index }));
  }

  /**
   * Grava `name` em `dir` pelo temporário, com `fsync` antes do rename (o 0 byte do APFS num crash, T7940), como o
   * `writeDurable` do cofre, mas só para a pessoa (0600): é o texto das notas.
   */
  private async durable(dir: string, name: string, content: string): Promise<void> {
    const tmp = path.join(dir, `.${name}-${randomBytes(4).toString("hex")}.tmp`);
    try {
      const fh = await open(tmp, "w", 0o600);
      try {
        await fh.writeFile(content);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, path.join(dir, name));
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** O caminho da nota que a pasta diz (`note.json`): null quando ela perdeu o caminho; undefined sem o arquivo. */
  private async readOwner(id: string): Promise<string | null | undefined> {
    const raw = await readFile(path.join(this.noteDir(id), NOTE_FILE), "utf8").catch(() => null);
    if (raw === null) return undefined;
    try {
      const p = (JSON.parse(raw) as { path?: unknown } | null)?.path;
      return typeof p === "string" && p ? p : null;
    } catch {
      return undefined;
    }
  }

  private async writeOwner(id: string, notePath: string | null): Promise<void> {
    const dir = this.noteDir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.durable(dir, NOTE_FILE, JSON.stringify({ path: notePath }));
  }

  /** Uma pasta que nenhuma nota reclama: só a poda por idade, e a pasta vazia some (T7940). */
  private async pruneOrphan(id: string): Promise<void> {
    const oldest = this.now() - this.maxAgeMs;
    for (const name of await this.files(id))
      if (Date.parse(atOf(name.slice(0, -3))) < oldest) await rm(path.join(this.noteDir(id), name), { force: true });
    // Sem versão nenhuma, a pasta some, com o note.json junto (T8073).
    if (!(await this.files(id)).length) await rm(this.noteDir(id), { recursive: true, force: true }).catch(() => {});
  }

  private async idFor(notePath: string, create: true): Promise<string>;
  private async idFor(notePath: string, create: boolean): Promise<string | null>;
  private async idFor(notePath: string, create: boolean): Promise<string | null> {
    const index = await this.loadIndex();
    if (index[notePath]) return index[notePath]!;
    if (!create) return null;
    const id = randomBytes(8).toString("hex");
    index[notePath] = id;
    await this.writeOwner(id, notePath);
    await this.saveIndex();
    return id;
  }

  /** A última versão gravada de um id (da memória, ou do disco na 1ª vez). */
  private async latest(id: string): Promise<{ at: number; hash: string } | null> {
    const cached = this.last.get(id);
    if (cached) return cached;
    const names = await this.files(id);
    const name = names.at(-1);
    if (!name) return null;
    const content = await readFile(path.join(this.noteDir(id), name), "utf8").catch(() => null);
    if (content === null) return null;
    const info = { at: Date.parse(atOf(name.slice(0, -3))), hash: hash(content) };
    this.last.set(id, info);
    return info;
  }

  private async write(id: string, content: string, at: number): Promise<void> {
    const dir = this.noteDir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let name = `${stampOf(at)}.md`;
    // Duas no mesmo milissegundo (raro): um sufixo que ordena depois da 1ª (o `~` vem depois do `.`, revisão #2826).
    for (let n = 2; (await this.files(id)).includes(name); n++) name = `${stampOf(at)}~${n}.md`;
    await this.durable(dir, name, content);
    this.last.set(id, { at, hash: hash(content) });
    await this.prune(id);
  }

  /** Até `maxCount` versões e só as dos últimos `maxAgeMs`; a mais nova sempre fica. */
  private async prune(id: string): Promise<void> {
    const names = await this.files(id);
    const oldest = this.now() - this.maxAgeMs;
    const keep = new Set(names.slice(-this.maxCount));
    for (const name of names.slice(0, -1)) {
      if (!keep.has(name) || Date.parse(atOf(name.slice(0, -3))) < oldest) await rm(path.join(this.noteDir(id), name), { force: true });
    }
  }
}
