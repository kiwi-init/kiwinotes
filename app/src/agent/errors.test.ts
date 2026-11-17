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
