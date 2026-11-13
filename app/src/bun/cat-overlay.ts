// O gato no overlay (spec #9810): quando um pedido ao agente começa e a pessoa não está vendo o gato do canto (o hub
// não está na frente, ou está escondido ou minimizado), o gato aparece no centro da tela, por cima de qualquer app,
// numa janela do helper. Este módulo decide quando: TypeScript puro, com o relógio de fora, testado no `bun test`.
//
// - **Nunca dois gatos:** quem decide é o app. Com o hub à vista, vale o gato do canto; com o overlay na tela, o hub
//   esconde o dele (`where(true)`).
// - **Os tempos do roteiro** (`docs/brand/kiwi-cat/estados/roteiro.md`, "Passagens, interrupções e overlay"): entra com o
//   `acordou` em 180 ms; o `pronto` dura 1100 ms e o gato sai em 160 ms; o `erro` fica ao menos 2200 ms e sai em
//   180 ms; o cancelamento sai em 120 ms, sem `pronto`; um pedido novo durante a saída volta do ponto em que estava.
// - **A troca entre o canto e o overlay** no meio de um pedido não repete a entrada: o gato aparece (ou some) já no
//   estado em que está, sem fade.
// - **Sem pedido, nada na tela:** o `repouso` e o `dormindo` não aparecem no overlay.
// - **A pílula do ditado tem a vez:** quem sabe se ela está na tela é o helper, que segura o gato até ela sair.

import { CatActivity, type CatState } from "../../ui/hub/cat-state.ts";
import type { AgentTurnEvent } from "../shared/ui-contract.ts";

/** Os tempos do roteiro, em ms. */
export const OVERLAY_TIMES = {
  enter: 180,
  pronto: 1100,
  prontoExit: 160,
  erro: 2200,
  erroExit: 180,
  cancelExit: 120,
} as const;

/** O que o app manda ao helper (os comandos `catOverlay.*` do IPC). */
export type CatOverlayCommand =
  | { type: "catOverlay.load" }
  | { type: "catOverlay.show"; estado: CatState; fadeMs: number }
  | { type: "catOverlay.state"; estado: CatState }
  | { type: "catOverlay.hide"; fadeMs: number }
  | { type: "catOverlay.unload" };

export interface CatOverlayHost {
  /** Manda um comando ao helper. */
  send(command: CatOverlayCommand): void;
  /** Avisa as janelas se o gato está no overlay (o hub esconde o do canto). */
  where(overlay: boolean): void;
}

export interface CatOverlayClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: CatOverlayClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type Phase =
  /** Sem pedido, ou o overlay desligado: nada na tela. */
  | "idle"
  /** Um pedido em andamento, com o gato no overlay. */
  | "shown"
  /** O pedido acabou; o gato fica o tempo do estado final e depois sai. */
  | "lingering"
  /** Um pedido em andamento, mas com o hub à vista: o gato é o do canto. */
  | "corner";

export class CatOverlay {
  private activity = new CatActivity(false);
  private phase: Phase = "idle";
  private enabled = false;
  private hubInView = false;
  private timer: unknown = null;
  /** O helper carregou a página (o overlay e o agente ligados). */
  private loaded = false;
  private overlayShown = false;

  constructor(
    private readonly host: CatOverlayHost,
    private readonly clock: CatOverlayClock = realClock,
  ) {}

  /** O estado do gato agora (para os testes e para o diagnóstico). */
  get state(): CatState {
    return this.activity.state;
  }

  get visible(): boolean {
    return this.overlayShown;
  }

  /**
   * O agente ligado e o interruptor "Mostrar o Kiwi-cat por cima dos outros apps". Ligado, o helper carrega a página
   * (pronta e pausada, para a entrada ser rápida); desligado, solta a página e o desenho.
   */
  configure(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.loaded = true;
      this.host.send({ type: "catOverlay.load" });
      return;
    }
    this.hideNow(0);
    this.phase = "idle";
    if (this.loaded) {
      this.loaded = false;
      this.host.send({ type: "catOverlay.unload" });
    }
  }

  /** O hub (o gato do canto) está à vista: na frente, aberto e não minimizado. */
  setHubInView(inView: boolean): void {
    if (inView === this.hubInView) return;
    this.hubInView = inView;
    if (!this.enabled) return;
    if (inView) {
      // A pessoa voltou ao Kiwi: o gato do canto assume, no mesmo estado, sem fade nem a saída do roteiro.
      if (this.phase === "shown") {
        this.hideNow(0);
        this.phase = "corner";
      } else if (this.phase === "lingering") {
        this.hideNow(0);
        this.phase = "idle";
      }
      return;
    }
    // A pessoa saiu do Kiwi no meio de um pedido: o gato aparece no overlay já no estado em que está.
    if (this.phase === "corner") this.show(this.activity.state, 0);
  }

  /** Um evento do agente (`agent.turn`). */
  turn(e: AgentTurnEvent): void {
    const before = this.activity.state;
    const state = this.activity.event(e);
    if (!this.enabled) {
      this.phase = "idle";
      return;
    }
    if (e.type === "started" && state === "acordou") {
      this.cancelTimer();
      if (this.hubInView) {
        this.phase = "corner";
        return;
      }
      // Durante a saída de um pedido anterior, volta do ponto em que estava (o helper anima a partir da opacidade de
      // agora): sem piscar.
      this.show("acordou", OVERLAY_TIMES.enter);
      return;
    }
    if (state === before) return;
    if (this.phase === "corner") {
      if (e.type === "done" || e.type === "error") this.phase = "idle";
      return;
    }
    if (this.phase !== "shown") return;
    if (e.type === "done" && state === "repouso") {
      // Cancelado (ou outro motivo que não `end_turn`): sai já, sem `pronto`.
      this.phase = "idle";
      this.hideNow(OVERLAY_TIMES.cancelExit);
      return;
    }
    this.host.send({ type: "catOverlay.state", estado: state });
    if (state === "pronto") this.linger(OVERLAY_TIMES.pronto, OVERLAY_TIMES.prontoExit);
    else if (state === "erro") this.linger(OVERLAY_TIMES.erro, OVERLAY_TIMES.erroExit);
  }

  /** Solta tudo (o app saindo). */
  dispose(): void {
    this.cancelTimer();
    this.configure(false);
  }

  private show(estado: CatState, fadeMs: number): void {
    this.phase = "shown";
    this.overlayShown = true;
    this.host.where(true);
    this.host.send({ type: "catOverlay.show", estado, fadeMs });
  }

  private linger(stay: number, exit: number): void {
    this.phase = "lingering";
    this.cancelTimer();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (this.phase !== "lingering") return;
      this.phase = "idle";
      this.hideNow(exit);
    }, stay);
  }

  private hideNow(fadeMs: number): void {
    this.cancelTimer();
    if (!this.overlayShown) return;
    this.overlayShown = false;
    this.host.send({ type: "catOverlay.hide", fadeMs });
    this.host.where(false);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
