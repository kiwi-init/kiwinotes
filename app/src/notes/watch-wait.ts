// Esperar o watcher nos testes (T6381, issue 240): o `fs.watch` do macOS (FSEvents) pode perder uma escrita feita logo
// depois de começar a olhar, e no runner do CI isso acontece. Medido: mesmo esperando 10 s, o evento não vinha. Então a
// espera não aumenta um sleep: ela repete a escrita (que tem de ser idempotente) até o watcher ver, com prazo.

export const WATCH_DEADLINE_MS = 8_000;
const EVERY_MS = 20;
const REWRITE_MS = 400;

/** Espera `probe()` ficar verdadeiro, conferindo a cada 20 ms; passa do prazo e falha dizendo o quê. */
export async function until(probe: () => boolean, what: string, deadlineMs = WATCH_DEADLINE_MS): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (!probe()) {
    if (Date.now() > end) throw new Error(`watcher timed out: ${what}`);
    await Bun.sleep(EVERY_MS);
  }
}

/**
 * Faz a escrita e espera o watcher ver; se ele não viu em 400 ms, escreve de novo (o FSEvents ainda não estava de pé).
 * `write` recebe o número da tentativa, para cada escrita ser uma mudança de verdade no disco.
 */
export async function untilSeen(
  write: (attempt: number) => Promise<void> | void,
  probe: () => boolean,
  what: string,
  deadlineMs = WATCH_DEADLINE_MS,
): Promise<number> {
  const end = Date.now() + deadlineMs;
  let attempt = 0;
  while (true) {
    await write(attempt++);
    const next = Math.min(Date.now() + REWRITE_MS, end);
    while (!probe() && Date.now() < next) await Bun.sleep(EVERY_MS);
    if (probe()) return attempt;
    if (Date.now() >= end) throw new Error(`watcher timed out: ${what} (${attempt} writes)`);
  }
}
