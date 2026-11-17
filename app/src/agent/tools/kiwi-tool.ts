// A ferramenta única (ADR 0013, peça 6; T14563): uma ferramenta só, `kiwi`, no lugar das 21 de antes. Ela tem quatro
// campos: o que fazer (achar, ler, escrever, propor, lembrar), o alvo, o texto e as opções. As 21 de antes continuam
// aqui dentro, como as ações: cada chamada vira uma delas (`resolveKiwiCall`), e a Atividade, o guardrail e o status
// veem a ação de verdade (`notes_read`, `notes_write`…), como antes.
//
// - **A lista nunca muda no meio da sessão:** a definição é uma constante, a mesma com ou sem escrita. O que a sessão
//   não pode (escrever sem o escritor, propor sem quem guarda) volta como erro, e a lista fica igual (o cache).
// - **As instruções longas saem da lista:** gerar arquivo, organizar pasta e as quatro propostas têm o próprio cartão
//   (`instructionCard`), que vai no pacote só quando o pedido precisa (`cardsFor`), ou volta no erro de uma chamada sem
//   os campos.
// - **O erro que ensina:** o que fazer, o como e as opções erradas voltam com a lista do que vale; uma ação de cartão
//   sem os campos devolve o cartão.
// - **Tolerante:** o `fazer` aceita o verbo em inglês e o nome antigo da ação; o `como` e as opções aceitam sem acento;
//   uma opção posta fora de `opcoes` é lida como opção. Cada erro de chamada custa uma ida inteira.
//
// Nos textos que o Kiwi manda ao agente, uma ação se escreve `kiwi ler/sumario`: fazer "ler", com opcoes.como "sumario".

import { KIWI_TOOLS, runKiwiTool, ToolError, type KiwiToolContext, type KiwiToolName, type ToolResult } from "./tools.ts";
import { FILE_FORMATS } from "./files.ts";
import { servedSchemaOf } from "./served-schema.ts";

/** O nome da ferramenta para o agente: no Claude Code, `mcp__kiwi__kiwi`. */
export const KIWI_TOOL = "kiwi";

export const FAZER = ["achar", "ler", "escrever", "propor", "lembrar"] as const;
export type Fazer = (typeof FAZER)[number];

/** Uma ação: o `fazer` e o `como` que levam a uma das ações de dentro, e onde o alvo e o texto entram nela. */
export interface Acao {
  fazer: Fazer;
  como: string;
  tool: KiwiToolName;
  /** O campo da ação que recebe o alvo. */
  alvo?: string;
  /** O campo da ação que recebe o texto. */
  texto?: string;
  /** As opções com outro nome na ação (`secao` → `section`). As outras opções vão com o próprio nome. */
  nomes?: Record<string, string>;
  /** O `como` de quando ele não vem. */
  padrao?: true;
  /** As instruções vêm pelo cartão, não pela lista. */
  cartao?: true;
}

export const ACOES: readonly Acao[] = [
  { fazer: "achar", como: "nome", tool: "find", alvo: "nome", padrao: true },
  { fazer: "achar", como: "texto", tool: "notes_search", texto: "query", nomes: { limite: "limit" } },
  { fazer: "achar", como: "pasta", tool: "notes_list", alvo: "folder" },
  { fazer: "achar", como: "reunioes", tool: "meetings_list" },
  { fazer: "achar", como: "projetos", tool: "projects_list" },
  { fazer: "ler", como: "nota", tool: "notes_read", alvo: "path", nomes: { secao: "section" }, padrao: true },
  { fazer: "ler", como: "sumario", tool: "notes_outline", alvo: "path" },
  { fazer: "ler", como: "reuniao", tool: "meetings_get", alvo: "path" },
  { fazer: "ler", como: "arquivo", tool: "files_read", alvo: "caminho" },
  { fazer: "ler", como: "projeto", tool: "project_status", alvo: "projeto" },
  { fazer: "escrever", como: "acrescentar", tool: "notes_append", alvo: "path", texto: "text", nomes: { secao: "section", versao: "version" }, padrao: true },
  { fazer: "escrever", como: "trocar", tool: "notes_write", alvo: "path", texto: "text", nomes: { secao: "section", versao: "version" } },
  // Escrever só a diferença (ADR 0013 peça 7, T14650).
  { fazer: "escrever", como: "trecho", tool: "notes_edit", alvo: "path", texto: "text", nomes: { de: "old", secao: "section", versao: "version" } },
  { fazer: "escrever", como: "mover", tool: "notes_section_move", alvo: "path", nomes: { secao: "section", antes: "before", depois: "after", versao: "version" } },
  { fazer: "escrever", como: "renomear", tool: "notes_section_rename", alvo: "path", texto: "title", nomes: { secao: "section", versao: "version" } },
  { fazer: "escrever", como: "juntar", tool: "notes_section_merge", alvo: "path", nomes: { secao: "section", com: "with", versao: "version" } },
  { fazer: "escrever", como: "criar", tool: "notes_create", alvo: "title", texto: "text", nomes: { pasta: "folder", titulo: "title" } },
  { fazer: "escrever", como: "diario", tool: "project_diary_add", alvo: "projeto", texto: "texto" },
  { fazer: "escrever", como: "organizar", tool: "notes_organize_folder", alvo: "folder", cartao: true },
  { fazer: "escrever", como: "arquivo", tool: "files_create", alvo: "nome", cartao: true },
  { fazer: "propor", como: "reuniao", tool: "meeting_propose", alvo: "reuniao", cartao: true },
  { fazer: "propor", como: "resumo", tool: "project_summary_propose", alvo: "projeto", cartao: true },
  { fazer: "propor", como: "referencias", tool: "notes_add_references", alvo: "nota", cartao: true },
  { fazer: "propor", como: "rotina", tool: "routine_propose", alvo: "nome", texto: "pedido", cartao: true },
  { fazer: "lembrar", como: "anotar", tool: "memory_remember", texto: "fato", padrao: true },
  { fazer: "lembrar", como: "esquecer", tool: "memory_forget", texto: "fato" },
];

/** Uma ação escrita como nos textos do Kiwi: `kiwi ler/sumario`. */
export const acaoLabel = (a: Pick<Acao, "fazer" | "como">) => `${KIWI_TOOL} ${a.fazer}/${a.como}`;

const acaoDe = (tool: string) => ACOES.find((a) => a.tool === tool);

/** O nome da ação nos textos do Kiwi, pelo nome antigo (`notes_read` → `kiwi ler/nota`). */
export function labelOf(tool: string): string {
  const a = acaoDe(tool);
  return a ? acaoLabel(a) : tool;
}

const NOMES_ANTIGOS = "notes_[a-z_]+|meetings_(?:list|get)|projects_list|project_(?:status|diary_add|summary_propose)|files_(?:read|create)|meeting_propose|routine_propose|memory_(?:remember|forget)|find";
const NOME_SOLTO = new RegExp(`\\b(${NOMES_ANTIGOS})\\b`, "g");
const NOME_ENTRE_CRASES = new RegExp(`\`(${NOMES_ANTIGOS})\``, "g");

/**
 * Troca os nomes antigos das ações, num texto fixo do próprio Kiwi (a descrição de uma ferramenta, uma instrução), pelo
 * jeito de chamar hoje. Só num texto sem nada de fora: um caminho ou um título com `find` mudaria junto.
 */
export function vocab(text: string): string {
  return text.replace(NOME_SOLTO, (m) => {
    const a = acaoDe(m);
    return a ? acaoLabel(a) : m;
  });
}

/**
 * O mesmo, num erro ou num aviso, que trazem o caminho, a seção ou o nome que vieram da pessoa ou do agente (T16159):
 * só troca o nome entre crases, como o Kiwi escreve as ações nas mensagens (`notes_read`). O resto chega intacto, e
 * o agente relê o caminho certo.
 */
export function vocabMensagem(text: string): string {
  return text.replace(NOME_ENTRE_CRASES, (m, nome: string) => {
    const a = acaoDe(nome);
    return a ? `\`${acaoLabel(a)}\`` : m;
  });
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().trim();

/** Os sinônimos do `fazer`: o verbo em inglês e as formas comuns. */
const FAZER_SINONIMOS: Record<string, Fazer> = {
  achar: "achar", procurar: "achar", buscar: "achar", listar: "achar", find: "achar", search: "achar", list: "achar",
  ler: "ler", read: "ler", ver: "ler",
  escrever: "escrever", write: "escrever", editar: "escrever", criar: "escrever", create: "escrever",
  mover: "escrever", move: "escrever", renomear: "escrever", rename: "escrever", juntar: "escrever", merge: "escrever",
  propor: "propor", propose: "propor",
  lembrar: "lembrar", remember: "lembrar", esquecer: "lembrar", forget: "lembrar", memoria: "lembrar",
};

/**
 * Os sinônimos que já dizem o como (revisão do T14563, #14585): "criar" é escrever/criar, nunca o acrescentar padrão,
 * que escreveria numa nota que já existe com esse nome; "listar" é achar/pasta.
 */
const COMO_DO_SINONIMO: Record<string, string> = {
  criar: "criar", create: "criar", esquecer: "esquecer", forget: "esquecer", listar: "pasta", list: "pasta",
  mover: "mover", move: "mover", renomear: "renomear", rename: "renomear", juntar: "juntar", merge: "juntar",
};

/** Os campos da ferramenta: o resto é lido como opção. */
const CAMPOS = ["fazer", "alvo", "texto", "opcoes"] as const;

/** As opções que valem numa ação, com o nome que a ação usa. */
function opcoesDe(a: Acao): Map<string, string> {
  const def = KIWI_TOOLS.find((t) => t.name === a.tool)!;
  const props = Object.keys((def.inputSchema.properties ?? {}) as Record<string, unknown>);
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(a.nomes ?? {})) out.set(k, v);
  for (const p of props) if (p !== a.alvo && p !== a.texto && !out.has(p)) out.set(p, p);
  // O nome de dentro também vale (`section`, além de `secao`).
  for (const v of Object.values(a.nomes ?? {})) if (v !== a.alvo && v !== a.texto) out.set(v, v);
  return out;
}

const listaComos = (fazer: Fazer) =>
  ACOES.filter((a) => a.fazer === fazer)
    .map((a) => `${a.como}${a.padrao ? " (padrão)" : ""}`)
    .join(", ");

export interface KiwiCall {
  acao: Acao;
  tool: KiwiToolName;
  args: Record<string, unknown>;
}

/**
 * Uma chamada da `kiwi` vira uma das ações de dentro: qual, e com que argumentos. Um erro aqui é um erro de chamada,
 * e ensina: diz o que vale.
 */
export function resolveKiwiCall(raw: unknown): KiwiCall {
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ToolError("E_BAD_ARGS", "os argumentos devem ser um objeto: {fazer, alvo, texto, opcoes}");
  const a = raw as Record<string, unknown>;
  // As opções: as de `opcoes` e as postas fora dela.
  if (a.opcoes !== undefined && a.opcoes !== null && (typeof a.opcoes !== "object" || Array.isArray(a.opcoes))) throw new ToolError("E_BAD_ARGS", "opcoes deve ser um objeto");
  const opcoes: Record<string, unknown> = { ...((a.opcoes as Record<string, unknown> | undefined) ?? {}) };
  for (const [k, v] of Object.entries(a)) if (!(CAMPOS as readonly string[]).includes(k) && !(k in opcoes)) opcoes[k] = v;

  // O que fazer: o verbo, um sinônimo ou o nome antigo da ação.
  if (typeof a.fazer !== "string" || !a.fazer.trim()) throw new ToolError("E_BAD_ARGS", `falta o fazer: um de ${FAZER.join(", ")}`);
  const antigo = acaoDe(a.fazer.trim());
  const fazer = antigo?.fazer ?? FAZER_SINONIMOS[fold(a.fazer)];
  if (!fazer) throw new ToolError("E_BAD_ARGS", `fazer "${a.fazer}" não existe: use ${FAZER.join(", ")}`);

  // Como: o pedido em opcoes.como, o do nome antigo, o "esquecer" do lembrar, ou o padrão.
  let como = typeof opcoes.como === "string" ? fold(opcoes.como) : undefined;
  delete opcoes.como;
  if (!como && antigo) como = antigo.como;
  if (!como && !antigo) como = COMO_DO_SINONIMO[fold(a.fazer)];
  // Um escrever com o trecho de antes (opcoes.de) é a troca de um trecho, nunca o acrescentar padrão (T14650).
  if (!como && fazer === "escrever" && (opcoes.de !== undefined || opcoes.old !== undefined)) como = "trecho";
  if (!como && fazer === "ler" && typeof a.alvo === "string" && FILE_FORMATS.some((f) => a.alvo!.toString().toLowerCase().endsWith(`.${f}`) && f !== "txt")) como = "arquivo";
  const acao = como ? ACOES.find((x) => x.fazer === fazer && fold(x.como) === como) : ACOES.find((x) => x.fazer === fazer && x.padrao);
  if (!acao) throw new ToolError("E_BAD_ARGS", `em fazer "${fazer}", opcoes.como é um de: ${listaComos(fazer)}`);

  const args: Record<string, unknown> = {};
  const alvo = a.alvo;
  const texto = a.texto;
  if (alvo !== undefined && alvo !== null && alvo !== "") {
    if (typeof alvo !== "string") throw new ToolError("E_BAD_ARGS", "alvo deve ser texto");
    if (acao.alvo) args[acao.alvo] = alvo;
    // A busca no texto aceita o que procurar no alvo.
    else if (acao.texto && (texto === undefined || texto === null)) args[acao.texto] = alvo;
    else throw new ToolError("E_BAD_ARGS", `${acaoLabel(acao)} não tem alvo`);
  }
  if (texto !== undefined && texto !== null) {
    if (!acao.texto) throw new ToolError("E_BAD_ARGS", `${acaoLabel(acao)} não tem texto`);
    args[acao.texto] = texto;
  }
  const validas = opcoesDe(acao);
  for (const [k, v] of Object.entries(opcoes)) {
    const nome = validas.get(k) ?? validas.get(fold(k));
    if (!nome) {
      const lista = [...new Set(Object.keys(acao.nomes ?? {}).concat([...validas.keys()].filter((x) => !Object.values(acao.nomes ?? {}).includes(x))))];
      throw new ToolError("E_BAD_ARGS", `${acaoLabel(acao)} não tem a opção ${k}${lista.length ? `; as opções dela: ${lista.join(", ")}` : "; ela não tem opções"}`);
    }
    args[nome] = v;
  }
  // Criar: o alvo pode ser o caminho da nota nova (`Projetos/Ideias`): a pasta e o título.
  // Só o alvo: um título mandado em opcoes.titulo fica como veio (o notes_create já cuida das barras nele).
  if (acao.tool === "notes_create" && typeof alvo === "string" && args.title === alvo && args.folder === undefined) {
    const i = alvo.lastIndexOf("/");
    if (i >= 0) args.folder = alvo.slice(0, i);
    args.title = alvo.slice(i + 1).replace(/\.md$/i, "");
  }
  return { acao, tool: acao.tool, args };
}

/**
 * O contrário: a chamada da `kiwi` que leva a uma ação de dentro com estes argumentos. O agente falso e a bateria
 * falam assim; o teste confere a volta (`resolveKiwiCall(kiwiCallFor(t, a))` dá `t` e `a`).
 */
export function kiwiCallFor(tool: string, args: Record<string, unknown> = {}): Record<string, unknown> {
  const acao = acaoDe(tool);
  if (!acao) throw new Error(`o Kiwi não tem a ação ${tool}`);
  const opcoes: Record<string, unknown> = acao.padrao ? {} : { como: acao.como };
  const inverso = Object.fromEntries(Object.entries(acao.nomes ?? {}).map(([k, v]) => [v, k]));
  const out: Record<string, unknown> = { fazer: acao.fazer };
  // Criar: o alvo é o caminho da nota nova; um título com barra vai como título, e não vira pasta.
  if (acao.tool === "notes_create" && typeof args.title === "string") {
    const { folder, title, ...rest } = args;
    if (title.includes("/")) Object.assign(opcoes, { titulo: title }, folder !== undefined ? { pasta: folder } : {});
    else out.alvo = typeof folder === "string" && folder ? `${folder}/${title}` : title;
    args = rest;
  }
  for (const [k, v] of Object.entries(args)) {
    if (k === acao.alvo) out.alvo = v;
    else if (k === acao.texto) out.texto = v;
    else opcoes[inverso[k] ?? k] = v;
  }
  if (Object.keys(opcoes).length) out.opcoes = opcoes;
  return out;
}

/**
 * O cartão de instrução de uma ação (ADR 0013 peças 2 e 6): a descrição longa e os campos, que saíram da lista fixa.
 * Vai no pacote quando o pedido precisa, e volta no erro de uma chamada sem os campos.
 */
export function instructionCard(acao: Acao): string {
  const def = KIWI_TOOLS.find((t) => t.name === acao.tool)!;
  const props = { ...((def.inputSchema.properties ?? {}) as Record<string, unknown>) };
  if (acao.alvo) delete props[acao.alvo];
  if (acao.texto) delete props[acao.texto];
  const inverso = Object.fromEntries(Object.entries(acao.nomes ?? {}).map(([k, v]) => [v, k]));
  const campos = Object.fromEntries(Object.entries(props).map(([k, v]) => [inverso[k] ?? k, servedSchemaOf(v)]));
  const onde = [acao.alvo ? `alvo: ${acao.alvo}` : "", acao.texto ? `texto: ${acao.texto}` : ""].filter(Boolean).join("; ");
  return [
    `[Instruções do Kiwi: ${acaoLabel(acao)}, isto é, {fazer: "${acao.fazer}", opcoes: {como: "${acao.como}", …}}${onde ? ` (${onde})` : ""}.`,
    vocab(def.description),
    `opcoes: ${JSON.stringify(campos)}]`,
  ].join("\n");
}

/** As ações que têm cartão. */
export const CARD_ACOES = ACOES.filter((a) => a.cartao);

/**
 * Os cartões que um pedido precisa, pelas palavras dele (sem modelo). É barato errar para mais (um cartão a mais pesa
 * umas centenas de tokens, uma vez); errar para menos custa uma ida, quando a chamada volta com o cartão.
 */
export function cardsFor(request: string): Acao[] {
  const t = fold(request);
  const has = (re: RegExp) => re.test(t);
  const out: string[] = [];
  const criar = has(/\b(ger[ae]\w*|cri[ae]\w*|mont[ae]\w*|fa(z|ca|zer)|export\w*|salv[ae]\w*)\b/);
  if (criar && has(/\b(planilha|xlsx|csv|docx|word|excel|pdf|documento|arquivo)\b/)) out.push("files_create");
  if (has(/\borganiz\w*\b.*\b(pasta|todas as notas)\b/)) out.push("notes_organize_folder");
  if (has(/\breunia?o\b|\breunioes\b/) && has(/\b(propo\w*|proposta|ata|registr\w*|projeto)\b/)) out.push("meeting_propose");
  if (has(/\bresumo executivo\b|\b(status|ponto|situacao) d[oe]s? projeto\b|\bcomo (esta|anda|vai) o projeto\b/)) out.push("project_summary_propose");
  if (has(/\breferencias?\b|\blinks?\b|\bdocumentacao\b/)) out.push("notes_add_references");
  if (has(/\brotina\b|\btodo dia\b|\btodos os dias\b|\btoda (semana|segunda|terca|quarta|quinta|sexta|manha|tarde|noite)\b|\bdiariamente\b|\bsemanalmente\b|\bdias uteis\b/)) out.push("routine_propose");
  return CARD_ACOES.filter((a) => out.includes(a.tool));
}

/** O bloco dos cartões no pedido, ou "" sem nenhum. */
export const CARDS_END = "[/Instruções do Kiwi]";
export function cardsBlock(acoes: readonly Acao[]): string {
  return acoes.length ? `${acoes.map(instructionCard).join("\n\n")}\n${CARDS_END}` : "";
}

/** O que a sessão pode: as mesmas regras de `kiwiTools`, pela ação de dentro. */
export interface KiwiAllowed {
  writes: boolean;
  proposes: boolean;
  memory: boolean;
}

/** A definição da ferramenta única, como vai na lista: a mesma em toda sessão. */
export const KIWI_TOOL_DEF = {
  name: KIWI_TOOL,
  title: "Kiwi Notes",
  description: [
    "As notas, pastas, projetos, reuniões e arquivos da pessoa no Kiwi Notes. Uma ação por chamada:",
    'fazer "achar" (opcoes.como: nome, o padrão, acha pelo nome falado e devolve o cartão; texto, busca no texto; pasta; reunioes; projetos).',
    'fazer "ler" (nota, o padrão, com opcoes.secao; sumario; reuniao; arquivo, com opcoes.parte; projeto). A leitura devolve a versao.',
    'fazer "escrever" (acrescentar, o padrão; trecho, troca opcoes.de pelo texto; trocar; mover; renomear; juntar; criar, alvo Pasta/Título; diario). Só a diferença, com a versao do cartão. Nada apaga uma nota; o antes fica nas Versões.',
    'fazer "propor" e as ações organizar e arquivo trazem as instruções no pedido, quando ele precisa. fazer "lembrar": um fato sobre a pessoa (opcoes.como esquecer, para tirar).',
    "O alvo aceita o caminho ou o nome como a pessoa fala. Nos textos do Kiwi, kiwi ler/sumario quer dizer fazer ler, opcoes.como sumario.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      fazer: { type: "string", enum: [...FAZER] },
      alvo: { type: "string", description: "A nota, pasta, projeto, reunião ou arquivo." },
      texto: { type: "string", description: "O texto a escrever, o que procurar ou o fato." },
      opcoes: { type: "object", description: "como, secao, versao, offset, parte e os campos das instruções." },
    },
    required: ["fazer"],
  },
} as const;

export interface KiwiCallResult extends ToolResult {
  /** A ação de dentro: é ela que a Atividade e o status mostram. */
  tool: KiwiToolName;
}

/**
 * Roda uma chamada da `kiwi`: resolve a ação, confere se a sessão pode, e roda a ação de dentro. Os erros e os avisos
 * do Kiwi falam o jeito de chamar de hoje; uma ação de cartão com erro nos campos devolve o cartão.
 */
export async function runKiwiCall(ctx: KiwiToolContext, raw: unknown, allowed: KiwiAllowed): Promise<KiwiCallResult> {
  let call: KiwiCall;
  try {
    call = resolveKiwiCall(raw);
  } catch (e) {
    throw e instanceof ToolError ? new ToolError(e.code, vocabMensagem(e.message)) : e;
  }
  const { acao } = call;
  const def = KIWI_TOOLS.find((t) => t.name === acao.tool)!;
  if ((def.writes && !allowed.writes) || (def.proposes && !allowed.proposes) || (def.memory && !allowed.memory)) {
    throw Object.assign(new ToolError("E_NOT_ALLOWED", `${acaoLabel(acao)} não está ligado nesta sessão: ${def.writes ? "o Kiwi só lê" : def.proposes ? "sem propostas" : "sem a memória"}`), { tool: acao.tool });
  }
  try {
    const r = await runKiwiTool(ctx, acao.tool, call.args);
    if (typeof r.value.aviso === "string") r.value = { ...r.value, aviso: vocabMensagem(r.value.aviso) };
    return { ...r, tool: acao.tool };
  } catch (e) {
    const err = e instanceof ToolError ? e : new ToolError("E_FAILED", String((e as Error)?.message ?? e));
    // Os modos do escrever (trecho, mover, renomear, juntar) não cabem na lista sem pesar em toda ida (T14650): o
    // erro de forma de qualquer escrita volta com o cartão dela, com os campos pelos nomes da kiwi.
    const card = (acao.cartao || acao.fazer === "escrever") && err.code === "E_BAD_ARGS" ? `\n\n${instructionCard(acao)}` : "";
    throw Object.assign(new ToolError(err.code, `${vocabMensagem(err.message)}${card}`), { tool: acao.tool });
  }
}

/** A ação de um erro da `runKiwiCall`, quando ela chegou a ser resolvida. */
export const toolOfError = (e: unknown): KiwiToolName | undefined => (e as { tool?: KiwiToolName })?.tool;
