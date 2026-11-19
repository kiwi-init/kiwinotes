import { describe, expect, test } from "bun:test";

import { canvasLines } from "./canvas-lines.ts";

const node = (id: string, x: number, y: number, extra: object) => ({ id, x, y, width: 200, height: 80, ...extra });
const board = (nodes: object[], edges: object[] = []) => JSON.stringify({ nodes, edges });

describe("canvasLines (T22432)", () => {
  test("os nós na ordem de leitura, o texto inteiro, e as setas pelo nome", () => {
    const json = board(
      [
        node("b", 300, 0, { type: "text", text: "Feira\npão\nleite" }),
        node("a", 0, 0, { type: "text", text: "Plano da semana" }),
        node("c", 0, 200, { type: "file", file: "Casa/feira.txt" }),
        node("d", 300, 200, { type: "link", url: "https://exemplo.com" }),
        node("g", 0, 400, { type: "group", label: "Ideias" }),
      ],
      [{ id: "e1", fromNode: "a", toNode: "b", label: "depois" }],
    );
    expect(canvasLines(json)).toBe(
      [
        "Cartão: Plano da semana",
        "Cartão: Feira",
        "  pão",
        "  leite",
        "Arquivo: Casa/feira.txt",
        "Link: https://exemplo.com",
        "Grupo: Ideias",
        "Seta: Plano da semana → Feira (depois)",
        "",
      ].join("\n"),
    );
  });

  test("mover um cartão sem mudar a ordem não muda as linhas; trocar o texto muda", () => {
    const a = board([node("a", 0, 0, { type: "text", text: "um" }), node("b", 0, 100, { type: "text", text: "dois" })]);
    const moved = board([node("a", 40, 10, { type: "text", text: "um" }), node("b", 10, 120, { type: "text", text: "dois" })]);
    const edited = board([node("a", 0, 0, { type: "text", text: "um" }), node("b", 0, 100, { type: "text", text: "três" })]);
    expect(canvasLines(moved)).toBe(canvasLines(a));
    expect(canvasLines(edited)).not.toBe(canvasLines(a));
  });

  test("um JSON que não abre volta como está", () => {
    expect(canvasLines("{ quebrado")).toBe("{ quebrado");
  });
});
