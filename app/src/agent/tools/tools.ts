// As ferramentas do Kiwi para o agente. As seis de leitura (spec #7496) devolvem o texto como está, sem resumir,
// classificar nem escolher pelo agente, e cada resposta tem um teto: o que passa dele vem com o `proximoOffset` para
// continuar de onde parou, e um aviso de que há mais.
//
// As três de escrita (spec #8356) só existem com um `writer`: `notes_create`, `notes_append` e `notes_write`.
// - **Uma edição da pessoa nunca se perde:** o `notes_read` devolve a `versao` da nota, e trocar um texto exige a versão
//   lida. A gravação confere de novo (o `save` condicional do cofre); se a nota mudou no meio, nada é escrito.
// - **A cópia de antes:** antes de cada escrita, o `journal` guarda o texto anterior (o registro do agente), e o `writer`
//   guarda o mesmo texto nas Versões da nota.
// - **Só notas comuns:** uma nota de reunião é recusada, e também a escrita que deixaria uma nota com cara de reunião.
// - **Nada apaga, renomeia nem move.** E cada escrita tem o teto de `WRITE_MAX_CHARS`.
//
// Os nomes usam sublinhado (`notes_search`): a API do Claude só aceita `[a-zA-Z0-9_-]` no nome de uma ferramenta. No
// Claude Code, elas aparecem como `mcp__kiwi__notes_search` etc.

import { splitMeetingNote, transcriptSection, isMeetingNote } from "../../shared/meeting-note.ts";
import { markdownStructure, headingFor, type NoteHeading } from "../../shared/markdown-structure.ts";
import { STATUS_OUTLINE_MAX, STATUS_RECENT } from "../../notes/projects.ts";
import type { VaultReader } from "./reader.ts";
import type { VaultWriter, WriterNote } from "./writer.ts";
import { removedSecrets, type DoubtDecider, type SecretGuard } from "../../guardrail/filter.ts";

/** O maior trecho de texto que `notes_read` e `meetings_get` devolvem de uma vez, em caracteres. */
export const READ_MAX_CHARS = 12_000;
/**
 * O maior texto de uma escrita, em caracteres (spec #8356). Fica abaixo do teto do corpo do servidor (`MAX_BODY`),
 * para o que passar chegar aqui e voltar com um aviso claro, e não com um erro do HTTP.
 */
export const WRITE_MAX_CHARS = 40_000;
/** O máximo de resultados do `notes_search`, e o padrão. */
export const SEARCH_MAX = 30;
export const SEARCH_DEFAULT = 10;
/** Quantas entradas o `notes_list` e o `meetings_list` devolvem por vez. */
export const LIST_PAGE = 200;
export const MEETINGS_PAGE = 50;
/** O máximo de seções no sumário. */
export const OUTLINE_MAX = 300;

export const KIWI_READ_TOOL_NAMES = [
  "notes_search",
  "notes_outline",
  "notes_read",
  "notes_list",
  "meetings_list",
  "meetings_get",
  "projects_list",
  "project_status",
] as const;
export const KIWI_WRITE_TOOL_NAMES = ["notes_create", "notes_append", "notes_write"] as const;
export const KIWI_TOOL_NAMES = [...KIWI_READ_TOOL_NAMES, ...KIWI_WRITE_TOOL_NAMES] as const;
export type KiwiToolName = (typeof KIWI_TOOL_NAMES)[number];

export interface KiwiToolDef {
  name: KiwiToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Escreve no cofre (spec #8356): só aparece com um `writer`. */
  writes?: true;
  /** Pode trocar um texto que já existia (o `notes_write`). */
  replaces?: true;
}

const offsetProp = {
  type: "integer",
  minimum: 0,
  description: "Onde continuar, em caracteres: o `proximoOffset` da resposta anterior. Comece sem ele.",
};

/** O que o `tools/list` do MCP devolve. As anotações dizem que nenhuma escreve nem sai do Mac. */
export const KIWI_TOOLS: readonly KiwiToolDef[] = [
  {
    name: "notes_search",
    title: "Procurar nas notas",
    description:
      "Procura nas notas do Kiwi pelas palavras e, se a busca pelo sentido estiver ligada, pelo assunto. Devolve o caminho, o título e um trecho de cada nota achada. Use antes de ler, para achar o que precisa sem ler tudo. Aceita \"frases\", tag:x, path:pasta e -palavra.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500, description: "O que procurar." },
        limit: { type: "integer", minimum: 1, maximum: SEARCH_MAX, description: `Quantos resultados (padrão ${SEARCH_DEFAULT}, máximo ${SEARCH_MAX}).` },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "notes_outline",
    title: "Sumário de uma nota",
    description:
      "O sumário de uma nota: os títulos, o nível e o tamanho de cada seção, em caracteres. Use para escolher a seção a ler com notes_read, em vez de ler a nota inteira.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "O caminho da nota, como o notes_search ou o notes_list devolvem (ex.: Projetos/Kiwi.md)." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "notes_read",
    title: "Ler uma nota",
    description: `Lê uma nota inteira, ou só uma seção dela, como está no arquivo. Devolve até ${READ_MAX_CHARS} caracteres por vez: quando há mais, a resposta traz o proximoOffset para continuar. A resposta traz também a versao da nota, que o notes_write pede para mudar o texto.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "O caminho da nota (ex.: Projetos/Kiwi.md)." },
        section: { type: "string", description: "O título de uma seção, como o notes_outline mostra. Sem ele, a nota inteira." },
        offset: offsetProp,
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "notes_list",
    title: "Listar uma pasta",
    description: `As pastas e as notas de dentro de uma pasta do Kiwi (só as de primeiro nível), com o tamanho e a última mudança. Até ${LIST_PAGE} notas por vez.`,
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "A pasta (ex.: Projetos). Vazio ou sem ele: a raiz." },
        offset: { type: "integer", minimum: 0, description: "Onde continuar: o proximoOffset da resposta anterior." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "meetings_list",
    title: "Listar as reuniões",
    description: `As reuniões gravadas no Kiwi, da mais nova para a mais velha: o caminho da nota, o título, o dia, a duração, o app e os participantes. Até ${MEETINGS_PAGE} por vez.`,
    inputSchema: {
      type: "object",
      properties: { offset: { type: "integer", minimum: 0, description: "Onde continuar: o proximoOffset da resposta anterior." } },
      additionalProperties: false,
    },
  },
  {
    name: "meetings_get",
    title: "Ler uma reunião",
    description: `A transcrição de uma reunião gravada, como está na nota, com o dia, a duração e os participantes. Até ${READ_MAX_CHARS} caracteres por vez: quando há mais, a resposta traz o proximoOffset. As anotações da pessoa ("Minhas notas") se leem com notes_read.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "O caminho da nota da reunião, como o meetings_list devolve." },
        offset: offsetProp,
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "projects_list",
    title: "Listar os projetos",
    description:
      "Os projetos do Kiwi: as pastas que a pessoa marcou como projeto, cada uma com a nota principal, a data da última mudança numa nota da pasta e quantas notas ela tem. Só a pessoa marca ou desmarca um projeto.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "project_status",
    title: "Como está um projeto",
    description: `O estado de um projeto, só contado, sem resumo: o sumário da nota principal (os títulos, até ${STATUS_OUTLINE_MAX}), as ${STATUS_RECENT} notas da pasta mudadas por último, com a data, e quantas caixas de tarefa abertas (- [ ]) há em cada nota da pasta, com o total. As datas são a hora do arquivo. Para ler uma nota, use notes_read.`,
    inputSchema: {
      type: "object",
      properties: { projeto: { type: "string", description: "A pasta do projeto, ou o nome dele, como o projects_list devolve (ex.: Projetos/Kiwi ou Kiwi)." } },
      required: ["projeto"],
      additionalProperties: false,
    },
  },
  {
    name: "notes_create",
    title: "Criar uma nota",
    description: `Cria uma nota nova numa pasta do Kiwi, com o título e o texto em Markdown. Se já existe uma nota com esse título na pasta, a nova ganha um número ("Título 2"): a resposta diz o caminho que ela ganhou. Até ${WRITE_MAX_CHARS} caracteres. Não cria notas de reunião.`,
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "A pasta (ex.: Projetos). Vazio ou sem ele: a raiz. Uma pasta que não existe é criada." },
        title: { type: "string", minLength: 1, maxLength: 200, description: "O título, que vira o nome do arquivo." },
        text: { type: "string", maxLength: WRITE_MAX_CHARS, description: "O texto da nota, em Markdown." },
      },
      required: ["title", "text"],
      additionalProperties: false,
    },
    writes: true,
  },
  {
    name: "notes_append",
    title: "Acrescentar numa nota",
    description: `Acrescenta texto no fim de uma nota, ou no fim de uma seção dela, sem mudar o que já está lá. O texto entra numa linha nova, logo depois da última linha; para um parágrafo separado, comece o texto com uma linha em branco. Até ${WRITE_MAX_CHARS} caracteres. Com a versao (do notes_read), a escrita é recusada se a nota mudou depois que você leu.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "O caminho da nota (ex.: Projetos/Kiwi.md)." },
        text: { type: "string", minLength: 1, maxLength: WRITE_MAX_CHARS, description: "O texto a acrescentar, em Markdown." },
        section: { type: "string", description: "O título de uma seção, como o notes_outline mostra: o texto entra no fim dela. Sem ele, no fim da nota." },
        version: { type: "string", description: "A versao que o notes_read devolveu. Opcional." },
      },
      required: ["path", "text"],
      additionalProperties: false,
    },
    writes: true,
  },
  {
    name: "notes_write",
    title: "Trocar o texto de uma nota",
    description: `Troca o texto de uma seção, ou da nota inteira. Leia antes com notes_read e mande a versao que ele devolveu: se a nota mudou depois disso, nada é escrito e você precisa ler de novo. Com section, troca só o que está abaixo do título (o título fica). Sem section, o texto vira a nota inteira, com o frontmatter. Até ${WRITE_MAX_CHARS} caracteres: para uma nota maior, troque por seção. O texto de antes fica guardado nas Versões da nota.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "O caminho da nota (ex.: Projetos/Kiwi.md)." },
        text: { type: "string", maxLength: WRITE_MAX_CHARS, description: "O texto novo, em Markdown." },
        version: { type: "string", description: "A versao que o notes_read devolveu." },
        section: { type: "string", description: "O título de uma seção, como o notes_outline mostra. Sem ele, a nota inteira." },
      },
      required: ["path", "text", "version"],
      additionalProperties: false,
    },
    writes: true,
    replaces: true,
  },
];

/** As ferramentas que o servidor oferece: as de escrita só com um `writer`. */
export function kiwiTools(writes: boolean): readonly KiwiToolDef[] {
  return writes ? KIWI_TOOLS : KIWI_TOOLS.filter((t) => !t.writes);
}

/** Um erro que o agente lê: o código do Kiwi e o motivo. A ferramenta responde com `isError`. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Uma mudança que uma ferramenta de escrita fez (spec #8356): vai para o registro do agente. */
export interface ToolChange {
  kind: "created" | "appended" | "replaced";
  path: string;
  section?: string;
  /** O tamanho, em caracteres, antes (0 numa nota criada) e depois. */
  before: number;
  after: number;
  /** A versão que a escrita deixou: o desfazer confere que a nota ainda está nela. */
  version: string;
  /** A cópia do texto de antes no registro (`journal.keep`); não há numa nota criada. */
  copy?: string;
  /** A pasta de notas aberta quando a escrita aconteceu (o id), se o app troca de pasta. */
  folder?: string;
  /** Quantos segredos da nota a escrita tirou (o agente trocou o trecho sem mandar o marcador de volta; spec #9818). */
  removedSecrets?: number;
}

export interface ToolResult {
  /** O que o agente recebe, já em JSON. */
  value: Record<string, unknown>;
  /** O que a pessoa vê no status ao vivo: o caminho lido ou escrito, ou o que foi procurado. */
  target?: string;
  /** O que mudou no cofre, numa ferramenta de escrita. */
  change?: ToolChange;
  /** Quantos segredos o filtro segurou no que esta leitura entregou (spec #9818): só a contagem, nunca o valor. */
  held?: number;
}

/**
 * Onde fica a cópia do texto de antes de cada escrita (o registro do agente, spec #8356). O `keep` termina antes da
 * escrita começar; se ela não acontece, o `drop` tira a cópia.
 */
export interface WriteJournal {
  keep(path: string, before: string): Promise<string>;
  drop(copy: string): Promise<void>;
}

/** O que as ferramentas usam: o leitor sempre; o escritor e o registro só para as de escrita. */
export interface KiwiToolContext {
  reader: VaultReader;
  writer?: VaultWriter;
  journal?: WriteJournal;
  /** O filtro do guardrail (spec #9818): o que sai para o agente vai sem os segredos, e a escrita os põe de volta. */
  guard?: SecretGuard;
  /** Quem decide a dúvida (spec #9873): a resposta guardada ou a pergunta à pessoa. Sem ele, a dúvida é segurada. */
  decider?: DoubtDecider;
}

function args(raw: unknown, allowed: string[]): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ToolError("E_BAD_ARGS", "os argumentos devem ser um objeto");
  const a = raw as Record<string, unknown>;
  const extra = Object.keys(a).find((k) => !allowed.includes(k));
  if (extra) throw new ToolError("E_BAD_ARGS", `campo desconhecido: ${extra}`);
  return a;
}

function str(a: Record<string, unknown>, key: string, required: boolean, max = 1024): string | undefined {
  const v = a[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolError("E_BAD_ARGS", `falta o campo ${key}`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolError("E_BAD_ARGS", `${key} deve ser texto`);
  if (v.length > max) throw new ToolError("E_BAD_ARGS", `${key} passa de ${max} caracteres`);
  return v;
}

function int(a: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = a[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new ToolError("E_BAD_ARGS", `${key} deve ser um inteiro de ${min} a ${max}`);
  return v;
}

/**
 * Um pedaço de `text` a partir de `offset`, com até `max` caracteres. Corta numa quebra de linha quando há uma na 2ª
 * metade do pedaço, para não partir uma linha ao meio, e diz onde continuar.
 */
export function chunk(text: string, offset = 0, max = READ_MAX_CHARS): { texto: string; offset: number; total: number; proximoOffset?: number; aviso?: string } {
  const total = text.length;
  if (offset > total) throw new ToolError("E_BAD_ARGS", `offset ${offset} passa do fim (${total} caracteres)`);
  let end = Math.min(total, offset + max);
  if (end < total) {
    const nl = text.lastIndexOf("\n", end - 1);
    if (nl >= offset + max / 2) end = nl + 1;
    // Não parte um par substituto (um emoji) ao meio.
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    // Nem um marcador do filtro (spec #9818): metade dele não volta na escrita.
    const open = text.lastIndexOf("‹segredo ", end - 1);
    if (open > offset && open < end) {
      const close = text.indexOf("›", open);
      if (close >= end) end = open;
    }
  }
  const out: { texto: string; offset: number; total: number; proximoOffset?: number; aviso?: string } = { texto: text.slice(offset, end), offset, total };
  if (end < total) {
    out.proximoOffset = end;
    out.aviso = `Há mais: ${total - end} caracteres depois deste trecho. Chame de novo com offset=${end} para continuar.`;
  }
  return out;
}

/** O texto de uma seção: do título até o próximo título do mesmo nível ou acima (como o `![[nota#Título]]`). */
function sectionOf(content: string, title: string): { titulo: string; texto: string } | null {
  const s = sectionSpan(content, title);
  return s ? { titulo: s.heading.title, texto: content.slice(s.heading.from, s.end) } : null;
}

/**
 * Onde fica uma seção: o título, onde começa o texto abaixo dele (depois da quebra de linha do título) e onde ela acaba
 * (no próximo título do mesmo nível ou acima, ou no fim da nota). `last` diz se ela vai até o fim da nota.
 */
function sectionSpan(content: string, title: string): { heading: NoteHeading; body: number; end: number; last: boolean } | null {
  const headings = markdownStructure(content).headings;
  const h = headingFor(headings, title);
  if (!h) return null;
  const next = headings.find((x) => x.from > h.from && x.level <= h.level);
  const eol = /^\r?\n/.exec(content.slice(h.to));
  return { heading: h, body: h.to + (eol ? eol[0].length : 0), end: next ? next.from : content.length, last: !next };
}

/** Tira as quebras de linha do fim. */
const trimEndNewlines = (s: string) => s.replace(/(?:\r?\n)+$/, "");

/**
 * Acrescenta `text` a `base` (a nota inteira, ou o texto de uma seção), numa linha nova depois da última linha. O que
 * já está lá não muda, menos as linhas em branco do fim. `last`: vai até o fim da nota (termina numa quebra de linha);
 * senão, uma linha em branco separa do próximo título.
 */
function appendTo(base: string, text: string, last: boolean): string {
  const core = trimEndNewlines(base);
  const added = trimEndNewlines(text);
  // Uma 1ª linha só de `=` ou de `-` (um separador `---`) colada abaixo de um parágrafo o transformaria num título
  // setext: a frase da pessoa viraria título (revisão do T9251). Só aí entra a linha em branco; o resto continua colado,
  // para uma lista acrescentada a uma lista seguir a mesma lista (#9305).
  const sep = SETEXT_UNDERLINE.test(added.split(/\r?\n/, 1)[0]!) ? "\n\n" : "\n";
  const joined = core ? `${core}${sep}${added}` : added;
  return joined + (last ? "\n" : "\n\n");
}

/** Uma linha que sublinha o parágrafo de cima e o faz título (o "setext" do Markdown). */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/** O texto que fica abaixo de um título, trocado: a linha em branco depois do título se mantém, como estava. */
function replaceBody(oldBody: string, text: string, last: boolean): string {
  const lead = /^\r?\n/.test(oldBody) ? "\n" : "";
  const core = trimEndNewlines(text.replace(/^(?:\r?\n)+/, ""));
  if (!core) return last ? "" : "\n";
  return lead + core + (last ? "\n" : "\n\n");
}

/** Recusa o que o agente não pode mudar: uma nota que não é UTF-8, ou uma nota de reunião (spec #8356). */
function writable(n: WriterNote): void {
  if (n.readOnly) throw new ToolError("E_READ_ONLY", `${n.path} não está em UTF-8: o Kiwi só mostra essa nota, e nada grava nela`);
  if (isMeetingNote(n.content))
    throw new ToolError("E_MEETING_NOTE", `${n.path} é a nota de uma reunião gravada: as reuniões são só para ler`);
}

/** O texto que vai ser gravado não pode virar uma nota de reunião (o `type: meeting` no frontmatter). */
function notMeeting(path: string, content: string): void {
  if (isMeetingNote(content))
    throw new ToolError("E_MEETING_NOTE", `o texto deixaria ${path} com cara de nota de reunião (type: meeting no frontmatter), e o agente não cria nem muda reuniões`);
}

/** O teto de uma escrita, com o que fazer em vez disso. */
function capped(text: string): void {
  if (text.length > WRITE_MAX_CHARS)
    throw new ToolError(
      "E_TOO_LARGE",
      `o texto tem ${text.length} caracteres, e cada escrita aceita até ${WRITE_MAX_CHARS}. Mude por seção (notes_write com section) ou acrescente em partes (notes_append).`,
    );
}

const changed = (path: string) =>
  new ToolError("E_CHANGED", `${path} mudou desde que você leu. Nada foi escrito: leia de novo com notes_read e mande a versao nova.`);

/** Quantas vezes o `notes_append` sem versão tenta de novo, quando a nota muda no meio da gravação. */
const APPEND_TRIES = 3;

/** As marcas internas de cada bloco da transcrição (`%%meeting-segment:…%%`): são do Kiwi, não do que foi dito. */
const SEGMENT_REF = /[ \t]*%%meeting-segment:[0-9a-f]{24} \{[^\n]*?\}%%/g;

/** Roda uma ferramenta. Um erro do cofre (`E_NOT_FOUND`, `E_OUTSIDE_VAULT`, `E_BAD_ARGS`) vira um `ToolError`. */
export async function runKiwiTool(ctx: KiwiToolContext, name: string, raw: unknown): Promise<ToolResult> {
  try {
    if ((KIWI_WRITE_TOOL_NAMES as readonly string[]).includes(name)) {
      if (!ctx.writer || !ctx.journal) throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
      return await write(ctx.writer, ctx.journal, name, raw, ctx.guard);
    }
    const r = await run(ctx.reader, name, raw, ctx.guard, ctx.decider);
    if (ctx.guard) r.held = ctx.guard.heldIn(JSON.stringify(r.value));
    return r;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "E_FAILED";
    throw new ToolError(code, String((e as Error)?.message ?? e));
  }
}

/** As palavras de uma busca, para saber onde ela casa: minúsculas e sem acento, de 2 letras ou mais. */
const fold = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const queryTerms = (q: string) => [...new Set(fold(q).split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length >= 2))];

/** Um trecho de `text` em volta da primeira palavra da busca que aparece (ou o começo), como o agente vê. */
function snippetOf(text: string, terms: string[]): string {
  const f = fold(text);
  const at = terms.map((t) => f.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  let start = Math.max(0, at - 80);
  let end = Math.min(text.length, at + 160);
  // Nunca meio marcador do filtro (revisão do T9833): a borda que cai dentro de um vai para fora dele.
  for (const m of text.matchAll(/‹segredo [^›\n]{0,40}›/g)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (a < start && start < b) start = a;
    if (a < end && end < b) end = b;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** O texto de uma nota como o agente vê: com o filtro, sem os segredos; sem ele, como está. */
async function run(reader: VaultReader, name: string, raw: unknown, guard?: SecretGuard, decider?: DoubtDecider): Promise<ToolResult> {
  /** O texto de uma nota como o agente vê: com o filtro, sem os segredos (a dúvida decidida antes); sem ele, como está. */
  const seen = async (path: string, content: string) => (guard ? (await guard.decide(path, content, decider)).text : content);
  switch (name) {
    case "notes_search": {
      const a = args(raw, ["query", "limit"]);
      const query = str(a, "query", true, 500)!;
      if (!query.trim()) throw new ToolError("E_BAD_ARGS", "query está vazio");
      const limit = int(a, "limit", 1, SEARCH_MAX) ?? SEARCH_DEFAULT;
      const hits = (await reader.search(query, limit)).slice(0, limit);
      const resultados: Record<string, unknown>[] = [];
      const terms = queryTerms(query);
      for (const h of hits) {
        let trecho = h.snippet;
        if (guard) {
          // O trecho sai da nota já filtrada, para um segredo partido na borda não escapar. E a busca não confirma
          // segredo: um achado cujas palavras só aparecem dentro de um segredo não volta.
          const content = (await reader.get(h.path)).content;
          const masked = await seen(h.path, content);
          const inReal = terms.some((t) => fold(content).includes(t));
          const inMasked = terms.some((t) => fold(masked).includes(t));
          if (inReal && !inMasked) continue;
          trecho = snippetOf(masked, inMasked ? terms : []);
        }
        resultados.push({
          path: h.path,
          titulo: h.title,
          trecho,
          ...(h.semantic ? { como: "pelo sentido" } : h.approx ? { como: "aproximado" } : {}),
        });
      }
      return { value: { query, resultados }, target: `"${query}"` };
    }
    case "notes_outline": {
      const a = args(raw, ["path"]);
      const n = await reader.get(str(a, "path", true)!);
      // Os títulos e os tamanhos do texto que o agente vê.
      const content = await seen(n.path, n.content);
      const headings = markdownStructure(content).headings;
      const secoes = headings.slice(0, OUTLINE_MAX).map((h, i) => {
        const next = headings.slice(i + 1).find((x) => x.level <= h.level);
        return { nivel: h.level, titulo: h.title, caracteres: (next ? next.from : content.length) - h.from };
      });
      return {
        value: {
          path: n.path,
          titulo: n.title,
          caracteres: content.length,
          secoes,
          ...(headings.length > OUTLINE_MAX ? { aviso: `A nota tem ${headings.length} títulos; o sumário mostra os ${OUTLINE_MAX} primeiros.` } : {}),
        },
        target: n.path,
      };
    }
    case "notes_read": {
      const a = args(raw, ["path", "section", "offset"]);
      const n = await reader.get(str(a, "path", true)!);
      const section = str(a, "section", false, 500);
      const offset = int(a, "offset", 0, Number.MAX_SAFE_INTEGER) ?? 0;
      // A versão da nota inteira (spec #8356): é ela que o notes_write pede, mesmo lendo uma seção só.
      const versao = n.version ? { versao: n.version } : {};
      // A nota inteira passa pelo filtro, e só depois é cortada: os pedaços e os offsets são do texto que o agente vê.
      const content = await seen(n.path, n.content);
      if (section !== undefined && section.trim()) {
        const s = sectionOf(content, section);
        if (!s) throw new ToolError("E_NOT_FOUND", `a nota ${n.path} não tem a seção "${section}"; veja os títulos com notes_outline`);
        return { value: { path: n.path, titulo: n.title, ...versao, secao: s.titulo, ...chunk(s.texto, offset) }, target: `${n.path} › ${s.titulo}` };
      }
      return { value: { path: n.path, titulo: n.title, ...versao, ...chunk(content, offset) }, target: n.path };
    }
    case "notes_list": {
      const a = args(raw, ["folder", "offset"]);
      const folder = (str(a, "folder", false) ?? "").replace(/^\/+|\/+$/g, "");
      const offset = int(a, "offset", 0, Number.MAX_SAFE_INTEGER) ?? 0;
      const all = await reader.list();
      if (folder && !all.folders.includes(folder)) throw new ToolError("E_NOT_FOUND", `a pasta ${folder} não existe`);
      const childOf = (p: string) => (folder ? p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes("/") : !p.includes("/"));
      const pastas = all.folders.filter(childOf);
      const notes = all.notes.filter((n) => n.folder === folder);
      const page = notes.slice(offset, offset + LIST_PAGE);
      const more = offset + LIST_PAGE < notes.length;
      return {
        value: {
          pasta: folder,
          pastas,
          notas: page.map((n) => ({ path: n.path, titulo: n.title, caracteres: n.size, mudou: n.mtime })),
          total: notes.length,
          ...(more ? { proximoOffset: offset + LIST_PAGE, aviso: `Há mais ${notes.length - offset - LIST_PAGE} notas nesta pasta.` } : {}),
        },
        target: folder || "a raiz das notas",
      };
    }
    case "meetings_list": {
      const a = args(raw, ["offset"]);
      const offset = int(a, "offset", 0, Number.MAX_SAFE_INTEGER) ?? 0;
      const all = await reader.meetings();
      const page = all.slice(offset, offset + MEETINGS_PAGE);
      const more = offset + MEETINGS_PAGE < all.length;
      return {
        value: {
          reunioes: page.map((m) => ({
            path: m.path,
            titulo: m.title,
            dia: m.date,
            inicio: m.start,
            duracaoSegundos: m.duration,
            app: m.app,
            participantes: m.participants,
            ...(m.live ? { gravandoAgora: true } : {}),
          })),
          total: all.length,
          ...(more ? { proximoOffset: offset + MEETINGS_PAGE, aviso: `Há mais ${all.length - offset - MEETINGS_PAGE} reuniões.` } : {}),
        },
        target: "as reuniões",
      };
    }
    case "meetings_get": {
      const a = args(raw, ["path", "offset"]);
      const n = await reader.get(str(a, "path", true)!);
      if (!isMeetingNote(n.content)) throw new ToolError("E_NOT_MEETING", `${n.path} não é a nota de uma reunião gravada; leia com notes_read`);
      const offset = int(a, "offset", 0, Number.MAX_SAFE_INTEGER) ?? 0;
      const meta = (await reader.meetings()).find((m) => m.path === n.path);
      const { body } = splitMeetingNote(await seen(n.path, n.content));
      const at = transcriptSection(body);
      const transcript = (at ? body.slice(at.from, at.to) : "").replace(SEGMENT_REF, "").trim();
      return {
        value: {
          path: n.path,
          titulo: n.title,
          ...(meta ? { dia: meta.date, inicio: meta.start, duracaoSegundos: meta.duration, app: meta.app, participantes: meta.participants } : {}),
          ...(transcript ? {} : { aviso: "A reunião ainda não tem transcrição." }),
          ...chunk(transcript, offset),
        },
        target: n.path,
      };
    }
    case "projects_list": {
      args(raw, []);
      const projetos = (await reader.projects()).map((p) => ({
        nome: p.name,
        pasta: p.folder,
        notaPrincipal: p.main,
        mudou: p.updated,
        notas: p.notes,
        ...(p.main === null ? { aviso: "A nota principal foi apagada; a pessoa ainda não escolheu outra." } : {}),
      }));
      return { value: { projetos, total: projetos.length }, target: "os projetos" };
    }
    case "project_status": {
      const a = args(raw, ["projeto"]);
      const want = str(a, "projeto", true)!.replace(/^\/+|\/+$/g, "");
      const all = await reader.projects();
      const byFolder = all.find((p) => p.folder === want);
      const byName = all.filter((p) => p.name.toLocaleLowerCase("pt-BR") === want.toLocaleLowerCase("pt-BR"));
      const p = byFolder ?? (byName.length === 1 ? byName[0] : undefined);
      if (!p) {
        if (byName.length > 1) throw new ToolError("E_AMBIGUOUS", `há ${byName.length} projetos chamados ${want}; diga a pasta: ${byName.map((x) => x.folder).join(", ")}`);
        throw new ToolError("E_NOT_FOUND", `${want} não é um projeto; veja os projetos com projects_list`);
      }
      const s = await reader.projectStatus(p.folder);
      let unread = false;
      // O sumário são os títulos de dentro da nota principal, texto da nota: com o filtro do guardrail (spec #9818),
      // saem do texto que o agente vê, como no notes_outline (revisão da T10012). Os caminhos, os títulos das notas, as
      // datas e as contagens vão como estão.
      if (guard && s.project.main !== null) {
        const main = await reader.get(s.project.main).catch(() => null);
        // Sem conseguir ler de novo (a nota mudou ou sumiu no meio), o sumário não vai: nunca o do texto sem o filtro.
        const headings = main ? markdownStructure(seen(guard, main.path, main.content)).headings : [];
        s.outlineTotal = headings.length;
        s.outline = headings.slice(0, STATUS_OUTLINE_MAX).map((h) => ({ level: h.level, title: h.title }));
        if (!main) unread = true;
      }
      const avisos = [
        ...(unread ? ["Não deu para ler a nota principal agora; o sumário ficou de fora. Tente de novo."] : []),
        ...(s.project.main === null ? ["A nota principal foi apagada; a pessoa ainda não escolheu outra."] : []),
        ...(s.outlineTotal > s.outline.length ? [`A nota principal tem ${s.outlineTotal} títulos; o sumário mostra os ${s.outline.length} primeiros.`] : []),
        ...(s.taskNotes > s.tasks.length ? [`${s.taskNotes} notas têm tarefas abertas; a lista mostra as ${s.tasks.length} com mais.`] : []),
      ];
      return {
        value: {
          projeto: s.project.name,
          pasta: s.project.folder,
          notaPrincipal: s.project.main,
          notas: s.project.notes,
          mudou: s.project.updated,
          sumario: s.outline.map((h) => ({ nivel: h.level, titulo: h.title })),
          recentes: s.recent.map((n) => ({ path: n.path, titulo: n.title, mudou: n.mtime })),
          tarefasAbertas: { total: s.openTasks, notas: s.taskNotes, porNota: s.tasks.map((t) => ({ path: t.path, abertas: t.open })) },
          ...(avisos.length ? { aviso: avisos.join(" ") } : {}),
        },
        target: s.project.name,
      };
    }
    default:
      throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
  }
}

/**
 * Grava `next` por cima de `n`, só se a nota ainda está na versão lida. A cópia do texto de antes vai para o registro
 * antes da gravação (e sai, se a gravação não acontece); o `writer` guarda o mesmo texto nas Versões da nota.
 */
async function commit(
  writer: VaultWriter,
  journal: WriteJournal,
  n: WriterNote,
  next: string,
): Promise<{ saved: true; path: string; version: string; copy: string } | { saved: false }> {
  const copy = await journal.keep(n.path, n.content);
  let r: Awaited<ReturnType<VaultWriter["save"]>>;
  try {
    r = await writer.save(n.path, next, n.version);
  } catch (e) {
    await journal.drop(copy);
    throw e;
  }
  if (!r.saved) {
    await journal.drop(copy);
    return { saved: false };
  }
  return { saved: true, path: r.path, version: r.version, copy };
}

/** Os marcadores do filtro de volta ao original, só na nota de onde saíram (spec #9818). */
const restore = (guard: SecretGuard | undefined, path: string, text: string) => (guard ? guard.write(path, text) : text);
/** Quantos segredos a escrita tirou, para o registro avisar. */
const removed = (before: string, after: string) => {
  const n = removedSecrets(before, after);
  return n ? { removedSecrets: n } : {};
};

async function write(writer: VaultWriter, journal: WriteJournal, name: string, raw: unknown, guard?: SecretGuard): Promise<ToolResult> {
  const folder = await writer.folder();
  const where = folder ? { folder } : {};
  switch (name) {
    case "notes_create": {
      const a = args(raw, ["folder", "title", "text"]);
      const title = str(a, "title", true, 200)!;
      // Uma nota nova não tem segredo dela: um marcador aqui é de outra nota, e a escrita é recusada.
      const text = restore(guard, "\u0000nova", str(a, "text", true, Number.MAX_SAFE_INTEGER)!);
      capped(text);
      const dir = (str(a, "folder", false) ?? "").replace(/^\/+|\/+$/g, "");
      notMeeting(title, text);
      const n = await writer.create(dir, title, text);
      return {
        value: { path: n.path, titulo: n.title, versao: n.version, caracteres: n.content.length },
        target: n.path,
        change: { kind: "created", path: n.path, before: 0, after: n.content.length, version: n.version, ...where },
      };
    }
    case "notes_append": {
      const a = args(raw, ["path", "text", "section", "version"]);
      const path = str(a, "path", true)!;
      const sent = str(a, "text", true, Number.MAX_SAFE_INTEGER)!;
      if (!sent.trim()) throw new ToolError("E_BAD_ARGS", "text está vazio");
      const sentSection = str(a, "section", false, 500)?.trim() || undefined;
      const version = str(a, "version", false, 200);
      // Sem a versão, o Kiwi usa a que acabou de ler; se a nota muda bem no meio, ele lê de novo e tenta outra vez.
      for (let tries = 0; ; tries++) {
        const n = await writer.get(path);
        writable(n);
        if (version !== undefined && version !== n.version) throw changed(n.path);
        // Os marcadores voltam ao original (no texto e no nome da seção) antes de conferir e gravar.
        const text = restore(guard, n.path, sent);
        capped(text);
        const section = sentSection && restore(guard, n.path, sentSection);
        let next: string;
        let titulo: string | undefined;
        if (section) {
          const s = sectionSpan(n.content, section);
          if (!s) throw new ToolError("E_NOT_FOUND", `a nota ${n.path} não tem a seção "${section}"; veja os títulos com notes_outline`);
          titulo = s.heading.title;
          next = n.content.slice(0, s.body) + appendTo(n.content.slice(s.body, s.end), text, s.last) + n.content.slice(s.end);
        } else {
          next = appendTo(n.content, text, true);
        }
        notMeeting(n.path, next);
        const r = await commit(writer, journal, n, next);
        if (!r.saved) {
          if (version !== undefined || tries + 1 >= APPEND_TRIES) throw changed(n.path);
          continue;
        }
        return {
          value: { path: r.path, ...(titulo ? { secao: titulo } : {}), versao: r.version, caracteres: next.length },
          target: titulo ? `${r.path} › ${titulo}` : r.path,
          change: {
            kind: "appended",
            path: r.path,
            ...(titulo ? { section: titulo } : {}),
            before: n.content.length,
            after: next.length,
            version: r.version,
            copy: r.copy,
            ...where,
            ...removed(n.content, next),
          },
        };
      }
    }
    case "notes_write": {
      const a = args(raw, ["path", "text", "version", "section"]);
      const path = str(a, "path", true)!;
      const sent = str(a, "text", true, Number.MAX_SAFE_INTEGER)!;
      const version = str(a, "version", true, 200)!;
      const sentSection = str(a, "section", false, 500)?.trim() || undefined;
      const n = await writer.get(path);
      writable(n);
      if (version !== n.version) throw changed(n.path);
      // Os marcadores voltam ao original (no texto e no nome da seção) antes de conferir e gravar.
      const text = restore(guard, n.path, sent);
      capped(text);
      const section = sentSection && restore(guard, n.path, sentSection);
      let next: string;
      let titulo: string | undefined;
      if (section) {
        const s = sectionSpan(n.content, section);
        if (!s) throw new ToolError("E_NOT_FOUND", `a nota ${n.path} não tem a seção "${section}"; veja os títulos com notes_outline`);
        titulo = s.heading.title;
        // O agente pode mandar o título junto (como o notes_read devolve a seção): ele não sai em dobro.
        const headingLine = n.content.slice(s.heading.from, s.heading.to);
        const sent = text.replace(/^(?:\r?\n)*/, "");
        const rest = sent.slice(headingLine.length);
        const body = sent.startsWith(headingLine) && (rest === "" || /^[ \t]*\r?\n/.test(rest)) ? rest.replace(/^[ \t]*/, "") : text;
        next = n.content.slice(0, s.body) + replaceBody(n.content.slice(s.body, s.end), body, s.last) + n.content.slice(s.end);
      } else {
        next = text;
      }
      notMeeting(n.path, next);
      const r = await commit(writer, journal, n, next);
      if (!r.saved) throw changed(n.path);
      return {
        value: { path: r.path, ...(titulo ? { secao: titulo } : {}), versao: r.version, caracteres: next.length },
        target: titulo ? `${r.path} › ${titulo}` : r.path,
        change: {
          kind: "replaced",
          path: r.path,
          ...(titulo ? { section: titulo } : {}),
          before: n.content.length,
          after: next.length,
          version: r.version,
          copy: r.copy,
          ...where,
          ...removed(n.content, next),
        },
      };
    }
    default:
      throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
  }
}
