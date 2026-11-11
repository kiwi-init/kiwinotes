// O texto aberto nas Notas (T7105): o que a pessoa digitou, a versão do arquivo no disco e o grava-sozinho. Lógica
// pura, sem React: o `TextViewer` só mostra o estado. Como o quadro branco, grava um pouco depois da última tecla,
// nunca por cima de uma mudança de fora (conflito) e nunca em paralelo.

import type { FileSaveResult } from "../types.ts";

export type Eol = "\n" | "\r\n" | "\r";

/**
 * O fim de linha do arquivo (revisão do T7105): `\r\n` (Windows), `\r` (Mac antigo) ou `\n`. O `<textarea>` troca
 * todos por `\n` no `value`, então sem guardar o do arquivo, digitar uma letra reescrevia todas as linhas. `null` com
 * mais de um tipo misturado: aí não há como devolver o arquivo como era, e ele abre só para leitura.
 */
export function detectEol(text: string): Eol | null {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const cr = (text.match(/\r/g) ?? []).length - crlf;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const kinds = [crlf, cr, lf].filter((n) => n > 0).length;
  if (kinds > 1) return null;
  return crlf ? "\r\n" : cr ? "\r" : "\n";
}

/** O texto como o `<textarea>` o guarda: todas as quebras em `\n`. */
export const toEditor = (text: string): string => text.replace(/\r\n?/g, "\n");

/** O texto do editor com o fim de linha do arquivo de volta. */
export const toDisk = (text: string, eol: Eol): string => (eol === "\n" ? toEditor(text) : toEditor(text).replace(/\n/g, eol));

export type TextSaveState = "idle" | "pending" | "saving" | "saved" | "conflict" | "error";

export interface TextSessionOptions {
  /** O texto como está no disco, com o fim de linha dele. */
  text: string;
  version: string;
  save(content: string, baseVersion: string): Promise<FileSaveResult>;
  onState(state: TextSaveState): void;
  /** O texto mudou por fora da digitação (o de fora foi adotado): a tela troca o que mostra. */
  onText(text: string): void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export const TEXT_SAVE_MS = 600;

export class TextSession {
  /** O texto da tela, com as quebras em `\n` (como o `<textarea>`). O que vai ao disco é o `toDisk` dele. */
  text: string;
  version: string;
  /** O fim de linha do arquivo, reaplicado em cada save. Com fins misturados (`detectEol` nulo), fica `\n`. */
  eol: Eol;
  state: TextSaveState = "idle";
  /** O arquivo como está no disco, quando ele mudou fora com algo ainda não gravado aqui. */
  conflict: { text: string; version: string } | null = null;
  private dirty = false;
  private saving: Promise<boolean> | null = null;
  private timer: unknown;
  private readonly delay: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(private readonly o: TextSessionOptions) {
    this.text = toEditor(o.text);
    this.eol = detectEol(o.text) ?? "\n";
    this.version = o.version;
    this.delay = o.delayMs ?? TEXT_SAVE_MS;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** A pessoa digitou. */
  edit(typed: string): void {
    const text = toEditor(typed);
    if (text === this.text) return;
    this.text = text;
    this.dirty = true;
    if (this.conflict) return;
    this.set("pending");
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => void this.save(), this.delay);
  }

  /** Grava o que falta. `true` quando nada ficou por gravar. */
  async save(): Promise<boolean> {
    while (this.saving) await this.saving;
    if (!this.dirty || this.conflict) return !this.dirty;
    this.dirty = false;
    const sent = toDisk(this.text, this.eol);
    this.set("saving");
    const run = (async () => {
      try {
        const r = await this.o.save(sent, this.version);
        if (r.saved) {
          this.version = r.version;
          this.set(this.dirty ? "pending" : "saved");
          return !this.dirty;
        }
        this.dirty = true;
        this.conflict = "text" in r.current ? { text: r.current.text, version: r.current.version } : null;
        this.set(this.conflict ? "conflict" : "error");
        return false;
      } catch {
        this.dirty = true;
        this.set("error");
        return false;
      }
    })();
    this.saving = run;
    try {
      return await run;
    } finally {
      this.saving = null;
    }
  }

  /** Antes de sair do arquivo: grava já. `false` segura a pessoa aqui (conflito ou erro). */
  async flush(): Promise<boolean> {
    this.clearTimer(this.timer);
    if (this.conflict) return false;
    if (!this.dirty) return this.saving ? this.saving : true;
    // O que foi digitado durante um save em curso também vai.
    for (let i = 0; i < 3; i++) {
      if (await this.save()) return true;
      if (this.conflict || this.state === "error") return false;
    }
    return !this.dirty;
  }

  /**
   * O arquivo mudou no disco. Sem nada por gravar, o de fora entra; com algo por gravar, fica o da pessoa e o próximo
   * save acha o conflito. O eco do próprio save (a mesma versão) não faz nada.
   */
  external(file: { text: string; version: string }): void {
    if (file.version === this.version || this.dirty || this.saving || this.conflict) return;
    this.adopt(file);
    this.set("idle");
  }

  /** No conflito: fica o do disco, e o que foi digitado aqui se perde. */
  useTheirs(): void {
    const c = this.conflict;
    if (!c) return;
    this.conflict = null;
    this.dirty = false;
    this.adopt(c);
    this.set("saved");
  }

  /** No conflito: grava o daqui por cima do de fora. */
  keepMine(): Promise<boolean> {
    const c = this.conflict;
    if (!c) return Promise.resolve(!this.dirty);
    this.version = c.version;
    this.conflict = null;
    this.dirty = true;
    return this.save();
  }

  /** O texto do disco entra na tela, com o fim de linha dele guardado. */
  private adopt(file: { text: string; version: string }): void {
    this.text = toEditor(file.text);
    this.eol = detectEol(file.text) ?? "\n";
    this.version = file.version;
    this.o.onText(this.text);
  }

  dispose(): void {
    this.clearTimer(this.timer);
  }

  private set(state: TextSaveState): void {
    this.state = state;
    this.o.onState(state);
  }
}
