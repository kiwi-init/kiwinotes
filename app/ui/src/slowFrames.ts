// O quadro travado depois de um clique ou de uma tecla (spec #12918): o harry sentiu a tela demorar a responder, e o
// app não tinha como contar. Só olha 1 s depois de cada clique ou tecla (sem um laço de quadros o tempo todo, que
// gastaria bateria), e conta o maior intervalo entre quadros, do clique até o fim. Acima de 100 ms, vai para o log
// local pelo `diagnostics.slowFrame`, no máximo um a cada 2 s.

/** Um quadro acima disto conta como travado (a meta do spec #12918). */
export const SLOW_FRAME_MS = 100;
/** Quanto tempo olhar depois de um clique ou tecla. */
export const WATCH_MS = 1000;
/** Um intervalo acima disto é a janela escondida ou o Mac dormindo, não um travamento. */
const IGNORE_ABOVE_MS = 10_000;
/** Um aviso a cada tanto, no máximo. */
const REPORT_EVERY_MS = 2000;

/** A conta, sem o navegador: `input` no clique, `frame` a cada quadro; devolve os ms a avisar, ou null. */
export class SlowFrames {
  private until = -Infinity;
  private last = 0;
  private worst = 0;
  private reported = -Infinity;

  /** Um clique ou tecla em `t`: devolve true se é preciso começar a olhar os quadros (não estava olhando). */
  input(t: number): boolean {
    const idle = t >= this.until;
    if (idle) {
      this.last = t;
      this.worst = 0;
    }
    this.until = t + WATCH_MS;
    return idle;
  }

  /** Um quadro em `t`: `more` diz se continua olhando; `report`, os ms do pior quadro, quando a janela fecha. */
  frame(t: number): { more: boolean; report: number | null } {
    const gap = t - this.last;
    this.last = t;
    if (gap <= IGNORE_ABOVE_MS) this.worst = Math.max(this.worst, gap);
    if (t < this.until) return { more: true, report: null };
    const worst = this.worst;
    this.worst = 0;
    if (worst <= SLOW_FRAME_MS || t - this.reported < REPORT_EVERY_MS) return { more: false, report: null };
    this.reported = t;
    return { more: false, report: Math.round(worst) };
  }
}

/** Liga a conta na página: `where()` diz a tela de agora; `report` manda para o log. Devolve o desligar. */
export function watchSlowFrames(where: () => string, report: (where: string, ms: number) => void): () => void {
  const s = new SlowFrames();
  const tick = (t: number) => {
    if (document.visibilityState !== "visible") return;
    const r = s.frame(t);
    if (r.report !== null) report(where(), r.report);
    if (r.more) requestAnimationFrame(tick);
  };
  const onInput = () => {
    if (s.input(performance.now())) requestAnimationFrame(tick);
  };
  addEventListener("pointerdown", onInput, true);
  addEventListener("keydown", onInput, true);
  return () => {
    removeEventListener("pointerdown", onInput, true);
    removeEventListener("keydown", onInput, true);
  };
}
