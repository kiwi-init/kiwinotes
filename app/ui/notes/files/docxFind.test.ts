import { expect, test } from "bun:test";

import { type DocxPiece, docxParagraphs, findInDocx } from "./docxFind.ts";

const piece = (paragraphId: string, start: number, text: string, page = 0, end = start + text.length): DocxPiece => ({ paragraphId, start, end, text, page });

test("acha sem acento nem maiúscula, na ordem do documento, com o trecho de cada parágrafo", () => {
  const ps = docxParagraphs([
    piece("p1", 0, "Relatório da "),
    piece("p1", 13, "Loja de exemplo"),
    piece("p2", 0, "A loja recebeu cadernos.", 1),
  ]);
  expect(ps.map((p) => p.text)).toEqual(["Relatório da Loja de exemplo", "A loja recebeu cadernos."]);
  expect(findInDocx(ps, "LOJA")).toEqual([
    { paragraphId: "p1", from: 13, to: 17, page: 0 },
    { paragraphId: "p2", from: 2, to: 6, page: 1 },
  ]);
  expect(findInDocx(ps, "relatorio")).toEqual([{ paragraphId: "p1", from: 0, to: 9, page: 0 }]);
  expect(findInDocx(ps, "  ")).toEqual([]);
  expect(findInDocx(ps, "prateleira")).toEqual([]);
});

test("um termo que passa de um pedaço para o outro (outra linha, outra página) é um achado só", () => {
  const ps = docxParagraphs([piece("p1", 0, "A equipe da loja "), piece("p1", 17, "anotou tudo.", 1)]);
  expect(findInDocx(ps, "loja anotou")).toEqual([{ paragraphId: "p1", from: 12, to: 23, page: 0 }]);
});

test("os pedaços fora de ordem, repetidos ou vazios não bagunçam o texto", () => {
  const ps = docxParagraphs([piece("p1", 6, "mundo"), piece("p1", 0, "olá, "), piece("p1", 0, "olá, "), piece("p1", 11, "")]);
  expect(ps[0]!.text).toBe("olá, mundo");
  expect(findInDocx(ps, "mundo")).toEqual([{ paragraphId: "p1", from: 6, to: 11, page: 0 }]);
});

test("um buraco no parágrafo (uma imagem no meio) vale um espaço, e um pedaço de outro tamanho fica no começo dele", () => {
  const ps = docxParagraphs([piece("p1", 0, "antes"), piece("p1", 6, "depois"), piece("p2", 0, "Página "), piece("p2", 7, "12", 0, 8)]);
  expect(ps[0]!.text).toBe("antes depois");
  expect(findInDocx(ps, "antes depois")).toEqual([{ paragraphId: "p1", from: 0, to: 12, page: 0 }]);
  // O "12" desenhado por um campo de 1 caractere: o achado cobre o campo inteiro.
  expect(findInDocx(ps, "12")).toEqual([{ paragraphId: "p2", from: 7, to: 8, page: 0 }]);
});
