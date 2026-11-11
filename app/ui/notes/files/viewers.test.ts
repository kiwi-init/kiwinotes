import { expect, test } from "bun:test";

import { EDITABLE_TEXT } from "../../../src/shared/file-view.ts";
import type { FileContent } from "../types.ts";
import { type FileViewer, loadFile, viewerFor, VIEWERS } from "./viewers.ts";

const View = () => null;
const text: FileViewer = { as: "text", View };
const binary: FileViewer = { as: "binary", View };

test("o visualizador vem da extensão, sem ligar para maiúsculas nem para a pasta", () => {
  const viewers = { txt: text, pdf: binary, "drawio.svg": binary, svg: text };
  expect(viewerFor("Docs/Lista.TXT", viewers)).toBe(text);
  expect(viewerFor("contrato.pdf", viewers)).toBe(binary);
  expect(viewerFor("Pasta.pdf/nota", viewers)).toBeUndefined();
  expect(viewerFor("sem-extensao", viewers)).toBeUndefined();
  expect(viewerFor("planilha.xlsx", viewers)).toBeUndefined();
  // A extensão dupla ganha da simples.
  expect(viewerFor("fluxo.drawio.svg", viewers)).toBe(binary);
  expect(viewerFor("logo.svg", viewers)).toBe(text);
  expect(viewerFor("v1.2.svg", viewers)).toBe(text);
});

test("os formatos registrados: os textos (T7105) e as tabelas (T7107); o resto segue abrindo no app padrão", () => {
  expect(Object.keys(VIEWERS).sort()).toEqual(["csv", "json", "log", "tsv", "txt", "yaml", "yml"]);
  expect(viewerFor("Dados/vendas.CSV")?.View).toBe(viewerFor("dados.tsv")!.View);
  expect(viewerFor("vendas.csv")?.View).not.toBe(viewerFor("lista.txt")!.View);
  for (const name of ["lista.txt", "saida.LOG", "dados.json", "config.yaml", "config.yml"]) expect(viewerFor(name)?.as).toBe("text");
  // Os mesmos tipos que o `files.save` aceita: o que abre editável, grava.
  expect(Object.keys(VIEWERS).filter((ext) => VIEWERS[ext] === viewerFor("a.txt")).sort()).toEqual([...EDITABLE_TEXT].sort());
  // A tabela é só leitura: o `files.save` não aceita csv nem tsv.
  expect(EDITABLE_TEXT.has("csv") || EDITABLE_TEXT.has("tsv")).toBe(false);
  expect(viewerFor("contrato.pdf")).toBeUndefined();
  expect(viewerFor("nota.md")).toBeUndefined();
});

test("ler para o visualizador: pronto, grande demais, sem visualizador, sumiu e erro", async () => {
  const asked: [string, string][] = [];
  const file: FileContent = { path: "a.txt", size: 3, version: "v1", text: "abc" };
  const read = (answer: FileContent | Error) => async (path: string, as: "text" | "binary") => {
    asked.push([path, as]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  expect(await loadFile(read(file), "a.txt", text)).toEqual({ kind: "ready", file, viewer: text });
  expect(asked).toEqual([["a.txt", "text"]]);
  expect(await loadFile(read({ path: "a.pdf", size: 30, tooLarge: true, limit: 25 }), "a.pdf", binary)).toEqual({ kind: "tooLarge", size: 30, limit: 25 });
  expect(asked.at(-1)).toEqual(["a.pdf", "binary"]);
  // Sem visualizador, nada é lido.
  const before = asked.length;
  expect(await loadFile(read(file), "a.zip", undefined)).toEqual({ kind: "unsupported" });
  expect(asked.length).toBe(before);
  expect(await loadFile(read(Object.assign(new Error("no file"), { code: "E_NOT_FOUND" })), "a.txt", text)).toEqual({ kind: "missing" });
  expect(await loadFile(read(new Error("E_NOT_FOUND: no file a.txt")), "a.txt", text)).toEqual({ kind: "missing" });
  expect(await loadFile(read(new Error("boom")), "a.txt", text)).toEqual({ kind: "error" });
});
