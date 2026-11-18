// O cartão do arquivo sem visualizador (T19316): o tipo e a data em palavras. O cartão na janela (os botões, um só
// "Abrir no app padrão", o "Mostrar no Finder") é conferido no `scripts/ui-scripts/arquivo-cartao.json`.

import { describe, expect, test } from "bun:test";

import { modified, typeLabel } from "./fileCard.ts";
import { viewerFor } from "./viewers.ts";

describe("cartão do arquivo", () => {
  test("o tipo vem da extensão, em maiúsculas", () => {
    expect(typeLabel("Projeto X/backup.zip")).toBe("Arquivo ZIP");
    expect(typeLabel("modelo.Sketch")).toBe("Arquivo SKETCH");
    expect(typeLabel("dados.tar.gz")).toBe("Arquivo GZ");
  });

  test("sem extensão: o nome sem ponto, o ponto no começo e o ponto no fim", () => {
    expect(typeLabel("Makefile")).toBe("Arquivo sem extensão");
    expect(typeLabel("Ana/.gitignore")).toBe("Arquivo sem extensão");
    expect(typeLabel("rascunho.")).toBe("Arquivo sem extensão");
  });

  test("a data da última mudança, em português; uma inválida some", () => {
    expect(modified("2026-03-04T15:06:00")).toMatch(/^4 de mar\.? de 2026.*15:06$/);
    expect(modified("ontem")).toBe("");
  });

  test("os tipos do cartão não têm visualizador próprio", () => {
    for (const name of ["backup.zip", "modelo.sketch", "Makefile.bin", "fonte.ttf"]) {
      expect(viewerFor(name)).toBeUndefined();
    }
  });
});
