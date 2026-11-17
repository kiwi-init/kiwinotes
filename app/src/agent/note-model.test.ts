// O Modelo de nota (spec #11102): o arquivo legível, o padrão, a sanidade e as instruções sempre iguais.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import {
  DEFAULT_NOTE_MODEL,
  formatNoteModel,
  NOTE_MODEL_FILE,
  noteModelText,
  parseNoteModel,
  readNoteModel,
  sanitizeNoteModel,
  writeNoteModel,
} from "./note-model.ts";

const custom = sanitizeNoteModel({
  blocks: [
    { block: "titulo", on: true },
    { block: "introducao", on: true },
    { block: "sumario", on: false },
    { block: "corpo", on: true },
    { block: "fechamento", on: true },
    { block: "propriedades", on: true },
  ],
  body: "topicos",
  numbered: true,
  tocDepth: 3,
});

describe("o Modelo de nota", () => {
  test("sem o arquivo, vale o padrão do spec: título, propriedades, introdução, sumário, corpo misto e fechamento", () => {
    const root = tempDir("kiwi-note-model-");
    expect(readNoteModel(root)).toEqual(DEFAULT_NOTE_MODEL);
    expect(DEFAULT_NOTE_MODEL.blocks.map((b) => b.block)).toEqual(["titulo", "propriedades", "introducao", "sumario", "corpo", "fechamento"]);
    expect(DEFAULT_NOTE_MODEL.body).toBe("misto");
  });

  test("grava num arquivo legível do cofre e lê de volta igual; nenhuma nota é tocada", () => {
    const root = tempDir("kiwi-note-model-");
    writeFileSync(path.join(root, "Ideias.md"), "# Ideias\n");
    writeNoteModel(root, custom);
    const text = readFileSync(path.join(root, NOTE_MODEL_FILE), "utf8");
    expect(text).toContain("- propriedades: ligado");
    expect(text).toContain("- sumario: desligado");
    expect(text).toContain("corpo: topicos");
    expect(text).toContain("titulos: numerados=sim");
    expect(readNoteModel(root)).toEqual(custom);
    expect(readFileSync(path.join(root, "Ideias.md"), "utf8")).toBe("# Ideias\n");
    expect(existsSync(path.join(root, `${NOTE_MODEL_FILE}.tmp`))).toBe(false);
  });

  test("o mesmo modelo dá os mesmos bytes, no arquivo e nas instruções do agente", () => {
    expect(formatNoteModel(custom)).toBe(formatNoteModel(parseNoteModel(formatNoteModel(custom))));
    expect(noteModelText(custom)).toBe(noteModelText(sanitizeNoteModel(JSON.parse(JSON.stringify(custom)))));
    expect(noteModelText(custom)).not.toBe(noteModelText(DEFAULT_NOTE_MODEL));
  });

  test("as instruções seguem a ordem e os blocos ligados, e dizem o que não criar", () => {
    const t = noteModelText(custom);
    const order = ["o título", "uma introdução", "o corpo, em tópicos", "o fechamento", "as propriedades"].map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain("Não crie: o sumário.");
    expect(t).toContain("Títulos numerados");
    expect(t).not.toContain("O sumário desce");
  });

  test("um arquivo estranho ou estragado cai no padrão, sem quebrar", () => {
    const root = tempDir("kiwi-note-model-");
    mkdirSync(path.join(root, ".kiwi"), { recursive: true });
    writeFileSync(path.join(root, NOTE_MODEL_FILE), "qualquer coisa\n- titulo: talvez\n");
    expect(readNoteModel(root)).toEqual(DEFAULT_NOTE_MODEL);
    // Repetidos, desconhecidos e faltando: os seis blocos sempre, sem repetição; o que falta entra no fim, ligado.
    const m = sanitizeNoteModel({ blocks: [{ block: "corpo", on: false }, { block: "corpo", on: true }, { block: "x" }], body: "nada", tocDepth: 9 });
    expect(m.blocks[0]).toEqual({ block: "corpo", on: false });
    expect(m.blocks.map((b) => b.block).sort()).toEqual([...DEFAULT_NOTE_MODEL.blocks.map((b) => b.block)].sort());
    expect(m.body).toBe("misto");
    expect(m.tocDepth).toBe(2);
  });
});
