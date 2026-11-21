// O agente falso (spec #4576): um programa que fala ACP de verdade (com o lado "agente" da biblioteca oficial) e que
// todos os testes e a CLI dos agentes usam no lugar do Claude Code. Ele não chama modelo nenhum e não vai à rede.
//
//   bun src/agent/fake/agent.ts            fala ACP pelo stdin e stdout
//
// O que ele faz depende do pedido:
//   (qualquer texto)   pensa, responde "Você disse: …" e conta o turno da sessão (para provar que ela foi retomada)
//   /lento             pensa, usa a ferramenta Read e responde em 20 pedaços, um a cada 100 ms; respeita o cancelar
//   /ate-cancelar      pensa e responde um pedaço a cada 100 ms até o cancelar (no máximo 60 s): o cancelar sempre pega
//                      o pedido no meio, mesmo num runner lento (T20776)
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
//   /permissao-kiwi    pede permissão para usar o `mcp__kiwi__kiwi` e conta o que o Kiwi respondeu
//   (pacote do aberto)  T19969: com um arquivo aberto nas Notas, diz "No <nome>:" e lê pelo files_read; sem nada aberto,
//                      pergunta qual
//   (uma pergunta, com "?")  procura nas notas, lê a 1ª achada e responde com o começo dela: o "Testar" dos Ajustes
//
// O ambiente:
//   KIWI_FAKE_AGENT_LOG      um arquivo JSONL onde ele anota cada `session/new`, `session/resume`, `session/load` e
//                            `session/prompt` (o pedido como chegou: o teste do começo fixo, spec #11084, lê daqui)
//                            que recebeu, com os parâmetros (os testes conferem o isolamento por ele)
//   KIWI_FAKE_AGENT_RESUME   "resume" (o padrão), "load" ou "none": como ele retoma uma sessão
//   KIWI_FAKE_AGENT_TOOL_DELAY_MS  uma pausa depois de cada ferramenta do Kiwi, para um print pegar o status no meio
//   KIWI_FAKE_AGENT_USAGE_DELAY_MS o `/usage` demora isso antes de responder, e respeita o cancelar (T16712)
//   KIWI_FAKE_AGENT_NO_MCP   "1": não anuncia o HTTP do MCP (`mcpCapabilities`), e o host não manda as ferramentas
//   KIWI_FAKE_AGENT_FLAVOR   "gemini": ele se apresenta como o Gemini CLI 0.70.0 (spec #24666), aberto pelo `fake/gemini.ts`:
//                            o `initialize` dele (os quatro jeitos de logar, o `loadSession` e sem `session/resume`), o
//                            `-32000` na abertura sem login (KIWI_FAKE_GEMINI_LOGGED_IN=0), o 429 do limite, as ferramentas
//                            no `_meta["gemini-cli"].mcp` e as opções de permissão dele (`proceed_once`, `cancel`)
//                            "agy": o Antigravity CLI (spec #25046), aberto pelo `fake/agy.ts`. Por ora, só o `initialize`
//                            é dele (os cinco jeitos de logar, `loadSession` e `session/resume`); o resto é o do "gemini"
//                            até o T25060 (as permissões, o login e a retomada)
//   KIWI_FAKE_AGENT_LOGGED_OUT  com o "gemini": um caminho; enquanto o arquivo existe, é como o LOGGED_IN=0. Um teste
//                            desloga e loga de novo sem reabrir o falso (T24672)
//   KIWI_FAKE_AGENT_MODEL    o modelo com que a sessão abre (o padrão é "fable", como se viesse do terminal da pessoa,
//                            que foi o que a prova de verdade mostrou, #8666); o esforço abre em "high". Com o "gemini",
//                            o padrão é o "default" (Auto), e a lista é a dos modelos do Gemini (T24673)
//
// As opções da sessão (`model` e `effort`) vêm na resposta de `session/new|resume|load`, e o `session/set_config_option`
// troca o valor e é anotado no log (T8678). Como no adaptador de verdade, o esforço depende do modelo (spec #16793): o
// sonnet tem só até "high", o haiku até "medium", o opus-legacy não tem a opção, e trocar para um modelo sem o esforço atual volta ao "default".

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { agent, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type { AgentContext, InitializeResponse, McpServer, PermissionOption, PromptResponse } from "@agentclientprotocol/sdk";
import { asKiwi } from "../tools/as-kiwi";

/** O Gemini falso (spec #24666): o mesmo agente, com o `initialize`, os erros e o formato das ferramentas do Gemini CLI. */
const AGY = process.env.KIWI_FAKE_AGENT_FLAVOR === "agy";
const GEMINI = AGY || process.env.KIWI_FAKE_AGENT_FLAVOR === "gemini";
const GEMINI_VERSION = process.env.KIWI_FAKE_GEMINI_VERSION ?? "0.70.0";
const AGY_VERSION = process.env.KIWI_FAKE_AGY_VERSION ?? "1.4.0";
// O Gemini CLI sabe o `session/load` e não sabe o `session/resume`; o `agy` sabe os dois, e o host prefere o resume.
const resumeMode = AGY ? "resume" : GEMINI ? "load" : (process.env.KIWI_FAKE_AGENT_RESUME ?? "resume");

/**
 * O `_meta` de uma ferramenta no `tool_call` e no pedido de permissão. O Claude Code (pelo adaptador) diz o nome em
 * `claudeCode.toolName` (`mcp__kiwi__kiwi`); o Gemini diz o servidor e a ferramenta em `gemini-cli.mcp`, e nada numa
 * ferramenta embutida.
 */
function toolMeta(name: string, kiwi: boolean): Record<string, unknown> | undefined {
  if (!GEMINI) return { claudeCode: { toolName: kiwi ? `mcp__kiwi__${name}` : name } };
  return kiwi ? { "gemini-cli": { mcp: { server_name: "kiwi", tool_name: name } } } : undefined;
}
/** O `_meta` como campo: nenhum, quando não há (o Gemini numa ferramenta embutida). */
function metaOf(meta: Record<string, unknown> | undefined): { _meta?: Record<string, unknown> } {
  return meta ? { _meta: meta } : {};
}
/** O título do `tool_call`: o Gemini mostra o nome e o servidor ("kiwi (kiwi MCP Server)"). */
function toolTitle(name: string, kiwi: boolean): string {
  return GEMINI && kiwi ? `${name} (kiwi MCP Server)` : name;
}
/** As opções de um pedido de permissão: as do Gemini usam os nomes dele. */
const PERMISSION_OPTIONS: PermissionOption[] = GEMINI
  ? [
      { optionId: "proceed_once", name: "Allow", kind: "allow_once" },
      { optionId: "cancel", name: "Reject", kind: "reject_once" },
    ]
  : [
      { optionId: "allow", name: "Permitir", kind: "allow_once" },
      { optionId: "reject", name: "Recusar", kind: "reject_once" },
    ];
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
/** O último Modelo de nota que chegou em cada sessão (spec #13379): o começo fixo só vem quando muda. */
const modelBySession = new Map<string, string>();
/** O texto das notas que o falso já viu na sessão, pelo pacote ou por uma leitura (o registro de entrega, T14682). */
const seenBySession = new Map<string, Map<string, string>>();

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
  // A ferramenta única (ADR 0013 peça 6, T14563): o agente falso pensa na ação (`notes_read`) e chama a `kiwi`, como o
  // agente de verdade, que só vê ela na lista.
  const call = asKiwi(name, args);
  await client.notify("session/update", {
    sessionId,
    // As de escrita (spec #8356) chegam como `edit`, como o Claude Code faz com uma ferramenta que muda arquivo.
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: toolTitle(call.name, true),
      kind: /^notes_(create|append|write)$/.test(name) ? "edit" : "read",
      status: "in_progress",
      _meta: toolMeta(call.name, true),
    },
  });
  const r = await mcp(sessionId, "tools/call", call);
  const pause = Number(process.env.KIWI_FAKE_AGENT_TOOL_DELAY_MS ?? 0);
  if (pause > 0) await Bun.sleep(pause);
  await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId, status: r.error || r.result?.isError ? "failed" : "completed" } });
  if (r.error) return { text: `erro: ${r.error.message}`, isError: true };
  return { text: String(r.result?.content?.[0]?.text ?? ""), isError: !!r.result?.isError };
}

/** A proposta fixa da reunião (spec #8360): os campos que o agente falso manda à `meeting_propose`. */
export const FAKE_PROPOSAL = {
  tema: "Cronograma da mudança",
  resumo: "A equipe revisou o cronograma da mudança e combinou a ordem das próximas entregas.",
  decisoes: ["A mudança começa pelo 3º andar", "O teste de carga fica para a semana que vem"],
  acoes: [
    { oque: "Mandar o plano de testes", quem: "Ana", quando: "sexta" },
    { oque: "Conferir a cota do bucket", quem: "Bruno" },
  ],
  participantes: ["Ana", "Bruno"],
  proximosPassos: ["Rodar a mudança de teste"],
  pendencias: ["Confirmar a janela de manutenção"],
};

/**
 * "Atualiza o projeto com a reunião que eu acabei de ter" (spec #8360): a reunião mais nova, os projetos e a proposta
 * fixa. Com um projeto, ele; com dois ou mais, os dois primeiros como candidatos; sem nenhum, só a nota da reunião.
 */
async function proposeMeeting(client: AgentContext, sessionId: string, path?: string): Promise<string> {
  const listed = await useTool(client, sessionId, "meetings_list", {});
  if (listed.isError) return `Não consegui ver as reuniões: ${listed.text}`;
  const meeting = (JSON.parse(listed.text) as { reunioes: { path: string; titulo: string; gravandoAgora?: boolean }[] }).reunioes.find(
    (m) => !m.gravandoAgora && (!path || m.path === path),
  );
  if (!meeting) return "Não achei nenhuma reunião gravada.";
  // A transcrição, pela ferramenta: ela passa pelo guardrail (o segredo vira marcador), e o falso não a usa.
  const read = await useTool(client, sessionId, "meetings_get", { path: meeting.path });
  if (read.isError) return `Não consegui ler a reunião: ${read.text}`;
  const projects = await useTool(client, sessionId, "projects_list", {});
  const folders = projects.isError ? [] : (JSON.parse(projects.text) as { projetos: { pasta: string }[] }).projetos.map((p) => p.pasta);
  const where = folders.length === 1 ? { projeto: folders[0] } : folders.length > 1 ? { candidatos: folders.slice(0, 2) } : {};
  const r = await useTool(client, sessionId, "meeting_propose", { reuniao: meeting.path, ...where, ...FAKE_PROPOSAL });
  if (r.isError) return `Não consegui preparar a proposta: ${r.text}`;
  return `Preparei a proposta da reunião "${meeting.titulo}". Veja e aplique no Kiwi.`;
}

/**
 * "Resumo executivo do <projeto>" (spec #11546): os projetos com esse nome (um vai como projeto; dois ou mais, como
 * candidatos), o estado e as reuniões dele, e os campos fixos, com as fontes de verdade (a nota principal e a reunião
 * mais nova da pasta). Não inventa: sem nota nem reunião, os blocos com fonte vão vazios.
 */
async function proposeSummary(client: AgentContext, sessionId: string, name: string): Promise<string> {
  const listed = await useTool(client, sessionId, "projects_list", {});
  if (listed.isError) return `Não consegui ver os projetos: ${listed.text}`;
  const fold = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const all = (JSON.parse(listed.text) as { projetos: { pasta: string; nome: string }[] }).projetos;
  const found = all.filter((p) => fold(p.nome).includes(fold(name)) || fold(p.pasta) === fold(name));
  if (!found.length) return `Não achei o projeto "${name}".`;
  const first = found[0]!;
  const status = await useTool(client, sessionId, "project_status", { projeto: first.pasta });
  if (status.isError) return `Não consegui ver o projeto: ${status.text}`;
  const main = (JSON.parse(status.text) as { notaPrincipal: string | null }).notaPrincipal;
  const meetings = await useTool(client, sessionId, "meetings_list", {});
  const inFolder = meetings.isError
    ? []
    : (JSON.parse(meetings.text) as { reunioes: { path: string; gravandoAgora?: boolean }[] }).reunioes.filter((m) => !m.gravandoAgora && m.path.startsWith(`${first.pasta}/`));
  const meeting = inFolder[0]?.path;
  const fromMeeting = meeting ?? main;
  const where = found.length === 1 ? { projeto: first.pasta } : { candidatos: found.slice(0, 2).map((p) => p.pasta) };
  const r = await useTool(client, sessionId, "project_summary_propose", {
    ...where,
    ...FAKE_SUMMARY(fromMeeting, main),
    reunioes: inFolder.slice(0, 3).map((m) => m.path),
  });
  if (r.isError) return `Não consegui preparar o resumo: ${r.text}`;
  return `Preparei o resumo executivo de "${first.nome}". Veja e aplique no Kiwi.`;
}

/** Os campos fixos do resumo do agente falso: as fontes são a reunião mais nova e a nota principal (null: o item sai). */
export function FAKE_SUMMARY(meeting: string | null, main: string | null): Record<string, unknown> {
  const at = <T,>(src: string | null, item: (s: string) => T) => (src ? [item(src)] : []);
  return {
    situacao: "amarelo",
    linha: "a mudança atrasou uma semana",
    andou: at(meeting, (fonte) => ({ texto: "O cronograma da mudança foi revisto", fonte })),
    decisoes: at(meeting, (fonte) => ({ texto: "A mudança começa pelo 3º andar", data: "2026-11-10", fonte })),
    riscos: [{ texto: "A janela de manutenção ainda não foi confirmada" }],
    proximosPassos: at(main, (fonte) => ({ oque: "Confirmar a janela de manutenção", quem: "Ana", quando: "sexta", fonte })),
  };
}

/** Os arquivos (spec #11549): "/ler-arquivo <caminho>" lê a 1ª parte e diz o sumário; "/gerar-arquivo <formato> <pasta/nome>" gera com o conteúdo fixo. */
export const FAKE_FILE_TABLE = [
  ["Mês", "Volumes", "Obs"],
  ["Outubro", "1200", "revisado"],
  ["Novembro", "980", "parcial"],
];
export const FAKE_FILE_BLOCKS = [
  { tipo: "titulo", texto: "Relatório da mudança", nivel: 1 },
  { tipo: "paragrafo", texto: "O 3º andar vai primeiro, e o teste de carga fica para a semana que vem." },
  { tipo: "item", texto: "Confirmar a janela de manutenção" },
  { tipo: "tabela", linhas: FAKE_FILE_TABLE },
];
async function readFileFake(client: AgentContext, sessionId: string, caminho: string): Promise<string> {
  const r = await useTool(client, sessionId, "files_read", { caminho });
  if (r.isError) return `Não consegui ler ${caminho}: ${r.text}`;
  const v = JSON.parse(r.text) as { formato: string; partes: number; rotulo: string; texto: string; sumario: { abas?: { nome: string }[]; paginas?: number } };
  const where = v.sumario.abas ? `${v.sumario.abas.length} aba(s)` : v.sumario.paginas ? `${v.sumario.paginas} página(s)` : `${v.partes} parte(s)`;
  return `Li ${caminho} (${v.formato}, ${where}). ${v.rotulo}:\n${v.texto.split("\n").slice(0, 4).join("\n")}`;
}
async function createFileFake(client: AgentContext, sessionId: string, formato: string, alvo: string): Promise<string> {
  const cut = alvo.lastIndexOf("/");
  const [pasta, nome] = cut < 0 ? ["", alvo] : [alvo.slice(0, cut), alvo.slice(cut + 1)];
  const conteudo = formato === "csv" || formato === "xlsx" ? { tabela: FAKE_FILE_TABLE } : { blocos: FAKE_FILE_BLOCKS };
  const r = await useTool(client, sessionId, "files_create", { formato, nome, pasta, conteudo });
  if (r.isError) return `Não consegui gerar o arquivo: ${r.text}`;
  return `Gerei ${(JSON.parse(r.text) as { caminho: string }).caminho}.`;
}

/** As referências fixas do agente falso (spec #11908): links de documentação pública, nenhum aberto de verdade. */
export const FAKE_REFERENCES = [
  { titulo: "ORBITweb", link: "https://www.orbitstandard.org/using/orbitweb", resumo: "O padrão do FIND-RS, PULL-RS e PUSH-RS.", data: "2026-11-14" },
  { titulo: "Cloud Atlas API: ORBIT", link: "https://cloud.google.com/atlas-api/docs/concepts/orbit", resumo: "Os orbitStores e o ORBITweb do Google.", data: "2026-11-14" },
];

/**
 * A web do agente (spec #11908): "/web <busca>" pede a permissão do `WebSearch`, como o Claude Code. Com o sim, a busca
 * aparece como uma ferramenta em andamento e termina; com o não, ela não acontece. O falso nunca vai à rede.
 */
async function webSearchFake(client: AgentContext, sessionId: string, query: string): Promise<string> {
  const toolCallId = `w${++rpcId}`;
  const call = { toolCallId, title: GEMINI ? "GoogleSearch" : "WebSearch", kind: "fetch", _meta: toolMeta(GEMINI ? "google_web_search" : "WebSearch", false) };
  const res = (await client.request("session/request_permission", {
    sessionId,
    toolCall: call,
    options: [
      { optionId: "allow", name: "Permitir", kind: "allow_once" },
      { optionId: "reject", name: "Recusar", kind: "reject_once" },
    ],
  })) as { outcome: { outcome: string; optionId?: string } };
  if (res.outcome.outcome !== "selected" || res.outcome.optionId !== "allow") return "web negada: a busca não aconteceu.";
  await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call", ...call, status: "in_progress" } });
  const pause = Number(process.env.KIWI_FAKE_AGENT_TOOL_DELAY_MS ?? 0);
  if (pause > 0) await Bun.sleep(pause);
  await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed" } });
  return `busquei na web: ${query}`;
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
    // O registro de entrega (T14682): a nota que já veio nesta conversa volta como "já está com você".
    // Como o agente de verdade, que tem a conversa no histórico, o falso lembra o texto que já viu.
    const lido = JSON.parse(read.text) as { texto?: string; jaEntregue?: string; diferenca?: string };
    const seen = seenBySession.get(sessionId) ?? new Map<string, string>();
    seenBySession.set(sessionId, seen);
    if (lido.texto === undefined) {
      const kept = seen.get(first.path);
      if (kept === undefined || lido.diferenca) return `Pela nota ${first.path}: ${lido.jaEntregue ?? lido.diferenca ?? ""}`;
      return `Pela nota ${first.path} (já estava comigo): ${kept.replace(/^---[\s\S]*?\n---\n/, "").trim().slice(0, 200)}`;
    }
    seen.set(first.path, lido.texto);
    const texto = lido.texto.replace(/^---[\s\S]*?\n---\n/, "").trim();
    return `Pela nota ${first.path}: ${texto.slice(0, 200)}`;
  }
  return "Não achei nada sobre isso nas suas notas.";
}

// Com o "gemini", os modelos mais novos dele (T24673, harry #24856): um print do Gemini não pode mostrar um modelo do Claude.
const GEMINI_MODEL_NAMES: Record<string, string> = { "gemini-hydrogen": "Hydrogen", "gemini-argon": "Argon", "gemini-neon": "Neon" };
const MODELS = GEMINI
  ? ["default", "gemini-hydrogen", "gemini-argon", "gemini-neon"]
  : ["default", "opus", "fable", "sonnet", "haiku", "opus-legacy"];
const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"];
/** Os esforços de cada modelo (spec #16793); um modelo fora daqui tem todos. */
// O haiku não oferece `default` (spec #16793, revisão #17024): ao entrar nele, o esforço do agente é o `medium`.
const MODEL_EFFORTS: Record<string, string[]> = { sonnet: ["default", "low", "medium", "high"], haiku: ["low", "medium"], "opus-legacy": [] };
const MODEL_START: Record<string, string> = { haiku: "medium" };
const effortsOf = (model: string) => MODEL_EFFORTS[model] ?? EFFORTS;
const config = new Map<string, { model: string; effort: string }>();
function configOf(sessionId: string) {
  let c = config.get(sessionId);
  if (!c) {
    c = { model: process.env.KIWI_FAKE_AGENT_MODEL ?? (GEMINI ? "default" : "fable"), effort: "high" };
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
        ? GEMINI
          ? { value, name: "Auto", description: "Let Gemini CLI decide the best model for the task" }
          : { value, name: "Default (recommended)", description: "Sonnet · Best for everyday, complex tasks" }
        : { value, name: GEMINI ? GEMINI_MODEL_NAMES[value] ?? value : value[0]!.toUpperCase() + value.slice(1) },
    ),
  });
  const efforts = effortsOf(c.model);
  return [select("model", "Modelo", c.model, MODELS), ...(efforts.length ? [select("effort", "Esforço", c.effort, efforts)] : [])];
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

/** O `initialize` do Gemini CLI 0.70.0 (acpRpcDispatcher.ts): os quatro jeitos de logar, o `loadSession` e o MCP. */
function geminiInitialize(): InitializeResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    authMethods: [
      { id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" },
      { id: "gemini-api-key", name: "Gemini API key", description: "Use an API key with Gemini Developer API", _meta: { "api-key": { provider: "google" } } },
      { id: "vertex-ai", name: "Vertex AI", description: "Use an API key with Vertex AI GenAI API" },
      { id: "gateway", name: "AI API Gateway", description: "Use a custom AI API Gateway", _meta: { gateway: { protocol: "google", restartRequired: "false" } } },
    ],
    agentInfo: { name: "gemini-cli", title: "Gemini CLI", version: GEMINI_VERSION },
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: true, embeddedContext: true },
      mcpCapabilities: process.env.KIWI_FAKE_AGENT_NO_MCP === "1" ? {} : { http: true, sse: true },
    },
  } as InitializeResponse;
}

/**
 * O `initialize` do `agy acp` (a doc "ACP" do Antigravity): o protocolo 1, o `agentInfo` "Antigravity ACP Server", os
 * cinco jeitos de logar, o `session/load` e o `session/resume` (que não repete o histórico), o `list` e o `close`.
 */
function agyInitialize(): InitializeResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    authMethods: [
      { id: "oauth-personal", name: "Log in with Google", description: "Sign in with a personal Google account" },
      { id: "oauth-business", name: "Log in with Google (business)", description: "Sign in with a Google Workspace account" },
      { id: "gemini-api-key", name: "Gemini API key", description: "Use a Gemini API key" },
      { id: "agent-platform", name: "Agent Platform", description: "Use Google Cloud Agent Platform" },
      { id: "terminal-login", name: "Log in from the terminal", description: "Run agy acp --login in a terminal" },
    ],
    agentInfo: { name: "Antigravity ACP Server", version: AGY_VERSION },
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { resume: {}, list: {}, close: {} },
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: process.env.KIWI_FAKE_AGENT_NO_MCP === "1" ? {} : { http: true, sse: true },
    },
  } as InitializeResponse;
}

/**
 * Sem login, o Gemini recusa a abertura da sessão com o -32000 do `authRequired` e a frase dele
 * (acpSessionManager.ts), e não abre nada. `KIWI_FAKE_GEMINI_LOGGED_IN=0` faz o falso fazer o mesmo.
 */
function geminiLogin(): void {
  const out = process.env.KIWI_FAKE_AGENT_LOGGED_OUT;
  if (GEMINI && (process.env.KIWI_FAKE_GEMINI_LOGGED_IN === "0" || (out && existsSync(out)))) {
    throw new RequestError(-32000, "Gemini API key is missing or not configured.");
  }
}

const app = agent({ name: "kiwi-fake-agent" })
  .onRequest("initialize", ({ params }): InitializeResponse => GEMINI ? (note("initialize", params), AGY ? agyInitialize() : geminiInitialize()) : ({
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
  // O Kiwi nunca chama o `authenticate` (ADR 0011): o login é da pessoa, no Terminal. O falso anota e recusa, e o teste
  // confere que a linha não aparece.
  .onRequest("authenticate", ({ params }) => {
    note("authenticate", params);
    throw RequestError.internalError({ message: "o agente falso não loga" });
  })
  .onRequest("session/new", ({ params }) => {
    note("session/new", params);
    geminiLogin();
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
    geminiLogin();
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
    if (params.configId === "model" && typeof value === "string" && MODELS.includes(value)) {
      c.model = value;
      if (!effortsOf(value).includes(c.effort)) c.effort = MODEL_START[value] ?? "default";
    } else if (params.configId === "effort" && typeof value === "string" && effortsOf(c.model).includes(value)) c.effort = value;
    else throw RequestError.invalidParams(undefined, `não sei ${params.configId}=${String(value)}`);
    return { configOptions: configOptions(params.sessionId) };
  })
  .onNotification("session/cancel", ({ params }) => {
    cancelled.add(params.sessionId);
  })
  // O gasto que o agente informa no fim do pedido (spec #11084): no agente falso, de mentira e previsível.
  .onRequest("session/prompt", async (ctx) => withUsage(ctx.params, await (async ({ params, client }: typeof ctx): Promise<FakeAnswer> => {
    const { sessionId } = params;
    const all = sessions();
    if (!(sessionId in all)) throw RequestError.sessionNotFound(sessionId);
    // O `/usage` é um comando do próprio Claude Code, não uma ida ao modelo: não conta turno nem entra nos pedidos
    // anotados. O Kiwi o manda antes de cada pedido (ADR 0013, T13702), e o registro dele é `session/usage`.
    if (params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("").trim() === "/usage") {
      note("session/usage", params);
      // Um `/usage` lento (T16712), para um teste pegar o cancelar no meio: a resposta pela metade, e o resto só no fim.
      const slow = Number(process.env.KIWI_FAKE_AGENT_USAGE_DELAY_MS ?? 0);
      if (slow > 0) {
        cancelled.delete(sessionId);
        await say(client, sessionId, "Plan usage: ");
        for (const end = Date.now() + slow; Date.now() < end; ) {
          if (cancelled.has(sessionId)) return { stopReason: "cancelled", noUsage: true };
          await Bun.sleep(20);
        }
      }
      await say(client, sessionId, FAKE_USAGE_MARKDOWN());
      return { stopReason: "end_turn", noUsage: true };
    }
    note("session/prompt", params);
    const turn = (all[sessionId] ?? 0) + 1;
    saveSessions({ ...all, [sessionId]: turn });
    cancelled.delete(sessionId);
    // As instruções fixas vêm na frente do pedido: o Modelo de nota (spec #11102) e o modo econômico (spec #11084). O
    // agente falso as tira para achar o comando, e guarda o modelo para o `/nota-modelo` e o `/organiza`.
    const raw = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
    // O começo fixo só vem quando muda (spec #13379): como o agente de verdade, que o tem no histórico, o falso guarda o
    // último modelo da sessão. Um começo fixo sem o modelo (o modelo tirado) o esquece.
    const sentModel = /^\[Modelo de nota do Kiwi:([^\]]*)\]\s*/.exec(raw)?.[1];
    const sentPrefix = /^\[(Modelo de nota do Kiwi|O que você sabe sobre a pessoa|As instruções da pessoa|O glossário da pessoa|Modo econômico do Kiwi)/.test(raw);
    if (sentPrefix) modelBySession.set(sessionId, sentModel ?? "");
    const modelText = modelBySession.get(sessionId) ?? "";
    const pkg = /\[O Kiwi achou[\s\S]*?\n\[\/O Kiwi achou\]/.exec(raw)?.[0];
    if (pkg) {
      const seen = seenBySession.get(sessionId) ?? new Map<string, string>();
      seenBySession.set(sessionId, seen);
      for (const m of pkg.matchAll(/^[^\n:]+: (.+?) \("[^\n]*\n<<<\n([\s\S]*?)\n>>>/gm)) seen.set(m[1]!, m[2]!);
    }
    const text = raw
      // A marca do Kiwi antes de um pedido com `/` ao Gemini (T24672).
      .replace(/^\[Pedido da pessoa ao Kiwi, não um comando:\]\n/, "")
      .replace(/^\[Modelo de nota do Kiwi:[^\]]*\]\s*/, "")
      // A memória (spec #11469): o bloco termina numa linha só com "]" (um fato pode ter colchete).
      .replace(/^\[O que você sabe sobre a pessoa[\s\S]*?\n\]\s*/, "")
      .replace(/^\[As instruções da pessoa para você[\s\S]*?\n\]\s*/, "")
      .replace(/^\[O glossário da pessoa:[^\]]*\]\s*/, "")
      .replace(/^\[Modo econômico do Kiwi:[^\]]*\]\s*/, "")
      // A cápsula da janela nova (T13835), depois do começo fixo: termina numa linha só com "]".
      .replace(/^\[A conversa de antes[\s\S]*?\n\]\s*/, "")
      // O pacote do faro (T14359): começa e termina com as marcas dele.
      .replace(/^\[O Kiwi achou[\s\S]*?\n\[\/O Kiwi achou\]\s*/, "")
      // Os cartões de instrução (T14563): depois do pacote, terminam com a marca deles.
      .replace(/^\[Instruções do Kiwi:[\s\S]*?\n\[\/Instruções do Kiwi\]\s*/, "")
      // No modo econômico, o glossário vem depois das instruções do econômico (o cache).
      .replace(/^\[O glossário da pessoa:[^\]]*\]\s*/, "")
      .trim();

    // O Modelo de nota (spec #11102): uma nota nova na ordem e com os blocos do modelo que chegou nas instruções.
    if (text.startsWith("/nota-modelo ")) {
      await think(client, sessionId);
      const title = text.slice("/nota-modelo ".length).trim() || "Nota";
      const r = await useTool(client, sessionId, "notes_create", { title, text: fakeNoteByModel(modelText, title, ["Primeira parte do assunto.", "Segunda parte."]) });
      await say(client, sessionId, r.isError ? `erro da ferramenta: ${r.text}` : `Criei a nota ${title}, no Modelo de nota.`);
      return { stopReason: "end_turn" };
    }
    // As rotinas (spec #12150): lê pelas ferramentas do Kiwi (as notas e as reuniões) e cria a nota que o pedido diz, na
    // pasta que ele diz, pelo notes_create. Os itens são fixos: o que importa é o caminho do pedido até a nota.
    const routine = /^\[Rotina do Kiwi\][\s\S]*?kiwi escrever\/criar a nota "(.+?)" na pasta "(.+?)"/.exec(text);
    if (routine) {
      await think(client, sessionId);
      const [, title, folder] = routine as unknown as [string, string, string];
      const list = await useTool(client, sessionId, "notes_list", {});
      const meetings = await useTool(client, sessionId, "meetings_list", {});
      if (list.isError || meetings.isError) {
        await say(client, sessionId, `erro da ferramenta: ${list.isError ? list.text : meetings.text}`);
        return { stopReason: "end_turn" };
      }
      const daily = title.startsWith("Resumo de ");
      const body = daily
        ? `# ${title}\n\n## O que mudou\n\n- As notas do dia, vistas pelo notes_list.\n\n## Decisões\n\n- Nenhuma decisão nova.\n\n## Próximos passos\n\n- [ ] Rever as notas de amanhã.\n`
        : `# ${title}\n\n## Sem projeto\n\n- [ ] Rever as ações em aberto das notas.\n`;
      const r = await useTool(client, sessionId, "notes_create", { folder, title, text: body });
      await say(client, sessionId, r.isError ? `erro da ferramenta: ${r.text}` : `Criei a nota ${title}, em ${folder}.`);
      return { stopReason: "end_turn" };
    }
    // Organizar uma nota que já existe: lê, monta de novo no modelo, mantendo o conteúdo, e grava pelo notes_write. Também
    // pelo pedido do passo 8 do onboarding (spec #11955): 'Organize a nota "<caminho>" no Modelo de nota: …'.
    const organize = text.startsWith("/organiza ") ? text.slice("/organiza ".length).trim() : /^Organize a nota "(.+?)" no Modelo de nota:/.exec(text)?.[1];
    if (organize) {
      await think(client, sessionId);
      const path = organize;
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
        update: { sessionUpdate: "tool_call", toolCallId: "t4", title: "Read", kind: "read", status: "in_progress", _meta: toolMeta("Read", false) },
      });
      await Bun.sleep(800);
      await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t4", status: "completed" } });
      await say(client, sessionId, "Pronto: o prazo do Kiwi é março.");
      return { stopReason: "end_turn" };
    }

    switch (text) {
      case "/sem-login":
        // O Gemini: a sessão aberta que perde o login (o token venceu) volta com o 401 da API do Google.
        if (GEMINI) throw new RequestError(401, "Request had invalid authentication credentials. Expected OAuth 2 access token.");
        throw RequestError.authRequired(undefined, "Please run /login");
      case "/limite":
        // O Gemini troca o 429 da API por esta frase, com o código 429 (acpSession.ts).
        if (GEMINI) throw new RequestError(429, "Rate limit exceeded. Try again later.");
        throw RequestError.internalError({ message: "Claude usage limit reached. Your limit will reset at 5pm." });
      case "/sem-rede":
        // O Gemini: o erro de rede sobe com o código 500 e a mensagem do `fetch`.
        if (GEMINI) throw new RequestError(500, "fetch failed: getaddrinfo ENOTFOUND generativelanguage.googleapis.com");
        throw RequestError.internalError({ message: "fetch failed: getaddrinfo ENOTFOUND api.anthropic.com" });
      case "/cai":
        process.exit(3);
        break;
      case "/permissao": {
        const res = await client.request("session/request_permission", {
          sessionId,
          toolCall: { toolCallId: "t1", title: GEMINI ? "Shell" : "Bash", kind: "execute", ...metaOf(toolMeta(GEMINI ? "run_shell_command" : "Bash", false)) },
          options: PERMISSION_OPTIONS,
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
          toolCall: { toolCallId: "t3", title: toolTitle("kiwi", true), kind: "read", ...metaOf(toolMeta("kiwi", true)) },
          options: PERMISSION_OPTIONS,
        });
        const outcome = res.outcome.outcome === "selected" ? res.outcome.optionId : res.outcome.outcome;
        await say(client, sessionId, `permissão: ${outcome}`);
        return { stopReason: "end_turn" };
      }
      case "/ate-cancelar": {
        await think(client, sessionId);
        for (let i = 1, end = Date.now() + 60_000; Date.now() < end; i++) {
          if (cancelled.has(sessionId)) return { stopReason: "cancelled" };
          await say(client, sessionId, `pedaço ${i} `);
          await Bun.sleep(100);
        }
        return { stopReason: "end_turn" };
      }
      case "/lento": {
        await think(client, sessionId);
        await client.notify("session/update", {
          sessionId,
          update: { sessionUpdate: "tool_call", toolCallId: "t2", title: "Read", kind: "read", status: "in_progress", _meta: toolMeta("Read", false) },
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
        // As rotinas novas (spec #12944): "todo dia às 18h, faz um resumo das reuniões" (ou "dias úteis às 9h, …") vira a
        // proposta pela routine_propose, com o nome tirado do pedido. Nada é ligado: a pessoa cria, ajusta ou descarta.
        const asked = /^(todo dia|dias úteis) às (\d{1,2})h(\d{2})?,?\s+(.+?)\.?$/i.exec(text);
        if (asked && kiwiServers.has(sessionId)) {
          const [, when, h, m, what] = asked as unknown as [string, string, string, string | undefined, string];
          const pedido = what.charAt(0).toUpperCase() + what.slice(1) + ".";
          const nome = what.replace(/^(?:faz|faça|fazer|me manda|manda)\s+(?:(?:um|uma)\s+)?/i, "").replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
          const hora = `${h.padStart(2, "0")}:${m ?? "00"}`;
          const r = await useTool(client, sessionId, "routine_propose", { nome, pedido, hora, dias: when.toLowerCase() });
          await say(client, sessionId, r.isError ? `Não consegui propor a rotina: ${r.text}` : `Preparei a rotina "${nome}", ${when.toLowerCase()} às ${hora}. Ela entra desligada: crie, ajuste ou descarte.`);
          return { stopReason: "end_turn" };
        }
        // As referências (spec #11908): "/referencias <nota>" manda itens fixos, como se tivesse pesquisado.
        const refs = /^\/referencias\s+(.+)$/.exec(text);
        if (refs && kiwiServers.has(sessionId)) {
          const r = await useTool(client, sessionId, "notes_add_references", { nota: refs[1]!.trim(), itens: FAKE_REFERENCES });
          await say(client, sessionId, r.isError ? `Não consegui preparar as referências: ${r.text}` : `Preparei as referências de ${refs[1]!.trim()}. Veja e aplique no Kiwi.`);
          return { stopReason: "end_turn" };
        }
        // Uma fala pronta (T13933, o print do README): "/diga <texto>" diz o texto, como o gato responderia.
        const line = /^\/diga\s+([\s\S]+)$/.exec(text);
        if (line) {
          await say(client, sessionId, line[1]!.trim());
          return { stopReason: "end_turn" };
        }
        // A web (spec #11908): só a permissão e o status; o falso nunca vai à rede.
        const web = /^\/web\s+(.+)$/.exec(text);
        if (web) {
          await say(client, sessionId, await webSearchFake(client, sessionId, web[1]!.trim()));
          return { stopReason: "end_turn" };
        }
        // Os arquivos (spec #11549).
        const readCmd = /^\/ler-arquivo\s+(.+)$/.exec(text);
        if (readCmd && kiwiServers.has(sessionId)) {
          await say(client, sessionId, await readFileFake(client, sessionId, readCmd[1]!.trim()));
          return { stopReason: "end_turn" };
        }
        const makeCmd = /^\/gerar-arquivo\s+(\w+)\s+(.+)$/.exec(text);
        if (makeCmd && kiwiServers.has(sessionId)) {
          await say(client, sessionId, await createFileFake(client, sessionId, makeCmd[1]!, makeCmd[2]!.trim()));
          return { stopReason: "end_turn" };
        }
        // O resumo executivo (spec #11546): "/resumo <projeto>" ou "resumo executivo do <projeto>".
        const summary = /^\/resumo\s+(.+)$/i.exec(text) ?? /resumo executivo d[oa]s?\s+(?:projeto\s+)?(.+?)[.?!]*$/i.exec(text);
        if (summary && kiwiServers.has(sessionId)) {
          await say(client, sessionId, await proposeSummary(client, sessionId, summary[1]!.trim()));
          return { stopReason: "end_turn" };
        }
        // A memória (spec #11469): "lembra que …" anota, "esquece que …" tira.
        const memo = /^(lembra|esquece) que (.+?)\.?$/i.exec(text.trim());
        if (memo && kiwiServers.has(sessionId)) {
          const tool = memo[1]!.toLowerCase() === "lembra" ? "memory_remember" : "memory_forget";
          const r = await useTool(client, sessionId, tool, { fato: memo[2]! });
          await say(client, sessionId, r.isError ? `Não deu: ${r.text}` : tool === "memory_remember" ? `Anotei: ${memo[2]}.` : `Esqueci: ${memo[2]}.`);
          return { stopReason: "end_turn" };
        }
        if (/atualiza o projeto com a reuni/i.test(text) && kiwiServers.has(sessionId)) {
          await say(client, sessionId, await proposeMeeting(client, sessionId));
          return { stopReason: "end_turn" };
        }
        // O pedido automático do fim da reunião (spec #8360): a reunião que ele nomeia.
        const auto = /^\[Pedido automático do Kiwi\] A reunião gravada ".*" \((.+\.md)\) terminou\./.exec(text);
        if (auto && kiwiServers.has(sessionId)) {
          await say(client, sessionId, await proposeMeeting(client, sessionId, auto[1]));
          return { stopReason: "end_turn" };
        }
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
        // O aberto nas Notas (T19969): sem nada aberto, pergunta qual; com um arquivo aberto, diz o nome antes, lê pela
        // ferramenta e conta as linhas, como o agente de verdade faria.
        if (pkg?.includes("mas nada está aberto lá agora")) {
          await say(client, sessionId, "Qual nota ou arquivo? Nada está aberto nas Notas agora.");
          return { stopReason: "end_turn" };
        }
        const openFile = /arquivo aberto nas Notas: (.+?)\. /.exec(pkg ?? "")?.[1];
        if (openFile && kiwiServers.has(sessionId)) {
          await think(client, sessionId);
          const r = await useTool(client, sessionId, "files_read", { caminho: openFile });
          const lines = r.isError ? 0 : ((JSON.parse(r.text) as { sumario?: { linhas?: number } }).sumario?.linhas ?? 0);
          await say(client, sessionId, r.isError ? `erro da ferramenta: ${r.text}` : `No ${openFile.split("/").pop()}: li o arquivo, a tabela tem ${lines} linhas, com o cabeçalho.`);
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
