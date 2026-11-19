// A janela Notas diante de uma escrita do Kiwi (T20869, spec #20843): anima ou recarrega como antes.
//
// O `agent.wrote` (T20868) chega logo antes do `notes.changed` da mesma escrita e fica guardado pela versão nova. Quando a
// recarga traz a nota nessa versão, e a janela tem aberta a versão de antes sem nada por gravar, a escrita se mostra no
// editor. Em qualquer dúvida (o frontmatter mudou, os trechos não fecham com o disco, a pessoa tem edição pendente), a
// janela recarrega como sempre: a tela nunca mostra outro texto que não o do disco.

import { applyLiveEdits } from "../../src/shared/live-edits.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { applyKiwiEdits, bodyEdits, type KiwiEdit, type KiwiWriteEnd } from "./editor/kiwi-writing.ts";
import type { AgentWrote } from "./types.ts";

/** Quantas escritas esperam a recarga, no máximo (uma que nunca recarregou não fica para sempre). */
const KEEP = 32;

/** As escritas do Kiwi que ainda esperam a recarga da nota, pela versão nova. */
export class KiwiWrites {
  private byKey = new Map<string, AgentWrote>();
  add(e: AgentWrote): void {
    // A nota anima pelos trechos; a planilha, pelas operações (T21114).
    if (!(e.edits || e.sheetOps?.length) || !e.version) return;
    const key = `${e.path}@${e.version}`;
    this.byKey.delete(key);
    this.byKey.set(key, e);
    while (this.byKey.size > KEEP) this.byKey.delete(this.byKey.keys().next().value!);
  }
  /** A escrita que levou `path` à `version`, uma vez só. */
  take(path: string, version: string): AgentWrote | null {
    const key = `${path}@${version}`;
    const e = this.byKey.get(key) ?? null;
    this.byKey.delete(key);
    return e;
  }
}

export interface KiwiPlan {
  /** O texto do editor agora (o corpo da versão de antes). */
  before: string;
  /** Os trechos no texto do editor. */
  edits: KiwiEdit[];
  /** O corpo do disco, o que fica na tela no fim. */
  final: string;
}

/**
 * O plano da animação, ou `null` para recarregar como antes. `open` é a nota que a janela tem (o texto inteiro e a versão),
 * `next` a que o disco tem agora.
 */
export function kiwiPlan(open: { content: string; version: string }, next: { content: string; version: string }, e: AgentWrote | null): KiwiPlan | null {
  if (!e?.edits || e.version !== next.version) return null;
  if (e.baseVersion !== undefined && e.baseVersion !== open.version) return null;
  // Os trechos levam o arquivo aberto exatamente ao do disco (o `applyLiveEdits` do contrato confere o `removed`).
  if (applyLiveEdits(open.content, e.edits) !== next.content) return null;
  const was = splitFrontmatter(open.content);
  const now = splitFrontmatter(next.content);
  if (was.frontmatter !== now.frontmatter) return null;
  const edits = bodyEdits(open.content, e.edits, was.frontmatter.length);
  if (!edits || applyKiwiEdits(was.body, edits) !== now.body) return null;
  return { before: was.body, edits, final: now.body };
}

/**
 * As escritas do Kiwi na nota aberta, uma depois da outra (#21094). Um pedido costuma escrever duas vezes seguidas
 * (`notes_edit` e depois `notes_append`), e a 2ª chega com a 1ª ainda na tela: ela espera a 1ª acabar. Quando a pessoa
 * pula uma, as que faltam entram de uma vez (`fast`), com o realce. `clear` larga a fila (outra nota, uma recarga).
 */
export class KiwiQueue {
  private tail: Promise<void> | null = null;
  private live = 0;
  private gen = 0;
  private fast = false;

  constructor(private readonly onIdle: () => void) {}

  /** Alguma escrita na tela ou esperando. */
  get busy(): boolean {
    return this.live > 0;
  }

  /**
   * Toca `play` agora, ou depois das que já estão na fila. `play(fast)` devolve o fim da escrita, ou `null` se ela não
   * pôde começar. Com a fila vazia, ele roda já, e o `false` do retorno é esse `null` (quem chamou recarrega como antes).
   * Na fila, um `null` chama `fail` (o texto do editor não é o esperado), e a fila segue.
   */
  add(play: (fast: boolean) => Promise<KiwiWriteEnd> | null, fail: () => void): boolean {
    const gen = this.gen;
    const after = (run: Promise<KiwiWriteEnd>) =>
      run.then((how) => {
        if (gen === this.gen && how === "skipped") this.fast = true;
      });
    if (!this.tail) {
      const run = play(false);
      if (!run) return false;
      this.live = 1;
      this.tail = this.settle(gen, after(run));
      return true;
    }
    this.live++;
    this.tail = this.settle(
      gen,
      this.tail.then(() => {
        if (gen !== this.gen) return;
        const run = play(this.fast);
        if (!run) return fail();
        return after(run);
      }),
    );
    return true;
  }

  /** Larga a fila: o que está esperando não toca mais. */
  clear(): void {
    if (!this.tail) return;
    this.gen++;
    this.tail = null;
    this.live = 0;
    this.fast = false;
    this.onIdle();
  }

  private settle(gen: number, p: Promise<void>): Promise<void> {
    return p.finally(() => {
      if (gen !== this.gen) return;
      if (--this.live > 0) return;
      this.tail = null;
      this.fast = false;
      this.onIdle();
    });
  }
}

/** O editor para a escrita: tocar os trechos (ou `null`, se o texto dele não é `before`) e trocar o texto de vez. */
export interface KiwiEditor {
  play(before: string, edits: KiwiEdit[], final: string, reduced: boolean): Promise<KiwiWriteEnd> | null;
  replace(text: string): void;
}

/**
 * A recarga da nota aberta diante de uma escrita do Kiwi: o plano entra na fila (já, ou depois da que está na tela).
 * `null`: não é uma escrita que se mostra, e a janela recarrega como antes. Com o plano, a nota já é a `next`; o editor
 * chega nela pela animação, ou direto, se o texto dele não for o esperado quando a vez dela chegar.
 */
export function startKiwiWrite(
  queue: KiwiQueue,
  writes: KiwiWrites,
  open: { content: string; version: string },
  next: { path: string; content: string; version: string },
  editor: KiwiEditor,
  reduced: boolean,
): KiwiPlan | null {
  const plan = kiwiPlan(open, next, writes.take(next.path, next.version));
  if (!plan) return null;
  const started = queue.add(
    (fast) => editor.play(plan.before, plan.edits, plan.final, fast || reduced),
    () => editor.replace(plan.final),
  );
  return started ? plan : null;
}

/** O Reduzir movimento do app (Ajustes › Aparência) ou do sistema. */
export function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}
