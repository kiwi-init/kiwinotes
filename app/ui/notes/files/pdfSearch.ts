// A busca no pdf das Notas (T7109, spec #7079). Lógica pura, sem o pdf.js: o texto de cada página vem como pedaços
// (`TextItem`: o texto, a matriz e a largura), e a busca acha o termo no texto da página, sem acento nem maiúscula,
// e devolve os retângulos para marcar por cima da página. Um termo pode atravessar dois pedaços (uma frase que o pdf
// partiu em duas corridas): aí o achado tem um retângulo por pedaço.

import { foldWithMap } from "../../../src/store/text.ts";

/** O que a busca usa de um `TextItem` do pdf.js. */
export interface PdfTextItem {
  str: string;
  /** `[a, b, c, d, e, f]`: a posição `(e, f)` da linha de base, em pontos do pdf. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Um retângulo em pontos do pdf (a origem embaixo, à esquerda): `[x1, y1, x2, y2]`. */
export type PdfRect = [number, number, number, number];

export interface PageText {
  /** O texto da página, os pedaços em ordem, com um espaço onde o pdf quebra a linha. */
  text: string;
  /** De onde veio cada trecho do texto: `[começo, fim)` no `text`, e o pedaço. */
  spans: { start: number; end: number; item: number }[];
  items: PdfTextItem[];
}

export interface PdfMatch {
  page: number;
  /** Um retângulo por pedaço que o achado atravessa. */
  rects: PdfRect[];
}

/** O texto de uma página pelos pedaços dela. */
export function pageText(items: PdfTextItem[]): PageText {
  let text = "";
  const spans: PageText["spans"] = [];
  let last: PdfTextItem | null = null;
  items.forEach((item, i) => {
    if (!item.str) {
      if (item.hasEOL && text && !text.endsWith(" ")) text += " ";
      return;
    }
    // Outra linha (a linha de base mudou mais que meia altura) também vale um espaço: nem todo pdf marca a quebra.
    const newLine = last !== null && Math.abs((item.transform[5] ?? 0) - (last.transform[5] ?? 0)) > Math.max(last.height, item.height, 1) / 2;
    if (newLine && text && !text.endsWith(" ")) text += " ";
    spans.push({ start: text.length, end: text.length + item.str.length, item: i });
    text += item.str;
    last = item;
    // A quebra de linha vale um espaço: "fim da\nlinha" acha "da linha".
    if (item.hasEOL && !text.endsWith(" ")) text += " ";
  });
  return { text, spans, items };
}

/**
 * O retângulo de um trecho `[from, to)` do pedaço, em pontos do pdf. A largura do trecho é proporcional ao número de
 * caracteres (o pdf.js não diz a largura de cada letra): numa fonte de largura variável a marca fica um pouco fora,
 * mas sempre em cima da palavra. A altura vai da linha de base para cima, com uma folga para a perna do "g" e do "p".
 */
export function itemRect(item: PdfTextItem, from: number, to: number): PdfRect {
  const [a = 1, b = 0, , , e = 0, f = 0] = item.transform;
  const length = Math.max(item.str.length, 1);
  // A direção do texto: `(a, b)` é o eixo x da matriz. Texto deitado tem `b = 0`.
  const scale = Math.hypot(a, b) || 1;
  const ux = a / scale;
  const uy = b / scale;
  const x1 = e + ux * item.width * (from / length);
  const y1 = f + uy * item.width * (from / length);
  const x2 = e + ux * item.width * (to / length);
  const y2 = f + uy * item.width * (to / length);
  const height = item.height || scale;
  // A normal ao texto, para cima.
  const nx = -uy;
  const ny = ux;
  const xs = [x1 - nx * height * 0.2, x2 - nx * height * 0.2, x1 + nx * height * 0.85, x2 + nx * height * 0.85];
  const ys = [y1 - ny * height * 0.2, y2 - ny * height * 0.2, y1 + ny * height * 0.85, y2 + ny * height * 0.85];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Os achados de `query` numa página, na ordem do texto. Sem acento nem maiúscula; um termo vazio não acha nada. */
export function findInPage(page: PageText, query: string, pageNumber = 1): PdfMatch[] {
  const needle = foldWithMap(query.trim()).folded;
  if (!needle) return [];
  const { folded, map } = foldWithMap(page.text);
  const matches: PdfMatch[] = [];
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    const start = map[at]!;
    const end = map[at + needle.length]!;
    const rects: PdfRect[] = [];
    for (const span of page.spans) {
      if (span.end <= start || span.start >= end) continue;
      const item = page.items[span.item]!;
      rects.push(itemRect(item, Math.max(start, span.start) - span.start, Math.min(end, span.end) - span.start));
    }
    if (rects.length) matches.push({ page: pageNumber, rects });
  }
  return matches;
}

/** Os achados no documento inteiro, página por página (a primeira é a 1). */
export function findInPages(pages: PageText[], query: string): PdfMatch[] {
  return pages.flatMap((p, i) => findInPage(p, query, i + 1));
}

/** O achado seguinte ou o anterior, dando a volta no fim. `-1` sem achados. */
export function stepMatch(current: number, total: number, direction: 1 | -1): number {
  if (!total) return -1;
  return (current + direction + total) % total;
}

/** Os degraus do zoom, e o seguinte para cima ou para baixo a partir de qualquer escala (a do "ajustar à largura"). */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export function stepZoom(scale: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > scale + 0.001) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001) ?? ZOOM_STEPS[0];
}

/** A escala que faz a página caber na largura disponível, dentro dos limites do zoom. */
export function fitWidth(pageWidth: number, available: number): number {
  if (!(pageWidth > 0) || !(available > 0)) return 1;
  return Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0], available / pageWidth));
}
