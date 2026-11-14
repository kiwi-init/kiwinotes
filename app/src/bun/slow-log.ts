// O registro do que é lento (spec #12918, T12943). O harry sentiu o app travar na rc18 (a troca para Configurações, o
// clique numa pasta do onboarding, o dropdown das Rotinas), e no headless nada disso passa da meta: a causa está no Mac
// dele. Este registro conta, no log local do app (`<dados>/logs/kiwi.log`, que só sai do Mac se a pessoa mandar):
// - a chamada da tela que levou mais de 100 ms (só o nome da capacidade e o tempo, nunca os argumentos ou a resposta);
// - o Bun que ficou mais de 250 ms sem rodar (algo síncrono e pesado segurando todas as respostas);
// - o quadro travado que a tela contou (`diagnostics.slowFrame`).
// Uma linha por vez com um teto por minuto: um travamento longo não enche o log.

/** Uma chamada da tela acima disto entra no log. */
export const SLOW_CALL_MS = 100;
/** O Bun parado acima disto entra no log. */
export const BUSY_MS = 250;
/** No máximo estas linhas `[slow]` por minuto; as que passarem viram uma contagem na próxima. */
export const SLOW_LINES_PER_MINUTE = 30;

export interface SlowLog {
  /** Uma linha `[slow] …`, com o teto por minuto. */
  line(text: string): void;
}

export function slowLog(write: (line: string) => void = (l) => console.warn(l), now: () => number = Date.now): SlowLog {
  let minute = -1;
  let used = 0;
  let dropped = 0;
  return {
    line(text) {
      const m = Math.floor(now() / 60_000);
      if (m !== minute) {
        if (dropped) write(`[slow] mais ${dropped} linhas no último minuto, fora do log`);
        minute = m;
        used = 0;
        dropped = 0;
      }
      if (used >= SLOW_LINES_PER_MINUTE) {
        dropped++;
        return;
      }
      used++;
      write(`[slow] ${text}`);
    },
  };
}

type Handler = (args: unknown) => unknown;

/** As capacidades com o tempo de cada chamada: acima de `SLOW_CALL_MS`, uma linha com o nome e os ms. */
export function timedCapabilities<T extends Record<string, Handler>>(caps: T, log: SlowLog, clock: () => number = () => performance.now()): T {
  const out: Record<string, Handler> = {};
  for (const [cap, fn] of Object.entries(caps)) {
    out[cap] = (args) => {
      const t0 = clock();
      const done = (failed: boolean) => {
        const ms = clock() - t0;
        if (ms > SLOW_CALL_MS) log.line(`${cap} levou ${Math.round(ms)} ms${failed ? " (falhou)" : ""}`);
      };
      let r: unknown;
      try {
        r = fn(args);
      } catch (e) {
        done(true);
        throw e;
      }
      if (r instanceof Promise) return r.then((v) => (done(false), v), (e: unknown) => (done(true), Promise.reject(e)));
      done(false);
      return r;
    };
  }
  return out as T;
}

/**
 * Olha o relógio a cada `everyMs`: se a volta atrasou mais que `BUSY_MS`, o Bun ficou parado esse tempo (uma tarefa
 * síncrona segurou o processo, e com ele todas as respostas da tela). Devolve o `stop`.
 */
export function watchBusy(log: SlowLog, everyMs = 100, clock: () => number = () => performance.now()): () => void {
  let last = clock();
  const timer = setInterval(() => {
    const t = clock();
    const late = t - last - everyMs;
    last = t;
    if (late > BUSY_MS) log.line(`o Bun ficou ${Math.round(late)} ms sem responder`);
  }, everyMs);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}
