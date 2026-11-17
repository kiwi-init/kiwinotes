import { describe, expect, test } from "bun:test";

import { closest, matchScore, nameKey, nearSections, noteCard, noteNamed, SIMILAR_MIN, similarity } from "./find.ts";

const note = (path: string, title = path.split("/").pop()!.replace(/\.(md|txt)$/, "")) => ({ path, title, folder: path.split("/").slice(0, -1).join("/"), size: 120, mtime: "2026-11-10T12:00:00.000Z" });

describe("os nomes (ADR 0013 peça 3, T14133)", () => {
  test("a chave: sem acento, maiúscula, espaço, -, _, . e a extensão", () => {
    expect(nameKey("Plano de Migração.md")).toBe("planodemigracao");
    expect(nameKey("plano-de_migracao")).toBe(nameKey("PLANO DE MIGRAÇÃO"));
    expect(nameKey("anotacoes.txt")).toBe("anotacoes");
  });

  test("o parecido aguenta o nome do ditado e separa o que não tem nada a ver", () => {
    expect(similarity("Rede Norte", "rede norte")).toBe(1);
    expect(matchScore("rêde nórti", ["Rede Norte"])).toBeGreaterThan(0.8);
    expect(matchScore("relatório quê um", ["Relatório Q1"])).toBeGreaterThan(0.7);
    expect(matchScore("portau clientis", ["Portal Clientes"])).toBeGreaterThan(0.6);
    expect(matchScore("relatório quê um", ["Ideias de viagem"])).toBeLessThan(SIMILAR_MIN);
    // Um nome que contém o pedido inteiro conta quase como igual.
    expect(matchScore("compras", ["Lista de compras"])).toBeGreaterThan(0.5);
  });

  test("closest: os k melhores, só acima do mínimo, do melhor para o pior", () => {
    const names = ["Relatório Q1", "Relatório Q1 rascunho", "Ideias de viagem", "Rotina da equipe"];
    const r = closest(names, "relatorio q1", (n) => [n], 3);
    expect(r.map((x) => x.item)).toEqual(["Relatório Q1", "Relatório Q1 rascunho"]);
    expect(r[0]!.score).toBe(1);
  });
});

describe("noteNamed", () => {
  const notes = [note("Trabalho/Plano de Migração.md"), note("Projetos/Kiwi.md"), note("Outra/kiwi.md"), note("Pessoal/anotacoes.txt")];
  test("o caminho exato, o nome único, a pasta errada com o nome certo, e o .txt pelo nome", () => {
    expect(noteNamed(notes, "Projetos/Kiwi.md")).toEqual({ note: notes[1] });
    expect(noteNamed(notes, "plano de migracao")).toEqual({ note: notes[0] });
    expect(noteNamed(notes, "Errada/Plano de Migração.md")).toEqual({ note: notes[0] });
    expect(noteNamed(notes, "anotacoes.md")).toEqual({ note: notes[3] });
  });
  test("dois com o mesmo nome: ambíguo; nenhum: os parecidos", () => {
    expect(noteNamed(notes, "kiwi")).toEqual({ ambiguous: [notes[1], notes[2]] });
    expect(noteNamed(notes, "plano de migrasão legado")).toEqual({ near: [notes[0]] });
    expect(noteNamed(notes, "zzzqqq")).toEqual({ near: [] });
  });
  test("o cartão e as seções parecidas", () => {
    expect(noteCard(notes[0]!)).toBe('Trabalho/Plano de Migração.md ("Plano de Migração", 120 caracteres, mudou em 2026-11-10)');
    expect(nearSections(["Prazo", "Riscos", "Equipe"], "Risco")).toEqual(["Riscos"]);
    // Nada parecido: os primeiros títulos, para o agente escolher.
    expect(nearSections(["Prazo", "Riscos"], "zzz")).toEqual(["Prazo", "Riscos"]);
  });
});
