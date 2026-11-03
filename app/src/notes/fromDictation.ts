// O ditado vira nota (T1320, spec #1107, item 6): "Enviar para nota…" no Histórico e o modo "nota rápida" do atalho.
//
// Um trecho ditado entra na nota em Markdown puro, que abre igual no Obsidian (sem HTML, que o sanitizador da janela
// Notas recusa):
//
//   Ficou decidido começar pela tomografia.
//   *🎙 ditado às 14:30* %%dictation:2026-11-03T17:30:12.345Z-ab12%%
//
// A legenda é a marca "🎙 ditado às HH:MM" do B v4 (docs/mockups/notas), numa linha em itálico logo abaixo do texto.
// O comentário do Obsidian (`%%…%%`, que ele esconde) leva o id do ditado: é por ele que um trecho mandado de novo é
// reconhecido, e não pelo texto e a hora, porque dois ditados iguais no mesmo minuto são dois trechos (T1565).
// Uma nota nova vai para `Caixa de entrada/`, com o título tirado da 1ª frase e o frontmatter `date` e
// `source: dictation`.

import type { Note, NoteMeta, SaveResult } from "./vault.ts";

/** A pasta das notas que nascem de um ditado. */
export const INBOX = "Caixa de entrada";

/** O título quando a 1ª frase não serve (só pontuação, ou nada). */
export const FALLBACK_TITLE = "Ditado";

/** O maior título que sai de uma frase, cortado numa palavra. */
export const MAX_TITLE = 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** HH:MM no fuso de quem ditou. */
export const clock = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

/** A legenda do trecho ditado: `*🎙 ditado às 14:30*`. */
export const dictationMark = (at: Date) => `*🎙 ditado às ${clock(at)}*`;

/** O padrão da legenda, com ou sem o id (a janela Notas pinta de verde e esconde o comentário). */
export const DICTATION_MARK = /^\*🎙 ditado às \d\d:\d\d\*(?: %%dictation:[^%\n]+%%)?$/m;

/** O id do ditado como ele vai no comentário: só o que cabe num id do Histórico, nada que feche o `%%`. */
export function dictationRef(id: string): string {
  const clean = id.replace(/[^\w:.-]/g, "");
  if (!clean) throw new Error("dictation id is empty");
  return `%%dictation:${clean}%%`;
}

/** O trecho ditado com a legenda embaixo e, nela, o id do ditado. */
export function dictationBlock(text: string, at: Date, id: string): string {
  return `${text.trim()}\n${dictationMark(at)} ${dictationRef(id)}`;
}

/** O título da nota: a 1ª frase do ditado, sem a pontuação do fim e cortada numa palavra. */
export function titleFromDictation(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = /^(.+?)[.!?…]+(?:\s|$)/u.exec(flat)?.[1] ?? flat;
  // Os caracteres que um nome de arquivo do Obsidian não leva viram espaço (o `fileNameFor` faria o mesmo).
  let title = first.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (title.length > MAX_TITLE) {
    const cut = title.slice(0, MAX_TITLE + 1);
    const space = cut.lastIndexOf(" ");
    title = (space > MAX_TITLE / 2 ? cut.slice(0, space) : title.slice(0, MAX_TITLE)).trim();
  }
  title = title.replace(/^[.\s]+/, "").replace(/[\s,;:–—-]+$/u, "");
  return /[\p{L}\p{N}]/u.test(title) ? title : FALLBACK_TITLE;
}

/** O .md de uma nota nova que nasce de um ditado. */
export function dictationNote(text: string, at: Date, id: string): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${clock(at)}`;
  return `---\ndate: ${date}\nsource: dictation\n---\n\n${dictationBlock(text, at, id)}\n`;
}

/** A nota com o trecho no fim, separado por uma linha em branco. */
export function appendBlock(content: string, block: string): string {
  const body = content.replace(/\s+$/, "");
  return body ? `${body}\n\n${block}\n` : `${block}\n`;
}

/** O que o vault precisa ter para isto (o `Vault` do T1316; os testes usam o de verdade numa pasta temporária). */
export interface DictationVault {
  open(): Promise<void>;
  create(folder: unknown, title: unknown, content?: unknown): Promise<Note>;
  get(path: unknown): Promise<Note>;
  save(path: unknown, content: unknown, baseVersion: unknown): Promise<SaveResult>;
  /** As notas que, pelo índice, têm `text`. O índice pode estar atrasado: cada uma é relida do disco. */
  notesContaining(text: string): NoteMeta[];
}

export interface ToNoteResult {
  note: NoteMeta;
  /** Uma nota nova foi criada. */
  created: boolean;
  /** O trecho já estava lá (mandado antes): nada foi escrito. */
  already: boolean;
}

/** Quantas vezes o acréscimo tenta de novo quando a nota muda no meio (outra janela, o Obsidian). */
const SAVE_TRIES = 5;

const metaOf = ({ content: _content, ...meta }: Note): NoteMeta => meta;

/**
 * Escreve os ditados nas notas, um por vez: dois cliques em "Enviar" (ou o atalho e o Histórico juntos) nunca fazem
 * duas notas com o mesmo ditado. O ditado é reconhecido pelo id dele (`%%dictation:<id>%%`), e a nota candidata é
 * relida do disco antes de decidir: o índice pode estar atrasado com uma edição do Obsidian que o watcher ainda não viu.
 */
export class DictationNotes {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly vault: DictationVault) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** A nota que tem mesmo o ditado `id`, relida do disco; uma que o índice indica mas já não tem (apagada, editada) não conta. */
  private async noteWith(id: string): Promise<NoteMeta | null> {
    const ref = dictationRef(id);
    for (const candidate of this.vault.notesContaining(ref)) {
      try {
        const note = await this.vault.get(candidate.path);
        if (note.content.includes(ref)) return metaOf(note);
      } catch {
        // Sumiu do disco: não é ela.
      }
    }
    return null;
  }

  /**
   * Uma nota nova em `Caixa de entrada/`. Se uma nota já tem este ditado (mandado de novo), devolve ela em vez de
   * criar outra. `fresh`: o id acabou de nascer (a nota rápida), então não há o que procurar.
   */
  toNew(text: string, at: Date, id: string, { fresh = false }: { fresh?: boolean } = {}): Promise<ToNoteResult> {
    return this.serialize(async () => {
      await this.vault.open();
      const found = fresh ? null : await this.noteWith(id);
      if (found) return { note: found, created: false, already: true };
      const note = await this.vault.create(INBOX, titleFromDictation(text), dictationNote(text, at, id));
      return { note: metaOf(note), created: true, already: false };
    });
  }

  /** O trecho no fim de uma nota que existe. Se ela já tem este ditado, não escreve de novo. */
  append(path: string, text: string, at: Date, id: string): Promise<ToNoteResult> {
    return this.serialize(async () => {
      await this.vault.open();
      const block = dictationBlock(text, at, id);
      const ref = dictationRef(id);
      let note = await this.vault.get(path);
      for (let i = 0; i < SAVE_TRIES; i++) {
        if (note.content.includes(ref)) return { note: metaOf(note), created: false, already: true };
        const r = await this.vault.save(note.path, appendBlock(note.content, block), note.version);
        if (r.saved) return { note: r.meta, created: false, already: false };
        // A nota mudou fora desde a leitura: acrescenta na versão de agora, sem apagar o que entrou.
        note = r.current;
      }
      throw new Error(`notes: ${path} kept changing, the dictation wasn't added`);
    });
  }
}
