// A forma da gota medida nos pixels (T18950, harry #18945); o desenho em si é o `ui/hub/goo-shape.ts`. O
// `hub-goo-check` tira, em cada quadro, um print só da camada da gota (preta no branco) e conta, coluna a coluna,
// quantos pixels dela há na faixa ao lado da pílula. Aqui está a conta, sem o navegador: um deslizar de pílula não
// tem pescoço nem gota solta, e não passa.

/** Uma coluna conta como vazia abaixo disto (o anti-aliasing da borda). */
const EMPTY_PX = 1;

export interface DropShape {
  /** `none`: nada fora da pílula; `attached`: a forma encosta na pílula; `detached`: há um vão entre ela e a gota. */
  kind: "none" | "attached" | "detached";
  /** A altura da gota: a coluna mais alta da faixa (px do print). */
  body: number;
  /** A ligação mais fina entre a pílula e a gota (px); 0 quando solta, `body` quando não há pescoço. */
  neck: number;
}

/**
 * `cols[i]` é a altura da forma na coluna `i` da faixa, com `i = 0` encostado na pílula e crescendo para longe dela.
 * A gota é a coluna mais alta; o pescoço é a coluna mais baixa entre a pílula e a gota.
 */
export function dropShape(cols: number[], minBody = 4): DropShape {
  let b = -1;
  for (let i = 0; i < cols.length; i++) if (b < 0 || cols[i]! > cols[b]!) b = i;
  const body = b < 0 ? 0 : cols[b]!;
  if (body < minBody) return { kind: "none", body, neck: 0 };
  // A gota pode ter caído inteira longe da pílula: o vão é qualquer coluna vazia antes dela.
  let neck = body;
  for (let i = 0; i < b; i++) {
    if (cols[i]! <= EMPTY_PX) return { kind: "detached", body, neck: 0 };
    neck = Math.min(neck, cols[i]!);
  }
  return { kind: "attached", body, neck };
}

/** O pescoço é fino o bastante: a ligação abaixo desta fração da altura da gota (o spec da T18950 pede < 30%). */
export const NECK_MAX = 0.3;

export const hasNeck = (s: DropShape) => s.kind === "attached" && s.neck < NECK_MAX * s.body;

/** O que a ida precisa mostrar, de um lado: um quadro com pescoço e um com a gota solta. `null` quando mostra. */
export function dripProblem(frames: DropShape[]): string | null {
  const missing = [
    frames.some(hasNeck) ? null : `nenhum quadro com pescoço (ligação < ${NECK_MAX * 100}% da altura da gota)`,
    frames.some((s) => s.kind === "detached") ? null : "nenhum quadro com a gota solta da pílula",
  ].filter(Boolean);
  return missing.length ? missing.join("; ") : null;
}
