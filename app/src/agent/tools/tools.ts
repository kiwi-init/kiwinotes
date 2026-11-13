// As ferramentas do Kiwi para o agente (spec #7496): seis, todas só de leitura. Elas devolvem o texto como está, sem
// resumir, classificar nem escolher pelo agente, e cada resposta tem um teto: o que passa dele vem com o `proximoOffset`
// para continuar de onde parou, e um aviso de que há mais.
//
// Os nomes usam sublinhado (`notes_search`): a API do Claude só aceita `[a-zA-Z0-9_-]` no nome de uma ferramenta. No
// Claude Code, elas aparecem como `mcp__kiwi__notes_search` etc.

import { splitMeetingNote, transcriptSection, isMeetingNote } from "../../shared/meeting-note.ts";
import { markdownStructure, headingFor } from "../../shared/markdown-structure.ts";
import type { VaultReader } from "./reader.ts";

/** O maior trecho de texto que `notes_read` e `meetings_get` devolvem de uma vez, em caracteres. */
export const READ_MAX_CHARS = 12_000;
/** O máximo de resultados do `notes_search`, e o padrão. */
export const SEARCH_MAX = 30;
export const SEARCH_DEFAULT = 10;
/** Quantas entradas o `notes_list` e o `meetings_list` devolvem por vez. */
export const LIST_PAGE = 200;
export const MEETINGS_PAGE = 50;
/** O máximo de seções no sumário. */
export const OUTLINE_MAX = 300;

export const KIWI_TOOL_NAMES = ["notes_search", "notes_outline", "notes_read", "notes_list", "meetings_list", "meetings_get"] as const;
export type KiwiToolName = (typeof KIWI_TOOL_NAMES)[number];

export interface KiwiToolDef {
  name: KiwiToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
    description: `Lê uma nota inteira, ou só uma seção dela, como está no arquivo. Devolve até ${READ_MAX_CHARS} caracteres por vez: quando há mais, a resposta traz o proximoOffset para continuar.`,
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
];

/** Um erro que o agente lê: o código do Kiwi e o motivo. A ferramenta responde com `isError`. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolResult {
  /** O que o agente recebe, já em JSON. */
  value: Record<string, unknown>;
  /** O que a pessoa vê no status ao vivo: o caminho lido, ou o que foi procurado. */
  target?: string;
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
  const headings = markdownStructure(content).headings;
  const h = headingFor(headings, title);
  if (!h) return null;
  const next = headings.find((x) => x.from > h.from && x.level <= h.level);
  return { titulo: h.title, texto: content.slice(h.from, next ? next.from : content.length) };
}

/** As marcas internas de cada bloco da transcrição (`%%meeting-segment:…%%`): são do Kiwi, não do que foi dito. */
const SEGMENT_REF = /[ \t]*%%meeting-segment:[0-9a-f]{24} \{[^\n]*?\}%%/g;

/** Roda uma ferramenta. Um erro do cofre (`E_NOT_FOUND`, `E_OUTSIDE_VAULT`, `E_BAD_ARGS`) vira um `ToolError`. */
export async function runKiwiTool(reader: VaultReader, name: string, raw: unknown): Promise<ToolResult> {
  try {
    return await run(reader, name, raw);
  } catch (e) {
    if (e instanceof ToolError) throw e;
    const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "E_FAILED";
    throw new ToolError(code, String((e as Error)?.message ?? e));
  }
}

async function run(reader: VaultReader, name: string, raw: unknown): Promise<ToolResult> {
  switch (name) {
    case "notes_search": {
      const a = args(raw, ["query", "limit"]);
      const query = str(a, "query", true, 500)!;
      if (!query.trim()) throw new ToolError("E_BAD_ARGS", "query está vazio");
      const limit = int(a, "limit", 1, SEARCH_MAX) ?? SEARCH_DEFAULT;
      const hits = (await reader.search(query, limit)).slice(0, limit);
      const resultados = hits.map((h) => ({
        path: h.path,
        titulo: h.title,
        trecho: h.snippet,
        ...(h.semantic ? { como: "pelo sentido" } : h.approx ? { como: "aproximado" } : {}),
      }));
      return { value: { query, resultados }, target: `"${query}"` };
    }
    case "notes_outline": {
      const a = args(raw, ["path"]);
      const n = await reader.get(str(a, "path", true)!);
      const headings = markdownStructure(n.content).headings;
      const secoes = headings.slice(0, OUTLINE_MAX).map((h, i) => {
        const next = headings.slice(i + 1).find((x) => x.level <= h.level);
        return { nivel: h.level, titulo: h.title, caracteres: (next ? next.from : n.content.length) - h.from };
      });
      return {
        value: {
          path: n.path,
          titulo: n.title,
          caracteres: n.content.length,
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
      if (section !== undefined && section.trim()) {
        const s = sectionOf(n.content, section);
        if (!s) throw new ToolError("E_NOT_FOUND", `a nota ${n.path} não tem a seção "${section}"; veja os títulos com notes_outline`);
        return { value: { path: n.path, titulo: n.title, secao: s.titulo, ...chunk(s.texto, offset) }, target: `${n.path} › ${s.titulo}` };
      }
      return { value: { path: n.path, titulo: n.title, ...chunk(n.content, offset) }, target: n.path };
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
      const { body } = splitMeetingNote(n.content);
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
    default:
      throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
  }
}
