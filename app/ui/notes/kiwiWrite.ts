// A janela Notas diante de uma escrita do Kiwi (T20869, spec #20843): anima ou recarrega como antes.
//
// O `agent.wrote` (T20868) chega logo antes do `notes.changed` da mesma escrita e fica guardado pela versão nova. Quando a
// recarga traz a nota nessa versão, e a janela tem aberta a versão de antes sem nada por gravar, a escrita se mostra no
// editor. Em qualquer dúvida (o frontmatter mudou, os trechos não fecham com o disco, a pessoa tem edição pendente), a
// janela recarrega como sempre: a tela nunca mostra outro texto que não o do disco.

import { splitFrontmatter } from "./frontmatter.ts";
import { applyKiwiEdits, bodyEdits, type KiwiEdit } from "./editor/kiwi-writing.ts";
import type { AgentWrote } from "./types.ts";

/** Quantas escritas esperam a recarga, no máximo (uma que nunca recarregou não fica para sempre). */
const KEEP = 32;

/** As escritas do Kiwi que ainda esperam a recarga da nota, pela versão nova. */
export class KiwiWrites {
  private byKey = new Map<string, AgentWrote>();
  add(e: AgentWrote): void {
    if (!e.edits || !e.version) return;
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
  const was = splitFrontmatter(open.content);
  const now = splitFrontmatter(next.content);
  if (was.frontmatter !== now.frontmatter) return null;
  const edits = bodyEdits(open.content, e.edits, was.frontmatter.length);
  if (!edits || applyKiwiEdits(was.body, edits) !== now.body) return null;
  return { before: was.body, edits, final: now.body };
}

/** O Reduzir movimento do app (Ajustes › Aparência) ou do sistema. */
export function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}
