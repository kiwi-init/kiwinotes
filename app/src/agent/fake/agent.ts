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
// Com o servidor de ferramentas do Kiwi no `session/new` (spec #7496), ele é um cliente MCP, como o Claude Code:
//   /ferramentas       pede a lista (`tools/list`) e responde com os nomes
//   /tool <nome> <json>  avisa o `tool_call` (`mcp__kiwi__<nome>`), chama a ferramenta e responde com o que voltou.
//                        Várias ferramentas num pedido: uma linha `/tool` para cada, depois de uma linha de texto ou
//                        não (spec #9480: "Mude o prazo\n/tool notes_read …\n/tool notes_write …")
//   /permissao-kiwi    pede permissão para usar o `mcp__kiwi__notes_read` e conta o que o Kiwi respondeu
//   (uma pergunta, com "?")  procura nas notas, lê a 1ª achada e responde com o começo dela: o "Testar" dos Ajustes
//
// O ambiente:
//   KIWI_FAKE_AGENT_LOG      um arquivo JSONL onde ele anota cada `session/new`, `session/resume`, `session/load` e
//                            `session/prompt` (o pedido como chegou: o teste do começo fixo, spec #11084, lê daqui)
//                            que recebeu, com os parâmetros (os testes conferem o isolamento por ele)
//   KIWI_FAKE_AGENT_RESUME   "resume" (o padrão), "load" ou "none": como ele retoma uma sessão
//   KIWI_FAKE_AGENT_TOOL_DELAY_MS  uma pausa depois de cada ferramenta do Kiwi, para um print pegar o status no meio
//   KIWI_FAKE_AGENT_NO_MCP   "1": não anuncia o HTTP do MCP (`mcpCapabilities`), e o host não manda as ferramentas
//   KIWI_FAKE_AGENT_MODEL    o modelo com que a sessão abre (o padrão é "fable", como se viesse do terminal da pessoa,
//                            que foi o que a prova de verdade mostrou, #8666); o esforço abre em "high"
//
// As opções da sessão (`model` e `effort`) vêm na resposta de `session/new|resume|load`, e o `session/set_config_option`
// troca o valor e é anotado no log (T8678).

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { agent, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type { AgentContext, InitializeResponse, McpServer, PromptResponse } from "@agentclientprotocol/sdk";

const resumeMode = process.env.KIWI_FAKE_AGENT_RESUME ?? "resume";
const log = process.env.KIWI_FAKE_AGENT_LOG;

// O pid dele, na pasta onde roda: os testes conferem que o programa fechou de verdade (T8678).
writeFileSync(path.join(process.cwd(), ".fake-agent.pid"), String(process.pid));

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

/** O servidor de ferramentas do Kiwi que cada sessão recebeu (`type: "http"`, o nome `kiwi`). */
const kiwiServers = new Map<string, { url: string; headers: Record<string, string>; ready?: Promise<void> }>();
function rememberServers(sessionId: string, servers: McpServer[] | undefined): void {
  const kiwi = (servers ?? []).find((x) => "type" in x && x.type === "http" && x.name === "kiwi") as
    | { url: string; headers: { name: string; value: string }[] }
    | undefined;
  if (kiwi) kiwiServers.set(sessionId, { url: kiwi.url, headers: Object.fromEntries(kiwi.headers.map((h) => [h.name, h.value])) });
  else kiwiServers.delete(sessionId);
}

let rpcId = 0;
/** Uma chamada MCP pelo HTTP, como o cliente do Claude Code: o `initialize` uma vez, e depois o método. */
async function mcp(sessionId: string, method: string, params?: unknown): Promise<{ result?: any; error?: { message: string } }> {
  const server = kiwiServers.get(sessionId);
  if (!server) throw new Error("esta sessão não recebeu as ferramentas do Kiwi");
  const post = async (body: unknown) =>
    fetch(server.url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...server.headers }, body: JSON.stringify(body) });
  server.ready ??= (async () => {
    const res = await post({ jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kiwi-fake-agent", version: "1.0.0" } } });
    if (!res.ok) throw new Error(`initialize: HTTP ${res.status}`);
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  })();
  await server.ready;
  const res = await post({ jsonrpc: "2.0", id: ++rpcId, method, params });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  return (await res.json()) as { result?: any; error?: { message: string } };
}

/** Usa uma ferramenta do Kiwi como o Claude Code: o `tool_call` no status, a chamada e o texto que voltou. */
async function useTool(client: AgentContext, sessionId: string, name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
  const toolCallId = `k${++rpcId}`;
  await client.notify("session/update", {
    sessionId,
    // As de escrita (spec #8356) chegam como `edit`, como o Claude Code faz com uma ferramenta que muda arquivo.
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: name,
      kind: /^notes_(create|append|write)$/.test(name) ? "edit" : "read",
      status: "in_progress",
      _meta: { claudeCode: { toolName: `mcp__kiwi__${name}` } },
    },
  });
  const r = await mcp(sessionId, "tools/call", { name, arguments: args });
  const pause = Number(process.env.KIWI_FAKE_AGENT_TOOL_DELAY_MS ?? 0);
  if (pause > 0) await Bun.sleep(pause);
  await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId, status: r.error || r.result?.isError ? "failed" : "completed" } });
  if (r.error) return { text: `erro: ${r.error.message}`, isError: true };
  return { text: String(r.result?.content?.[0]?.text ?? ""), isError: !!r.result?.isError };
}

/** Responde a uma pergunta pelas notas: procura a pergunta, ou a palavra mais longa dela, lê a 1ª nota e cita o começo. */
async function answerFromNotes(client: AgentContext, sessionId: string, question: string): Promise<string> {
  const words = [...new Set(question.replace(/[?!.,;:"]/g, " ").split(/\s+/).filter((w) => w.length >= 4))].sort((a, b) => b.length - a.length);
  for (const query of [question.replace(/\?+$/, ""), ...words]) {
    const found = await useTool(client, sessionId, "notes_search", { query, limit: 3 });
    if (found.isError) continue;
    const first = (JSON.parse(found.text) as { resultados: { path: string }[] }).resultados[0];
    if (!first) continue;
    const read = await useTool(client, sessionId, "notes_read", { path: first.path });
    if (read.isError) return `Não consegui ler ${first.path}: ${read.text}`;
    const texto = (JSON.parse(read.text) as { texto: string }).texto.replace(/^---[\s\S]*?\n---\n/, "").trim();
    return `Pela nota ${first.path}: ${texto.slice(0, 200)}`;
  }
  return "Não achei nada sobre isso nas suas notas.";
}

const MODELS = ["default", "opus", "fable", "sonnet", "haiku"];
const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"];
const config = new Map<string, { model: string; effort: string }>();
function configOf(sessionId: string) {
  let c = config.get(sessionId);
  if (!c) {
    c = { model: process.env.KIWI_FAKE_AGENT_MODEL ?? "fable", effort: "high" };
    config.set(sessionId, c);
  }
  return c;
}
function configOptions(sessionId: string) {
  const c = configOf(sessionId);
  const select = (id: string, name: string, currentValue: string, values: string[]) => ({
    id,
    name,
    type: "select" as const,
    currentValue,
    // Como o adaptador de verdade: o "default" com o nome de recomendado e o modelo que ele usa na descrição (T8762).
    options: values.map((value) =>
      value === "default"
        ? { value, name: "Default (recommended)", description: "Sonnet · o padrão da sua conta" }
        : { value, name: value[0]!.toUpperCase() + value.slice(1) },
    ),
  });
  return [select("model", "Modelo", c.model, MODELS), select("effort", "Esforço", c.effort, EFFORTS)];
}

/** O `usage_update` com o uso da janela (o `SDKRateLimitInfo` em `_meta["_claude/rateLimit"]`), como o adaptador manda. */
async function rateLimit(client: AgentContext, sessionId: string, info: Record<string, unknown>): Promise<void> {
  await client.notify("session/update", {
    sessionId,
    update: { sessionUpdate: "usage_update", used: 12_000, size: 200_000, _meta: { "_claude/rateLimit": info } },
  } as never);
}

/** A resposta do `/usage` como o adaptador formata (markdown), com horas de volta de mentira, no fuso do Mac. */
const FAKE_USAGE_MARKDOWN = () => {
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  return [
    "> Claude Max subscription usage",
    "",
    `**5-hour limit** — **37%** · Resets ${fmt(Date.now() + 2 * 3_600_000)}`,
    "",
    "`███████░░░░░░░░░░░░░`",
    "",
    `**Weekly · all models** — **12%** · Resets ${fmt(Date.now() + 4 * 86_400_000)}`,
  ].join("\n");
};

/** O gasto de mentira do pedido: entrada pelo tamanho do texto, e o cache lido a partir do segundo pedido. */
let fakeTurns = 0;
type FakeAnswer = PromptResponse & { noUsage?: boolean };
function withUsage(params: { prompt: { type: string; text?: string }[] }, r: FakeAnswer): PromptResponse {
  const { noUsage, ...out } = r;
  if (noUsage || r.stopReason !== "end_turn") return out;
  const chars = params.prompt.reduce((n, b) => n + (b.type === "text" ? (b.text ?? "").length : 0), 0);
  const inputTokens = 800 + chars, outputTokens = 120, cachedReadTokens = fakeTurns++ ? 6_000 : 0, cachedWriteTokens = fakeTurns === 1 ? 6_000 : 0;
  // O `usage` do adaptador (o `PromptResponse` do ACP v1 não o declara: ele vai como campo a mais).
  return { ...out, usage: { inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens, totalTokens: inputTokens + outputTokens + cachedReadTokens + cachedWriteTokens } } as PromptResponse;
}

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
      // KIWI_FAKE_AGENT_NO_MCP=1: um agente que não sabe o HTTP do MCP (o host não manda o servidor do Kiwi).
      mcpCapabilities: process.env.KIWI_FAKE_AGENT_NO_MCP === "1" ? {} : { http: true, sse: false },
      sessionCapabilities: resumeMode === "resume" ? { resume: {} } : {},
    },
    authMethods: [],
  }))
  .onRequest("session/new", ({ params }) => {
    note("session/new", params);
    const sessionId = crypto.randomUUID();
    rememberServers(sessionId, params.mcpServers);
    saveSessions({ ...sessions(), [sessionId]: 0 });
    return { sessionId, configOptions: configOptions(sessionId) };
  })
  .onRequest("session/resume", ({ params }) => {
    note("session/resume", params);
    if (!(params.sessionId in sessions())) throw RequestError.sessionNotFound(params.sessionId);
    rememberServers(params.sessionId, params.mcpServers);
    return { configOptions: configOptions(params.sessionId) };
  })
  .onRequest("session/load", async ({ params, client }) => {
    note("session/load", params);
    if (!(params.sessionId in sessions())) throw RequestError.sessionNotFound(params.sessionId);
    rememberServers(params.sessionId, params.mcpServers);
    // O `session/load` repete a conversa antiga: o host não pode tomar isso pela resposta do pedido novo.
    await say(client, params.sessionId, "(a conversa antiga, repetida no load)");
    return { configOptions: configOptions(params.sessionId) };
  })
  .onRequest("session/set_config_option", ({ params }) => {
    note("session/set_config_option", params);
    const value = (params as { value?: unknown }).value;
    const c = configOf(params.sessionId);
    if (params.configId === "model" && typeof value === "string" && MODELS.includes(value)) c.model = value;
    else if (params.configId === "effort" && typeof value === "string" && EFFORTS.includes(value)) c.effort = value;
    else throw RequestError.invalidParams(undefined, `não sei ${params.configId}=${String(value)}`);
    return { configOptions: configOptions(params.sessionId) };
  })
  .onNotification("session/cancel", ({ params }) => {
    cancelled.add(params.sessionId);
  })
  // O gasto que o agente informa no fim do pedido (spec #11084): no agente falso, de mentira e previsível.
  .onRequest("session/prompt", async (ctx) => withUsage(ctx.params, await (async ({ params, client }: typeof ctx): Promise<FakeAnswer> => {
    const { sessionId } = params;
    note("session/prompt", params);
    const all = sessions();
    if (!(sessionId in all)) throw RequestError.sessionNotFound(sessionId);
    const turn = (all[sessionId] ?? 0) + 1;
    saveSessions({ ...all, [sessionId]: turn });
    cancelled.delete(sessionId);
    // As instruções fixas vêm na frente do pedido: o Modelo de nota (spec #11102) e o modo econômico (spec #11084). O
    // agente falso as tira para achar o comando, e guarda o modelo para o `/nota-modelo` e o `/organiza`.
    const raw = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
    const modelText = /^\[Modelo de nota do Kiwi:([^\]]*)\]\s*/.exec(raw)?.[1] ?? "";
    const text = raw
      .replace(/^\[Modelo de nota do Kiwi:[^\]]*\]\s*/, "")
      .replace(/^\[Modo econômico do Kiwi:[^\]]*\]\s*/, "")
      .trim();

    // O Modelo de nota (spec #11102): uma nota nova na ordem e com os blocos do modelo que chegou nas instruções.
    if (text.startsWith("/nota-modelo ")) {
      await think(client, sessionId);
      const title = text.slice("/nota-modelo ".length).trim() || "Nota";
      const r = await useTool(client, sessionId, "notes_create", { title, text: fakeNoteByModel(modelText, title, ["Primeira parte do assunto.", "Segunda parte."]) });
      await say(client, sessionId, r.isError ? `erro da ferramenta: ${r.text}` : `Criei a nota ${title}, no Modelo de nota.`);
      return { stopReason: "end_turn" };
    }
    // Organizar uma nota que já existe: lê, monta de novo no modelo, mantendo o conteúdo, e grava pelo notes_write.
    if (text.startsWith("/organiza ")) {
      await think(client, sessionId);
      const path = text.slice("/organiza ".length).trim();
      const read = await useTool(client, sessionId, "notes_read", { path });
      if (read.isError) {
        await say(client, sessionId, `erro da ferramenta: ${read.text}`);
        return { stopReason: "end_turn" };
      }
      const note = JSON.parse(read.text) as { texto: string; versao: string; titulo?: string };
      const body = note.texto.replace(/^---[\s\S]*?---\n/, "").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      const title = note.titulo ?? path.replace(/\.md$/, "").split("/").at(-1)!;
      const w = await useTool(client, sessionId, "notes_write", { path, text: fakeNoteByModel(modelText, title, body), version: note.versao });
      await say(client, sessionId, w.isError ? `erro da ferramenta: ${w.text}` : `Organizei ${path} no Modelo de nota.`);
      return { stopReason: "end_turn" };
    }

    // O agente econômico (spec #11084): o aviso do próprio agente, o limite acabado com a hora de volta e o `/usage`.
    // A lista das ferramentas como chega ao agente, crua (spec #11084: o começo fixo, comparado byte a byte).
    if (text.endsWith("/ferramentas-cru")) {
      const r = await mcp(sessionId, "tools/list");
      await say(client, sessionId, JSON.stringify(r.result?.tools ?? null));
      return { stopReason: "end_turn" };
    }
    if (text === "/aviso") {
      await think(client, sessionId);
      await say(client, sessionId, "Começando. ");
      await rateLimit(client, sessionId, { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.82, resetsAt: Math.floor(Date.now() / 1000) + 2 * 3600 });
      await say(client, sessionId, "E terminando.");
      return { stopReason: "end_turn" };
    }
    if (text === "/limite-com-hora") {
      await think(client, sessionId);
      await rateLimit(client, sessionId, { status: "rejected", rateLimitType: "five_hour", utilization: 1, resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600 });
      throw RequestError.internalError({ message: "Claude usage limit reached." });
    }
    if (text === "/usage") {
      await say(client, sessionId, FAKE_USAGE_MARKDOWN());
      return { stopReason: "end_turn", noUsage: true };
    }
    // Os balões do gato (spec #9495): um texto que chega palavra por palavra, e uma fala antes de uma ferramenta.
    if (text.startsWith("/conta ")) {
      await think(client, sessionId);
      for (const w of text.slice("/conta ".length).split(/(?<=\s)/)) {
        if (cancelled.has(sessionId)) return { stopReason: "cancelled" };
        await say(client, sessionId, w);
        await Bun.sleep(40);
      }
      return { stopReason: "end_turn" };
    }
    if (text === "/antes-da-ferramenta") {
      await think(client, sessionId);
      await say(client, sessionId, "Vou ler a nota do Kiwi antes de responder.");
      await Bun.sleep(1500);
      await client.notify("session/update", {
        sessionId,
        update: { sessionUpdate: "tool_call", toolCallId: "t4", title: "Read", kind: "read", status: "in_progress", _meta: { claudeCode: { toolName: "Read" } } },
      });
      await Bun.sleep(800);
      await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t4", status: "completed" } });
      await say(client, sessionId, "Pronto: o prazo do Kiwi é março.");
      return { stopReason: "end_turn" };
    }

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
      case "/ferramentas": {
        const r = await mcp(sessionId, "tools/list");
        const names = ((r.result?.tools ?? []) as { name: string }[]).map((t) => t.name);
        await say(client, sessionId, `ferramentas: ${names.join(", ")}`);
        return { stopReason: "end_turn" };
      }
      case "/permissao-kiwi": {
        const res = await client.request("session/request_permission", {
          sessionId,
          toolCall: { toolCallId: "t3", title: "notes_read", kind: "read", _meta: { claudeCode: { toolName: "mcp__kiwi__notes_read" } } },
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
        await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed" } });
        return { stopReason: "end_turn" };
      }
      default:
        await think(client, sessionId);
        const tools = text.split("\n").filter((l) => l.startsWith("/tool "));
        if (tools.length) {
          const out: string[] = [];
          for (const line of tools) {
            const [, name = "", ...rest] = line.split(" ");
            const r = await useTool(client, sessionId, name, rest.length ? JSON.parse(rest.join(" ")) : {});
            out.push(r.isError ? `erro da ferramenta: ${r.text}` : r.text);
          }
          await say(client, sessionId, out.join("\n"));
          return { stopReason: "end_turn" };
        }
        if (text.endsWith("?") && kiwiServers.has(sessionId)) {
          await say(client, sessionId, await answerFromNotes(client, sessionId, text));
          return { stopReason: "end_turn" };
        }
        await say(client, sessionId, `Você disse: "${text}". `);
        await say(client, sessionId, `Este é o turno ${turn} desta sessão.`);
        return { stopReason: "end_turn" };
    }
  })(ctx)));

/**
 * Uma nota montada como o modelo pede (spec #11102): os blocos na ordem das linhas numeradas das instruções, só os que
 * vieram. `body` são as linhas de conteúdo, que ficam todas. Sem modelo, título e corpo.
 */
function fakeNoteByModel(model: string, title: string, body: string[]): string {
  const steps = model.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ""));
  const order = steps.length ? steps : ["o título", "o corpo"];
  const bulleted = /o corpo, em tópicos/.test(model);
  const parts: string[] = [];
  for (const step of order) {
    if (step.startsWith("o título")) parts.push(`# ${title}`);
    else if (step.startsWith("as propriedades")) parts.push("---\ntags: [kiwi]\n---");
    else if (step.startsWith("uma introdução")) parts.push("Esta nota resume o assunto.");
    else if (step.startsWith("o sumário")) parts.push("## Sumário\n\n- [[#Assunto]]");
    else if (step.startsWith("o corpo")) parts.push(`## Assunto\n\n${body.map((l) => (bulleted ? `- ${l.replace(/^- /, "")}` : l)).join("\n")}`);
    else if (step.startsWith("o fechamento")) parts.push("## Próximos passos\n\n- [ ] Rever a nota");
  }
  return `${parts.join("\n\n")}\n`;
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
);
const conn = app.connect(stream);
await conn.closed;
process.exit(0);
