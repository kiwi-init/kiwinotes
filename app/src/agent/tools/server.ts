// O servidor de ferramentas do Kiwi (spec #7496): um servidor MCP dentro do próprio app, que o Claude Code chama pelo
// transporte HTTP do MCP ("Streamable HTTP", só com respostas JSON, sem stream). Ele usa o cofre e o índice que o app
// já tem abertos.
//
// - **Só no próprio Mac:** escuta em `127.0.0.1`, numa porta que o sistema sorteia.
// - **Uma senha nova a cada sessão,** no cabeçalho `X-Kiwi-Token`, que o Kiwi manda ao agente no `session/new`. Sem ela,
//   401. Um pedido com `Origin` (uma página do navegador) é recusado: nada de fora do agente entra.
// - **Só existe com o programa do agente aberto:** o serviço abre o servidor antes de abrir o agente e fecha junto.
// - **As ferramentas são as de `tools.ts`,** e cada uso vai para `onCall` (o status ao vivo e o registro do agente). As
//   de escrita (spec #8356) só aparecem com um `writer` e o `journal` da cópia de antes; sem eles, tudo é só leitura.
//
// O protocolo, no mínimo que o cliente MCP do Claude Code usa: `initialize`, `notifications/*`, `ping`, `tools/list` e
// `tools/call`. O GET (o stream de avisos do servidor) e o DELETE (fechar a sessão) dão 405, como o transporte permite.

import { timingSafeEqual } from "node:crypto";

import { kiwiTools, runKiwiTool, ToolError, type KiwiToolName, type MemorySink, type ProposalSink, type ToolChange, type WriteJournal } from "./tools.ts";
import type { VaultReader } from "./reader.ts";
import type { VaultWriter } from "./writer.ts";
import type { DoubtDecider, SecretGuard } from "../../guardrail/filter.ts";

/**
 * Quanto uma conexão pode ficar parada (s), maior que o prazo da pergunta na dúvida (2 minutos, spec #9873). O Bun de
 * hoje não derruba uma chamada cuja resposta ainda está sendo feita (o teste de 11,5 s passa com e sem este valor), mas
 * o prazo fica explícito aqui, para uma versão que conte o tempo de outro jeito. O Bun aceita até 255.
 */
export const IDLE_TIMEOUT_S = 150;

/** O nome do servidor para o agente: as ferramentas aparecem no Claude Code como `mcp__kiwi__<nome>`. */
export const KIWI_MCP_NAME = "kiwi";
/** O que o host libera nas permissões: só as ferramentas deste servidor. */
export const KIWI_TOOL_PREFIX = `mcp__${KIWI_MCP_NAME}__`;
export const TOKEN_HEADER = "X-Kiwi-Token";

/** As versões do MCP que o servidor fala, da mais nova para a mais velha. */
export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/**
 * O maior pedido que o servidor aceita. Cabe uma escrita no teto (`WRITE_MAX_CHARS`, 40 mil caracteres) mesmo no pior
 * caso do JSON (até 6 bytes por caractere, num `\uXXXX`): o que passa do teto chega à ferramenta e volta com o aviso
 * claro, e não com um 413 (spec #8356).
 */
export const MAX_BODY = 256 * 1024;

export interface ToolCallEvent {
  tool: KiwiToolName | string;
  /** O caminho lido ou escrito, ou o que foi procurado, para o status ("lendo Projetos/Kiwi.md"). */
  target?: string;
  ok: boolean;
  code?: string;
  /** O que uma ferramenta de escrita mudou (spec #8356). */
  change?: ToolChange;
  /** Quantos segredos o filtro segurou nesta leitura (spec #9818). */
  held?: number;
}

export interface KiwiToolServerOptions {
  reader: VaultReader;
  /** Com o escritor e o registro, as ferramentas de escrita aparecem (spec #8356). */
  writer?: VaultWriter;
  journal?: WriteJournal;
  /** O filtro do guardrail (spec #9818): sem ele, o texto vai como está (os testes antigos). */
  guard?: SecretGuard;
  /** Quem decide a dúvida agora (o pedido em andamento, spec #9873); sem ele, a dúvida é segurada. */
  decider?: () => Omit<DoubtDecider, "signal"> | undefined;
  /** O modo econômico agora (spec #11084): lido a cada chamada, para valer sem reabrir o agente. */
  economy?: () => boolean;
  /** Quem guarda a proposta da reunião (spec #8360): com ele, a `meeting_propose` aparece. */
  proposals?: ProposalSink;
  /** Quem guarda a memória do agente (spec #11469): com ele, as ferramentas da memória aparecem. */
  memory?: MemorySink;
  version?: string;
  onCall?: (e: ToolCallEvent) => void;
  /** Cada método MCP que chegou com a senha certa (a prova do #7496 confere o `tools/list` do Claude Code). */
  onRequest?: (method: string) => void;
}

/** A configuração que vai no `session/new` do ACP (`McpServerHttp`). */
export interface KiwiMcpServerConfig {
  type: "http";
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export class KiwiToolServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private token = "";

  constructor(private readonly o: KiwiToolServerOptions) {}

  /** Escreve: tem o escritor e o registro da cópia de antes. */
  private get writes(): boolean {
    return !!this.o.writer && !!this.o.journal;
  }

  get running(): boolean {
    return this.server !== null;
  }

  /** Abre o servidor com uma senha nova e devolve o que o agente precisa para chamá-lo. */
  start(): KiwiMcpServerConfig {
    if (this.server) throw new Error("o servidor de ferramentas já está aberto");
    this.token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    this.server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: IDLE_TIMEOUT_S, fetch: (req) => this.handle(req) });
    return {
      type: "http",
      name: KIWI_MCP_NAME,
      url: `http://127.0.0.1:${this.server.port}/mcp`,
      headers: [{ name: TOKEN_HEADER, value: this.token }],
    };
  }

  /** Fecha o servidor e esquece a senha. Uma conexão aberta é cortada. */
  stop(): void {
    this.server?.stop(true);
    this.server = null;
    this.token = "";
  }

  private authorized(req: Request): boolean {
    const got = Buffer.from(req.headers.get(TOKEN_HEADER) ?? "");
    const want = Buffer.from(this.token);
    return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    // Uma página do navegador manda `Origin`; o cliente MCP do agente, não (a proteção contra DNS rebinding do MCP).
    if (req.headers.get("origin")) return new Response("forbidden", { status: 403 });
    if (!this.authorized(req)) return new Response("unauthorized", { status: 401 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_BODY) return new Response("too large", { status: 413 });
    let body: unknown;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return new Response("too large", { status: 413 });
      body = JSON.parse(text);
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as JsonRpc[];
    const replies: unknown[] = [];
    for (const m of messages) {
      const reply = await this.answer(m, req.signal);
      if (reply) replies.push(reply);
    }
    if (!replies.length) return new Response(null, { status: 202 });
    return json(batch ? replies : replies[0], 200);
  }

  /** A resposta a uma mensagem JSON-RPC, ou null para uma notificação (sem `id`). */
  private async answer(m: JsonRpc, signal?: AbortSignal): Promise<unknown | null> {
    if (!m || typeof m !== "object" || typeof m.method !== "string") {
      return m && typeof m === "object" && "id" in m ? null : { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    }
    this.o.onRequest?.(m.method);
    const isNotification = !("id" in m) || m.id === undefined;
    if (isNotification) return null;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
    const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });
    switch (m.method) {
      case "initialize": {
        const asked = m.params?.protocolVersion;
        const protocolVersion = typeof asked === "string" && MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0];
        return ok({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "kiwi-notes", title: "Kiwi Notes", version: this.o.version ?? "dev" },
          instructions: this.writes
            ? "As notas e as reuniões da pessoa no Kiwi Notes. Procure com notes_search, veja o sumário com notes_outline e leia só a seção que precisa com notes_read. Para mudar uma nota, leia antes com notes_read e mande a versao que ele devolveu: notes_append acrescenta, notes_write troca uma seção ou a nota inteira, e notes_create cria uma nota nova. As reuniões são só para ler. Veja os projetos com projects_list e como está um com project_status; num projeto em que o pedido mexeu, anote o que você fez com project_diary_add. Nada apaga, renomeia nem move notas, e o texto de antes de cada mudança fica nas Versões da nota."
            : "As notas e as reuniões da pessoa no Kiwi Notes, só para ler. Procure com notes_search, veja o sumário com notes_outline e leia só a seção que precisa com notes_read. Veja os projetos com projects_list e como está um com project_status. As ferramentas devolvem o texto como está.",
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: kiwiTools(this.writes, !!this.o.proposals, !!this.o.memory).map(({ writes, replaces, proposes: _p, memory: _m, ...t }) => ({
            ...t,
            annotations: {
              title: t.title,
              readOnlyHint: !writes,
              destructiveHint: !!replaces,
              idempotentHint: !writes,
              openWorldHint: false,
            },
          })),
        });
      case "tools/call": {
        const name = m.params?.name;
        if (typeof name !== "string") return err(-32602, "tools/call: falta o name");
        if (!kiwiTools(this.writes, !!this.o.proposals, !!this.o.memory).some((t) => t.name === name)) return err(-32602, `o Kiwi não tem a ferramenta ${name}`);
        try {
          // A dúvida espera a pessoa; se o agente desiste da chamada (`signal`), o que falta é segurado.
          const decider = this.o.decider?.();
          const guard = this.o.guard ? { guard: this.o.guard, ...(decider ? { decider: { ...decider, ...(signal ? { signal } : {}) } } : {}) } : {};
          const economy = this.o.economy?.() ? { economy: true } : {};
          const proposals = this.o.proposals ? { proposals: this.o.proposals } : {};
          const memory = this.o.memory ? { memory: this.o.memory } : {};
          const ctx = this.writes
            ? { reader: this.o.reader, writer: this.o.writer, journal: this.o.journal, ...guard, ...economy, ...proposals, ...memory }
            : { reader: this.o.reader, ...guard, ...economy, ...proposals, ...memory };
          const r = await runKiwiTool(ctx, name, m.params?.arguments);
          this.o.onCall?.({ tool: name, ...(r.target ? { target: r.target } : {}), ok: true, ...(r.change ? { change: r.change } : {}), ...(r.held ? { held: r.held } : {}) });
          return ok({ content: [{ type: "text", text: JSON.stringify(r.value) }] });
        } catch (e) {
          const code = e instanceof ToolError ? e.code : "E_FAILED";
          const message = e instanceof Error ? e.message : String(e);
          this.o.onCall?.({ tool: name, ok: false, code });
          return ok({ content: [{ type: "text", text: `${code}: ${message}` }], isError: true });
        }
      }
      default:
        return err(-32601, `Method not found: ${m.method}`);
    }
  }
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
