// A memória do agente (spec #11469, T11665): o arquivo legível, o limite de 60 fatos, o texto no começo do pedido e as
// ferramentas com o guardrail (o segredo é recusado; a dúvida passa pela pergunta antes de ser guardada).

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { DoubtAnswers } from "../guardrail/answers.ts";
import { SecretGuard } from "../guardrail/filter.ts";
import { DoubtQuestions } from "../guardrail/questions.ts";
import { tempDir } from "../../test/tmp.ts";
import { forgetFact, formatMemory, glossaryText, instructionsText, MEMORY_FILE, MEMORY_MAX, memoryText, parseMemory, readMemory, rememberFact, writeMemory } from "./memory.ts";
import { EMPTY_READER } from "./tools/reader.ts";
import { kiwiTools, runKiwiTool, type MemorySink } from "./tools/tools.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = tempDir("kn-memory-");
  dirs.push(d);
  return d;
};

const DOUBT = "Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya";
const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

describe("o arquivo da memória", () => {
  test("legível, um fato por linha, sem repetição; a pessoa pode editar à mão", () => {
    const root = tmp();
    expect(readMemory(root)).toEqual([]);
    expect(writeMemory(root, ["Prefere respostas curtas", "  trabalha   com PACS ", "prefere respostas curtas."])).toEqual([
      "Prefere respostas curtas",
      "trabalha com PACS",
    ]);
    const file = readFileSync(path.join(root, MEMORY_FILE), "utf8");
    expect(file).toBe(formatMemory(["Prefere respostas curtas", "trabalha com PACS"]));
    expect(file).toStartWith("# O que o agente sabe sobre você\n");
    // Uma linha à mão (com *), uma sem marcador (ignorada) e uma repetida.
    writeFileSync(path.join(root, MEMORY_FILE), `${file}* mora em Belo Horizonte\nlinha solta\n- Trabalha com PACS\n`);
    expect(readMemory(root)).toEqual(["Prefere respostas curtas", "trabalha com PACS", "mora em Belo Horizonte"]);
    expect(parseMemory(formatMemory(readMemory(root)))).toEqual(readMemory(root));
  });

  test("um arquivo que não dá para ler não vira memória vazia: o erro sobe e nada é gravado por cima (revisão do T11665)", () => {
    const root = tmp();
    writeMemory(root, ["fato 1", "fato 2", "fato 3"]);
    const file = path.join(root, MEMORY_FILE);
    const before = readFileSync(file, "utf8");
    chmodSync(file, 0o000);
    try {
      expect(() => readMemory(root)).toThrow(/não conseguiu ler a memória/);
      expect(() => writeMemory(root, rememberFact(readMemory(root), "fato novo").facts)).toThrow();
    } finally {
      chmodSync(file, 0o600);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
    // Uma pasta no lugar do arquivo também é erro, não memória vazia.
    const other = tmp();
    mkdirSync(path.join(other, MEMORY_FILE), { recursive: true });
    expect(() => readMemory(other)).toThrow(/não conseguiu ler a memória/);
  });

  test("anotar e esquecer: o repetido não entra, o cheio recusa, e esquecer acha sem maiúscula nem acento", () => {
    const r = rememberFact(["Prefere respostas curtas"], "prefere respostas curtas!");
    expect(r).toEqual({ facts: ["Prefere respostas curtas"], added: false, index: 0 });
    expect(rememberFact([], "usa o Mac")).toEqual({ facts: ["usa o Mac"], added: true, index: 0 });
    const full = Array.from({ length: MEMORY_MAX }, (_, i) => `fato ${i}`);
    expect(() => rememberFact(full, "mais um")).toThrow(/60 fatos/);
    expect(() => rememberFact([], "x".repeat(301))).toThrow(/300/);
    expect(forgetFact(["Mora em Ribeirão"], "mora em ribeirao")).toEqual({ facts: [], removed: "Mora em Ribeirão", index: 0 });
    expect(() => forgetFact([], "nada")).toThrow(/não está na memória/);
  });

  test("no começo do pedido: os mesmos bytes para os mesmos fatos, e nada sem fatos", () => {
    expect(memoryText([])).toBe("");
    const a = memoryText(["Prefere respostas curtas", "Trabalha com PACS"]);
    expect(a).toBe(memoryText(["Prefere respostas curtas", "Trabalha com PACS"]));
    expect(a).toBe(
      "[O que você sabe sobre a pessoa (a memória do Kiwi). Para anotar ou esquecer um fato, use memory_remember e memory_forget:\n- Prefere respostas curtas\n- Trabalha com PACS\n]\n\n",
    );
  });
});

describe("as ferramentas da memória", () => {
  function sink() {
    const root = tmp();
    mkdirSync(root, { recursive: true });
    const s: MemorySink = {
      remember: async (fact) => {
        const r = rememberFact(readMemory(root), fact);
        writeMemory(root, r.facts);
        return { added: r.added, total: r.facts.length };
      },
      forget: async (fact) => {
        const r = forgetFact(readMemory(root), fact);
        writeMemory(root, r.facts);
        return { removed: r.removed, total: r.facts.length };
      },
    };
    return { root, s };
  }

  test("só aparecem com quem guarda a memória; anotar e esquecer gravam no cofre", async () => {
    expect(kiwiTools(true, true).map((t) => t.name)).not.toContain("memory_remember");
    expect(kiwiTools(false, false, true).map((t) => t.name)).toEqual(expect.arrayContaining(["memory_remember", "memory_forget"]));
    await expect(runKiwiTool({ reader: EMPTY_READER }, "memory_remember", { fato: "x" })).rejects.toMatchObject({ code: "E_UNKNOWN_TOOL" });
    const { root, s } = sink();
    const r = await runKiwiTool({ reader: EMPTY_READER, memory: s }, "memory_remember", { fato: "prefere respostas curtas" });
    expect(r.value).toEqual({ anotado: "prefere respostas curtas", novo: true, total: 1 });
    expect(r.target).toBe("prefere respostas curtas");
    expect(readMemory(root)).toEqual(["prefere respostas curtas"]);
    expect((await runKiwiTool({ reader: EMPTY_READER, memory: s }, "memory_remember", { fato: "Prefere respostas curtas." })).value).toMatchObject({ novo: false });
    expect((await runKiwiTool({ reader: EMPTY_READER, memory: s }, "memory_forget", { fato: "prefere respostas curtas" })).value).toEqual({
      esquecido: "prefere respostas curtas",
      total: 0,
    });
    await expect(runKiwiTool({ reader: EMPTY_READER, memory: s }, "memory_forget", { fato: "nada" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("um segredo é recusado: o token no fato, e o marcador do filtro que o agente leu", async () => {
    const { root, s } = sink();
    const guard = new SecretGuard();
    await expect(runKiwiTool({ reader: EMPTY_READER, memory: s, guard }, "memory_remember", { fato: `o token do CI é ${GH}` })).rejects.toMatchObject({ code: "E_SECRET" });
    const marker = /‹segredo [^›]+›/.exec(guard.request(`token ${GH}`).text)![0];
    await expect(runKiwiTool({ reader: EMPTY_READER, memory: s, guard }, "memory_remember", { fato: `a chave é ${marker}` })).rejects.toMatchObject({ code: "E_SECRET" });
    expect(readMemory(root)).toEqual([]);
  });

  test("um trecho em dúvida passa pela pergunta à pessoa antes de ser guardado", async () => {
    const answers = new DoubtAnswers(tmp());
    const questions = new DoubtQuestions({ answers });
    const decider = { answers, questions, request: "p1" };
    const ctx = { reader: EMPTY_READER, memory: sink().s, guard: new SecretGuard(), decider };
    // "É segredo": não anota.
    const held = runKiwiTool(ctx, "memory_remember", { fato: `o código do armário é ${DOUBT}` });
    await Bun.sleep(5);
    const card = questions.current()!;
    expect(card.items.map((i) => i.value)).toEqual([DOUBT]);
    questions.answer(card.id, card.items[0]!.fingerprint, "hold");
    await expect(held).rejects.toMatchObject({ code: "E_SECRET" });
    // "Pode mandar" (a resposta fica guardada): anota.
    answers.set(answers.fingerprint(DOUBT), "send", "m", "random");
    expect((await runKiwiTool(ctx, "memory_remember", { fato: `o código do armário é ${DOUBT}` })).value).toMatchObject({ novo: true });
  });
});

describe("as instruções e o glossário (T11667)", () => {
  test("as instruções da pessoa: o texto como está, até 2.000 caracteres; sem texto, nada", () => {
    expect(instructionsText("  ")).toBe("");
    expect(instructionsText("Sempre em português.\r\nNão mexa na pasta Arquivo.")).toBe(
      "[As instruções da pessoa para você (Ajustes › Agente). Siga sempre:\nSempre em português.\nNão mexa na pasta Arquivo.\n]\n\n",
    );
    expect(instructionsText("x".repeat(2500))).toContain("x".repeat(2000) + "\n]");
    expect(instructionsText("x".repeat(2500))).not.toContain("x".repeat(2001));
  });

  test("o glossário: só os termos, na ordem, sem repetir; no modo econômico, só os que aparecem no pedido", () => {
    const terms = ["DICOM", "kubectl", "Healthcare API", "dicom", "a]b"];
    expect(glossaryText([])).toBe("");
    expect(glossaryText(terms)).toBe("[O glossário da pessoa: escreva estes termos assim. DICOM; kubectl; Healthcare API; a b]\n\n");
    expect(glossaryText(terms)).toBe(glossaryText([...terms]));
    expect(glossaryText(terms, "Migre os estudos dicom pela healthcare api")).toBe("[O glossário da pessoa: escreva estes termos assim. DICOM; Healthcare API]\n\n");
    expect(glossaryText(terms, "nada a ver")).toBe("");
  });
});
