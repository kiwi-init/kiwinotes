import { describe, expect, test } from "bun:test";

import { RequestError } from "@agentclientprotocol/sdk";

import { ACP_AUTH_REQUIRED, AgentError, classifyAgentError } from "./errors.ts";

const code = (e: unknown) => classifyAgentError(e, "Claude Code").code;

describe("os erros do agente", () => {
  test("o authRequired do ACP é não logado, e o código é o da biblioteca", () => {
    expect(RequestError.authRequired().code).toBe(ACP_AUTH_REQUIRED);
    expect(code(RequestError.authRequired())).toBe("E_AGENT_NOT_LOGGED_IN");
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
    expect(g(new Error("Please set an Auth method in your settings.json or specify GEMINI_API_KEY")).code).toBe("E_AGENT_NOT_LOGGED_IN");
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
});
