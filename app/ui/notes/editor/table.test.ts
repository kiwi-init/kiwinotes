import { describe, expect, test } from "bun:test";

import { cellAt, formatTable, parseTable, splitRow, tableEnter, tableTab } from "./table.ts";

const raw = "| Item | Valor |\n|---|--:|\n| Mudança | 4.200 |\n| Rede | 1.800 |";

describe("tabela Markdown", () => {
  test("lê células, alinhamento e pipe escapado", () => {
    expect(splitRow("| a | b \\| c | |")).toEqual(["a", "b \\| c", ""]);
    expect(parseTable(raw)).toEqual({ header: ["Item", "Valor"], align: [null, "right"], rows: [["Mudança", "4.200"], ["Rede", "1.800"]] });
    expect(parseTable("| só | uma linha |")).toBeNull();
  });

  test("alinha as colunas, respeitando o alinhamento pedido", () => {
    expect(formatTable(parseTable(raw)!)).toBe(
      ["| Item    | Valor |", "| ------- | ----: |", "| Mudança | 4.200 |", "| Rede    | 1.800 |"].join("\n"),
    );
  });

  test("completa linha com célula a menos", () => {
    expect(parseTable("| a | b |\n| - | - |\n| 1 |")!.rows).toEqual([["1", ""]]);
  });

  test("acha linha e coluna do cursor", () => {
    expect(cellAt(raw, raw.indexOf("Valor"))).toEqual({ row: 0, col: 1 });
    expect(cellAt(raw, raw.indexOf("Rede") + 2)).toEqual({ row: 3, col: 0 });
  });

  test("Tab vai para a próxima célula e seleciona o conteúdo dela", () => {
    const r = tableTab(raw, raw.indexOf("Mudança"), 1)!;
    expect(r.text.slice(r.anchor, r.head)).toBe("4.200");
    const back = tableTab(r.text, r.anchor, -1)!;
    expect(back.text.slice(back.anchor, back.head)).toBe("Mudança");
  });

  test("Tab no fim do cabeçalho pula o separador; ⇧Tab na 1ª linha de dados volta ao cabeçalho", () => {
    const r = tableTab(raw, raw.indexOf("Valor"), 1)!;
    expect(r.text.slice(r.anchor, r.head)).toBe("Mudança");
    const back = tableTab(r.text, r.anchor, -1)!;
    expect(back.text.slice(back.anchor, back.head)).toBe("Valor");
  });

  test("Tab depois da última célula abre uma linha nova", () => {
    const r = tableTab(raw, raw.indexOf("1.800"), 1)!;
    expect(r.text.split("\n")).toHaveLength(5);
    expect(r.anchor).toBe(r.head);
    expect(r.text.slice(r.text.lastIndexOf("\n") + 1, r.anchor)).toBe("| ");
  });

  test("Enter abre uma linha vazia abaixo, com o cursor na 1ª célula", () => {
    const r = tableEnter(raw, raw.indexOf("Mudança"))!;
    const lines = r.text.split("\n");
    expect(lines[3]).toMatch(/^\|\s+\|\s+\|$/);
    expect(lines[4]).toContain("Rede");
    expect(r.text.slice(0, r.anchor).split("\n")).toHaveLength(4);
  });
});
