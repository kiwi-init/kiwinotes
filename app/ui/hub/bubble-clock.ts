// O relógio do balão (spec #32534, Cena 3): um só, no Hub e no overlay. Depois da resposta, 45 s parado, a pergunta
// "Precisa de mais alguma coisa?", mais 15 s, e o balão sai. O mouse em cima do Kiwi ou do balão segura (nada corre, e
// a pergunta fica à vista: é o mouse que mostra o balão); solto, a pergunta sai e a espera recomeça do zero. O clique no balão nunca fecha: ele recomeça a espera. Quem fecha é o × e o Esc.
// O overlay (src/bun/cat-overlay.ts) usa os mesmos tempos; esta é a versão sem tela para o Hub, com o relógio de fora.

/** Parado depois da resposta, quanto o balão espera antes de perguntar se precisa de mais algo. */
export const BUBBLE_IDLE_ASK_MS = 45_000;
/** Depois da pergunta, sem resposta, quanto ele ainda fica antes de sair. */
export const BUBBLE_ASK_LEAVE_MS = 15_000;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export class BubbleClock {
  private timer: unknown = null;
  private running = false;
  private held = false;
  /** A pergunta está no balão agora. */
  asking = false;

  constructor(
    private readonly on: { ask: (on: boolean) => void; leave: () => void },
    private readonly timers: Timers = realTimers,
  ) {}

  /** Um balão de resposta (ou de erro) entrou: a espera começa, a menos que o mouse já esteja em cima. */
  start(): void {
    this.running = true;
    this.restart();
  }

  /** O balão saiu (o ×, o Esc, um pedido novo): o relógio para, sem a pergunta. */
  stop(): void {
    this.running = false;
    this.cancel();
    this.setAsk(false);
  }

  /** O mouse em cima do Kiwi ou do balão (`true`) segura, com a pergunta onde está; solto, a espera recomeça do zero. */
  hold(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    if (!this.running) return;
    if (on) this.cancel();
    else this.restart();
  }

  /** O clique ou a rolagem no balão: conta como interação, a pergunta sai e a espera recomeça. */
  touch(): void {
    if (!this.running) return;
    this.restart();
  }

  private restart(): void {
    this.cancel();
    this.setAsk(false);
    if (this.held) return;
    this.timer = this.timers.set(() => {
      this.setAsk(true);
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.running = false;
        this.setAsk(false);
        this.on.leave();
      }, BUBBLE_ASK_LEAVE_MS);
    }, BUBBLE_IDLE_ASK_MS);
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private setAsk(on: boolean): void {
    if (on === this.asking) return;
    this.asking = on;
    this.on.ask(on);
  }
}
