// O ⌘F do docx (T21151, spec #21080). Lógica pura, sem o motor: o texto de cada parágrafo vem dos pedaços que o motor
// desenhou (cada um com o parágrafo e o trecho dele), e a busca acha o termo sem acento nem maiúscula, como a do pdf.
// O achado é um trecho do parágrafo (`from`, `to`): o motor sabe marcar, rolar e selecionar por ele.

import { foldWithMap } from "../../../src/store/text.ts";

/** Um pedaço de texto desenhado: o parágrafo, o trecho dele e a página. */
export interface DocxPiece {
  paragraphId: string;
  start: number;
  end: number;
  text: string;
  page: number;
}

export interface DocxParagraph {
  id: string;
  /** A página onde ele começa (a primeira é 0). */
  page: number;
  text: string;
  /** Para cada letra do `text`, o lugar dela no parágrafo; e um a mais, o fim. */
  offsets: number[];
}

export interface DocxMatch {
  paragraphId: string;
  from: number;
  to: number;
  page: number;
}

/**
 * Os parágrafos, na ordem em que aparecem, com o texto montado pelos pedaços. Um parágrafo que passa de uma página
 * para outra vem em mais de um pedaço; um pedaço repetido (o mesmo trecho desenhado duas vezes) entra uma vez só.
 */
export function docxParagraphs(pieces: DocxPiece[]): DocxParagraph[] {
  const byId = new Map<string, { page: number; pieces: DocxPiece[] }>();
  for (const p of pieces) {
    if (!p.text) continue;
    const entry = byId.get(p.paragraphId);
    if (entry) entry.pieces.push(p);
    else byId.set(p.paragraphId, { page: p.page, pieces: [p] });
  }
  const out: DocxParagraph[] = [];
  for (const [id, { page, pieces: list }] of byId) {
    list.sort((a, b) => a.start - b.start);
    let text = "";
    const offsets: number[] = [];
    let at = -1;
    for (const p of list) {
      if (p.start < at) continue;
      // Um buraco entre dois pedaços (uma imagem, um campo) vale um espaço: as palavras dos lados não se juntam.
      if (at !== -1 && p.start > at && !text.endsWith(" ")) {
        text += " ";
        offsets.push(at);
      }
      // O texto desenhado nem sempre tem o tamanho do trecho (um campo, uma tabulação): aí as letras ficam no começo dele.
      const exact = p.text.length === p.end - p.start;
      for (let i = 0; i < p.text.length; i++) offsets.push(exact ? p.start + i : p.start);
      text += p.text;
      at = p.end;
    }
    offsets.push(at);
    out.push({ id, page, text, offsets });
  }
  return out;
}

/** Os achados de `query`, na ordem do documento. Sem acento nem maiúscula; um termo vazio não acha nada. */
export function findInDocx(paragraphs: DocxParagraph[], query: string): DocxMatch[] {
  const needle = foldWithMap(query.trim()).folded;
  if (!needle) return [];
  const matches: DocxMatch[] = [];
  for (const p of paragraphs) {
    const { folded, map } = foldWithMap(p.text);
    for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
      const start = map[at]!;
      const end = map[at + needle.length]!;
      const from = p.offsets[start]!;
      // O fim é o lugar depois da última letra achada.
      const to = end < p.text.length ? p.offsets[end]! : p.offsets[p.text.length]!;
      if (to > from) matches.push({ paragraphId: p.id, from, to, page: p.page });
    }
  }
  return matches;
}
