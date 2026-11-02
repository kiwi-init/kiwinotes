import { describe, expect, test } from "bun:test";

import { compileDictionary } from "./dictionary.ts";
import { fixtures } from "./fixtures.ts";
import { cleanup, cleanupWithRules, toneFor } from "./index.ts";
import { rejectReason } from "./llm.ts";
import { sidecarLlm } from "./sidecar.ts";
import type { LlmBackend, LlmRequest } from "./types.ts";

describe("fixtures (só regras)", () => {
  for (const f of fixtures) {
    test(f.name, () => {
      expect(cleanupWithRules({ raw: f.raw, bundleId: f.bundleId, tone: f.tone, dictionary: f.dictionary }).text).toBe(f.expected);
    });
  }
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
    expect(calls[0]!.system).toContain("PACS");
    expect(calls[0]!.temperature).toBe(0);
    expect(r.rulesText).toBe("Oi ana, segue o relatório do PACS em anexo, qualquer dúvida me avisa.");
  });

  test("auto: frase curta no Slack fica só com as regras", async () => {
    const { backend, calls } = fakeLlm("x");
    const r = await cleanup({ raw: "ok chego às quatro", bundleId: "com.tinyspeck.slackmacgap" }, { llm: backend, llmMode: "auto" });
    expect(calls).toHaveLength(0);
    expect(r.text).toBe("Ok chego às quatro");
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

  test("tirar as aspas em volta e reaplicar a grafia do dicionário", async () => {
    const { backend } = fakeLlm('"Oi, Ana. Segue o relatório do pacs em anexo. Qualquer dúvida, me avisa."');
    const r = await cleanup({ raw, bundleId: MAIL, dictionary }, { llm: backend, llmMode: "always" });
    expect(r.text).toBe("Oi, Ana. Segue o relatório do PACS em anexo. Qualquer dúvida, me avisa.");
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
  test("vazio", () => {
    expect(rejectReason(input, "  ", dict)).toBe("empty");
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
