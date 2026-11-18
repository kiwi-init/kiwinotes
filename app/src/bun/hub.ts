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
  /** Manda o hub aberto para uma seção (o evento `hub.navigate`); `path`, o arquivo que as Notas abrem (spec #17683). */
  navigate(section: HubSection, path?: string): void;
  setDock(visible: boolean): void;
  /**
   * A intro da abertura do zero (#2078). Sem ela, o hub abre direto. Devolve `true` quando o fim dela já mostrou o hub
   * (T16769): aí ele não abre de novo, que tocaria a entrada outra vez.
   */
  intro?(): Promise<boolean | void>;
}

export class Hub {
  private cold = true;
  private pending: HubSection | null = null;
  /** O arquivo pedido junto da seção (o clique no balão do gato, spec #17683), para as Notas abrirem. */
  private pendingPath: string | null = null;
  private dock = false;
  /** A abertura em andamento (a intro e o show). Uma 2ª abertura nesse meio espera esta, em vez de mostrar o hub antes
   * do fim da intro (round 1 do T2121, T2308). */
  private opening: Promise<void> | null = null;

  constructor(private readonly deps: HubDeps) {}

  /**
   * Abre o hub, numa seção se ela vier. A 1ª vez no processo é a abertura do zero, com a intro; as outras, não. Com uma
   * abertura em andamento (a intro tocando), uma 2ª espera a mesma: o hub só aparece no fim da intro, na seção pedida
   * por último.
   */
  async open(section?: HubSection, path?: string): Promise<void> {
    if (section) {
      this.pending = section;
      this.pendingPath = path ?? null;
    }
    if (this.opening) return this.opening;
    if (this.deps.isOpen()) {
      if (section) {
        this.pending = null;
        this.pendingPath = null;
        if (path) this.deps.navigate(section, path);
        else this.deps.navigate(section);
      }
      this.setDock(true);
      return this.deps.show();
    }
    this.opening = this.openFresh().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async openFresh(): Promise<void> {
    const cold = this.cold;
    this.cold = false;
    this.setDock(true);
    let revealed = false;
    if (cold && this.deps.intro) {
      try {
        revealed = (await this.deps.intro()) === true;
      } catch {
        // A intro é enfeite: se falhar, o hub abre igual.
      }
    }
    if (revealed) {
      // O hub abriu escondido antes de a intro tocar: a seção pedida no meio dela vai agora.
      const path = this.pendingPath;
      const section = this.takeSection();
      if (section && path) this.deps.navigate(section, path);
      else if (section) this.deps.navigate(section);
    } else await this.deps.show();
    if (!this.deps.isOpen()) this.closed();
  }

  /** O que o hub que abriu pede (`hub.section`): a seção pedida, uma vez só. */
  takeSection(): HubSection | null {
    const s = this.pending;
    this.pending = null;
    this.pendingPath = null;
    return s;
  }

  /** A seção pedida e o arquivo junto dela (`hub.section`), uma vez só. */
  takeRequest(): { section: HubSection; path?: string } | null {
    const path = this.pendingPath;
    const section = this.takeSection();
    if (!section) return null;
    return path ? { section, path } : { section };
  }

  /** A janela do hub fechou (o botão vermelho ou ⌘W): sai do Dock, e o app continua na barra. */
  closed(): void {
    this.pending = null;
    this.pendingPath = null;
    this.setDock(false);
  }

  private setDock(visible: boolean): void {
    if (this.dock === visible) return;
    this.dock = visible;
    this.deps.setDock(visible);
  }
}
