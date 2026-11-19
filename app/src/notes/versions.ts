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
// - Todo arquivo que o Kiwi grava tem histórico, não só a nota (T21239, spec #21160): o texto (`.txt`, código, json…)
//   entra como a nota, e o binário (xlsx, docx) entra em bytes, num `<carimbo>.bin`, com um teto de espaço por arquivo
//   (`maxBinaryBytes`): passou, saem as mais antigas. O caminho do índice é o do arquivo no cofre, qualquer que seja.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface VersionInfo {
  /** O nome do arquivo da versão, sem `.md`: o carimbo da hora. */
  id: string;
  at: string;
  size: number;
}

/** O que uma versão guarda: o texto (a nota, o `.txt`, o código) ou os bytes (o xlsx, o docx). */
export type VersionContent = string | Uint8Array;

export interface VersionsOptions {
  /** `<dados do app>/history/notes`. */
  dir: string;
  now?: () => number;
  minGapMs?: number;
  maxCount?: number;
  maxAgeMs?: number;
  /** O teto das versões em bytes de um arquivo (T21239); o texto não tem teto. */
  maxBinaryBytes?: number;
}

export const MIN_GAP_MS = 2 * 60_000;
export const MAX_VERSIONS = 50;
export const MAX_AGE_MS = 30 * 86_400_000;
/** O teto por arquivo das versões em bytes (T21239, spec #21160): o número sai da medida do PR. */
export const MAX_BINARY_BYTES = 200 * 1024 * 1024;

const hash = (s: VersionContent) => createHash("sha256").update(s).digest("hex").slice(0, 16);
/** O texto vai num `.md` (como sempre foi), os bytes num `.bin`. */
const TEXT_EXT = ".md";
const BIN_EXT = ".bin";
const extOf = (c: VersionContent) => (typeof c === "string" ? TEXT_EXT : BIN_EXT);
/** O id da versão pelo nome do arquivo (`<carimbo>.md` ou `<carimbo>.bin`). */
const idOfFile = (name: string) => name.replace(/\.(md|bin)$/, "");
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
  content: VersionContent;
  timer: ReturnType<typeof setTimeout>;
}

export class NoteVersions {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly minGapMs: number;
  private readonly maxCount: number;
  private readonly maxAgeMs: number;
  private readonly maxBinaryBytes: number;
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
    this.maxBinaryBytes = o.maxBinaryBytes ?? MAX_BINARY_BYTES;
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
  record(notePath: string, content: VersionContent, before?: VersionContent): Promise<void> {
    return this.serial(async () => {
      const id = await this.idFor(notePath, true);
      const known = await this.latest(id);
      // A 1ª mudança de uma nota sem histórico: o texto de antes entra primeiro, e o novo logo em seguida.
      const first = !known && before !== undefined && hash(before) !== hash(content);
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
        const vid = idOfFile(name);
        const s = await stat(path.join(this.noteDir(id), name)).catch(() => null);
        if (s) out.push({ id: vid, at: atOf(vid), size: s.size });
      }
      return out.reverse();
    });
  }

  /** O texto de uma versão (a nota, o `.txt`, o código). Uma versão em bytes dá `E_BINARY`: ela se lê pelo `read`. */
  async get(notePath: string, versionId: unknown): Promise<{ content: string; at: string }> {
    const v = await this.read(notePath, versionId);
    if (typeof v.content !== "string") throw Object.assign(new Error(`version ${String(versionId)} of ${notePath} is binary`), { code: "E_BINARY" });
    return { content: v.content, at: v.at };
  }

  /** Uma versão como foi guardada: o texto, ou os bytes (T21239). */
  async read(notePath: string, versionId: unknown): Promise<{ content: VersionContent; at: string }> {
    if (!isVersionId(versionId)) throw Object.assign(new Error("bad version id"), { code: "E_BAD_ARGS" });
    const id = await this.serial(() => this.idFor(notePath, false));
    const dir = id ? this.noteDir(id) : null;
    const text = dir ? await readFile(path.join(dir, `${versionId}${TEXT_EXT}`), "utf8").catch(() => null) : null;
    if (text !== null) return { content: text, at: atOf(versionId) };
    const bytes = dir ? await readFile(path.join(dir, `${versionId}${BIN_EXT}`)).catch(() => null) : null;
    if (bytes === null) throw Object.assign(new Error(`no version ${versionId} of ${notePath}`), { code: "E_NOT_FOUND" });
    return { content: new Uint8Array(bytes), at: atOf(versionId) };
  }

  /** Grava uma versão agora, sem esperar o intervalo (o restaurar: a volta também é uma versão). */
  snapshot(notePath: string, content: VersionContent): Promise<void> {
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
    return names.filter((n) => /\.(md|bin)$/.test(n) && isVersionId(idOfFile(n))).sort((a, b) => (idOfFile(a) < idOfFile(b) ? -1 : idOfFile(a) > idOfFile(b) ? 1 : 0));
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
  private async durable(dir: string, name: string, content: VersionContent): Promise<void> {
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
      if (Date.parse(atOf(idOfFile(name))) < oldest) await rm(path.join(this.noteDir(id), name), { force: true });
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
    const raw = await readFile(path.join(this.noteDir(id), name)).catch(() => null);
    if (raw === null) return null;
    // O hash do texto é o da string, como na gravação; o dos bytes, o dos bytes.
    const info = { at: Date.parse(atOf(idOfFile(name))), hash: name.endsWith(TEXT_EXT) ? hash(raw.toString("utf8")) : hash(new Uint8Array(raw)) };
    this.last.set(id, info);
    return info;
  }

  private async write(id: string, content: VersionContent, at: number): Promise<void> {
    const dir = this.noteDir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const ext = extOf(content);
    const taken = new Set((await this.files(id)).map(idOfFile));
    let stamp = stampOf(at);
    // Duas no mesmo milissegundo (raro): um sufixo que ordena depois da 1ª (o `~` vem depois do `.`, revisão #2826).
    for (let n = 2; taken.has(stamp); n++) stamp = `${stampOf(at)}~${n}`;
    const name = `${stamp}${ext}`;
    await this.durable(dir, name, content);
    this.last.set(id, { at, hash: hash(content) });
    await this.prune(id);
  }

  /**
   * Até `maxCount` versões e só as dos últimos `maxAgeMs`; as em bytes, até `maxBinaryBytes` somadas (T21239), saindo
   * as mais antigas. A mais nova sempre fica.
   */
  private async prune(id: string): Promise<void> {
    const names = await this.files(id);
    const oldest = this.now() - this.maxAgeMs;
    const keep = new Set(names.slice(-this.maxCount));
    const gone = new Set<string>();
    for (const name of names.slice(0, -1)) {
      if (!keep.has(name) || Date.parse(atOf(idOfFile(name))) < oldest) {
        await rm(path.join(this.noteDir(id), name), { force: true });
        gone.add(name);
      }
    }
    const bins = names.filter((n) => n.endsWith(BIN_EXT) && !gone.has(n));
    if (!bins.length) return;
    const sizes = new Map<string, number>();
    for (const n of bins) sizes.set(n, (await stat(path.join(this.noteDir(id), n)).catch(() => null))?.size ?? 0);
    let total = [...sizes.values()].reduce((a, b) => a + b, 0);
    const newest = names.at(-1);
    for (const n of bins) {
      if (total <= this.maxBinaryBytes) break;
      if (n === newest) break;
      await rm(path.join(this.noteDir(id), n), { force: true });
      total -= sizes.get(n)!;
    }
  }
}
