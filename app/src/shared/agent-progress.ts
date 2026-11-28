// A linha de andamento do balão do Kiwi (spec #32534, Cena 2, T33177): o passo atual do pedido em poucas palavras
// ("Pensando", "Procurando nas suas notas", "Lendo 3 notas", "Pesquisando na web", "Escrevendo a resposta"), trocado a
// cada ferramenta. O mesmo no Hub (o `BubbleFeed`) e fora dele (o `CatOverlay` do main).
//
// Nunca o nome nem o texto de uma nota: o `target` dos eventos só conta quantas notas diferentes foram lidas, e nunca
// sai daqui. TypeScript puro, sem relógio.

import type { AgentTurnEvent } from "./ui-contract";
import { type Locale, translate } from "./i18n";

export type ProgressStep = "thinking" | "search" | "read" | "meetings" | "web" | "write" | "answer";

/** O passo de cada ferramenta do Kiwi (o nome sem o `mcp__kiwi__`) e da web. A que não está aqui não troca o passo. */
const TOOL_STEPS: Record<string, ProgressStep> = {
  notes_search: "search",
  notes_list: "search",
  projects_list: "search",
  project_status: "search",
  notes_read: "read",
  notes_outline: "read",
  meetings_list: "meetings",
  meetings_get: "meetings",
  notes_create: "write",
  notes_append: "write",
  notes_write: "write",
  notes_edit: "write",
  notes_section_move: "write",
  notes_section_rename: "write",
  notes_section_merge: "write",
  project_diary_add: "write",
  cat_speak: "answer",
  web: "web",
};

export class AgentProgress {
  private step: ProgressStep | null = null;
  /** As notas lidas no pedido, só para contar: o caminho nunca vai à tela. */
  private readonly reads = new Set<string>();

  /** Lê um evento do pedido; devolve se o passo (ou a conta de notas) mudou. */
  event(e: AgentTurnEvent): boolean {
    const before = this.key();
    if (e.type === "started") {
      this.step = null;
      this.reads.clear();
    } else if (e.type === "status" && (e.status === "opening" || e.status === "thinking")) {
      // O "pensando" de quando uma ferramenta acaba não apaga o passo dela: só o primeiro vira "Pensando".
      this.step ??= "thinking";
    } else if (e.type === "status" && e.status === "running") {
      const step = TOOL_STEPS[e.tool];
      if (step) this.step = step;
      // A ferramenta do Kiwi sai duas vezes: no começo, sem o `target`, e no fim, com ele. Só o do fim conta a nota.
      if (step === "read" && e.target) this.reads.add(e.target);
    } else if (e.type === "text" && e.text.trim()) {
      this.step = "answer";
    }
    return this.key() !== before;
  }

  /** O pedido começou (a fala chegou antes do `started`, ou o pedido já está no ar): "Pensando" até o próximo passo. */
  begin(): void {
    this.step ??= "thinking";
  }

  /** O texto do passo, na língua pedida; null antes do primeiro. */
  text(locale: Locale): string | null {
    if (!this.step) return null;
    if (this.step === "read") return translate(locale, "hub.step.read", { n: Math.max(1, this.reads.size) });
    return translate(locale, `hub.step.${this.step}`);
  }

  private key(): string {
    return `${this.step}:${this.step === "read" ? this.reads.size : 0}`;
  }
}
