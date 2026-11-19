// A célula selecionada e a largura arrastável (T21040, spec #21008). O estoque de uma loja inventada.
import { describe, expect, test } from "bun:test";

import { CELL_PAD, MIN_COL, offsetsOf, ROW_H } from "./grid.ts";
import { cellAddress, cellText, clampCell, dragWidth, firstVisible, fitWidth, MAX_DRAG, MAX_FIT, MIN_DRAG, moveCell, scrollToShow, withCustom } from "./selection.ts";

const header = ["Código", "Produto", "Estoque"];
const rows = [
  ["1001", "Caneca azul 300 ml", "42"],
  ["1002", "Caderno A5", "7"],
];
/** 7 px por letra, 8 no negrito. */
const measure = (t: string, bold: boolean) => t.length * (bold ? 8 : 7);

describe("o endereço e o conteúdo", () => {
  test("como no Excel: a linha de cima é a 1, e a seguinte a 2", () => {
    expect(cellAddress({ row: 0, col: 0 }, 2)).toBe("A1");
    expect(cellAddress({ row: 1, col: 1 }, 2)).toBe("B2");
    expect(cellAddress({ row: 2, col: 27 }, 2)).toBe("AB3");
  });

  test("o texto vem da linha de cima ou das outras, e o que falta é vazio", () => {
    expect(cellText({ row: 0, col: 1 }, header, rows)).toBe("Produto");
    expect(cellText({ row: 1, col: 1 }, header, rows)).toBe("Caneca azul 300 ml");
    expect(cellText({ row: 2, col: 9 }, header, rows)).toBe("");
  });
});

describe("as setas", () => {
  const at = { row: 1, col: 1 };
  const move = (key: string, meta = false, cell = at) => moveCell(cell, { key, meta }, 2, 3, 10);

  test("andam uma célula", () => {
    expect(move("ArrowUp")).toEqual({ row: 0, col: 1 });
    expect(move("ArrowDown")).toEqual({ row: 2, col: 1 });
    expect(move("ArrowLeft")).toEqual({ row: 1, col: 0 });
    expect(move("ArrowRight")).toEqual({ row: 1, col: 2 });
  });

  test("param na borda", () => {
    expect(move("ArrowUp", false, { row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
    expect(move("ArrowLeft", false, { row: 0, col: 0 })).toEqual({ row: 0, col: 0 });
    expect(move("ArrowDown", false, { row: 2, col: 2 })).toEqual({ row: 2, col: 2 });
    expect(move("ArrowRight", false, { row: 2, col: 2 })).toEqual({ row: 2, col: 2 });
  });

  test("⌘ + seta vai até a borda; Home e End, ao começo e ao fim da linha", () => {
    expect(move("ArrowDown", true)).toEqual({ row: 2, col: 1 });
    expect(move("ArrowUp", true)).toEqual({ row: 0, col: 1 });
    expect(move("ArrowRight", true)).toEqual({ row: 1, col: 2 });
    expect(move("Home")).toEqual({ row: 1, col: 0 });
    expect(move("End")).toEqual({ row: 1, col: 2 });
  });

  test("Page Down anda uma tela, menos uma linha", () => {
    expect(moveCell({ row: 0, col: 0 }, { key: "PageDown" }, 100, 3, 10)).toEqual({ row: 9, col: 0 });
    expect(moveCell({ row: 50, col: 0 }, { key: "PageUp" }, 100, 3, 10)).toEqual({ row: 41, col: 0 });
  });

  test("outra tecla não anda", () => {
    expect(move("a")).toBeNull();
    expect(move("Enter")).toBeNull();
  });

  test("a célula fora da grade volta para dentro (o arquivo mudou e ficou menor)", () => {
    expect(clampCell({ row: 9, col: 9 }, 2, 3)).toEqual({ row: 2, col: 2 });
  });
});

describe("a célula à vista", () => {
  // 10 colunas de 100 px; a tela mostra 300 px por 5 linhas.
  const offsets = offsetsOf(Array.from({ length: 10 }, () => 100));
  const view = { left: 0, top: 0, width: 300, height: 5 * ROW_H };

  test("já à vista: a rolagem não muda", () => {
    expect(scrollToShow({ row: 1, col: 1 }, offsets, view)).toEqual({ left: 0, top: 0 });
  });

  test("à direita e embaixo: rola só o que falta", () => {
    expect(scrollToShow({ row: 8, col: 4 }, offsets, view)).toEqual({ left: 200, top: 3 * ROW_H });
  });

  test("à esquerda e em cima: rola até o começo dela, sem passar por baixo das partes paradas", () => {
    expect(scrollToShow({ row: 2, col: 1 }, offsets, { ...view, left: 500, top: 600 })).toEqual({ left: 100, top: ROW_H });
  });

  test("a linha de cima está sempre à vista: o clique só rola para o lado", () => {
    expect(scrollToShow({ row: 0, col: 0 }, offsets, { ...view, left: 500, top: 600 })).toEqual({ left: 0, top: 600 });
  });

  test("a tecla que chega na linha de cima (⌘↑) volta ao começo", () => {
    expect(scrollToShow({ row: 0, col: 6 }, offsets, { ...view, left: 500, top: 600 }, true)).toEqual({ left: 500, top: 0 });
  });

  test("uma coluna mais larga que a tela mostra o começo", () => {
    const wide = offsetsOf([100, 900]);
    expect(scrollToShow({ row: 1, col: 1 }, wide, view)).toEqual({ left: 100, top: 0 });
  });

  test("a primeira seta começa no canto da tela, não lá no A1", () => {
    expect(firstVisible(offsets, view, 50)).toEqual({ row: 0, col: 0 });
    expect(firstVisible(offsets, { ...view, left: 250, top: 10 * ROW_H }, 50)).toEqual({ row: 11, col: 3 });
  });
});

describe("a borda arrastada", () => {
  test("muda a largura pelo arraste, entre o mínimo e o máximo", () => {
    expect(dragWidth(120, 35.4)).toBe(155);
    expect(dragWidth(120, -500)).toBe(MIN_DRAG);
    expect(dragWidth(120, 5000)).toBe(MAX_DRAG);
  });

  test("dois cliques: a largura do texto mais largo, sem o máximo da abertura", () => {
    expect(fitWidth(1, header, rows, measure)).toBe("Caneca azul 300 ml".length * 7 + CELL_PAD);
    expect(fitWidth(0, header, rows, measure)).toBe(Math.max(MIN_COL, "Código".length * 8 + CELL_PAD));
    const long = [["x".repeat(80)]];
    expect(fitWidth(0, ["A"], long, measure)).toBe(80 * 7 + CELL_PAD);
    expect(fitWidth(0, ["A"], [["x".repeat(4000)]], measure)).toBe(MAX_FIT);
  });

  test("só a coluna mudada sai da largura de abertura", () => {
    expect(withCustom([100, 120, 140], { 1: 300 })).toEqual([100, 300, 140]);
  });
});
