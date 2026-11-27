// O balão no mouse (spec #32534): todo balão do Kiwi, no Hub e no overlay, só aparece com o mouse em cima do Kiwi ou
// do balão, e sai 250 ms depois que o mouse sai. Com o "Ver mais" aberto, fica (preso) até o ×, o Esc ou um clique fora.
// A regra é só esta, sem a tela: o Hub (KiwiCat.tsx) e a página do overlay (catoverlay/main.ts) a usam igual.

/** Quanto o balão espera depois que o mouse sai do Kiwi e do balão: o tempo de ir de um ao outro. */
export const PEEK_LEAVE_MS = 250;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export class BubblePeek {
  private over = new Set<string>();
  private pinned = false;
  private timer: unknown = null;
  /** O balão à vista agora. */
  shown = false;

  constructor(private onChange: (shown: boolean) => void, private timers: Timers = realTimers) {}

  /** O mouse entrou (`on`) ou saiu de um lugar que mostra o balão: o Kiwi, um balão. Cada lugar tem um nome. */
  hover(where: string, on: boolean) {
    if (on) this.over.add(where);
    else this.over.delete(where);
    this.update();
  }

  /** O "Ver mais" aberto prende o balão; fechado, ele segue o mouse de novo (com a espera, se o mouse está longe). */
  pin(on: boolean) {
    this.pinned = on;
    this.update();
  }

  /** O mouse sobre o Kiwi ou um balão, agora. */
  get hovering(): boolean {
    return this.over.size > 0;
  }

  dispose() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private update() {
    if (this.pinned || this.over.size > 0) {
      this.dispose();
      this.set(true);
    } else if (this.shown && this.timer === null) {
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.set(false);
      }, PEEK_LEAVE_MS);
    }
  }

  private set(shown: boolean) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.onChange(shown);
  }
}
