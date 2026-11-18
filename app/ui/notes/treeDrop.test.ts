// Onde cai o que se arrasta na árvore (T19937, spec #19261). Caminhos inventados.
import { describe, expect, test } from "bun:test";

import { canDrop, dropFolder } from "./treeDrop.ts";

const nota = { kind: "note" as const, path: "Projetos/Plano.md" };
const pasta = { kind: "folder" as const, path: "Projetos" };
const pdf = { kind: "file" as const, path: "Projetos/exemplo.pdf" };

describe("dropFolder", () => {
  test("numa nota ou num arquivo, a pasta deles", () => {
    expect(dropFolder({ kind: "note", path: "Ideias/Lista.md" }, 0.5, nota)).toBe("Ideias");
    expect(dropFolder({ kind: "file", path: "Ideias/dados.csv" }, 0.1, nota)).toBe("Ideias");
    // uma nota da raiz: soltar entre as linhas da raiz é a raiz
    expect(dropFolder({ kind: "note", path: "Leia-me.md" }, 0.5, pdf)).toBe("");
  });

  test("numa pasta: o meio é dentro, as bordas ao lado", () => {
    const row = { kind: "folder" as const, path: "Ideias" };
    expect(dropFolder(row, 0.5, nota)).toBe("Ideias");
    expect(dropFolder(row, 0.1, nota)).toBe("");
    expect(dropFolder(row, 0.9, nota)).toBe("");
    const sub = { kind: "folder" as const, path: "Ideias/2026" };
    expect(dropFolder(sub, 0.1, nota)).toBe("Ideias");
    expect(dropFolder(sub, 0.5, nota)).toBe("Ideias/2026");
  });

  test("a base de uma pasta aberta é dentro", () => {
    expect(dropFolder({ kind: "folder", path: "Ideias", expanded: true }, 0.9, nota)).toBe("Ideias");
    expect(dropFolder({ kind: "folder", path: "Ideias", expanded: true }, 0.1, nota)).toBe("");
  });

  test("onde já está ou dentro dela mesma: não solta", () => {
    expect(dropFolder({ kind: "note", path: "Projetos/Outra.md" }, 0.5, nota)).toBeNull();
    expect(dropFolder({ kind: "folder", path: "Projetos" }, 0.5, pdf)).toBeNull();
    expect(dropFolder({ kind: "folder", path: "Projetos" }, 0.5, pasta)).toBeNull();
    expect(dropFolder({ kind: "folder", path: "Projetos/Velhos" }, 0.5, pasta)).toBeNull();
    // a borda da própria pasta é a raiz, onde ela já está
    expect(dropFolder({ kind: "folder", path: "Projetos" }, 0.1, pasta)).toBeNull();
    expect(dropFolder({ kind: "note", path: "Ideias/Lista.md" }, 0.5, null)).toBeNull();
  });
});

describe("canDrop", () => {
  test("a raiz aceita o que não está nela", () => {
    expect(canDrop(nota, "")).toBe(true);
    expect(canDrop(pasta, "")).toBe(false);
    expect(canDrop({ kind: "folder", path: "Projetos/Velhos" }, "")).toBe(true);
  });

  test("um nome que começa igual não é subpasta", () => {
    expect(canDrop(pasta, "Projetos 2")).toBe(true);
    expect(canDrop(pasta, "Projetos/x")).toBe(false);
  });
});
