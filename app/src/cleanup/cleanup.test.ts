import { describe, expect, test } from "bun:test";

import { compileDictionary } from "./dictionary.ts";
import { fixtures } from "./fixtures.ts";
import { cleanup, cleanupWithRules, llmSystemMessage, rulesDroppedTooMuch, toneFor } from "./index.ts";
import { languageOf, maxTokensFor, rejectReason } from "./llm.ts";
import { filterOutput } from "./outputFilter.ts";
import { MAX_VOCABULARY_TERMS } from "./prompts.ts";
import { sidecarLlm } from "./sidecar.ts";
import type { LlmBackend, LlmRequest } from "./types.ts";

describe("fixtures (só regras)", () => {
  for (const f of fixtures) {
    test(f.name, () => {
      expect(cleanupWithRules({ raw: f.raw, bundleId: f.bundleId, tone: f.tone, dictionary: f.dictionary }).text).toBe(f.expected);
    });
  }
});

describe("trava das regras (#241)", () => {
  test("perder mais de 40% das palavras de conteúdo dispara", () => {
    expect(rulesDroppedTooMuch("Se não for usar, apaga isso do servidor.", "")).toBe(true);
    expect(rulesDroppedTooMuch("O deploy do servidor de produção quebrou ontem", "O deploy.")).toBe(true);
    // Uma palavra só a menos (25%) fica abaixo da trava: esse caso é coberto pela fixture, não por ela.
    expect(rulesDroppedTooMuch("O desempenho ficou igual ou melhor que antes.", "O desempenho ficou que antes.")).toBe(false);
  });
  test("muletas e correções não contam", () => {
    expect(rulesDroppedTooMuch("me encontra às três, não, quer dizer, às quatro", "Me encontra às quatro.")).toBe(false);
    expect(rulesDroppedTooMuch("first, buy milk, second, call mom", "1. Buy milk\n2. Call mom")).toBe(false);
  });
  test("frase curta não dispara", () => {
    expect(rulesDroppedTooMuch("hum ok", "Ok.")).toBe(false);
  });
});

describe("tom pelo app", () => {
  test("bundle ids conhecidos", () => {
    expect(toneFor("com.tinyspeck.slackmacgap")).toBe("casual");
    expect(toneFor("com.microsoft.Outlook")).toBe("formal");
    expect(toneFor("com.googlecode.iterm2")).toBe("literal");
    expect(toneFor("com.jetbrains.intellij")).toBe("literal");
    expect(toneFor("com.apple.Notes")).toBe("default");
    expect(toneFor(undefined)).toBe("default");
  });
});

function fakeLlm(answer: string | ((req: LlmRequest) => string), opts: { delayMs?: number; available?: boolean } = {}) {
  const calls: LlmRequest[] = [];
  const backend: LlmBackend = {
    name: "fake",
    available: () => opts.available ?? true,
    complete: (req, signal) =>
      new Promise((resolve, reject) => {
        calls.push(req);
        const t = setTimeout(() => resolve(typeof answer === "function" ? answer(req) : answer), opts.delayMs ?? 0);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      }),
  };
  return { backend, calls };
}

describe("LLM por cima das regras", () => {
  const raw = "oi ana, segue o relatório do pacs em anexo, qualquer dúvida me avisa";
  const dictionary = ["PACS"];
  const MAIL = "com.apple.mail";

  test("modo off (padrão) nunca chama o LLM", async () => {
    const { backend, calls } = fakeLlm("x");
    const r = await cleanup({ raw, bundleId: MAIL, dictionary }, { llm: backend });
    expect(calls).toHaveLength(0);
    expect(r.llm).toBeUndefined();
    expect(r.text).toBe("Oi ana, segue o relatório do PACS em anexo, qualquer dúvida me avisa.");
  });

  test("auto: no e-mail usa a saída do LLM e manda os termos no prompt", async () => {
    const polished = "Oi, Ana. Segue o relatório do PACS em anexo. Qualquer dúvida, me avisa.";
    const { backend, calls } = fakeLlm(polished);
    const r = await cleanup({ raw, bundleId: MAIL, dictionary }, { llm: backend, llmMode: "auto" });
    expect(r.text).toBe(polished);
    expect(r.llm).toMatchObject({ used: true, backend: "fake" });
    expect(calls[0]!.system).toContain("<CUSTOM_VOCABULARY>\nImportant Vocabulary:\nPACS\n</CUSTOM_VOCABULARY>");
    expect(calls[0]!.system).toContain("- Tone: a professional email.");
    expect(calls[0]!.system).toBe(llmSystemMessage("formal", dictionary));
    expect(calls[0]!.prompt).toBe("\n<TRANSCRIPT>\nOi ana, segue o relatório do PACS em anexo, qualquer dúvida me avisa.\n</TRANSCRIPT>");
    expect(calls[0]!.temperature).toBe(0);
    expect(r.rulesText).toBe("Oi ana, segue o relatório do PACS em anexo, qualquer dúvida me avisa.");
  });

  test("auto: frase curta no Slack fica só com as regras", async () => {
    const { backend, calls } = fakeLlm("x");
    const r = await cleanup({ raw: "ok chego às quatro", bundleId: "com.tinyspeck.slackmacgap" }, { llm: backend, llmMode: "auto" });
    expect(calls).toHaveLength(0);
    expect(r.text).toBe("Ok chego às 4h");
  });

  test("terminal nunca passa pelo LLM, nem no always", async () => {
    const { backend, calls } = fakeLlm("x");
    await cleanup({ raw: "git status", bundleId: "com.apple.Terminal" }, { llm: backend, llmMode: "always" });
    expect(calls).toHaveLength(0);
  });

  test("LLM indisponível: fica com as regras sem tentar", async () => {
    const { backend, calls } = fakeLlm("x", { available: false });
    const r = await cleanup({ raw, bundleId: MAIL }, { llm: backend, llmMode: "always" });
    expect(calls).toHaveLength(0);
    expect(r.llm).toBeUndefined();
  });

  test("timeout: aborta e devolve as regras", async () => {
    const { backend } = fakeLlm("Oi, Ana.", { delayMs: 500 });
    const r = await cleanup({ raw, bundleId: MAIL, dictionary }, { llm: backend, llmMode: "always", llmTimeoutMs: 30 });
    expect(r.llm).toMatchObject({ used: false, reason: "timeout" });
    expect(r.text).toBe(r.rulesText);
    expect(r.ms).toBeLessThan(400);
  });

  test("erro do backend: devolve as regras", async () => {
    const backend: LlmBackend = { name: "fake", available: () => true, complete: async () => Promise.reject(new Error("llm_refused")) };
    const r = await cleanup({ raw, bundleId: MAIL }, { llm: backend, llmMode: "always" });
    expect(r.llm).toMatchObject({ used: false, reason: "error", detail: "Error: llm_refused" });
    expect(r.text).toBe(r.rulesText);
  });

  test("a guarda descarta resposta em vez de revisão (o caso do #144)", async () => {
    const { backend } = fakeLlm("Não foi possível encontrar informações sobre o clima para amanhã em São Paulo.");
    const r = await cleanup({ raw: "what's the weather tomorrow in são paulo" }, { llm: backend, llmMode: "always" });
    expect(r.llm).toMatchObject({ used: false, reason: "rejected", detail: "answered" });
    expect(r.text).toBe("What's the weather tomorrow in são paulo?");
  });

  test("tira o raciocínio e o <TRANSCRIPT> que o modelo devolveu junto", async () => {
    const { backend } = fakeLlm("<think>limpar</think>\n<TRANSCRIPT>\nOi, Ana. Segue o relatório do PACS em anexo. Qualquer dúvida, me avisa.\n</TRANSCRIPT>");
    const r = await cleanup({ raw, bundleId: MAIL, dictionary }, { llm: backend, llmMode: "always" });
    expect(r.llm).toMatchObject({ used: true });
    expect(r.text).toBe("Oi, Ana. Segue o relatório do PACS em anexo. Qualquer dúvida, me avisa.");
  });

  test("tirar as aspas em volta e reaplicar a grafia do dicionário", async () => {
    const { backend } = fakeLlm('"Oi, Ana. Segue o relatório do pacs em anexo. Qualquer dúvida, me avisa."');
    const r = await cleanup({ raw, bundleId: MAIL, dictionary }, { llm: backend, llmMode: "always" });
    expect(r.text).toBe("Oi, Ana. Segue o relatório do PACS em anexo. Qualquer dúvida, me avisa.");
  });
});

describe("prompt do VoiceInk", () => {
  test("o modelo recebe as instruções da tarefa no lugar do %@", () => {
    const system = llmSystemMessage("default");
    expect(system.startsWith("<SYSTEM_INSTRUCTIONS>")).toBe(true);
    expect(system).not.toContain("%@");
    expect(system).toContain("<TASK_INSTRUCTIONS>\n<TASK>\nClean <TRANSCRIPT> into polished, readable, general-purpose text.");
    expect(system).not.toContain("Important Vocabulary:");
    expect(system).not.toContain("<TONE>");
  });

  test("regra de idioma e exemplos em português (T6592)", () => {
    const system = llmSystemMessage("default");
    expect(system).toContain("- Never translate. Portuguese stays in Portuguese");
    expect(system).toContain("Input: quantos dias faltam para o fim do mês\nOutput: Quantos dias faltam para o fim do mês?\n");
    expect(system).toContain("Output: Importamos 12.000 laudos em 40 pastas, e a taxa foi de R$ 80.");
    expect(system.indexOf("Input: oi bruno segue")).toBeLessThan(system.lastIndexOf("</EXAMPLES>"));
  });

  test("tom do app e vocabulário escapado", () => {
    const system = llmSystemMessage("casual", ["C++ <beta>", { term: "R&D" }]);
    expect(system).toContain("<TONE>\n- Tone: a chat message.");
    expect(system).toContain("Important Vocabulary:\nC++ &lt;beta&gt;\nR&amp;D\n</CUSTOM_VOCABULARY>");
  });

  test("vocabulário na ordem da pessoa, sem repetição", () => {
    const system = llmSystemMessage("default", ["kubectl", "Healthcare API", "KUBECTL"]);
    expect(system).toContain("Important Vocabulary:\nkubectl\nHealthcare API\n</CUSTOM_VOCABULARY>");
  });

  test("vocabulário grande é cortado", () => {
    const terms = Array.from({ length: MAX_VOCABULARY_TERMS + 20 }, (_, i) => `termo${i}`);
    const system = llmSystemMessage("default", terms);
    expect(system).toContain(`termo${MAX_VOCABULARY_TERMS - 1}\n`);
    expect(system).not.toContain(`termo${MAX_VOCABULARY_TERMS}\n`);
  });

  test("filtro da saída: tira <think>, <thinking> e <reasoning>", () => {
    expect(filterOutput("<thinking>a\nb</thinking>Oi.<reasoning>x</reasoning>  ")).toBe("Oi.");
    expect(filterOutput("  <think></think>\nTexto. ")).toBe("Texto.");
  });

  test("máximo de tokens: o dobro da entrada, entre 256 e 8192", () => {
    expect(maxTokensFor("curto")).toBe(256);
    expect(maxTokensFor("a".repeat(3000))).toBe(2000);
    expect(maxTokensFor("a".repeat(30000))).toBe(8192);
  });
});

describe("guarda da saída do LLM", () => {
  const dict = compileDictionary(["DICOM", "Healthcare API"]);
  const input = "O DICOM store tá com problema de permissão na Healthcare API.";

  test("aceita revisão fiel", () => {
    expect(rejectReason(input, "O DICOM store está com problema de permissão na Healthcare API.", dict)).toBeNull();
  });
  test("termo do dicionário cortado", () => {
    expect(rejectReason(input, "O store está com problema de permissão na Healthcare API.", dict)).toBe("lost_term:DICOM");
  });
  test("texto que cresceu demais", () => {
    expect(rejectReason("Me manda amanhã.", "Me manda o relatório completo do projeto amanhã de manhã, por favor.", dict)).toBe("grew");
  });
  test("palavras novas (inventou)", () => {
    expect(rejectReason(input, "O DICOM store perdeu dados de pacientes ontem na Healthcare API.", dict)).toBe("novel_words");
  });
  test("ditado que começa como resposta de assistente não é resposta (#309)", () => {
    for (const t of ["Segue o link da reunião de amanhã.", "Certo, pode mandar o relatório hoje.", "Sure, I can review it after lunch."]) {
      expect(rejectReason(t, t, dict)).toBeNull();
    }
    expect(rejectReason("Qual o horário da reunião?", "Claro! A reunião é às 10h.", dict)).toBe("answered");
  });
  test("vazio", () => {
    expect(rejectReason(input, "  ", dict)).toBe("empty");
  });

  test("um preâmbulo com acento também é resposta, não revisão (T913)", () => {
    expect(rejectReason("me manda o arquivo", "Aqui está: me manda o arquivo.", dict)).toBe("answered");
    expect(rejectReason("aqui está o arquivo que você pediu", "Aqui está o arquivo que você pediu.", dict)).toBeNull();
  });

  test("tirar ou pôr uma negação reprova, mesmo sendo palavra curta (T913)", () => {
    expect(rejectReason("eu não vou mandar o relatório amanhã", "Eu vou mandar o relatório amanhã.", dict)).toBe("negation:não");
    expect(rejectReason("eu vou mandar o relatório amanhã", "Eu não vou mandar o relatório amanhã.", dict)).toBe("negation:não");
    expect(rejectReason("I will never ship this on Friday", "I will ship this on Friday.", dict)).toBe("negation:never");
    expect(rejectReason("it doesn't build on main", "It builds on main.", dict)).toBe("negation:not");
    // A mesma negação, só arrumada, passa; e o "no" de "no servidor" não conta.
    expect(rejectReason("eu não vou mandar o relatório amanhã", "Eu não vou mandar o relatório amanhã.", dict)).toBeNull();
    expect(rejectReason("o erro tá no servidor de produção", "O erro está no servidor de produção.", dict)).toBeNull();
  });

  test("traduzir reprova: a saída tem que ficar no idioma da entrada (T6592)", () => {
    const pt = "processamos vinte mil exames em trinta e cinco lotes ontem e faltam uns quinhentos";
    expect(rejectReason(pt, "We processed twenty thousand exams in thirty-five batches yesterday and about five hundred are left.", dict)).toBe("language");
    expect(rejectReason("let's meet at four on the main room", "Vamos nos encontrar às quatro na sala principal.", dict)).toBe("language");
    expect(rejectReason(pt, "Processamos 20 mil exames em 35 lotes ontem e faltam uns 500.", dict)).toBeNull();
    // Os curtos que passaram no T1208 (ADR 0002).
    expect(rejectReason("o kubectl tá fora do path", "The kubectl is out of the path.", dict)).toBe("language");
    expect(rejectReason("meu email é davi arroba kiwi ponto app", "My email is davi@kiwi.app.", dict)).toBe("language");
    // Termo em inglês no meio do português não muda o idioma.
    expect(rejectReason(input, "O DICOM store está com problema de permissão na Healthcare API.", dict)).toBeNull();
  });

  test("milhar com vírgula do inglês num texto em português reprova (T6592)", () => {
    const pt = "processamos vinte mil exames em trinta e cinco lotes";
    expect(rejectReason(pt, "Processamos 20,000 exames em 35 lotes.", dict)).toBe("number_format");
    expect(rejectReason(pt, "Processamos 20.000 exames em 35 lotes.", dict)).toBeNull();
    expect(rejectReason("o custo subiu 2,5 por cento neste mês", "O custo subiu 2,5% neste mês.", dict)).toBeNull();
    expect(rejectReason("we processed twenty thousand records", "We processed 20,000 records.", dict)).toBeNull();
  });

  test("crase de código que não foi ditada reprova (T6592)", () => {
    expect(rejectReason("roda o kubectl get pods pra ver se subiu", "Roda o `kubectl get pods` pra ver se subiu.", dict)).toBe("markup");
    expect(rejectReason("roda o `kubectl` agora", "Roda o `kubectl` agora.", dict)).toBeNull();
  });

  test("idioma pelas stopwords, e nada quando não dá para dizer", () => {
    expect(languageOf("o servidor caiu de novo e ninguém viu")).toBe("pt");
    expect(languageOf("the server is down and nobody saw it")).toBe("en");
    expect(languageOf("um so basically we need to like ship this by friday")).toBe("en");
    expect(languageOf("se for o caso, me avisa")).toBe("pt");
    expect(languageOf("Canberra.")).toBeNull();
    expect(languageOf("ok, deploy feito")).toBeNull();
    expect(languageOf("o build is green")).toBeNull();
    expect(languageOf("o kubectl tá fora do path")).toBe("pt");
  });

  test("pergunta respondida sem começo de assistente reprova (T6592)", () => {
    expect(rejectReason("qual é a capital da austrália", "Canberra é a capital da Austrália.", dict)).toBe("answered");
    expect(rejectReason("Qual o horário da reunião?", "A reunião é às 10h.", dict)).toBe("answered");
    expect(rejectReason("what's the weather tomorrow in são paulo", "Tomorrow in São Paulo it will be sunny.", dict)).toBe("answered");
    expect(rejectReason("oi ana, você sabe onde fica a sala?", "Oi, Ana, a sala fica no segundo andar.", dict)).toBe("answered");
    // A pergunta só arrumada passa, com ou sem o "?".
    expect(rejectReason("qual é a capital da austrália", "Qual é a capital da Austrália?", dict)).toBeNull();
    expect(rejectReason("você pode me explicar por que o kubectl não acha o cluster", "Você pode me explicar por que o kubectl não acha o cluster", dict)).toBeNull();
    expect(rejectReason("what's the weather tomorrow in são paulo", "What's the weather tomorrow in São Paulo?", dict)).toBeNull();
    // Começar por "como" ou "quando" sem ser pergunta não reprova a limpeza que mantém o começo.
    expect(rejectReason("quando chegar me avisa", "Quando chegar, me avisa.", dict)).toBeNull();
  });
});

describe("backend do sidecar", () => {
  test("monta o llm.complete e lê o result", async () => {
    let sent: unknown;
    const backend = sidecarLlm({
      status: () => ({ available: true }),
      request: async (cmd) => {
        sent = cmd;
        return { v: 1, type: "result", id: "1", ok: true, data: { text: "ok", ms: 12 } };
      },
    });
    const req = { system: "s", prompt: "p", maxTokens: 10, temperature: 0, timeoutMs: 900 };
    expect(await backend.complete(req, new AbortController().signal)).toBe("ok");
    expect(sent).toEqual({ type: "llm.complete", ...req });
  });

  test("erro do sidecar vira exceção com o código", async () => {
    const backend = sidecarLlm({
      status: () => ({ available: false, reason: "appleIntelligenceNotEnabled" }),
      request: async () => ({ v: 1, type: "result", id: "1", ok: false, error: "llm_unavailable" }),
    });
    expect(backend.available()).toBe(false);
    expect(backend.complete({ system: "", prompt: "", maxTokens: 1, temperature: 0, timeoutMs: 1 }, new AbortController().signal)).rejects.toThrow(
      "llm_unavailable",
    );
  });
});

describe("latência", () => {
  test("as regras levam bem menos de 400 ms por frase (meta do T52)", () => {
    const dictionary = ["DICOM", "PACS", "Healthcare API", "kubectl"];
    // Aquece o JIT antes de medir.
    for (const f of fixtures) cleanupWithRules({ raw: f.raw, bundleId: f.bundleId, dictionary: f.dictionary ?? dictionary });
    const times: number[] = [];
    for (let round = 0; round < 20; round++) {
      for (const f of fixtures) {
        const t0 = performance.now();
        cleanupWithRules({ raw: f.raw, bundleId: f.bundleId, dictionary: f.dictionary ?? dictionary });
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(times.length * 0.99)]!;
    expect(p99).toBeLessThan(5);
  });
});
