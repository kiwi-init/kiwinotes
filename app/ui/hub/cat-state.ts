// O estado do gato a partir dos eventos do agente (`agent.turn`, spec #9510), sem depender do desenho: TypeScript puro,
// testado no `bun test`. Quem desenha é o módulo do gato (`ui/kiwicat/cat.ts`), que recebe só o estado.
//
// - `started` → `acordou`; `status` `opening`/`thinking` → `thinking`; `status` `running` → `agindo`, e o `thinking`
//   que o host manda quando a ferramenta acaba volta a `thinking`; `text` e `permission` não mudam nada.
// - `done` `end_turn` → `pronto` (o módulo volta sozinho ao `repouso`); `done` `cancelled` ou outro motivo →
//   `repouso`; `error` → `erro`, até o próximo pedido (ou o agente ser desligado, que desmonta o gato).
// - **Sempre o pedido atual:** o evento de um pedido que já acabou é ignorado, e o de um pedido que o gato não viu
//   começar também, a não ser que o agente estivesse ocupado quando o gato nasceu: aí ele adota esse pedido.
// - O que já acabou fica guardado só para ignorar os atrasados, até um limite: a memória não cresce.

import type { AgentTurnEvent } from "../../src/shared/ui-contract";

export type CatState = "repouso" | "acordou" | "ouvindo" | "thinking" | "agindo" | "pronto" | "erro";

/** Quantos pedidos terminados o gato lembra, para ignorar um evento atrasado deles. */
export const CAT_FINISHED_MAX = 64;

export class CatActivity {
  state: CatState;
  /**
   * O campo de "falar por texto" está aberto (spec #9878): sem pedido em andamento, o gato fica atento (`ouvindo`, sem
   * ondas); um pedido que começa daqui vai direto ao `thinking`, sem repetir o `acordou`; e um pedido que termina com o
   * campo aberto volta à atenção, sem `pronto`.
   */
  private attentive = false;
  private current: string | null = null;
  /** O gato nasceu com o agente ocupado: o primeiro pedido desconhecido é o que estava rodando. */
  private adoptable: boolean;
  private readonly finished = new Set<string>();

  constructor(busy: boolean) {
    this.state = busy ? "thinking" : "repouso";
    this.adoptable = busy;
  }

  private finish(id: string): void {
    this.finished.add(id);
    // O Set guarda a ordem de entrada: o mais velho sai primeiro.
    if (this.finished.size > CAT_FINISHED_MAX) this.finished.delete(this.finished.values().next().value!);
  }

  /**
   * Abre ou fecha o campo de texto. Com um pedido em andamento, nada muda no gato (ele segue mostrando o pedido); sem
   * pedido, abrir deixa o gato atento e fechar volta ao `repouso`.
   */
  attend(on: boolean): CatState {
    this.attentive = on;
    this.sending = false;
    if (this.current !== null || this.adoptable) return this.state;
    this.state = on ? "ouvindo" : "repouso";
    return this.state;
  }

  /**
   * O pedido saiu do campo: o campo fecha, mas o gato continua atento até o `started` chegar, para não repetir a
   * entrada. Se o pedido nem começa (o envio falhou), `attend(false)` volta ao repouso.
   */
  sent(): CatState {
    this.attentive = false;
    this.sending = true;
    return this.state;
  }
  private sending = false;

  /** O pedido em andamento, que o campo usa para não mandar outro por cima. */
  get busy(): boolean {
    return this.current !== null || this.adoptable;
  }

  event(e: AgentTurnEvent): CatState {
    if (this.finished.has(e.id)) return this.state;
    if (e.type === "started") {
      if (this.current && this.current !== e.id) this.finish(this.current);
      this.current = e.id;
      this.adoptable = false;
      // Atento, o gato já tinha entrado: o pedido segue direto para o que o agente faz.
      this.state = this.attentive || this.sending ? "thinking" : "acordou";
      this.sending = false;
      return this.state;
    }
    if (this.current !== e.id) {
      // Um pedido que o gato não viu começar: só o que já rodava quando ele nasceu.
      if (this.current !== null || !this.adoptable) return this.state;
      this.current = e.id;
      this.adoptable = false;
    }
    if (e.type === "status") this.state = e.status === "running" ? "agindo" : "thinking";
    else if (e.type === "done" || e.type === "error") {
      // Com o campo aberto, o fim do pedido volta à atenção do `ouvindo`, sem nova entrada; o erro continua aparecendo.
      this.state = e.type === "error" ? "erro" : this.attentive ? "ouvindo" : e.stopReason === "end_turn" ? "pronto" : "repouso";
      this.finish(e.id);
      this.current = null;
    }
    return this.state;
  }
}
