// A bateria de tokens (spec #12137): o que o Kiwi põe em cada pedido ao agente, medido sem chamar agente nenhum. Os
// casos são fixos (a memória cheia, as instruções no máximo, o glossário grande, o Modelo inteiro), para o número só
// mudar quando o Kiwi mudar o que manda.

import { fixedPrefix, type FixedPrefixInput, prefixParts } from "../../src/agent/fixed-prefix.ts";
import { FACT_MAX_CHARS, GLOSSARY_MAX, INSTRUCTIONS_MAX, MEMORY_MAX } from "../../src/agent/memory.ts";
import { DEFAULT_NOTE_MODEL } from "../../src/agent/note-model.ts";
import { countTokens } from "../../src/agent/token-count.ts";
import { EMPTY_READER } from "../../src/agent/tools/reader.ts";
import { KiwiToolServer } from "../../src/agent/tools/server.ts";
import { kiwiTools, runKiwiTool } from "../../src/agent/tools/tools.ts";
import { servedSchemaOf } from "../../src/agent/tools/served-schema.ts";
import { acaoLabel, CARD_ACOES, cardsBlock } from "../../src/agent/tools/kiwi-tool.ts";
import type { VaultReader } from "../../src/agent/tools/reader.ts";
import { meetingPrompt } from "../../src/agent/service.ts";

/** Um item medido: o nome (a chave do tetos.json) e os tokens. */
export interface Measure {
  item: string;
  tokens: number;
}

/** Um fato de memória realista, do tamanho de uma frase longa (o teto é de 300 caracteres). */
const fact = (i: number) =>
  `Fato ${i + 1}: a pessoa trabalha com mudança de dados para a nuvem, prefere respostas curtas e revisa as remessas às sextas-feiras.`.slice(0, FACT_MAX_CHARS);

/** As instruções no máximo, com texto de verdade repetido. */
const INSTRUCTIONS = "Sempre em português do Brasil. Não mexa na pasta Arquivo. Prefiro tópicos curtos a parágrafos longos. "
  .repeat(40)
  .slice(0, INSTRUCTIONS_MAX);

/** O glossário grande: tantos termos quanto vão no pedido. */
const TERMS = Array.from({ length: GLOSSARY_MAX }, (_, i) => `Termo${i + 1} Atlas`);

/** O caso cheio: tudo no máximo. */
export const FULL: Omit<FixedPrefixInput, "economy" | "request"> = {
  model: DEFAULT_NOTE_MODEL,
  facts: Array.from({ length: MEMORY_MAX }, (_, i) => fact(i)),
  instructions: INSTRUCTIONS,
  terms: TERMS,
};

/** Um pedido típico, que cita dois termos do glossário. */
export const REQUEST = "Resuma a nota do projeto Atlas e diga o que mudou com o Termo1 Atlas e o Termo2 Atlas.";

/** O começo fixo, no normal e no econômico. */
export function prefixMeasures(): Measure[] {
  return [
    { item: "começo fixo › normal", tokens: countTokens(fixedPrefix({ ...FULL, economy: false, request: REQUEST })) },
    { item: "começo fixo › econômico", tokens: countTokens(fixedPrefix({ ...FULL, economy: true, request: REQUEST })) },
    // O pedido seguinte, na mesma sessão e com os mesmos ajustes (spec #13379): o começo fixo já está no histórico, e só
    // vai o que muda a cada pedido (no econômico, o glossário com os termos dele).
    { item: "começo fixo › pedido seguinte", tokens: countTokens(prefixParts({ ...FULL, economy: false, request: REQUEST }).perRequest) },
    { item: "começo fixo › pedido seguinte › econômico", tokens: countTokens(prefixParts({ ...FULL, economy: true, request: REQUEST }).perRequest) },
  ];
}

/** O que o servidor MCP do Kiwi manda ao agente: as instruções do `initialize` e a lista do `tools/list`. */
export async function toolMeasures(): Promise<Measure[]> {
  const stub = {} as never;
  const server = new KiwiToolServer({ reader: EMPTY_READER, writer: stub, journal: stub, proposals: stub, memory: stub });
  const config = server.start();
  try {
    const h = Object.fromEntries(config.headers.map((x) => [x.name, x.value]));
    const rpc = async (method: string, params?: unknown) => {
      const r = await fetch(config.url, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return ((await r.json()) as { result: Record<string, unknown> }).result;
    };
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    const list = await rpc("tools/list");
    return [
      { item: "ferramentas › instruções do servidor", tokens: countTokens(String(init.instructions)) },
      { item: "ferramentas › lista", tokens: countTokens(JSON.stringify(list.tools)) },
    ];
  } finally {
    server.stop();
  }
}

/**
 * A lista de antes da ferramenta única (T14563): as 22 ferramentas, como o `tools/list` as servia (o commit c30559fa),
 * para o "antes" do relatório e da bateria. Não tem teto: não vai mais ao agente.
 */
export function listaAntes(): number {
  const tools = kiwiTools(true, true, true).map(({ writes, replaces, proposes: _p, memory: _m, ...t }) => ({
    ...t,
    inputSchema: servedSchemaOf(t.inputSchema),
    annotations: { title: t.title, readOnlyHint: !writes, destructiveHint: !!replaces, idempotentHint: !writes, openWorldHint: false },
  }));
  return countTokens(JSON.stringify(tools));
}

/** Os cartões de instrução (ADR 0013 peça 6, T14563): cada um, como vai no pedido que precisa dele. */
export function cardMeasures(): Measure[] {
  return CARD_ACOES.map((a) => ({ item: `cartão › ${acaoLabel(a)}`, tokens: countTokens(cardsBlock([a])) }));
}

// ── Os retornos das ferramentas (T12202) ─────────────────────────────────────────────────────────────────────────────


/** Os casos fixos: a ferramenta e os argumentos, num cofre de exemplo (`vault.ts`). */
export const CASES: { item: string; tool: string; args: Record<string, unknown> }[] = [
  { item: "notes_read › seção", tool: "notes_read", args: { path: "Projetos/Atlas/Atlas.md", section: "Prazo" } },
  { item: "notes_read › nota inteira", tool: "notes_read", args: { path: "Projetos/Atlas/Atlas.md" } },
  { item: "notes_outline", tool: "notes_outline", args: { path: "Projetos/Atlas/Atlas.md" } },
  { item: "notes_search", tool: "notes_search", args: { query: "envio orçamento" } },
  { item: "project_status", tool: "project_status", args: { projeto: "Atlas" } },
  { item: "meetings_get", tool: "meetings_get", args: { path: "Reuniões/2026-11-10 · Orçamento.md" } },
  { item: "files_read › planilha grande", tool: "files_read", args: { caminho: "Projetos/Atlas/vendas.xlsx" } },
];

/** O que cada caso devolve ao agente (o JSON que vai na resposta da ferramenta), no normal ou no econômico. */
export async function returnMeasures(reader: VaultReader, economy: boolean): Promise<Measure[]> {
  const out: Measure[] = [];
  for (const c of CASES) {
    const r = await runKiwiTool({ reader, economy }, c.tool, c.args);
    out.push({ item: `${c.item}${economy ? " › econômico" : ""}`, tokens: countTokens(JSON.stringify(r.value)) });
  }
  return out;
}

/** Os pedidos que o próprio Kiwi manda (o fim da reunião → o projeto). */
export function autoRequestMeasures(): Measure[] {
  return [{ item: "pedido automático › reunião → projeto", tokens: countTokens(meetingPrompt({ path: "Reuniões/2026-11-10 · Orçamento.md", title: "Orçamento" })) }];
}
