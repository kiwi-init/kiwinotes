// Os pedidos das rotinas (spec #12150).

import { expect, test } from "bun:test";

import { routineNoteChange, routineNoteTitle, routinePrompt } from "./routines.ts";

test("a nota da rotina entre as mudanças do pedido: a primeira .md criada, com a posição contada de 1 (revisão do #479)", () => {
  expect(routineNoteChange([{ kind: "created", path: "Rotinas/Resumo de 16-11-2026.md" }])).toEqual({ note: "Rotinas/Resumo de 16-11-2026.md", change: 1 });
  // O agente escreveu outra coisa antes: o [Ver] abre a 3ª mudança, não a 1ª.
  expect(
    routineNoteChange([
      { kind: "appended", path: "Kiwi/Kiwi.md" },
      { kind: "created", path: "Saída/tabela.csv" },
      { kind: "created", path: "Rotinas/Resumo de 16-11-2026.md" },
    ]),
  ).toEqual({ note: "Rotinas/Resumo de 16-11-2026.md", change: 3 });
  expect(routineNoteChange([{ kind: "replaced", path: "Kiwi/Kiwi.md" }])).toBeNull();
  expect(routineNoteChange([])).toBeNull();
});

test("o pedido diz a nota e a pasta; o título leva a data com hífen", () => {
  const now = new Date(2026, 10, 16, 18);
  expect(routineNoteTitle("daily", now)).toBe("Resumo de 16-11-2026");
  expect(routineNoteTitle("weekly", now)).toBe("Pendentes da semana de 16-11-2026");
  expect(routinePrompt("daily", "Diário/Resumos", now)).toContain('notes_create a nota "Resumo de 16-11-2026" na pasta "Diário/Resumos"');
});
