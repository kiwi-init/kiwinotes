// Os textos da seção "Atividade do agente" (spec #9480): as horas, o resumo do que o agente leu, cada mudança, os avisos
// do [Ver] e as respostas do [Desfazer] nos sete casos, em palavras simples (nenhum código na tela).

import { describe, expect, test } from "bun:test";

import type { AgentChangeView, AgentUndoNote } from "../../src/shared/ui-contract.ts";
import { changeLine, doubtLine, goneRequest, heldLines, hourOf, removedLine, noteName, openChanges, readsLine, requestLine, undoLine, undoneLine, viewNotice, whenOf, memoryLines } from "./activityText.ts";

/** Uma hora local, em ISO: os testes não dependem do fuso da máquina. */
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m).toISOString();
const NOW = new Date(2026, 10, 13, 18, 0).getTime();

describe("a seção Atividade do agente: os textos", () => {
  test("as horas: hoje, ontem e o dia", () => {
    expect(hourOf(at(13, 14, 32))).toBe("14:32");
    expect(whenOf(at(13, 9, 5), NOW)).toBe("hoje, 09:05");
    expect(whenOf(at(12, 23, 59), NOW)).toBe("ontem, 23:59");
    expect(whenOf(at(2, 8, 0), NOW)).toBe("2 nov, 08:00");
    expect(undoneLine(at(13, 14, 32), NOW)).toBe("Desfeito às 14:32");
    expect(undoneLine(at(12, 14, 32), NOW)).toBe("Desfeito ontem, às 14:32");
    expect(undoneLine(at(2, 14, 32), NOW)).toBe("Desfeito em 2 nov, às 14:32");
  });

  test("o que o agente leu, resumido; um pedido que não leu nada também diz", () => {
    const t = at(13, 10, 0);
    expect(readsLine([])).toBe("Não leu nenhuma nota.");
    expect(readsLine([{ at: t, tool: "notes_read", target: "Kiwi.md" }])).toBe("Leu 1 nota.");
    expect(
      readsLine([
        { at: t, tool: "notes_read", target: "Kiwi.md" },
        { at: t, tool: "notes_outline", target: "Kiwi.md" },
        { at: t, tool: "notes_read", target: "Ideias.md" },
        { at: t, tool: "notes_search", target: '"prazo"' },
        { at: t, tool: "notes_search", target: '"março"' },
        { at: t, tool: "meetings_get", target: "Reuniões/2026-11-12.md" },
        { at: t, tool: "notes_list" },
      ]),
    ).toBe("Leu 2 notas, leu 1 reunião, procurou 2 vezes e listou as notas.");    // Os projetos (spec #9874): os vistos, sem repetir, e a lista.
    expect(
      readsLine([
        { at: t, tool: "projects_list", target: "os projetos" },
        { at: t, tool: "project_status", target: "Kiwi" },
        { at: t, tool: "project_status", target: "Kiwi" },
        { at: t, tool: "project_status", target: "Acme" },
      ]),
    ).toBe("Viu 2 projetos e listou os projetos.");
  });

  test("cada mudança: o verbo, a nota sem o .md e a seção", () => {
    expect(noteName("Projetos/Kiwi.md")).toBe("Projetos/Kiwi");
    expect(requestLine("\n  Mude o prazo para abril \n/tool notes_write {}")).toBe("Mude o prazo para abril");
    expect(requestLine("")).toBe("");
    expect(changeLine({ kind: "created", path: "Projetos/Resumo.md" })).toBe("Criou Projetos/Resumo");
    expect(changeLine({ kind: "appended", path: "Ideias.md" })).toBe("Acrescentou em Ideias");
    expect(changeLine({ kind: "replaced", path: "Projetos/Kiwi.md", section: "Prazo" })).toBe("Trocou Projetos/Kiwi › Prazo");
    const c = { at: at(13, 10, 0), kind: "appended" as const, path: "a.md", before: 1, after: 2, version: "v" };
    expect(openChanges({ id: "p", at: c.at, request: "", reads: [], changes: [c, { ...c, undone: c.at }] })).toBe(1);
  });

  test("os avisos do [Ver]: criada, mudada depois, sumiu, outra pasta, desfeita e sem a cópia", () => {
    const base: AgentChangeView = { request: "p", change: 1, path: "Kiwi.md", kind: "replaced", at: at(13, 10, 0), before: "a", state: "exact", after: "b" };
    expect(viewNotice(base)).toBeNull();
    expect(viewNotice({ ...base, kind: "created", before: "" })).toBe("A nota que o agente criou.");
    expect(viewNotice({ ...base, state: "changed" })).toContain("mudou depois do agente");
    expect(viewNotice({ ...base, state: "gone", after: undefined })).toContain("renomeada, movida ou apagada");
    expect(viewNotice({ ...base, state: "otherFolder", after: undefined })).toContain("outra pasta de notas");
    const undone = viewNotice({ ...base, state: "undone", after: undefined, undone: new Date().toISOString() })!;
    expect(undone).toMatch(/^Desfeito às \d\d:\d\d\. /);
    expect(undone).toContain("nas Versões da nota");
    expect(viewNotice({ ...base, state: "gone", before: null, after: undefined })).toContain("não está mais guardada");
    expect(viewNotice({ ...base, before: null })).toContain("só o texto que o agente deixou");
  });

  test("o [Desfazer] em palavras simples: o que voltou, e os sete casos em que nada muda", () => {
    const n = (o: Partial<AgentUndoNote>): AgentUndoNote => ({ path: "Projetos/Kiwi.md", result: "refused", changes: [1], ...o });
    expect(undoLine(n({ result: "restored" }), "p", NOW)).toBe("Projetos/Kiwi voltou ao texto de antes.");
    expect(undoLine(n({ result: "trashed", path: "Resumo.md" }), "p", NOW)).toContain("Resumo foi para a Lixeira");
    const lines = [
      undoLine(n({ reason: "E_CHANGED" }), "p", NOW),
      undoLine(n({ reason: "E_GONE" }), "p", NOW),
      undoLine(n({ reason: "E_LATER_WRITE", later: { request: "p2", change: 1, at: at(13, 14, 32) } }), "p", NOW),
      undoLine(n({ reason: "E_OTHER_FOLDER" }), "p", NOW),
      undoLine(n({ reason: "E_EXPIRED" }), "p", NOW),
      undoLine(n({ reason: "E_NO_COPY" }), "p", NOW),
      undoLine(n({ result: "already" }), "p", NOW),
    ];
    expect(lines[0]).toContain("mudou depois do agente");
    expect(lines[1]).toContain("renomeada, movida ou apagada");
    // A escrita mais nova num outro pedido: pela hora dele, nunca pelo id.
    expect(lines[2]).toBe("O agente escreveu de novo em Projetos/Kiwi no pedido de hoje, 14:32. Desfaça antes aquele pedido. Nada mudou.");
    expect(lines[3]).toContain("outra pasta de notas");
    expect(lines[4]).toContain("mais de 30 dias");
    expect(lines[5]).toContain("não está mais guardada");
    expect(lines[6]).toContain("já tinha sido desfeita");
    // Nada de código nem de id na tela.
    for (const l of lines) expect(l).not.toMatch(/E_[A-Z_]+|p2/);
    // O pedido que passou dos 30 dias com a tela aberta: pela hora dele.
    expect(goneRequest(at(13, 10, 48), NOW)).toBe("O pedido de hoje, 10:48 passou dos 30 dias: não há mais o que desfazer.");
    expect(goneRequest(undefined, NOW)).toBe("Esse pedido passou dos 30 dias: não há mais o que desfazer.");
    // A escrita mais nova no mesmo pedido.
    expect(undoLine(n({ reason: "E_LATER_WRITE", later: { request: "p", change: 2, at: at(13, 14, 0) } }), "p", NOW)).toContain("neste mesmo pedido");
  });

  test("o filtro do guardrail (spec #9818): quantos segredos o Kiwi segurou, por lugar, e a mudança que tirou um", () => {
    const t = at(13, 10, 0);
    expect(heldLines({ reads: [], requestHeld: 0 })).toEqual([]);
    expect(
      heldLines({
        requestHeld: 1,
        reads: [
          { at: t, tool: "notes_read", target: "Projetos/Kiwi.md", held: 2 },
          { at: t, tool: "notes_read", target: "Projetos/Kiwi.md › Acessos", held: 1 },
          { at: t, tool: "notes_search", target: '"senha"', held: 3 },
          { at: t, tool: "notes_read", target: "Ideias.md" },
        ],
      }),
    ).toEqual(["O Kiwi segurou 1 segredo no pedido.", "O Kiwi segurou 2 segredos em Projetos/Kiwi.", "O Kiwi segurou 3 segredos nos resultados da busca."]);
    expect(removedLine(1)).toBe("Esta mudança tirou 1 segredo da nota. O Desfazer o traz de volta, e o texto de antes está nas Versões.");
  });

  test("a dúvida sem resposta (spec #9873): onde e a máscara, nunca o trecho", () => {
    expect(doubtLine({ path: "Projetos/Kiwi.md", line: 4, mask: "•••• (32 caracteres)" })).toBe(
      "O Kiwi ficou em dúvida em Projetos/Kiwi, linha 4 (•••• (32 caracteres)) e segurou desta vez.",
    );
    expect(doubtLine({ path: "", line: 1, mask: "•••• (32 caracteres)" })).toContain("no seu pedido");
  });
});

test("a memória do agente (spec #11469) na Atividade: uma linha por fato anotado ou tirado, e não é leitura de nota", () => {
  const reads = [
    { at: "2026-11-13T23:00:00.000Z", tool: "memory_remember", target: "prefere respostas curtas" },
    { at: "2026-11-13T23:00:01.000Z", tool: "memory_forget", target: "usa o Windows" },
  ];
  expect(memoryLines(reads)).toEqual(["Anotou na memória: “prefere respostas curtas”.", "Tirou da memória: “usa o Windows”."]);
  expect(readsLine(reads)).toBe("");
  expect(readsLine([...reads, { at: "2026-11-13T23:00:02.000Z", tool: "notes_read", target: "Ideias.md" }])).toBe("Leu 1 nota.");
});
