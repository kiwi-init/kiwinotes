// A tela do Modelo de nota (spec #11102): mover um bloco muda só a ordem.
import { expect, test } from "bun:test";

import { DEFAULT_NOTE_MODEL } from "../../src/agent/note-model.ts";
import { moveBlock } from "./NoteModel.tsx";

test("mover um bloco muda só a ordem, e fora dos limites não muda nada", () => {
  const m = moveBlock(DEFAULT_NOTE_MODEL, 2, 0);
  expect(m.blocks.map((b) => b.block)).toEqual(["introducao", "titulo", "propriedades", "sumario", "corpo", "fechamento"]);
  expect(moveBlock(m, 0, 2).blocks).toEqual(DEFAULT_NOTE_MODEL.blocks);
  expect(moveBlock(DEFAULT_NOTE_MODEL, 0, 9)).toBe(DEFAULT_NOTE_MODEL);
  expect(m.body).toBe(DEFAULT_NOTE_MODEL.body);
});
