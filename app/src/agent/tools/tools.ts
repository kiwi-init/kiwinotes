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
import { FILE_FORMATS, FILES_INDEX_MAX, FILES_READ_MAX_BYTES, FileReadError, fileFormat, readDocument } from "./files.ts";
import { buildFile, CREATE_FORMATS, type CreateContent, type CreateFormat, type DocBlock } from "./files-create.ts";
import type { VaultWriter, WriterNote } from "./writer.ts";
import { FACT_MAX_CHARS, MEMORY_MAX, MemoryError } from "../memory.ts";
import {
  PROPOSAL_CANDIDATES_MAX,
  PROPOSAL_ITEM_CHARS,
  PROPOSAL_LIST_MAX,
  PROPOSAL_TEXT_CHARS,
  PROPOSAL_THEME_CHARS,
  type ProposalAction,
  type ProposalFields,
  type ProposalMeeting,
  type ProposalProject,
} from "../proposals.ts";
import { removedSecrets, type DoubtDecider, type SecretGuard } from "../../guardrail/filter.ts";
import type { SummaryFields, SummarySignal } from "../summary.ts";
import { noteWithReferences, REFERENCES_MAX, type ReferenceItem } from "../references.ts";

/** O maior trecho de texto que `notes_read` e `meetings_get` devolvem de uma vez, em caracteres. */
export const READ_MAX_CHARS = 12_000;
/** O pedaço de texto no modo econômico (spec #11084). */
export const ECONOMY_READ_MAX_CHARS = 4_000;
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
  "files_read",
] as const;
export const KIWI_WRITE_TOOL_NAMES = ["notes_create", "notes_append", "notes_write", "notes_organize_folder", "project_diary_add", "files_create"] as const;
/** O diário do agente num projeto (spec #11469, T11670): a seção no fim da nota principal, uma linha com data por vez. */
export const DIARY_SECTION = "Diário do agente";
/** A maior linha do diário, em caracteres: uma frase, não um relatório. */
export const DIARY_LINE_MAX = 300;
/** Quantas linhas do diário o `project_status` devolve (as últimas). */
export const DIARY_STATUS_LINES = 10;
/** O máximo de notas que um "organizar a pasta" libera de uma vez (spec #11102). */
export const ORGANIZE_MAX = 200;
/** A proposta da reunião (spec #8360): não escreve nada, guarda a proposta para a pessoa aprovar. */
export const KIWI_PROPOSE_TOOL_NAMES = ["meeting_propose", "project_summary_propose", "notes_add_references"] as const;
/** A memória do agente (spec #11469): o que ele sabe sobre a pessoa, em `.kiwi/agente/sobre-mim.md`. */
export const KIWI_MEMORY_TOOL_NAMES = ["memory_remember", "memory_forget"] as const;
export const KIWI_TOOL_NAMES = [...KIWI_READ_TOOL_NAMES, ...KIWI_WRITE_TOOL_NAMES, ...KIWI_PROPOSE_TOOL_NAMES, ...KIWI_MEMORY_TOOL_NAMES] as const;
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
  /** Guarda uma proposta para a pessoa aprovar (spec #8360): só aparece com quem guarda as propostas. */
  proposes?: true;
  /** Muda a memória do agente (spec #11469): só aparece com quem guarda a memória. */
  memory?: true;
}

const offsetProp = {
  type: "integer",
  minimum: 0,
  description: "Onde continuar, em caracteres: o `proximoOffset` da resposta anterior. Comece sem ele.",
};

/** O que o `tools/list` do MCP devolve. As anotações dizem que nenhuma escreve nem sai do Mac. */

/** Um item do resumo executivo com a fonte (spec #11546). */
const SOURCED_PROPS = {
  texto: { type: "string", minLength: 1, maxLength: PROPOSAL_ITEM_CHARS },
  fonte: { type: "string", description: "O caminho da nota ou da reunião de onde veio, como o notes_list ou o meetings_list devolve." },
} as const;
const SOURCED_ITEM = { type: "object", properties: SOURCED_PROPS, required: ["texto", "fonte"], additionalProperties: false } as const;
/** Os limites do `files_create` (spec #11549): o conteúdo que o agente manda numa chamada. */
export const CREATE_ROWS_MAX = 20_000;
export const CREATE_COLUMNS_MAX = 200;
export const CREATE_SHEETS_MAX = 50;
export const CREATE_BLOCKS_MAX = 5_000;
export const CREATE_CELL_CHARS = 5_000;
export const CREATE_TOTAL_CHARS = 2_000_000;
/** Quantas reuniões recentes o resumo mostra, no máximo. */
export const SUMMARY_MEETINGS_MAX = 10;

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
    description: `O estado de um projeto, só contado, sem resumo: o sumário da nota principal (os títulos, até ${STATUS_OUTLINE_MAX}), as ${STATUS_RECENT} notas da pasta mudadas por último, com a data, e quantas caixas de tarefa abertas (- [ ]) há em cada nota da pasta, com o total. As datas são a hora do arquivo. Para ler uma nota, use notes_read. Com o resumo executivo disponível, diz também resumoDesde: o dia de onde "o que andou" do próximo resumo conta (AAAA-MM-DD).`,
    inputSchema: {
      type: "object",
      properties: { projeto: { type: "string", description: "A pasta do projeto, ou o nome dele, como o projects_list devolve (ex.: Projetos/Kiwi ou Kiwi)." } },
      required: ["projeto"],
      additionalProperties: false,
    },
  },
  {
    name: "files_read",
    title: "Ler um arquivo do cofre",
    description: `Lê uma planilha, um documento ou um pdf do cofre (${FILE_FORMATS.join(", ")}) como texto: a planilha vira uma tabela por aba, com o cabeçalho; o docx, o texto com os títulos; o pdf, o texto de cada página. Devolve o sumário (as abas, as páginas, as linhas), o índice das partes e uma parte de cada vez (a 1ª, sem parte). Para ler o resto, peça a parte pelo número. Até 20 MB. Para uma nota (.md), use notes_read.`,
    inputSchema: {
      type: "object",
      properties: {
        caminho: { type: "string", description: "O caminho do arquivo no cofre (ex.: Projetos/Kiwi/vendas.xlsx), como o notes_list ou a nota mostram." },
        parte: { type: "integer", minimum: 1, description: "Qual parte ler, pelo índice; sem ela, a 1ª." },
      },
      required: ["caminho"],
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
  {
    name: "project_diary_add",
    title: "Anotar no diário do projeto",
    description: `Acrescenta uma linha com a data de hoje no "${DIARY_SECTION}", a seção no fim da nota principal de um projeto: o que você fez ou decidiu nele neste pedido, numa frase (até ${DIARY_LINE_MAX} caracteres). Só quando o pedido mexeu no projeto. Sem a seção, o Kiwi cria. O project_status devolve as últimas linhas. O texto de antes fica nas Versões da nota, e a pessoa desfaz pela Atividade.`,
    inputSchema: {
      type: "object",
      properties: {
        projeto: { type: "string", description: "A pasta do projeto, ou o nome dele, como o projects_list devolve." },
        texto: { type: "string", minLength: 1, maxLength: DIARY_LINE_MAX, description: "A frase, sem a data (o Kiwi põe) e sem marcador de lista." },
      },
      required: ["projeto", "texto"],
      additionalProperties: false,
    },
    writes: true,
  },
  {
    name: "notes_organize_folder",
    title: "Organizar uma pasta inteira",
    description: `Antes de organizar várias notas de uma pasta pelo Modelo de nota: o Kiwi conta as notas e pergunta à pessoa, na tela, se pode. Só use quando a pessoa pedir para organizar a pasta. Com o sim, devolve as notas (até ${ORGANIZE_MAX}); organize cada uma com notes_read e notes_write, mantendo todo o conteúdo. Com o não, não mude nenhuma nota da pasta.`,
    inputSchema: {
      type: "object",
      properties: { folder: { type: "string", description: "A pasta (ex.: Projetos). As subpastas entram junto." } },
      required: ["folder"],
      additionalProperties: false,
    },
    writes: true,
  },
  {
    name: "files_create",
    title: "Gerar um arquivo",
    description: `Gera um arquivo ${CREATE_FORMATS.join(", ")} numa pasta do cofre com o conteúdo que você manda; o Kiwi monta o arquivo. Mande só a estrutura: para csv, a tabela (a 1ª linha é o cabeçalho); para xlsx, a tabela ou as abas; para txt, docx e pdf, os blocos (títulos, parágrafos, itens e tabelas). O arquivo nunca substitui outro (com o nome já usado, ganha um número). Ele aparece na Atividade com [Desfazer]. Para apontar para ele numa nota, use o link [[caminho]] pela escrita normal.`,
    inputSchema: {
      type: "object",
      properties: {
        formato: { type: "string", enum: [...CREATE_FORMATS] },
        nome: { type: "string", minLength: 1, maxLength: 120, description: "O nome do arquivo, com ou sem a extensão (ex.: Vendas de novembro)." },
        pasta: { type: "string", description: "A pasta do cofre (ex.: Projetos/Kiwi); vazia, a raiz." },
        conteudo: {
          type: "object",
          properties: {
            tabela: { type: "array", maxItems: CREATE_ROWS_MAX, items: { type: "array", items: { type: "string" } }, description: "As linhas; a 1ª é o cabeçalho." },
            abas: {
              type: "array",
              maxItems: CREATE_SHEETS_MAX,
              items: {
                type: "object",
                properties: { nome: { type: "string" }, tabela: { type: "array", items: { type: "array", items: { type: "string" } } } },
                required: ["nome", "tabela"],
                additionalProperties: false,
              },
              description: "Só no xlsx: uma aba por item.",
            },
            blocos: {
              type: "array",
              maxItems: CREATE_BLOCKS_MAX,
              items: {
                type: "object",
                properties: {
                  tipo: { type: "string", enum: ["titulo", "paragrafo", "item", "tabela"] },
                  texto: { type: "string" },
                  nivel: { type: "integer", minimum: 1, maximum: 3 },
                  linhas: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Só na tabela; a 1ª linha é o cabeçalho." },
                },
                required: ["tipo"],
                additionalProperties: false,
              },
              description: "Para txt, docx e pdf: os pedaços na ordem.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["formato", "nome", "conteudo"],
      additionalProperties: false,
    },
    writes: true,
  },
  {
    name: "meeting_propose",
    title: "Propor a nota de uma reunião",
    description: `Prepara a proposta de uma reunião gravada para a pessoa aprovar: o Kiwi monta a nota da reunião na pasta do projeto (o resumo, as decisões, as ações e o link para a transcrição) e a mudança na nota principal do projeto (uma linha no histórico de reuniões, as decisões e as pendências novas). Nada é escrito agora: a pessoa vê a proposta e aplica ou descarta. Mande só os campos, sem Markdown pronto. Descubra o projeto pelo assunto, pelos termos e pelos nomes, comparando com o projects_list: na dúvida entre parecidos, mande os candidatos (de 2 a ${PROPOSAL_CANDIDATES_MAX}) e a pessoa escolhe; sem nenhum parecido, não mande projeto nem candidatos.`,
    inputSchema: {
      type: "object",
      properties: {
        reuniao: { type: "string", description: "O caminho da nota da reunião, como o meetings_list devolve." },
        projeto: { type: "string", description: "A pasta do projeto, ou o nome dele, como o projects_list devolve. Só com certeza." },
        candidatos: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: PROPOSAL_CANDIDATES_MAX,
          description: "Na dúvida: as pastas (ou os nomes) dos projetos parecidos, para a pessoa escolher. Sem o projeto.",
        },
        tema: { type: "string", minLength: 1, maxLength: PROPOSAL_THEME_CHARS, description: "O tema da reunião, curto: vira o nome da nota." },
        resumo: { type: "string", maxLength: PROPOSAL_TEXT_CHARS, description: "O resumo da reunião, em poucos parágrafos." },
        decisoes: { type: "array", items: { type: "string", maxLength: PROPOSAL_ITEM_CHARS }, maxItems: PROPOSAL_LIST_MAX, description: "As decisões tomadas, uma por item." },
        acoes: {
          type: "array",
          maxItems: PROPOSAL_LIST_MAX,
          items: {
            type: "object",
            properties: {
              oque: { type: "string", minLength: 1, maxLength: PROPOSAL_ITEM_CHARS },
              quem: { type: "string", maxLength: 200 },
              quando: { type: "string", maxLength: 200 },
            },
            required: ["oque"],
            additionalProperties: false,
          },
          description: "As ações combinadas: o quê, quem e quando.",
        },
        participantes: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: PROPOSAL_LIST_MAX, description: "Quem participou." },
        proximosPassos: { type: "array", items: { type: "string", maxLength: PROPOSAL_ITEM_CHARS }, maxItems: PROPOSAL_LIST_MAX, description: "Os próximos passos." },
        pendencias: {
          type: "array",
          items: { type: "string", maxLength: PROPOSAL_ITEM_CHARS },
          maxItems: PROPOSAL_LIST_MAX,
          description: "As pendências novas do projeto, que entram na nota principal como caixas de tarefa.",
        },
      },
      required: ["reuniao", "tema"],
      additionalProperties: false,
    },
    proposes: true,
  },
  {
    name: "project_summary_propose",
    title: "Propor o resumo executivo de um projeto",
    description: `Prepara o resumo executivo de um projeto para a pessoa aprovar: o Kiwi monta a seção "Resumo executivo" no topo da nota principal do projeto, num formato fixo (a situação, o que andou, as decisões, os riscos, os próximos passos e as reuniões recentes), no lugar do resumo anterior. Use quando a pessoa pedir o resumo, o status ou o ponto de um projeto. Leia antes as notas e as reuniões do projeto (project_status, notes_read, meetings_list). Mande só os campos, sem Markdown pronto, e não invente: cada item leva a fonte, o caminho da nota ou da reunião de onde veio, e um item com uma fonte que não existe fica de fora. Nada é escrito agora: a pessoa vê a proposta e aplica ou descarta. Na dúvida entre projetos parecidos, mande os candidatos (de 2 a ${PROPOSAL_CANDIDATES_MAX}).`,
    inputSchema: {
      type: "object",
      properties: {
        projeto: { type: "string", description: "A pasta do projeto, ou o nome dele, como o projects_list devolve. Só com certeza." },
        candidatos: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: PROPOSAL_CANDIDATES_MAX,
          description: "Na dúvida: as pastas (ou os nomes) dos projetos parecidos, para a pessoa escolher. Sem o projeto.",
        },
        situacao: { type: "string", enum: ["verde", "amarelo", "vermelho"], description: "verde: no rumo; amarelo: pede atenção; vermelho: travado." },
        linha: { type: "string", maxLength: PROPOSAL_ITEM_CHARS, description: "Uma linha sobre a situação (opcional)." },
        andou: {
          type: "array",
          maxItems: PROPOSAL_LIST_MAX,
          items: SOURCED_ITEM,
          description: "O que andou no período: um avanço por item, com a fonte.",
        },
        decisoes: {
          type: "array",
          maxItems: PROPOSAL_LIST_MAX,
          items: {
            type: "object",
            properties: { ...SOURCED_PROPS, data: { type: "string", description: "O dia da decisão, AAAA-MM-DD." } },
            required: ["texto", "fonte"],
            additionalProperties: false,
          },
          description: "As decisões, com o dia e a fonte.",
        },
        riscos: {
          type: "array",
          maxItems: PROPOSAL_LIST_MAX,
          items: {
            type: "object",
            properties: { texto: SOURCED_PROPS.texto, fonte: { ...SOURCED_PROPS.fonte, description: "A fonte, se houver." } },
            required: ["texto"],
            additionalProperties: false,
          },
          description: "Os riscos e bloqueios.",
        },
        proximosPassos: {
          type: "array",
          maxItems: PROPOSAL_LIST_MAX,
          items: {
            type: "object",
            properties: {
              oque: SOURCED_PROPS.texto,
              quem: { type: "string", maxLength: 200 },
              quando: { type: "string", maxLength: 200 },
              fonte: SOURCED_PROPS.fonte,
            },
            required: ["oque", "fonte"],
            additionalProperties: false,
          },
          description: "Os próximos passos: o quê, quem e quando, com a fonte.",
        },
        reunioes: {
          type: "array",
          items: { type: "string" },
          maxItems: SUMMARY_MEETINGS_MAX,
          description: "Os caminhos das reuniões recentes do projeto, como o meetings_list devolve.",
        },
      },
      required: ["situacao"],
      additionalProperties: false,
    },
    proposes: true,
  },
  {
    name: "notes_add_references",
    title: "Pôr as referências numa nota",
    description: `Prepara as referências de uma nota para a pessoa aprovar: os links das páginas que você abriu na web (a documentação, um artigo), cada um com o título, uma linha sobre ele e o dia. O Kiwi monta a seção "Referências" no fim da nota, sem repetir um link que ela já tem. Nada é escrito agora: a pessoa vê e aplica ou descarta. Só links http(s) de páginas que você abriu; até ${REFERENCES_MAX} por vez.`,
    inputSchema: {
      type: "object",
      properties: {
        nota: { type: "string", description: "O caminho da nota (ex.: Projetos/PACS/PACS.md), como o notes_list devolve." },
        itens: {
          type: "array",
          minItems: 1,
          maxItems: REFERENCES_MAX,
          items: {
            type: "object",
            properties: {
              titulo: { type: "string", minLength: 1, maxLength: 200 },
              link: { type: "string", description: "O endereço http(s) da página." },
              resumo: { type: "string", maxLength: 300, description: "Uma linha sobre o que a página tem." },
              data: { type: "string", description: "O dia em que você abriu a página, AAAA-MM-DD." },
            },
            required: ["titulo", "link"],
            additionalProperties: false,
          },
        },
      },
      required: ["nota", "itens"],
      additionalProperties: false,
    },
    proposes: true,
  },
  {
    name: "memory_remember",
    title: "Anotar na memória",
    description: `Anota um fato sobre a pessoa na memória do Kiwi, que vai no começo de todo pedido: quando ela pedir ("lembra que…") ou quando você perceber algo útil e duradouro (o trabalho dela, como ela prefere as respostas). Um fato por chamada, numa linha curta, até ${FACT_MAX_CHARS} caracteres. Nunca senhas, tokens nem dados sensíveis: o Kiwi recusa. A memória tem até ${MEMORY_MAX} fatos; cheia, esqueça um antes. A pessoa vê a anotação no balão e pode desfazer.`,
    inputSchema: {
      type: "object",
      properties: { fato: { type: "string", minLength: 1, maxLength: FACT_MAX_CHARS, description: "O fato, numa linha (ex.: prefere respostas curtas)." } },
      required: ["fato"],
      additionalProperties: false,
    },
    memory: true,
  },
  {
    name: "memory_forget",
    title: "Esquecer da memória",
    description: "Tira um fato da memória do Kiwi: quando a pessoa pedir (\"esquece que…\"), quando ele mudou, ou para abrir espaço. Mande o fato como está na memória.",
    inputSchema: {
      type: "object",
      properties: { fato: { type: "string", minLength: 1, maxLength: FACT_MAX_CHARS, description: "O fato, como está na memória." } },
      required: ["fato"],
      additionalProperties: false,
    },
    memory: true,
  },
];

/** As ferramentas que o servidor oferece: as de escrita só com um `writer`, e a proposta só com quem a guarda. */
export function kiwiTools(writes: boolean, proposes = false, memory = false): readonly KiwiToolDef[] {
  return KIWI_TOOLS.filter((t) => (writes || !t.writes) && (proposes || !t.proposes) && (memory || !t.memory));
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
  /**
   * O modo econômico (spec #11084): o `notes_read` sem seção devolve o sumário, nunca a nota inteira, e o texto sai em
   * pedaços menores, com o "há mais". As descrições das ferramentas não mudam (o começo do pedido fica igual, para o cache).
   */
  economy?: boolean;
  /** Quem guarda as propostas (a da reunião, spec #8360, e o resumo executivo, #11546). Sem ele, elas não existem. */
  proposals?: ProposalSink;
  /** Quem guarda a memória do agente (spec #11469). Sem ele, as ferramentas da memória não existem. */
  memory?: MemorySink;
  /** O relógio do diário do projeto (T11670), para os testes. Sem ele, a hora do Mac. */
  now?: () => Date;
}

/** A memória do agente: anotar e esquecer, com o total de fatos depois. */
export interface MemorySink {
  remember(fact: string): Promise<{ added: boolean; total: number }>;
  forget(fact: string): Promise<{ removed: string; total: number }>;
}

/** O que a `meeting_propose` entrega: a reunião e o projeto já conferidos, e os campos limpos. */
export interface ProposalDraft {
  meeting: ProposalMeeting;
  project: ProposalProject | null;
  candidates: ProposalProject[];
  fields: ProposalFields;
}

/** O que a `project_summary_propose` entrega: o projeto (ou os candidatos) e os campos com as fontes já conferidas. */
export interface SummaryDraft {
  project: ProposalProject | null;
  candidates: ProposalProject[];
  /** Sem o `since`: quem guarda calcula pela nota principal e pelos Ajustes. */
  fields: Omit<SummaryFields, "since">;
}

export interface ProposalSink {
  propose(d: ProposalDraft): Promise<{ id: string }>;
  summary(d: SummaryDraft): Promise<{ id: string }>;
  /** As referências de uma nota (spec #11908): a nota e os itens já conferidos. */
  references(d: { note: string; items: ReferenceItem[] }): Promise<{ id: string }>;
  /** Desde quando "o que andou" conta no próximo resumo do projeto (`AAAA-MM-DD`), para o `project_status`. */
  since(p: ProposalProject): Promise<string>;
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
    if (name === "notes_organize_folder") {
      if (!ctx.writer) throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
      return await organizeFolder(ctx.reader, raw, ctx.decider);
    }
    if ((KIWI_MEMORY_TOOL_NAMES as readonly string[]).includes(name)) {
      if (!ctx.memory) throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
      return await memoryTool(ctx.memory, name, raw, ctx.guard, ctx.decider);
    }
    if ((KIWI_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)) {
      if (!ctx.proposals) throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
      if (name === "project_summary_propose") return await proposeSummary(ctx.reader, ctx.proposals, raw, ctx.guard);
      if (name === "notes_add_references") return await proposeReferences(ctx.reader, ctx.proposals, raw, ctx.guard);
      return await propose(ctx.reader, ctx.proposals, raw, ctx.guard);
    }
    if ((KIWI_WRITE_TOOL_NAMES as readonly string[]).includes(name)) {
      if (!ctx.writer || !ctx.journal) throw new ToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta ${name}`);
      if (name === "project_diary_add") return await diaryAdd(ctx.reader, ctx.writer, ctx.journal, raw, ctx.guard, ctx.now?.() ?? new Date());
      return await write(ctx.writer, ctx.journal, name, raw, ctx.guard);
    }
    const r = await run(ctx.reader, name, raw, ctx.guard, ctx.decider, ctx.economy, ctx.proposals);
    if (ctx.guard) r.held = ctx.guard.heldIn(JSON.stringify(r.value));
    return r;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "E_FAILED";
    throw new ToolError(code, String((e as Error)?.message ?? e));
  }
}

/**
 * "Organizar a pasta inteira" (spec #11102): conta as notas e pergunta à pessoa no cartão, no mesmo pedido. A resposta
 * nunca é lembrada; sem resposta no prazo, é não. Só com o sim as notas são devolvidas, e cada escrita depois passa
 * pelo `notes_write` (o snapshot, o [Desfazer] e a Atividade).
 */
async function organizeFolder(reader: VaultReader, raw: unknown, decider?: DoubtDecider): Promise<ToolResult> {
  const a = args(raw, ["folder"]);
  const folder = (str(a, "folder", true) ?? "").replace(/^\/+|\/+$/g, "");
  const all = await reader.list();
  if (folder && !all.folders.includes(folder)) throw new ToolError("E_NOT_FOUND", `a pasta ${folder} não existe`);
  const notes = all.notes.filter((n) => !folder || n.folder === folder || n.folder.startsWith(`${folder}/`));
  if (!notes.length) return { value: { pasta: folder, total: 0, confirmou: false, aviso: "A pasta não tem notas." } };
  const where = folder ? `${folder}/` : "a raiz do cofre";
  const question = `Organizar ${notes.length} ${notes.length === 1 ? "nota" : "notas"} em ${where} pelo Modelo de nota?`;
  const yes = decider ? await decider.questions.confirm(decider.request, question, decider.signal) : false;
  if (!yes) return { value: { pasta: folder, total: notes.length, confirmou: false, aviso: "A pessoa não confirmou: não mude nenhuma nota desta pasta." } };
  return {
    value: {
      pasta: folder,
      total: notes.length,
      confirmou: true,
      notas: notes.slice(0, ORGANIZE_MAX).map((n) => n.path),
      ...(notes.length > ORGANIZE_MAX ? { aviso: `Só as primeiras ${ORGANIZE_MAX} desta vez.` } : {}),
    },
  };
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
async function run(
  reader: VaultReader,
  name: string,
  raw: unknown,
  guard?: SecretGuard,
  decider?: DoubtDecider,
  economy = false,
  proposals?: ProposalSink,
): Promise<ToolResult> {
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
      const max = economy ? ECONOMY_READ_MAX_CHARS : READ_MAX_CHARS;
      if (section !== undefined && section.trim()) {
        const s = sectionOf(content, section);
        if (!s) throw new ToolError("E_NOT_FOUND", `a nota ${n.path} não tem a seção "${section}"; veja os títulos com notes_outline`);
        return { value: { path: n.path, titulo: n.title, ...versao, secao: s.titulo, ...chunk(s.texto, offset, max) }, target: `${n.path} › ${s.titulo}` };
      }
      // Modo econômico (spec #11084): sem seção, o sumário no lugar da nota longa, e o caminho para ler o resto.
      const headings = economy && offset === 0 && content.length > max ? markdownStructure(content).headings : [];
      if (headings.length) {
        const secoes = headings.slice(0, OUTLINE_MAX).map((h) => ({ nivel: h.level, titulo: h.title }));
        const aviso = "Modo econômico: a nota é longa, então vai o sumário. Há mais: peça uma seção com section, ou o texto em pedaços com offset.";
        return { value: { path: n.path, titulo: n.title, ...versao, caracteres: content.length, secoes, aviso }, target: n.path };
      }
      return { value: { path: n.path, titulo: n.title, ...versao, ...chunk(content, offset, max) }, target: n.path };
    }
    case "files_read": {
      const a = args(raw, ["caminho", "parte"]);
      const path = str(a, "caminho", true)!.trim().replace(/^\/+/, "");
      const parte = int(a, "parte", 1, Number.MAX_SAFE_INTEGER) ?? 1;
      if (/\.md$/i.test(path)) throw new ToolError("E_BAD_ARGS", `${path} é uma nota: leia com notes_read`);
      if (!fileFormat(path)) throw new ToolError("E_BAD_ARGS", `o files_read lê só ${FILE_FORMATS.join(", ")}`);
      const f = await reader.file(path);
      if ("tooLarge" in f || f.size > FILES_READ_MAX_BYTES)
        throw new ToolError("E_TOO_LARGE", `${path} tem ${Math.round(f.size / 1024 / 1024)} MB, e o agente lê arquivos de até ${FILES_READ_MAX_BYTES / 1024 / 1024} MB`);
      if (!("base64" in f)) throw new ToolError("E_FAILED", `não deu para ler ${path}`);
      let doc: Awaited<ReturnType<typeof readDocument>>;
      try {
        doc = await readDocument(path, Buffer.from(f.base64, "base64"), economy ? ECONOMY_READ_MAX_CHARS : READ_MAX_CHARS);
      } catch (e) {
        if (e instanceof FileReadError) throw new ToolError(e.code, `${path}: ${e.message}`);
        throw e;
      }
      const total = doc.parts.length;
      if (parte > total) throw new ToolError("E_BAD_ARGS", `${path} tem ${total} parte(s)`);
      const part = doc.parts[parte - 1]!;
      // O texto da parte passa pelo filtro, como uma nota (spec #9818): o segredo vira o marcador, e a dúvida é perguntada.
      const texto = await seen(path, part.text);
      // Os nomes das abas e os rótulos das partes também são texto do arquivo: passam pelo filtro, numa chamada só
      // (revisão do T11691). Um nome de aba não tem quebra de linha, então as linhas voltam no mesmo lugar.
      const abas = doc.summary.abas ?? [];
      const shown = doc.parts.slice(0, FILES_INDEX_MAX);
      const names = [...abas.map((x) => x.nome), ...shown.map((x) => x.label), part.label];
      const clean = (await seen(path, names.join("\n"))).split("\n");
      if (clean.length === names.length) {
        abas.forEach((x, i) => (x.nome = clean[i]!));
        shown.forEach((x, i) => (x.label = clean[abas.length + i]!));
        part.label = clean.at(-1)!;
      } else throw new ToolError("E_FAILED", `não deu para ler ${path} com o filtro`);
      const indice = shown.map((p, i) => ({ parte: i + 1, rotulo: p.label }));
      const avisos = [
        ...doc.warnings,
        ...(total > FILES_INDEX_MAX ? [`O índice mostra as ${FILES_INDEX_MAX} primeiras de ${total} partes.`] : []),
        ...(parte < total ? [`Há mais: ${total - parte} parte(s) depois desta; peça com parte.`] : []),
      ];
      return {
        value: {
          caminho: path,
          formato: doc.format,
          tamanho: f.size,
          sumario: doc.summary,
          partes: total,
          indice,
          parte,
          rotulo: part.label,
          texto,
          ...(parte < total ? { proximaParte: parte + 1 } : {}),
          ...(avisos.length ? { aviso: avisos.join(" ") } : {}),
        },
        target: total > 1 ? `${path} › ${part.label}` : path,
      };
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
      const p = await findProject(reader, str(a, "projeto", true)!);
      const s = await reader.projectStatus(p.folder);
      let unread = false;
      let diary: { lines: string[]; total: number } | null = null;
      // O sumário e o diário (T11670) são texto de dentro da nota principal: com o filtro do guardrail (spec #9818),
      // saem do texto que o agente vê, como no notes_outline (revisão da T10012). Os caminhos, os títulos das notas, as
      // datas e as contagens vão como estão.
      if (s.project.main !== null) {
        const main = await reader.get(s.project.main).catch(() => null);
        const text = main ? await seen(main.path, main.content) : null;
        if (guard) {
          // Sem conseguir ler de novo (a nota mudou ou sumiu no meio), o sumário não vai: nunca o do texto sem o filtro.
          const headings = text !== null ? markdownStructure(text).headings : [];
          s.outlineTotal = headings.length;
          s.outline = headings.slice(0, STATUS_OUTLINE_MAX).map((h) => ({ level: h.level, title: h.title }));
          if (!main) unread = true;
        }
        if (text !== null) diary = diaryOf(text);
      }
      const avisos = [
        ...(unread ? ["Não deu para ler a nota principal agora; o sumário ficou de fora. Tente de novo."] : []),
        ...(s.project.main === null ? ["A nota principal foi apagada; a pessoa ainda não escolheu outra."] : []),
        ...(s.outlineTotal > s.outline.length ? [`A nota principal tem ${s.outlineTotal} títulos; o sumário mostra os ${s.outline.length} primeiros.`] : []),
        ...(s.taskNotes > s.tasks.length ? [`${s.taskNotes} notas têm tarefas abertas; a lista mostra as ${s.tasks.length} com mais.`] : []),
        ...(diary && diary.total > diary.lines.length ? [`O diário tem ${diary.total} linhas; vão as ${diary.lines.length} últimas.`] : []),
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
          ...(diary?.lines.length ? { diario: diary.lines } : {}),
          ...(proposals ? { resumoDesde: await proposals.since({ folder: s.project.folder, name: s.project.name, main: s.project.main }) } : {}),
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
    case "files_create":
      return createFile(writer, raw, guard, where);
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

/** O projeto pela pasta ou, sem ambiguidade, pelo nome. */
async function findProject(reader: VaultReader, raw: string) {
  const want = raw.replace(/^\/+|\/+$/g, "");
  const all = await reader.projects();
  const byFolder = all.find((p) => p.folder === want);
  const byName = all.filter((p) => p.name.toLocaleLowerCase("pt-BR") === want.toLocaleLowerCase("pt-BR"));
  const p = byFolder ?? (byName.length === 1 ? byName[0] : undefined);
  if (p) return p;
  if (byName.length > 1) throw new ToolError("E_AMBIGUOUS", `há ${byName.length} projetos chamados ${want}; diga a pasta: ${byName.map((x) => x.folder).join(", ")}`);
  throw new ToolError("E_NOT_FOUND", `${want} não é um projeto; veja os projetos com projects_list`);
}

/** O dia, no fuso do Mac (AAAA-MM-DD). */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** As linhas do diário de uma nota (as de lista, sem o marcador), as últimas `DIARY_STATUS_LINES`. Sem a seção, nada. */
export function diaryOf(content: string): { lines: string[]; total: number } | null {
  const s = sectionSpan(content, DIARY_SECTION);
  if (!s) return null;
  const all = content
    .slice(s.body, s.end)
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1]?.trim())
    .filter((l): l is string => !!l);
  return { lines: all.slice(-DIARY_STATUS_LINES), total: all.length };
}

/**
 * O diário do projeto (spec #11469, T11670): uma linha `- AAAA-MM-DD: texto` no fim da seção "Diário do agente" da
 * nota principal, que o Kiwi cria no fim da nota quando ela não existe. É uma escrita como o `notes_append`: a cópia de
 * antes nas Versões, a Atividade e o [Desfazer].
 */
async function diaryAdd(reader: VaultReader, writer: VaultWriter, journal: WriteJournal, raw: unknown, guard: SecretGuard | undefined, now: Date): Promise<ToolResult> {
  const a = args(raw, ["projeto", "texto"]);
  const p = await findProject(reader, str(a, "projeto", true)!);
  if (p.main === null) throw new ToolError("E_NOT_FOUND", `o projeto ${p.name} está sem nota principal: a pessoa ainda não escolheu outra`);
  const sent = str(a, "texto", true, Number.MAX_SAFE_INTEGER)!
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*]\s+/, "");
  if (!sent) throw new ToolError("E_BAD_ARGS", "texto está vazio");
  const folder = await writer.folder();
  for (let tries = 0; ; tries++) {
    const n = await writer.get(p.main);
    writable(n);
    // Os marcadores voltam ao original, só os desta nota (como no notes_append).
    const text = restore(guard, n.path, sent);
    if (text.length > DIARY_LINE_MAX) throw new ToolError("E_BAD_ARGS", `a linha do diário passa de ${DIARY_LINE_MAX} caracteres: escreva uma frase curta`);
    const line = `- ${localDay(now)}: ${text}`;
    const s = sectionSpan(n.content, DIARY_SECTION);
    let next: string;
    if (s) {
      const body = n.content.slice(s.body, s.end);
      next = n.content.slice(0, s.body) + appendTo(body, body.trim() ? line : `\n${line}`, s.last) + n.content.slice(s.end);
    } else {
      const head = `## ${DIARY_SECTION}\n\n${line}`;
      next = n.content.trim() ? appendTo(n.content, `\n${head}`, true) : `${head}\n`;
    }
    notMeeting(n.path, next);
    const r = await commit(writer, journal, n, next);
    if (!r.saved) {
      if (tries + 1 >= APPEND_TRIES) throw changed(n.path);
      continue;
    }
    return {
      value: { projeto: p.name, path: r.path, linha: line, versao: r.version },
      target: `${r.path} › ${DIARY_SECTION}`,
      change: {
        kind: "appended",
        path: r.path,
        section: DIARY_SECTION,
        before: n.content.length,
        after: next.length,
        version: r.version,
        copy: r.copy,
        ...(folder ? { folder } : {}),
        ...removed(n.content, next),
      },
    };
  }
}

/** Uma lista de textos de um campo: cada item limpo de marcadores (nenhum segredo vai para uma nota nova). */
function texts(a: Record<string, unknown>, key: string, guard: SecretGuard | undefined, max = PROPOSAL_ITEM_CHARS): string[] {
  const v = a[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ToolError("E_BAD_ARGS", `${key} deve ser uma lista`);
  if (v.length > PROPOSAL_LIST_MAX) throw new ToolError("E_BAD_ARGS", `${key} passa de ${PROPOSAL_LIST_MAX} itens`);
  return v
    .map((x, i) => {
      if (typeof x !== "string") throw new ToolError("E_BAD_ARGS", `${key}[${i}] deve ser texto`);
      if (x.length > max) throw new ToolError("E_BAD_ARGS", `${key}[${i}] passa de ${max} caracteres`);
      return restore(guard, "\u0000nova", x).trim();
    })
    .filter(Boolean);
}

/** O projeto (ou os candidatos, na dúvida) de uma proposta, conferidos com o `projects_list`. */
async function projectChoice(reader: VaultReader, a: Record<string, unknown>): Promise<{ project: ProposalProject | null; candidates: ProposalProject[] }> {
  const projects = await reader.projects();
  const findProject = (q: string): ProposalProject => {
    const k = fold(q.replace(/^\/+|\/+$/g, ""));
    const p = projects.find((x) => fold(x.folder) === k) ?? projects.find((x) => fold(x.name) === k);
    if (!p) throw new ToolError("E_NOT_FOUND", `não há projeto "${q}"; veja os projetos com projects_list`);
    return { folder: p.folder, name: p.name, main: p.main };
  };
  const projeto = str(a, "projeto", false, 500)?.trim();
  const named = texts(a, "candidatos", undefined, 500);
  if (projeto && named.length) throw new ToolError("E_BAD_ARGS", "mande o projeto ou os candidatos, não os dois");
  const candidates = [...new Map(named.map(findProject).map((p) => [p.folder, p])).values()];
  if (named.length && (candidates.length < 2 || candidates.length > PROPOSAL_CANDIDATES_MAX))
    throw new ToolError("E_BAD_ARGS", `os candidatos são de 2 a ${PROPOSAL_CANDIDATES_MAX} projetos diferentes`);
  return { project: projeto ? findProject(projeto) : null, candidates };
}

/**
 * A proposta da reunião (spec #8360): confere a reunião e os projetos, limpa os campos e guarda. Um marcador do filtro
 * num campo é recusado, como numa nota nova: um segredo da transcrição não vai para a nota do projeto.
 */
async function propose(reader: VaultReader, sink: ProposalSink, raw: unknown, guard: SecretGuard | undefined): Promise<ToolResult> {
  const a = args(raw, ["reuniao", "projeto", "candidatos", "tema", "resumo", "decisoes", "acoes", "participantes", "proximosPassos", "pendencias"]);
  const meetingPath = str(a, "reuniao", true)!;
  const meeting = (await reader.meetings()).find((m) => m.path === meetingPath);
  if (!meeting) throw new ToolError("E_NOT_FOUND", `não há reunião gravada em ${meetingPath}; veja as reuniões com meetings_list`);
  if (meeting.live) throw new ToolError("E_BAD_ARGS", `a reunião ${meetingPath} ainda está gravando`);
  const { project, candidates } = await projectChoice(reader, a);
  const theme = restore(guard, "\u0000nova", str(a, "tema", true, PROPOSAL_THEME_CHARS)!).trim();
  if (!theme) throw new ToolError("E_BAD_ARGS", "tema está vazio");
  const summary = restore(guard, "\u0000nova", str(a, "resumo", false, PROPOSAL_TEXT_CHARS) ?? "").trim();
  const rawActions = a.acoes ?? [];
  if (!Array.isArray(rawActions)) throw new ToolError("E_BAD_ARGS", "acoes deve ser uma lista");
  if (rawActions.length > PROPOSAL_LIST_MAX) throw new ToolError("E_BAD_ARGS", `acoes passa de ${PROPOSAL_LIST_MAX} itens`);
  const actions: ProposalAction[] = rawActions.map((x, i) => {
    const o = args(x, ["oque", "quem", "quando"]);
    const what = restore(guard, "\u0000nova", str(o, "oque", true, PROPOSAL_ITEM_CHARS)!).trim();
    if (!what) throw new ToolError("E_BAD_ARGS", `acoes[${i}].oque está vazio`);
    const who = restore(guard, "\u0000nova", str(o, "quem", false, 200) ?? "").trim();
    const when = restore(guard, "\u0000nova", str(o, "quando", false, 200) ?? "").trim();
    return { what, ...(who ? { who } : {}), ...(when ? { when } : {}) };
  });
  const fields: ProposalFields = {
    theme,
    ...(summary ? { summary } : {}),
    decisions: texts(a, "decisoes", guard),
    actions,
    participants: texts(a, "participantes", guard, 200),
    nextSteps: texts(a, "proximosPassos", guard),
    pending: texts(a, "pendencias", guard),
  };
  const { id } = await sink.propose({ meeting: { path: meeting.path, title: meeting.title, date: meeting.date }, project, candidates, fields });
  return {
    value: {
      proposta: id,
      reuniao: meeting.path,
      projeto: project?.folder ?? null,
      ...(candidates.length ? { candidatos: candidates.map((c) => c.folder) } : {}),
      aviso: "Nada foi escrito. A proposta aparece para a pessoa, que aplica ou descarta. Não escreva estas notas com outras ferramentas.",
    },
    target: meeting.path,
  };
}


const SIGNALS: readonly SummarySignal[] = ["verde", "amarelo", "vermelho"];

/**
 * O resumo executivo de um projeto (spec #11546): confere o projeto e as fontes, limpa os campos e guarda a proposta.
 * O agente não inventa: um item com uma fonte que não é nota nem reunião do cofre fica de fora (e a resposta conta
 * quantos). Um marcador do filtro num campo é recusado, como na proposta da reunião.
 */
async function proposeSummary(reader: VaultReader, sink: ProposalSink, raw: unknown, guard: SecretGuard | undefined): Promise<ToolResult> {
  const a = args(raw, ["projeto", "candidatos", "situacao", "linha", "andou", "decisoes", "riscos", "proximosPassos", "reunioes"]);
  const { project, candidates } = await projectChoice(reader, a);
  // O resumo vai na nota principal de um projeto: sem projeto, ou sem a nota, o agente diz à pessoa, sem balão.
  if (!project && !candidates.length) throw new ToolError("E_BAD_ARGS", "mande o projeto, ou os candidatos na dúvida; veja os projetos com projects_list");
  if (project && !project.main)
    throw new ToolError("E_NO_MAIN_NOTE", `o projeto ${project.name} não tem nota principal: a pessoa marca uma em Notas, no projeto. Diga isso a ela; não há resumo sem a nota.`);
  const signal = str(a, "situacao", true, 20) as SummarySignal;
  if (!SIGNALS.includes(signal)) throw new ToolError("E_BAD_ARGS", "situacao é verde, amarelo ou vermelho");
  const clean = (o: Record<string, unknown>, key: string, required: boolean, max: number, where: string) => {
    const v = restore(guard, "\u0000nova", str(o, key, required, max) ?? "").trim();
    if (required && !v) throw new ToolError("E_BAD_ARGS", `${where}.${key} está vazio`);
    return v;
  };
  const status = clean(a, "linha", false, PROPOSAL_ITEM_CHARS, "resumo");
  const [{ notes }, meetings] = await Promise.all([reader.list(), reader.meetings()]);
  const known = new Set([...notes.map((n) => n.path), ...meetings.map((m) => m.path)]);
  let dropped = 0;
  /** A fonte conferida: um caminho do cofre, ou null (o item sai). */
  const source = (o: Record<string, unknown>, required: boolean): string | null | undefined => {
    const f = str(o, "fonte", required, 1024)?.trim().replace(/^\/+/, "");
    if (!f) return required ? null : undefined;
    return known.has(f) ? f : known.has(`${f}.md`) ? `${f}.md` : null;
  };
  const list = <T,>(key: string, keys: string[], map: (o: Record<string, unknown>, where: string) => T | null): T[] => {
    const v = a[key] ?? [];
    if (!Array.isArray(v)) throw new ToolError("E_BAD_ARGS", `${key} deve ser uma lista`);
    if (v.length > PROPOSAL_LIST_MAX) throw new ToolError("E_BAD_ARGS", `${key} passa de ${PROPOSAL_LIST_MAX} itens`);
    return v.flatMap((x, i) => {
      const r = map(args(x, keys), `${key}[${i}]`);
      if (r === null) dropped++;
      return r === null ? [] : [r];
    });
  };
  const progress = list("andou", ["texto", "fonte"], (o, w) => {
    const text = clean(o, "texto", true, PROPOSAL_ITEM_CHARS, w);
    const src = source(o, true);
    return src ? { text, source: src } : null;
  });
  const decisions = list("decisoes", ["texto", "data", "fonte"], (o, w) => {
    const text = clean(o, "texto", true, PROPOSAL_ITEM_CHARS, w);
    const date = str(o, "data", false, 10)?.trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError("E_BAD_ARGS", `${w}.data é AAAA-MM-DD`);
    const src = source(o, true);
    return src ? { text, source: src, ...(date ? { date } : {}) } : null;
  });
  const risks = list("riscos", ["texto", "fonte"], (o, w) => {
    const text = clean(o, "texto", true, PROPOSAL_ITEM_CHARS, w);
    const src = source(o, false);
    if (src === null) return null;
    return { text, ...(src ? { source: src } : {}) };
  });
  const nextSteps = list("proximosPassos", ["oque", "quem", "quando", "fonte"], (o, w) => {
    const text = clean(o, "oque", true, PROPOSAL_ITEM_CHARS, w);
    const who = clean(o, "quem", false, 200, w);
    const when = clean(o, "quando", false, 200, w);
    const src = source(o, true);
    return src ? { text, source: src, ...(who ? { who } : {}), ...(when ? { when } : {}) } : null;
  });
  const rawMeetings = a.reunioes ?? [];
  if (!Array.isArray(rawMeetings)) throw new ToolError("E_BAD_ARGS", "reunioes deve ser uma lista");
  if (rawMeetings.length > SUMMARY_MEETINGS_MAX) throw new ToolError("E_BAD_ARGS", `reunioes passa de ${SUMMARY_MEETINGS_MAX} itens`);
  const byPath = new Map(meetings.filter((m) => !m.live).map((m) => [m.path, m]));
  const recent = [...new Set(rawMeetings.map((x) => (typeof x === "string" ? x.trim() : "")))].flatMap((p) => {
    const m = byPath.get(p);
    if (!m) dropped++;
    return m ? [{ path: m.path, title: m.title, date: m.date }] : [];
  });
  recent.sort((x, y) => y.date.localeCompare(x.date));
  const { id } = await sink.summary({
    project,
    candidates,
    fields: { signal, ...(status ? { status } : {}), progress, decisions, risks, nextSteps, meetings: recent },
  });
  const target = project?.main ?? project?.folder ?? candidates[0]?.folder ?? "";
  return {
    value: {
      proposta: id,
      projeto: project?.folder ?? null,
      ...(candidates.length ? { candidatos: candidates.map((c) => c.folder) } : {}),
      ...(dropped ? { foraSemFonte: dropped } : {}),
      aviso:
        "Nada foi escrito. A proposta aparece para a pessoa, que aplica ou descarta. Não escreva o resumo com outras ferramentas." +
        (dropped ? ` ${dropped} item(ns) ficaram de fora porque a fonte não é uma nota nem uma reunião do cofre.` : ""),
    },
    target,
  };
}

/**
 * A memória do agente (spec #11469). Anotar passa pelo guardrail: um marcador do filtro (um segredo que o agente leu)
 * ou um segredo no próprio fato é recusado, e um trecho em dúvida vai para a pergunta à pessoa antes de ser guardado
 * (#9873). Esquecer só tira o que já está lá.
 */
async function memoryTool(sink: MemorySink, name: string, raw: unknown, guard: SecretGuard | undefined, decider: DoubtDecider | undefined): Promise<ToolResult> {
  const a = args(raw, ["fato"]);
  const fact = str(a, "fato", true, FACT_MAX_CHARS * 2)!.replace(/\s+/g, " ").trim();
  if (!fact) throw new ToolError("E_BAD_ARGS", "fato está vazio");
  try {
    if (name === "memory_forget") {
      const r = await sink.forget(fact);
      return { value: { esquecido: r.removed, total: r.total }, target: r.removed };
    }
    const secret = () => new ToolError("E_SECRET", "o fato tem um segredo (uma senha, um token ou algo que a pessoa disse que é segredo): nada foi anotado. Anote sem ele.");
    if (/‹segredo [^›\n]{0,40}›/.test(fact)) throw secret();
    if (guard && (await guard.decide("", fact, decider)).held > 0) throw secret();
    const r = await sink.remember(fact);
    // Sem `target` quando o fato já estava lá: nada mudou, e a Atividade não diz "Anotou" (revisão do T11665).
    return {
      value: { anotado: fact, novo: r.added, total: r.total, ...(r.added ? {} : { aviso: "Esse fato já estava na memória." }) },
      ...(r.added ? { target: fact } : {}),
    };
  } catch (e) {
    if (e instanceof MemoryError) throw new ToolError(e.code, e.message);
    throw e;
  }
}

/**
 * Um arquivo gerado (spec #11549): confere o formato, o nome e o conteúdo, limpa cada texto (um marcador do filtro é
 * recusado, como numa nota nova: o segredo de outra nota não vai para um arquivo), monta os bytes e cria o arquivo.
 */
async function createFile(writer: VaultWriter, raw: unknown, guard: SecretGuard | undefined, where: { folder?: string }): Promise<ToolResult> {
  const a = args(raw, ["formato", "nome", "pasta", "conteudo"]);
  const format = str(a, "formato", true, 10) as CreateFormat;
  if (!(CREATE_FORMATS as readonly string[]).includes(format)) throw new ToolError("E_BAD_ARGS", `formato é ${CREATE_FORMATS.join(", ")}`);
  const given = str(a, "nome", true, 120)!.trim();
  const ext = /\.([a-z0-9]{2,5})$/i.exec(given)?.[1]?.toLowerCase();
  if (ext && (CREATE_FORMATS as readonly string[]).includes(ext) && ext !== format) throw new ToolError("E_BAD_ARGS", `o nome termina em .${ext}, e o formato é ${format}`);
  const name = `${ext === format ? given.slice(0, -(format.length + 1)) : given}.${format}`;
  const dir = (str(a, "pasta", false) ?? "").trim().replace(/^\/+|\/+$/g, "");
  let total = 0;
  const text = (v: unknown, where: string, max = CREATE_CELL_CHARS) => {
    if (typeof v !== "string") throw new ToolError("E_BAD_ARGS", `${where} deve ser texto`);
    if (v.length > max) throw new ToolError("E_BAD_ARGS", `${where} passa de ${max} caracteres`);
    total += v.length;
    if (total > CREATE_TOTAL_CHARS) throw new ToolError("E_TOO_LARGE", `o conteúdo passa de ${CREATE_TOTAL_CHARS} caracteres: divida em mais de um arquivo`);
    return restore(guard, "\u0000nova", v);
  };
  const table = (v: unknown, where: string): string[][] => {
    if (!Array.isArray(v)) throw new ToolError("E_BAD_ARGS", `${where} deve ser uma lista de linhas`);
    if (v.length > CREATE_ROWS_MAX) throw new ToolError("E_TOO_LARGE", `${where} passa de ${CREATE_ROWS_MAX} linhas`);
    return v.map((r, i) => {
      if (!Array.isArray(r)) throw new ToolError("E_BAD_ARGS", `${where}[${i}] deve ser uma lista de células`);
      if (r.length > CREATE_COLUMNS_MAX) throw new ToolError("E_TOO_LARGE", `${where}[${i}] passa de ${CREATE_COLUMNS_MAX} colunas`);
      return r.map((c, k) => text(typeof c === "number" ? String(c) : c, `${where}[${i}][${k}]`));
    });
  };
  const c = args(a.conteudo, ["tabela", "abas", "blocos"]);
  const content: CreateContent = {};
  if (c.tabela !== undefined) content.tabela = table(c.tabela, "conteudo.tabela");
  if (c.abas !== undefined) {
    if (!Array.isArray(c.abas) || !c.abas.length || c.abas.length > CREATE_SHEETS_MAX) throw new ToolError("E_BAD_ARGS", `conteudo.abas é uma lista de 1 a ${CREATE_SHEETS_MAX} abas`);
    content.abas = c.abas.map((x, i) => {
      const o = args(x, ["nome", "tabela"]);
      return { nome: text(o.nome, `conteudo.abas[${i}].nome`, 100), tabela: table(o.tabela, `conteudo.abas[${i}].tabela`) };
    });
  }
  if (c.blocos !== undefined) {
    if (!Array.isArray(c.blocos) || c.blocos.length > CREATE_BLOCKS_MAX) throw new ToolError("E_BAD_ARGS", `conteudo.blocos é uma lista de até ${CREATE_BLOCKS_MAX} blocos`);
    content.blocos = c.blocos.map((x, i): DocBlock => {
      const o = args(x, ["tipo", "texto", "nivel", "linhas"]);
      const w = `conteudo.blocos[${i}]`;
      if (o.tipo === "tabela") return { tipo: "tabela", linhas: table(o.linhas, `${w}.linhas`) };
      if (o.tipo !== "titulo" && o.tipo !== "paragrafo" && o.tipo !== "item") throw new ToolError("E_BAD_ARGS", `${w}.tipo é titulo, paragrafo, item ou tabela`);
      const t = text(o.texto, `${w}.texto`, 20_000);
      if (o.tipo === "titulo") {
        const nivel = o.nivel === undefined ? 1 : o.nivel;
        if (nivel !== 1 && nivel !== 2 && nivel !== 3) throw new ToolError("E_BAD_ARGS", `${w}.nivel é 1, 2 ou 3`);
        return { tipo: "titulo", texto: t, nivel };
      }
      return { tipo: o.tipo, texto: t };
    });
  }
  // O que cada formato pede.
  if (format === "csv" && (!content.tabela || content.abas || content.blocos)) throw new ToolError("E_BAD_ARGS", "o csv é uma tabela: mande conteudo.tabela");
  if (format === "xlsx" && (content.blocos || !!content.tabela === !!content.abas)) throw new ToolError("E_BAD_ARGS", "o xlsx leva conteudo.tabela ou conteudo.abas");
  if ((format === "txt" || format === "docx" || format === "pdf") && (content.abas || !!content.blocos === !!content.tabela))
    throw new ToolError("E_BAD_ARGS", `o ${format} leva conteudo.blocos (ou uma conteudo.tabela)`);
  const bytes = await buildFile(format, content);
  const f = await writer.createFile(dir, name, bytes);
  return {
    value: {
      caminho: f.path,
      formato: format,
      tamanho: f.size,
      aviso: `O arquivo está criado e aparece na Atividade com [Desfazer]. Para apontar para ele numa nota, use [[${f.path}]].`,
    },
    target: f.path,
    change: { kind: "created", path: f.path, before: 0, after: f.size, version: f.version, ...where },
  };
}


/**
 * As referências de uma nota (spec #11908): confere a nota e os links, limpa os textos (um marcador do filtro é
 * recusado: um segredo não vai para a nota pela web) e guarda a proposta. Só os links que a nota ainda não tem contam.
 */
async function proposeReferences(reader: VaultReader, sink: ProposalSink, raw: unknown, guard: SecretGuard | undefined): Promise<ToolResult> {
  const a = args(raw, ["nota", "itens"]);
  const notePath = str(a, "nota", true, 1024)!.trim().replace(/^\/+/, "");
  if (!/\.md$/i.test(notePath)) throw new ToolError("E_BAD_ARGS", "nota é o caminho de uma nota .md");
  const n = await reader.get(notePath);
  const raws = a.itens;
  if (!Array.isArray(raws) || !raws.length) throw new ToolError("E_BAD_ARGS", "itens é uma lista com ao menos um item");
  if (raws.length > REFERENCES_MAX) throw new ToolError("E_BAD_ARGS", `itens passa de ${REFERENCES_MAX}`);
  const clean = (v: string | undefined) => restore(guard, "\u0000nova", v ?? "").replace(/\s+/g, " ").trim();
  const items: ReferenceItem[] = raws.map((x, i) => {
    const o = args(x, ["titulo", "link", "resumo", "data"]);
    const w = `itens[${i}]`;
    const title = clean(str(o, "titulo", true, 200));
    if (!title) throw new ToolError("E_BAD_ARGS", `${w}.titulo está vazio`);
    const link = str(o, "link", true, 2048)!.trim();
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new ToolError("E_BAD_ARGS", `${w}.link não é um endereço: mande o http(s) da página que você abriu`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new ToolError("E_BAD_ARGS", `${w}.link não é http(s): só páginas da web que você abriu`);
    if (url.username || url.password) throw new ToolError("E_BAD_ARGS", `${w}.link leva usuário ou senha: mande o endereço sem eles`);
    clean(link); // um marcador no link também é recusado
    // Um segredo no próprio link (um `?token=…`, uma URL assinada) também não vai para a nota (revisão do T11986).
    if (guard && guard.read("", link).held > 0) throw new ToolError("E_SECRET", `${w}.link leva um segredo (um token ou uma assinatura): mande o endereço sem ele`);
    const date = str(o, "data", false, 10)?.trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError("E_BAD_ARGS", `${w}.data é AAAA-MM-DD`);
    return { title, url: url.toString(), summary: clean(str(o, "resumo", false, 300)), ...(date ? { date } : {}) };
  });
  const fresh = noteWithReferences(n.content, items).added;
  if (!fresh.length)
    return { value: { nota: n.path, novos: 0, aviso: "Todos esses links já estão na nota: nada a propor." }, target: n.path };
  const { id } = await sink.references({ note: n.path, items: fresh });
  return {
    value: {
      proposta: id,
      nota: n.path,
      novos: fresh.length,
      ...(fresh.length < items.length ? { jaNaNota: items.length - fresh.length } : {}),
      aviso: "Nada foi escrito. A proposta aparece para a pessoa, que aplica ou descarta. Não escreva as referências com outras ferramentas.",
    },
    target: n.path,
  };
}
