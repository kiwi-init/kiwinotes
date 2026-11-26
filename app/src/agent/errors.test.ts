import { describe, expect, test } from "bun:test";

import { RequestError } from "@agentclientprotocol/sdk";

import { ACP_AUTH_REQUIRED, AgentError, agentErrorKey, type AgentErrorCode, classifyAgentError } from "./errors.ts";
import { mainLocale } from "../bun/locale.ts";
import { translate } from "../shared/i18n/index.ts";

const code = (e: unknown) => classifyAgentError(e, "Claude Code").code;

describe("os erros do agente", () => {
  test("o authRequired do ACP é não logado, e o código é o da biblioteca", () => {
    expect(RequestError.authRequired().code).toBe(ACP_AUTH_REQUIRED);
    expect(code(RequestError.authRequired())).toBe("E_AGENT_NOT_LOGGED_IN");
  });

  test("sem login, cada agente diz como entrar: o padrão, ou o loginHelp do host (spec #25046)", () => {
    expect(classifyAgentError(RequestError.authRequired(), "Claude Code").message).toBe(
      "O Claude Code não está logado. Entre na sua conta pelo próprio Claude Code e tente de novo.",
    );
    const help = "agent.error.login.agy" as const;
    const helpText = "Abra o Antigravity no Terminal e entre com a sua conta.";
    // O -32000 "Authentication required" do `agy acp` (docs do Antigravity), o data.reason e as palavras.
    for (const e of [new RequestError(-32000, "Authentication required"), new RequestError(-32603, "x", { reason: "auth_required" }), new Error("401 UNAUTHENTICATED")]) {
      const err = classifyAgentError(e, "Gemini", help);
      expect(err.code).toBe("E_AGENT_NOT_LOGGED_IN");
      expect(err.message).toBe(`O Gemini não está logado. ${helpText}`);
    }
    // O loginHelp só muda o login: os outros erros ficam iguais.
    expect(classifyAgentError(new Error("429 Too Many Requests"), "Gemini", help).message).not.toContain(helpText);
  });

  test("um data.reason explícito vale antes das palavras", () => {
    expect(code(new RequestError(-32603, "Internal error", { reason: "rate_limited" }))).toBe("E_AGENT_LIMIT");
    expect(code(new RequestError(-32603, "Internal error", { reason: "quota_exhausted" }))).toBe("E_AGENT_LIMIT");
    expect(code(new RequestError(-32603, "network down", { reason: "auth_required" }))).toBe("E_AGENT_NOT_LOGGED_IN");
    expect(code(new RequestError(-32603, "Internal error", { reason: "transport_lost" }))).toBe("E_AGENT_OFFLINE");
  });

  test("as palavras de limite, de rede e de login, no texto ou no data", () => {
    expect(code(RequestError.internalError({ message: "Claude usage limit reached. Your limit will reset at 5pm." }))).toBe("E_AGENT_LIMIT");
    expect(code(new Error("429 Too Many Requests"))).toBe("E_AGENT_LIMIT");
    expect(code(RequestError.internalError({ message: "fetch failed: getaddrinfo ENOTFOUND api.anthropic.com" }))).toBe("E_AGENT_OFFLINE");
    expect(code(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe("E_AGENT_OFFLINE");
    expect(code(new Error("Invalid API key · Please run /login"))).toBe("E_AGENT_NOT_LOGGED_IN");
  });

  test("os erros do Gemini (spec #24666) caem nos mesmos casos, com a mensagem em português e sem o texto dele", () => {
    const g = (e: unknown) => classifyAgentError(e, "Gemini");
    expect(g(RequestError.authRequired()).code).toBe("E_AGENT_NOT_LOGGED_IN");
    expect(g(new Error("Please set an Auth method in your settings.json")).code).toBe("E_AGENT_NOT_LOGGED_IN");
    expect(g(new Error("Gemini API key is missing or not configured.")).code).toBe("E_AGENT_NOT_LOGGED_IN");
    expect(g(new Error("API key not valid. Please pass a valid API key.")).code).toBe("E_AGENT_NOT_LOGGED_IN");
    expect(g(new Error("[API Error: 401 UNAUTHENTICATED]")).code).toBe("E_AGENT_NOT_LOGGED_IN");
    const limit = g(RequestError.internalError({ message: "[API Error: RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'exemplo']" }));
    expect(limit.code).toBe("E_AGENT_LIMIT");
    expect(limit.message).toBe("O Gemini atingiu o limite de uso da sua conta. Espere o limite voltar e tente de novo.");
    expect(limit.message).not.toContain("RESOURCE_EXHAUSTED");
    expect(limit.detail).toContain("RESOURCE_EXHAUSTED");
    expect(g(new Error("[API Error: 429 Too Many Requests]")).code).toBe("E_AGENT_LIMIT");
    expect(g(new Error("fetch failed: getaddrinfo ENOTFOUND generativelanguage.exemplo")).code).toBe("E_AGENT_OFFLINE");
    expect(g(Object.assign(new Error("spawn gemini ENOENT"), { code: "ENOENT" })).code).toBe("E_AGENT_NOT_INSTALLED");
    expect(g(new Error("algo estranho")).message).toBe("O Gemini falhou ao responder. Tente de novo.");
  });

  test("o limite vence o login: a mensagem de limite costuma falar da conta", () => {
    expect(code(new Error("You've hit your usage limit for this account. Log in to a different account?"))).toBe("E_AGENT_LIMIT");
  });

  test("o programa que não existe (ENOENT) é não instalado", () => {
    expect(code(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }))).toBe("E_AGENT_NOT_INSTALLED");
  });

  test("o resto é falhou, e o que o agente disse fica no detail, fora da mensagem", () => {
    const e = classifyAgentError(new Error("segfault no worker 3"), "Claude Code");
    expect(e.code).toBe("E_AGENT_FAILED");
    expect(e.message).toBe("O Claude Code falhou ao responder. Tente de novo.");
    expect(e.detail).toContain("segfault");
  });

  test("um AgentError passa como está", () => {
    const e = new AgentError("E_AGENT_BUSY", "Claude Code");
    expect(classifyAgentError(e)).toBe(e);
  });

  // T30986: as mensagens saem do catálogo, na língua do main.
  test("em inglês, cada erro sai em inglês, com o nome, o login e as versões", () => {
    const all: Record<AgentErrorCode, true> = {
      E_AGENT_NOT_INSTALLED: true, E_AGENT_NOT_LOGGED_IN: true, E_AGENT_LIMIT: true, E_AGENT_OFFLINE: true,
      E_AGENT_BUSY: true, E_AGENT_FAILED: true, E_ADAPTER_MISSING: true, E_ADAPTER_OFFLINE: true,
      E_ADAPTER_TAMPERED: true, E_ADAPTER_DOWNLOAD: true, E_ADAPTER_CANCELLED: true, E_AGENT_TOO_OLD: true,
      E_AGENT_TOO_NEW: true,
    };
    mainLocale.set("en");
    try {
      for (const c of Object.keys(all) as AgentErrorCode[]) {
        const m = new AgentError(c, "Claude Code", undefined, { instalada: "1.0.0", esperada: "2.0.0" }).message;
        expect(m).toBe(translate("en", agentErrorKey(c), { agente: "Claude Code", entrar: translate("en", "agent.error.login", { agente: "Claude Code" }), instalada: "1.0.0", esperada: "2.0.0" }));
        expect(m).toContain("Claude Code");
        expect(m).not.toMatch(/[{}]|não|Tente|ç|ã/);
      }
      expect(classifyAgentError(RequestError.authRequired(), "Claude Code").message).toBe(
        "Claude Code isn't logged in. Sign in to your account in Claude Code itself and try again.",
      );
      expect(classifyAgentError(new Error("401 UNAUTHENTICATED"), "Gemini", "agent.error.login.agy").message).toBe(
        "Gemini isn't logged in. Open Antigravity in Terminal and sign in to your account.",
      );
      expect(classifyAgentError(new Error("fetch failed: ENOTFOUND exemplo.com"), "Gemini").message).toBe(
        "No internet connection. Gemini needs the network to answer.",
      );
      // Sem o nome, "the agent" no começo da frase vira "The agent".
      expect(new AgentError("E_AGENT_FAILED").message).toBe("The agent failed to answer. Try again.");
    } finally {
      mainLocale.set("pt");
    }
    expect(new AgentError("E_AGENT_FAILED", "Gemini").message).toBe("O Gemini falhou ao responder. Tente de novo.");
  });
});
