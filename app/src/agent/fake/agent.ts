// O agente falso (spec #4576): um programa que fala ACP de verdade (com o lado "agente" da biblioteca oficial) e que
// todos os testes e a CLI dos agentes usam no lugar do Claude Code. Ele não chama modelo nenhum e não vai à rede.
//
//   bun src/agent/fake/agent.ts            fala ACP pelo stdin e stdout
//
// O que ele faz depende do pedido:
//   (qualquer texto)   pensa, responde "Você disse: …" e conta o turno da sessão (para provar que ela foi retomada)
//   /lento             pensa, usa a ferramenta Read e responde em 20 pedaços, um a cada 100 ms; respeita o cancelar
//   /permissao         pede permissão para usar o Bash e conta o que o Kiwi respondeu
//   /sem-login         falha com o `authRequired` do ACP
//   /limite            falha com a mensagem de limite de uso
//   /sem-rede          falha com um erro de rede (ENOTFOUND)
//   /cai               o processo sai no meio do pedido
//
// O ambiente:
//   KIWI_FAKE_AGENT_LOG      um arquivo JSONL onde ele anota cada `session/new`, `session/resume` e `session/load`
//                            que recebeu, com os parâmetros (os testes conferem o isolamento por ele)
//   KIWI_FAKE_AGENT_RESUME   "resume" (o padrão), "load" ou "none": como ele retoma uma sessão

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { agent, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type { AgentContext, InitializeResponse } from "@agentclientprotocol/sdk";

const resumeMode = process.env.KIWI_FAKE_AGENT_RESUME ?? "resume";
const log = process.env.KIWI_FAKE_AGENT_LOG;

/** As sessões e os turnos ficam num arquivo na pasta de trabalho, para valerem de uma abertura para outra. */
const stateFile = path.join(process.cwd(), ".fake-agent-sessions.json");
function sessions(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}
function saveSessions(s: Record<string, number>): void {
  writeFileSync(stateFile, JSON.stringify(s));
}

function note(method: string, params: unknown): void {
  if (log) appendFileSync(log, JSON.stringify({ method, params }) + "\n");
}

const cancelled = new Set<string>();

async function say(client: AgentContext, sessionId: string, text: string): Promise<void> {
  await client.notify("session/update", { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
}

async function think(client: AgentContext, sessionId: string): Promise<void> {
  await client.notify("session/update", {
    sessionId,
    update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "pensando…" } },
  });
}

const app = agent({ name: "kiwi-fake-agent" })
  .onRequest("initialize", (): InitializeResponse => ({
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: "kiwi-fake-agent", title: "Agente falso", version: "1.0.0" },
    agentCapabilities: {
      loadSession: resumeMode === "load",
      sessionCapabilities: resumeMode === "resume" ? { resume: {} } : {},
    },
    authMethods: [],
  }))
  .onRequest("session/new", ({ params }) => {
    note("session/new", params);
    const sessionId = crypto.randomUUID();
    saveSessions({ ...sessions(), [sessionId]: 0 });
    return { sessionId };
  })
  .onRequest("session/resume", ({ params }) => {
    note("session/resume", params);
    if (!(params.sessionId in sessions())) throw RequestError.sessionNotFound(params.sessionId);
    return {};
  })
  .onRequest("session/load", async ({ params, client }) => {
    note("session/load", params);
    if (!(params.sessionId in sessions())) throw RequestError.sessionNotFound(params.sessionId);
    // O `session/load` repete a conversa antiga: o host não pode tomar isso pela resposta do pedido novo.
    await say(client, params.sessionId, "(a conversa antiga, repetida no load)");
    return {};
  })
  .onNotification("session/cancel", ({ params }) => {
    cancelled.add(params.sessionId);
  })
  .onRequest("session/prompt", async ({ params, client }) => {
    const { sessionId } = params;
    const all = sessions();
    if (!(sessionId in all)) throw RequestError.sessionNotFound(sessionId);
    const turn = (all[sessionId] ?? 0) + 1;
    saveSessions({ ...all, [sessionId]: turn });
    cancelled.delete(sessionId);
    const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

    switch (text) {
      case "/sem-login":
        throw RequestError.authRequired(undefined, "Please run /login");
      case "/limite":
        throw RequestError.internalError({ message: "Claude usage limit reached. Your limit will reset at 5pm." });
      case "/sem-rede":
        throw RequestError.internalError({ message: "fetch failed: getaddrinfo ENOTFOUND api.anthropic.com" });
      case "/cai":
        process.exit(3);
        break;
      case "/permissao": {
        const res = await client.request("session/request_permission", {
          sessionId,
          toolCall: { toolCallId: "t1", title: "Bash", kind: "execute", _meta: { claudeCode: { toolName: "Bash" } } },
          options: [
            { optionId: "allow", name: "Permitir", kind: "allow_once" },
            { optionId: "reject", name: "Recusar", kind: "reject_once" },
          ],
        });
        const outcome = res.outcome.outcome === "selected" ? res.outcome.optionId : res.outcome.outcome;
        await say(client, sessionId, `permissão: ${outcome}`);
        return { stopReason: "end_turn" };
      }
      case "/lento": {
        await think(client, sessionId);
        await client.notify("session/update", {
          sessionId,
          update: { sessionUpdate: "tool_call", toolCallId: "t2", title: "Read", kind: "read", status: "in_progress", _meta: { claudeCode: { toolName: "Read" } } },
        });
        for (let i = 1; i <= 20; i++) {
          if (cancelled.has(sessionId)) return { stopReason: "cancelled" };
          await say(client, sessionId, `pedaço ${i} `);
          await Bun.sleep(100);
        }
        return { stopReason: "end_turn" };
      }
      default:
        await think(client, sessionId);
        await say(client, sessionId, `Você disse: "${text}". `);
        await say(client, sessionId, `Este é o turno ${turn} desta sessão.`);
        return { stopReason: "end_turn" };
    }
  });

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
);
const conn = app.connect(stream);
await conn.closed;
process.exit(0);
