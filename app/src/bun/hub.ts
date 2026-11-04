// O hub (T2121, spec #2100): a janela principal e o que acontece em volta dela.
// - Abrir do zero (a 1ª abertura deste processo) toca a intro (#2078, quando houver) e abre o hub.
// - Abrir de novo com o app rodando (Finder, Dock, Spotlight, o menu da barra) abre o hub sem a intro.
// - Com o hub aberto o app fica no Dock e no ⌘Tab (#2107); fechar o hub tira ele de lá, e o app segue na barra.
// Sem Electrobun aqui: o index.ts liga as peças, e os testes usam peças falsas.

import type { HubSection } from "../shared/ui-contract.ts";

export interface HubDeps {
  /** Abre a janela do hub, ou traz para a frente a que já existe. Nunca rejeita (o `showWindow`). */
  show(): Promise<void>;
  isOpen(): boolean;
  /** Manda o hub aberto para uma seção (o evento `hub.navigate`). */
  navigate(section: HubSection): void;
  setDock(visible: boolean): void;
  /** A intro da abertura do zero (#2078). Sem ela, o hub abre direto. */
  intro?(): Promise<void>;
}

export class Hub {
  private cold = true;
  private pending: HubSection | null = null;
  private dock = false;

  constructor(private readonly deps: HubDeps) {}

  /**
   * Abre o hub, numa seção se ela vier. A 1ª vez no processo é a abertura do zero, com a intro; as outras, não. Uma
   * abertura em andamento não toca a intro de novo: `cold` cai antes de esperar.
   */
  async open(section?: HubSection): Promise<void> {
    if (this.deps.isOpen()) {
      if (section) this.deps.navigate(section);
      this.setDock(true);
      return this.deps.show();
    }
    if (section) this.pending = section;
    const cold = this.cold;
    this.cold = false;
    this.setDock(true);
    if (cold && this.deps.intro) {
      try {
        await this.deps.intro();
      } catch {
        // A intro é enfeite: se falhar, o hub abre igual.
      }
    }
    await this.deps.show();
    if (!this.deps.isOpen()) this.closed();
  }

  /** O que o hub que abriu pede (`hub.section`): a seção pedida, uma vez só. */
  takeSection(): HubSection | null {
    const s = this.pending;
    this.pending = null;
    return s;
  }

  /** A janela do hub fechou (o botão vermelho ou ⌘W): sai do Dock, e o app continua na barra. */
  closed(): void {
    this.pending = null;
    this.setDock(false);
  }

  private setDock(visible: boolean): void {
    if (this.dock === visible) return;
    this.dock = visible;
    this.deps.setDock(visible);
  }
}
