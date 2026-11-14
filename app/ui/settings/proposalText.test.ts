// Os textos da proposta da reunião (spec #8360, T11293), estado por estado.

import { describe, expect, test } from "bun:test";

import type { AgentProposalSummary } from "../../src/shared/ui-contract.ts";
import { choiceJoin, mainDiff, openProposals, proposalLine, whereLine } from "./proposalText.ts";

const base: AgentProposalSummary = {
  id: "p1",
  at: "2026-11-11T12:00:00.000Z",
  status: "pending",
  kind: "meeting",
  meeting: { path: "Reuniões/2026-11-11 10h00 Zoom.md", title: "2026-11-11 10h00 Zoom", date: "2026-11-11" },
  project: { folder: "Projetos/Migração", name: "Migração" },
  candidates: [],
  theme: "Cronograma",
  note: { folder: "Projetos/Migração", title: "2026-11-11 · Cronograma" },
};

describe("a proposta na tela", () => {
  test("a frase de cada estado, e onde a nota vai", () => {
    expect(proposalLine(base)).toBe('A proposta da reunião “2026-11-11 10h00 Zoom” está pronta: a nota “2026-11-11 · Cronograma” em Migração, e a reunião na nota principal.');
    expect(proposalLine({ ...base, project: null, note: { ...base.note!, folder: "" } })).toBe(
      'A proposta da reunião “2026-11-11 10h00 Zoom” está pronta: a nota “2026-11-11 · Cronograma” na pasta principal.',
    );
    expect(whereLine({ ...base, note: { ...base.note!, folder: "Atas" } })).toBe("em Atas");
    expect(proposalLine({ ...base, status: "offer", theme: "" })).toBe(
      'A reunião “2026-11-11 10h00 Zoom” terminou. Quer a proposta da nota do projeto? Ela gasta um pedido do seu plano.',
    );
    expect(proposalLine({ ...base, status: "applied" })).toBe('Pronto: a nota “2026-11-11 · Cronograma” está em Migração.');
    // Em dúvida: a frase curta, e a pergunta com os nomes vem do choiceJoin.
    expect(proposalLine({ ...base, project: null, candidates: [{ folder: "a", name: "A" }, { folder: "b", name: "B" }] })).toBe(
      'A proposta da reunião “2026-11-11 10h00 Zoom” está pronta.',
    );
    expect(["A", "B", "C"].map((n, i) => `${choiceJoin(i, 3)}${n}`).join("")).toBe("A, do B ou do C");
    expect(["A", "B"].map((n, i) => `${choiceJoin(i, 2)}${n}`).join("")).toBe("A ou do B");
  });

  test("as abertas: a pergunta e a pronta, da mais nova para a mais velha", () => {
    const list = [
      { ...base, id: "velha", at: "2026-11-10T10:00:00.000Z" },
      { ...base, id: "aplicada", status: "applied" as const },
      { ...base, id: "nova", status: "offer" as const, at: "2026-11-12T10:00:00.000Z" },
      { ...base, id: "fora", status: "discarded" as const },
    ];
    expect(openProposals(list).map((p) => p.id)).toEqual(["nova", "velha"]);
  });

  test("a diferença na nota principal: as linhas novas, 2 em volta, o resto recolhido, sem a linha vazia do fim", () => {
    const lines = ["# P", "a", "b", "c", "d", "e", "## Pendências", "- [ ] x", "- [ ] nova", ""].map((text) => ({ text, added: text === "- [ ] nova" }));
    expect(mainDiff(lines)).toEqual([
      { kind: "gap", count: 6 },
      { kind: "same", text: "## Pendências" },
      { kind: "same", text: "- [ ] x" },
      { kind: "add", text: "- [ ] nova" },
    ]);
  });
});
