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
// - **A fala pelo Control termina com um balão** (spec #12938): a resposta do agente (o que ele disse depois da última
//   ferramenta), em trechos que cabem no balão, cada um pelo tempo de leitura; ou o erro em palavras. O gato só sai
//   depois do último trecho. Os outros pedidos (uma rotina, por exemplo) não mostram texto por cima dos apps.

import { readingMs, splitChunks } from "../../ui/hub/bubble-state.ts";
import { CatActivity, type CatState } from "../../ui/hub/cat-state.ts";
import type { Command } from "../shared/ipc.ts";
import { catColorHex } from "../shared/kiwicat-colors.ts";
import { CAT_SIZE, type CatPosition, DEFAULT_CAT_POSITION } from "../shared/kiwicat-place.ts";
import type { AgentStatus, AgentTurnEvent, AgentVoiceUi, AppSettings } from "../shared/ui-contract.ts";

/** Os tempos do roteiro, em ms. */
export const OVERLAY_TIMES = {
  enter: 180,
  pronto: 1100,
  prontoExit: 160,
  erro: 2200,
  erroExit: 180,
  cancelExit: 120,
} as const;

/** Quanto cabe num trecho do balão do overlay: três linhas de uns 36 caracteres (spec #12938). */
export const OVERLAY_BUBBLE_CHARS = 108;

/**
 * O texto do agente sem a marcação (spec #12938): o balão do overlay mostra texto corrido, sem `#` de título, `**`,
 * crases, `[texto](link)` nem `>` de citação. Um título vira uma frase; os itens de lista ficam com "•".
 */
export function plainBubbleText(markdown: string): string {
  const parts: string[] = [];
  for (const raw of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) continue;
    let line = raw.trim().replace(/^>\s?/, "");
    const heading = /^#{1,6}\s+/.test(line);
    line = line
      .replace(/^#{1,6}\s+/, "")
      // Um título colado no meio da linha ("…: # Prazo"); um "#12" (sem espaço) fica.
      .replace(/(^|\s)#{1,6}\s+(?=\S)/g, "$1")
      .replace(/^[-*+]\s+/, "• ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
    if (!line) continue;
    parts.push(heading && !/[.!?:;…]$/.test(line) ? `${line}.` : line);
  }
  return parts.join(" ");
}

/** O balão do erro: o que a pessoa lê quando a fala não virou resposta. */
export const voiceErrorLine = (message: string) => `Não consegui falar com o agente: ${message.trim() || "erro desconhecido"}`;

/** O que o app manda ao helper (os comandos `catOverlay.*` do IPC). */
export type CatOverlayCommand =
  | { type: "catOverlay.load" }
  | { type: "catOverlay.show"; estado: CatState; fadeMs: number }
  | { type: "catOverlay.state"; estado: CatState }
  | { type: "catOverlay.hide"; fadeMs: number }
  | { type: "catOverlay.unload" }
  | { type: "catOverlay.color"; cor: string }
  | { type: "catOverlay.place"; posicao: CatPosition; escala: number }
  | { type: "catOverlay.bubble"; text: string | null; error?: boolean };

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
  /** A cor da névoa (`#rrggbb`), da escolha em Ajustes › Agente. */
  private cor: string | null = null;
  /** A posição e o tamanho (spec #12949): vão antes do `load`, como a cor. */
  private posicao: CatPosition = DEFAULT_CAT_POSITION;
  private escala: number = CAT_SIZE.default;
  private overlayShown = false;
  /** O balão está no overlay (spec #12938). */
  private bubbleShown = false;
  /**
   * Os pedidos que vieram da fala pelo Control, pelo id do `asked` (um pedido que começou enquanto a pessoa segurava o
   * Control, como uma rotina, não entra). Cada um sai no `done` ou no `error` dele.
   */
  private readonly voiceRequests = new Set<string>();
  /** O pedido em andamento: tudo o que o agente disse, e até onde antes da última ferramenta. */
  private turnId: string | null = null;
  private said = "";
  private closedLen = 0;
  private usedTool = false;

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
   * O agente ligado e o interruptor "Mostrar o Kiwi Cat por cima dos outros apps". Ligado, o helper carrega a página
   * (pronta e pausada, para a entrada ser rápida); desligado, solta a página e o desenho.
   */
  configure(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.load();
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
    this.track(e);
    const voice = this.voiceRequests.has(e.id);
    if (e.type === "done" || e.type === "error") this.voiceRequests.delete(e.id);
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
    if (voice && e.type === "done" && state === "pronto") this.speak([this.answerOf(e.text)], false, OVERLAY_TIMES.pronto, OVERLAY_TIMES.prontoExit);
    else if (voice && e.type === "error") this.speak([voiceErrorLine(e.message)], true, OVERLAY_TIMES.erro, OVERLAY_TIMES.erroExit);
    else if (state === "pronto") this.linger(OVERLAY_TIMES.pronto, OVERLAY_TIMES.prontoExit);
    else if (state === "erro") this.linger(OVERLAY_TIMES.erro, OVERLAY_TIMES.erroExit);
  }

  /** O que o agente disse no pedido, para o balão da resposta (o `done` traz o texto inteiro). */
  private track(e: AgentTurnEvent): void {
    if (e.type === "started") {
      this.turnId = e.id;
      this.said = "";
      this.closedLen = 0;
      this.usedTool = false;
      return;
    }
    if (e.id !== this.turnId) return;
    if (e.type === "text") this.said += e.text;
    else if (e.type === "status" && e.status === "running") {
      this.closedLen = this.said.length;
      this.usedTool = true;
    }
  }

  /** A resposta final: o que veio depois da última ferramenta; sem texto, o que ele fez. */
  private answerOf(full: string): string {
    const said = full && full.startsWith(this.said.slice(0, this.closedLen)) ? full : this.said;
    const answer = plainBubbleText(said.slice(this.closedLen)) || plainBubbleText(said);
    return answer || (this.usedTool ? "Feito." : "Pronto.");
  }

  /**
   * O balão (spec #12938): os trechos, um por vez, cada um pelo tempo de leitura (o primeiro, ao menos `stay`); depois
   * do último, o gato sai em `exit`. Um pedido novo, o hub à vista ou o overlay desligado cortam a fila.
   */
  private speak(texts: string[], error: boolean, stay: number, exit: number): void {
    const chunks = texts.flatMap((t) => splitChunks(t, (s) => [...s].length <= OVERLAY_BUBBLE_CHARS).map((c) => c.text));
    this.phase = "lingering";
    this.cancelTimer();
    const step = (i: number) => {
      this.bubbleShown = true;
      this.host.send({ type: "catOverlay.bubble", text: chunks[i]!, error });
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        if (this.phase !== "lingering") return;
        if (i + 1 < chunks.length) return step(i + 1);
        this.phase = "idle";
        this.hideNow(exit);
      }, Math.max(i === 0 ? stay : 0, readingMs(chunks[i]!)));
    };
    if (chunks.length) step(0);
    else this.linger(stay, exit);
  }

  /**
   * A fala pelo Control (spec #9876): sem pedido em andamento, o gato entra pelo `acordou` e fica no `ouvindo` (as ondas
   * o helper manda direto à página, do próprio mic). O pedido que começa daqui vai ao `thinking` sem repetir a entrada;
   * cancelada ou vazia, o gato sai pela saída de cancelamento, sem `pronto`.
   */
  voice(v: AgentVoiceUi): void {
    if (!this.enabled) return;
    const before = this.activity.state;
    if (v.phase === "listening") {
      if (this.activity.attend(true) === before) return;
      this.cancelTimer();
      if (this.hubInView) {
        this.phase = "corner";
        return;
      }
      this.show("acordou", OVERLAY_TIMES.enter);
      this.host.send({ type: "catOverlay.state", estado: "ouvindo" });
    } else if (v.phase === "asked") {
      // O id do pedido marca a fala: só ele termina com o balão.
      this.voiceRequests.add(v.id);
      // Se o pedido já começou, só sai da atenção: o `sent()` ficaria marcado, e o próximo pedido pularia o `acordou`
      // (e nem apareceria no overlay).
      if (this.turnId === v.id) this.activity.attend(false);
      else this.activity.sent();
    } else if (v.phase === "idle") {
      if (this.activity.attend(false) === before) return;
      if (this.phase === "corner") this.phase = "idle";
      if (this.phase !== "shown") return;
      if (v.error) {
        // O pedido não saiu: o gato diz por quê antes de sair (spec #12938).
        this.host.send({ type: "catOverlay.state", estado: "erro" });
        this.speak([voiceErrorLine(v.error)], true, OVERLAY_TIMES.erro, OVERLAY_TIMES.erroExit);
        return;
      }
      this.phase = "idle";
      this.hideNow(OVERLAY_TIMES.cancelExit);
    }
  }

  /**
   * O helper (re)começou: a página e a janela dele sumiram. Carrega de novo e, com o gato na tela, volta no mesmo
   * estado, sem a entrada.
   */
  helperReady(): void {
    if (!this.loaded) return;
    this.load();
    if (this.overlayShown) this.host.send({ type: "catOverlay.show", estado: this.activity.state, fadeMs: 0 });
  }

  /** Solta tudo (o app saindo). */
  dispose(): void {
    this.cancelTimer();
    this.configure(false);
  }

  /**
   * A cor da névoa (spec #9349). Com a página carregada, ela troca na hora (a passagem de 400 ms do módulo, mesmo com o
   * gato na tela); senão, fica para o próximo `load`.
   */
  setColor(cor: string): void {
    if (cor === this.cor) return;
    this.cor = cor;
    if (this.loaded) this.host.send({ type: "catOverlay.color", cor });
  }

  /**
   * A posição e o tamanho do gato (spec #12949). O tamanho muda a janela e a página: com ela carregada, carrega de novo
   * e, com o gato na tela, ele volta no mesmo estado, já no lugar novo.
   */
  setPlace(posicao: CatPosition, escala: number): void {
    if (posicao === this.posicao && escala === this.escala) return;
    this.posicao = posicao;
    this.escala = escala;
    if (!this.loaded) return;
    this.load();
    if (this.overlayShown) this.host.send({ type: "catOverlay.show", estado: this.activity.state, fadeMs: 0 });
  }

  /** A cor, a posição e o tamanho vão antes do `load`: o helper os passa à página que ele abre. */
  private load(): void {
    this.loaded = true;
    if (this.cor) this.host.send({ type: "catOverlay.color", cor: this.cor });
    this.host.send({ type: "catOverlay.place", posicao: this.posicao, escala: this.escala });
    this.host.send({ type: "catOverlay.load" });
  }

  private show(estado: CatState, fadeMs: number): void {
    if (this.bubbleShown) {
      this.bubbleShown = false;
      this.host.send({ type: "catOverlay.bubble", text: null });
    }
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
    // O helper tira o balão junto com o gato.
    this.bubbleShown = false;
    this.host.send({ type: "catOverlay.hide", fadeMs });
    this.host.where(false);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** O que o app (e o headless) ligam ao controlador. */
export interface CatOverlayWiring {
  agent: {
    status(): Promise<AgentStatus>;
    onStatus(fn: (s: AgentStatus) => void): () => void;
    onTurn(fn: (e: AgentTurnEvent) => void): () => void;
  };
  settings: { load(): Promise<AppSettings> };
  /** O helper; sem ele (`--no-helper`), o controlador roda e nada sai. */
  helper?: {
    send(command: Command): Promise<{ ok: boolean; error?: string }>;
    onReady(fn: () => void): () => void;
  };
  /** A pasta da página (`views/ui/catoverlay`). */
  pageDir: string;
  /** O gato foi para o overlay, ou voltou (o evento `kiwicat.where`). */
  where(overlay: boolean): void;
  log?(message: string): void;
  clock?: CatOverlayClock;
}

export interface AttachedCatOverlay {
  readonly overlay: CatOverlay;
  /** As Configurações mudaram (o interruptor `kiwicat.overlay`). */
  settingsChanged(settings: AppSettings): void;
  setHubInView(inView: boolean): void;
  stop(): void;
}

/**
 * Liga o controlador ao agente, às Configurações e ao helper: ligado só com o agente ligado e o interruptor
 * `kiwicat.overlay`; carrega a página de novo quando o helper reinicia.
 */
export function attachCatOverlay(w: CatOverlayWiring): AttachedCatOverlay {
  const toHelper = (c: CatOverlayCommand): Command => (c.type === "catOverlay.load" ? { type: "catOverlay.load", dir: w.pageDir } : c);
  const overlay = new CatOverlay(
    {
      send: (c) => {
        if (!w.helper) return;
        w.helper.send(toHelper(c)).then(
          (r) => r.ok || w.log?.(`[kiwicat] ${c.type}: ${r.error ?? "failed"}`),
          // Sem o helper agora: o `ready` dele carrega de novo.
          () => {},
        );
      },
      where: w.where,
    },
    w.clock,
  );
  let agentOn: boolean | undefined;
  let overlayOn: boolean | undefined;
  const apply = () => overlay.configure(agentOn === true && overlayOn === true);
  const offs = [
    w.agent.onStatus((s) => {
      agentOn = s.enabled;
      apply();
    }),
    w.agent.onTurn((e) => overlay.turn(e)),
    w.helper?.onReady(() => overlay.helperReady()) ?? (() => {}),
  ];
  // A primeira leitura não passa por cima de um evento que chegou antes dela.
  void w.agent.status().then((s) => {
    if (agentOn === undefined) agentOn = s.enabled;
    apply();
  }, () => {});
  let colorSet = false;
  void w.settings.load().then((s) => {
    if (overlayOn === undefined) overlayOn = s.kiwicat.overlay;
    if (!colorSet) {
      overlay.setColor(catColorHex(s.kiwicat.cor));
      overlay.setPlace(s.kiwicat.posicao, s.kiwicat.tamanho);
    }
    apply();
  }, () => {});
  return {
    overlay,
    settingsChanged: (s) => {
      overlayOn = s.kiwicat.overlay;
      colorSet = true;
      overlay.setColor(catColorHex(s.kiwicat.cor));
      overlay.setPlace(s.kiwicat.posicao, s.kiwicat.tamanho);
      apply();
    },
    setHubInView: (inView) => overlay.setHubInView(inView),
    stop: () => {
      for (const off of offs) off();
      overlay.dispose();
    },
  };
}
