// A confirmação da pessoa no cartão da dúvida (spec #11102, o "organizar a pasta inteira"): vale só para aquele
// pedido. Nunca é lembrada, nunca vira pendência, e o prazo sem resposta conta como "Agora não" (lead, #11306).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { runKiwiTool } from "../agent/tools/tools.ts";
import type { VaultReader } from "../agent/tools/reader.ts";
import { DoubtAnswers } from "./answers.ts";
import { CONFIRM_KIND, DoubtQuestions } from "./questions.ts";

function rig(timeoutMs = 2000) {
  const dir = tempDir("kiwi-confirm-");
  const answers = new DoubtAnswers(dir);
  const pending: unknown[] = [];
  const q = new DoubtQuestions({ answers, timeoutMs, onPending: (_r, items) => pending.push(...items) });
  return { dir, answers, q, pending };
}

/** Responde ao cartão aberto assim que ele aparece. */
async function answerWhenOpen(q: DoubtQuestions, answer: "send" | "hold") {
  for (let i = 0; i < 100 && !q.current(); i++) await Bun.sleep(5);
  const card = q.current()!;
  expect(card.items).toHaveLength(1);
  expect(card.items[0]!.kind).toBe(CONFIRM_KIND);
  q.answer(card.id, card.items[0]!.fingerprint, answer);
  return card.items[0]!;
}

describe("a confirmação no cartão (spec #11102)", () => {
  test("Organizar dá sim, e Agora não dá não; a pergunta aparece no cartão", async () => {
    const { q } = rig();
    const yes = q.confirm("r1", "Organizar 3 notas em Projetos/ pelo Modelo de nota?");
    const item = await answerWhenOpen(q, "send");
    expect(item.value).toBe("Organizar 3 notas em Projetos/ pelo Modelo de nota?");
    expect(await yes).toBe(true);
    const no = q.confirm("r1", "Organizar 3 notas em Projetos/ pelo Modelo de nota?");
    await answerWhenOpen(q, "hold");
    expect(await no).toBe(false);
  });

  test("um Organizar nunca é lembrado: a mesma pasta, no pedido seguinte, pergunta de novo", async () => {
    const { q, answers, dir } = rig();
    const first = q.confirm("r1", "Organizar 3 notas em Projetos/ pelo Modelo de nota?");
    const item = await answerWhenOpen(q, "send");
    expect(await first).toBe(true);
    // Nada foi guardado na memória das respostas da dúvida.
    expect(answers.get(item.fingerprint)).toBeNull();
    expect(existsSync(path.join(dir, "guardrail-answers.json"))).toBe(false);
    // O pedido seguinte, a mesma pergunta: o cartão abre de novo, e sem resposta não segue.
    const again = q.confirm("r2", "Organizar 3 notas em Projetos/ pelo Modelo de nota?");
    for (let i = 0; i < 100 && !q.current(); i++) await Bun.sleep(5);
    expect(q.current()?.items[0]?.answer).toBeUndefined();
    q.cancel("r2");
    expect(await again).toBe(false);
  });

  test("o prazo sem resposta conta como Agora não, e não vira pendência na Atividade", async () => {
    const { q, pending } = rig(40);
    expect(await q.confirm("r1", "Organizar 3 notas em Projetos/ pelo Modelo de nota?")).toBe(false);
    expect(pending).toEqual([]);
    expect(q.current()).toBeNull();
  });

  test("a ferramenta notes_organize_folder: conta, pergunta, e só com o sim devolve as notas", async () => {
    const { q } = rig();
    const reader = {
      list: async () => ({
        folders: ["Projetos", "Projetos/Kiwi", "Outros"],
        notes: [
          { path: "Projetos/A.md", folder: "Projetos", title: "A", size: 1, mtime: "" },
          { path: "Projetos/Kiwi/B.md", folder: "Projetos/Kiwi", title: "B", size: 1, mtime: "" },
          { path: "Outros/C.md", folder: "Outros", title: "C", size: 1, mtime: "" },
        ],
      }),
    } as unknown as VaultReader;
    const ctx = { reader, writer: {} as never, decider: { answers: new DoubtAnswers(tempDir("kiwi-confirm-")), questions: q, request: "r1" } };
    const run = runKiwiTool(ctx, "notes_organize_folder", { folder: "Projetos" });
    const item = await answerWhenOpen(q, "send");
    expect(item.value).toBe("Organizar 2 notas em Projetos/ pelo Modelo de nota?");
    expect((await run).value).toEqual({ pasta: "Projetos", total: 2, confirmou: true, notas: ["Projetos/A.md", "Projetos/Kiwi/B.md"] });
    const refused = runKiwiTool(ctx, "notes_organize_folder", { folder: "Projetos" });
    await answerWhenOpen(q, "hold");
    const r = (await refused).value as { confirmou: boolean; notas?: string[] };
    expect(r.confirmou).toBe(false);
    expect(r.notas).toBeUndefined();
    // Sem o escritor, a ferramenta nem existe; sem quem pergunte, é não.
    await expect(runKiwiTool({ reader }, "notes_organize_folder", { folder: "Projetos" })).rejects.toMatchObject({ code: "E_UNKNOWN_TOOL" });
    expect(((await runKiwiTool({ reader, writer: {} as never }, "notes_organize_folder", { folder: "Projetos" })).value as { confirmou: boolean }).confirmou).toBe(false);
  });
});
