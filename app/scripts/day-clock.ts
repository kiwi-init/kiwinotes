// Os horários de "hoje" dos roteiros que agrupam por dia (T33888, #33885). "Agora − 30 min" às 00:01 cai em ontem, e
// o roteiro que espera o grupo de hoje reprova; um roteiro que começa às 23:59 termina amanhã. Os dois casos ficam aqui.

/** A meia-noite (local) do dia de `now`. */
export const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** A folga antes da meia-noite: um roteiro de tela leva menos que isso. */
export const MIDNIGHT_MARGIN_MS = 5 * 60_000;

/** Quanto esperar para o roteiro inteiro caber num dia só: 0, ou até 1 s depois da meia-noite se falta menos da folga. */
export function waitForSameDay(now: Date, margin = MIDNIGHT_MARGIN_MS): number {
  const left = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
  return left < margin ? left + 1000 : 0;
}

/**
 * Um instante de hoje "`minutes` minutos atrás", sem passar da meia-noite: com mais de `scale` minutos desde ela, é
 * `now − minutes`; antes disso, a mesma conta encolhe na proporção, e as entradas ficam entre a meia-noite e agora, na
 * mesma ordem.
 */
export function minutesAgoToday(now: Date, minutes: number, scale = 60): Date {
  const span = Math.min(now.getTime() - startOfDay(now).getTime(), scale * 60_000);
  return new Date(now.getTime() - (span * minutes) / scale);
}
