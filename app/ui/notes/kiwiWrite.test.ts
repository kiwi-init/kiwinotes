// T20869 (spec #20843): a janela anima a escrita do Kiwi só quando ela fecha com o disco; senão, recarrega como antes.
import { describe, expect, test } from "bun:test";

import { KiwiWrites, kiwiPlan } from "./kiwiWrite.ts";
import type { AgentWrote } from "./types.ts";

const fm = "---\nprojeto: exemplo\n---\n";
const before = `${fm}# Viagem\n\nLevar mapa.\n`;
const at = before.indexOf("mapa");
const after = `${fm}# Viagem\n\nLevar mapa e lanterna.\n`;
const event: AgentWrote = {
  path: "Viagem.md",
  baseVersion: "v1",
  version: "v2",
  turnId: "t1",
  edits: [{ from: at + 4, to: at + 4, removed: "", inserted: " e lanterna" }],
};

describe("o plano", () => {
  test("a escrita que fecha com o disco vira trechos no corpo (sem o frontmatter)", () => {
    const plan = kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v2" }, event);
    expect(plan).not.toBeNull();
    expect(plan!.before).toBe("# Viagem\n\nLevar mapa.\n");
    expect(plan!.final).toBe("# Viagem\n\nLevar mapa e lanterna.\n");
    expect(plan!.edits[0]!.from).toBe(at + 4 - fm.length);
  });

  test("recarrega como antes: outra versão aberta, disco diferente, frontmatter mexido ou arquivo sem trechos", () => {
    expect(kiwiPlan({ content: before, version: "v0" }, { content: after, version: "v2" }, event)).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after + "mais\n", version: "v2" }, event)).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v3" }, event)).toBeNull();
    const fmEdit: AgentWrote = { ...event, edits: [{ from: 4, to: 11, removed: "projeto", inserted: "tema" }] };
    expect(kiwiPlan({ content: before, version: "v1" }, { content: before.replace("projeto", "tema"), version: "v2" }, fmEdit)).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v2" }, { path: "Viagem.md" })).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v2" }, null)).toBeNull();
  });
});

describe("as escritas esperando a recarga", () => {
  test("cada uma sai uma vez, pela versão nova", () => {
    const w = new KiwiWrites();
    w.add(event);
    expect(w.take("Viagem.md", "v1")).toBeNull();
    expect(w.take("Viagem.md", "v2")).toEqual(event);
    expect(w.take("Viagem.md", "v2")).toBeNull();
  });

  test("arquivo sem trechos não fica guardado, e a lista não cresce sem fim", () => {
    const w = new KiwiWrites();
    w.add({ path: "planilha.xlsx", version: "v9" });
    expect(w.take("planilha.xlsx", "v9")).toBeNull();
    for (let i = 0; i < 100; i++) w.add({ ...event, version: `x${i}` });
    expect(w.take("Viagem.md", "x0")).toBeNull();
    expect(w.take("Viagem.md", "x99")).not.toBeNull();
  });
});
