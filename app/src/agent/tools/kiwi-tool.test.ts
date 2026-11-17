// A ferramenta única (ADR 0013 peça 6, T14563): a `kiwi` e as ações de dentro. Sem agente, sem servidor: só a tradução,
// o erro que ensina, os cartões e a lista constante. O caminho inteiro pelo servidor está em tools.test e write.test.

import { describe, expect, test } from "bun:test";

import { ACOES, acaoLabel, cardsBlock, cardsFor, CARDS_END, instructionCard, KIWI_TOOL_DEF, kiwiCallFor, labelOf, resolveKiwiCall, runKiwiCall, vocab, vocabMensagem } from "./kiwi-tool.ts";
import { KIWI_TOOLS, kiwiTools, type KiwiToolContext } from "./tools.ts";
import { ToolError } from "./tools.ts";

const errOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError);
    return `${(e as ToolError).code}: ${(e as Error).message}`;
  }
  throw new Error("não deu erro");
};

describe("a ferramenta única (T14563)", () => {
  test("cada ação de antes tem um fazer/como, e só um", () => {
    expect(ACOES.map((a) => a.tool).sort()).toEqual(KIWI_TOOLS.map((t) => t.name).sort());
    expect(new Set(ACOES.map(acaoLabel)).size).toBe(ACOES.length);
    for (const f of new Set(ACOES.map((a) => a.fazer))) expect(ACOES.filter((a) => a.fazer === f && a.padrao).length).toBeLessThanOrEqual(1);
  });

  test("a volta: kiwiCallFor e resolveKiwiCall dão a mesma ação com os mesmos argumentos, em todas", () => {
    for (const def of KIWI_TOOLS) {
      const props = Object.keys((def.inputSchema.properties ?? {}) as Record<string, unknown>);
      const args = Object.fromEntries(props.map((k) => [k, `v-${k}`]));
      const call = resolveKiwiCall(kiwiCallFor(def.name, args));
      expect({ tool: call.tool, args: call.args }).toEqual({ tool: def.name, args });
    }
  });

  test("criar: o alvo é Pasta/Título; um título com barra fica título, nunca vira pasta", () => {
    expect(kiwiCallFor("notes_create", { folder: "Projetos", title: "Ideias", text: "x" })).toEqual({ fazer: "escrever", alvo: "Projetos/Ideias", texto: "x", opcoes: { como: "criar" } });
    expect(resolveKiwiCall({ fazer: "escrever", alvo: "Projetos/Ideias.md", opcoes: { como: "criar" } }).args).toEqual({ folder: "Projetos", title: "Ideias" });
    const fora = resolveKiwiCall(kiwiCallFor("notes_create", { title: "../../fora", text: "x" }));
    expect(fora.args).toEqual({ title: "../../fora", text: "x" });
  });

  test("tolerante: verbo em inglês, nome antigo, sem acento, opção posta fora de opcoes, e o arquivo pela extensão", () => {
    expect(resolveKiwiCall({ fazer: "read", alvo: "A.md" }).tool).toBe("notes_read");
    expect(resolveKiwiCall({ fazer: "notes_outline", alvo: "A.md" }).tool).toBe("notes_outline");
    expect(resolveKiwiCall({ fazer: "ler", alvo: "A.md", opcoes: { como: "Sumário" } }).tool).toBe("notes_outline");
    expect(resolveKiwiCall({ fazer: "ler", alvo: "A.md", secao: "Prazo" }).args).toEqual({ path: "A.md", section: "Prazo" });
    expect(resolveKiwiCall({ fazer: "ler", alvo: "A.md", opcoes: { seção: "Prazo" } }).args).toEqual({ path: "A.md", section: "Prazo" });
    expect(resolveKiwiCall({ fazer: "ler", alvo: "Planilhas/Custos.xlsx" }).tool).toBe("files_read");
    expect(resolveKiwiCall({ fazer: "esquecer", texto: "um fato" }).tool).toBe("memory_forget");
    // O sinônimo que diz o como (revisão #14585): criar nunca cai no acrescentar, listar é a pasta.
    expect(resolveKiwiCall({ fazer: "criar", alvo: "Projetos/Ideia", texto: "oi" })).toMatchObject({ tool: "notes_create", args: { folder: "Projetos", title: "Ideia", text: "oi" } });
    expect(resolveKiwiCall({ fazer: "create", alvo: "Ideia.md", texto: "oi" })).toMatchObject({ tool: "notes_create", args: { title: "Ideia", text: "oi" } });
    expect(resolveKiwiCall({ fazer: "forget", texto: "um fato" }).tool).toBe("memory_forget");
    expect(resolveKiwiCall({ fazer: "listar", alvo: "Projetos" })).toMatchObject({ tool: "notes_list", args: { folder: "Projetos" } });
    // O como dito vale mais que o do sinônimo.
    expect(resolveKiwiCall({ fazer: "criar", alvo: "A.md", texto: "x", opcoes: { como: "acrescentar" } }).tool).toBe("notes_append");
    expect(resolveKiwiCall({ fazer: "achar", alvo: "gatos", opcoes: { como: "texto" } }).args).toEqual({ query: "gatos" });
  });

  test("o erro ensina: diz o que vale", () => {
    expect(errOf(() => resolveKiwiCall({ alvo: "A.md" }))).toBe("E_BAD_ARGS: falta o fazer: um de achar, ler, escrever, propor, lembrar");
    expect(errOf(() => resolveKiwiCall({ fazer: "apagar", alvo: "A.md" }))).toContain("use achar, ler, escrever, propor, lembrar");
    expect(errOf(() => resolveKiwiCall({ fazer: "escrever", opcoes: { como: "apagar" } }))).toContain("acrescentar (padrão), trocar, trecho, mover, renomear, juntar, criar");
    expect(errOf(() => resolveKiwiCall({ fazer: "achar", texto: "x", opcoes: { como: "texto", extra: 1 } }))).toBe("E_BAD_ARGS: kiwi achar/texto não tem a opção extra; as opções dela: limite");
    expect(errOf(() => resolveKiwiCall({ fazer: "achar", alvo: "x", opcoes: { como: "reunioes" } }))).toContain("kiwi achar/reunioes não tem alvo");
    expect(errOf(() => resolveKiwiCall("ler"))).toContain("{fazer, alvo, texto, opcoes}");
  });

  test("a lista é uma constante: a mesma definição em qualquer sessão, e bem menor que as 21", () => {
    expect(KIWI_TOOL_DEF.inputSchema.required).toEqual(["fazer"]);
    const antes = JSON.stringify(kiwiTools(true, true, true)).length;
    expect(JSON.stringify(KIWI_TOOL_DEF).length * 4).toBeLessThan(antes);
  });

  test("sem permissão, a ação volta E_NOT_ALLOWED pela ação de dentro, antes de tocar o cofre", async () => {
    const ctx = {} as KiwiToolContext;
    const none = { writes: false, proposes: false, memory: false };
    await expect(runKiwiCall(ctx, { fazer: "escrever", alvo: "A.md", texto: "x" }, none)).rejects.toMatchObject({ code: "E_NOT_ALLOWED", tool: "notes_append" });
    await expect(runKiwiCall(ctx, { fazer: "propor", alvo: "R", opcoes: { como: "reuniao" } }, none)).rejects.toMatchObject({ code: "E_NOT_ALLOWED", tool: "meeting_propose" });
    await expect(runKiwiCall(ctx, { fazer: "lembrar", texto: "x" }, none)).rejects.toMatchObject({ code: "E_NOT_ALLOWED", tool: "memory_remember" });
    await expect(runKiwiCall(ctx, { fazer: "voar" }, none)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });

  test("o cartão: as instruções longas da ação, com os campos com o nome de fora", () => {
    const meeting = ACOES.find((a) => a.tool === "meeting_propose")!;
    const card = instructionCard(meeting);
    expect(card.startsWith('[Instruções do Kiwi: kiwi propor/reuniao, isto é, {fazer: "propor", opcoes: {como: "reuniao", …}} (alvo: reuniao).')).toBe(true);
    expect(card).not.toMatch(/\b(meeting_propose|notes_read|meetings_get)\b/);
    expect(cardsBlock([])).toBe("");
    expect(cardsBlock([meeting]).endsWith(`\n${CARDS_END}`)).toBe(true);
  });

  test("os cartões pelo pedido: só os que ele precisa", () => {
    const of = (t: string) => cardsFor(t).map((a) => a.tool);
    expect(of("Qual é o prazo do Kiwi?")).toEqual([]);
    expect(of("Mude o prazo do Kiwi para abril")).toEqual([]);
    expect(of("Gere uma planilha com os custos do Projeto X")).toEqual(["files_create"]);
    expect(of("Organize a pasta Clientes")).toEqual(["notes_organize_folder"]);
    expect(of("Faça o resumo executivo do Projeto X")).toEqual(["project_summary_propose"]);
    expect(of("Coloque as referências na nota Plano")).toEqual(["notes_add_references"]);
    expect(of("Todo dia às 9h, me mande as tarefas abertas")).toEqual(["routine_propose"]);
    expect(of('[Pedido automático do Kiwi] A reunião gravada "Ana" terminou. Leia a transcrição, compare com os projetos e prepare a proposta.')).toEqual(["meeting_propose"]);
  });

  test("o vocabulário: os textos do Kiwi trocam o nome antigo pelo jeito de chamar de hoje", () => {
    expect(labelOf("notes_outline")).toBe("kiwi ler/sumario");
    expect(labelOf("notes_read")).toBe("kiwi ler/nota");
    expect(vocab("procure com find e leia com notes_read")).toBe("procure com kiwi achar/nome e leia com kiwi ler/nota");
  });

  test("num erro ou num aviso, o caminho chega intacto: só o nome entre crases muda (T16159)", async () => {
    expect(vocabMensagem("How to find things.md mudou desde que você leu: leia de novo com `notes_read`")).toBe(
      "How to find things.md mudou desde que você leu: leia de novo com `kiwi ler/nota`",
    );
    expect(vocabMensagem("Arquivo/notes_read.md não existe; procure com `find`")).toBe("Arquivo/notes_read.md não existe; procure com `kiwi achar/nome`");
    expect(vocabMensagem("use [[Saída/find.xlsx]]")).toBe("use [[Saída/find.xlsx]]");
    // Um nome entre crases que não é ação fica como está.
    expect(vocabMensagem("o Kiwi não tem a ferramenta `voar`")).toBe("o Kiwi não tem a ferramenta `voar`");
    // De ponta a ponta: o erro da ação de dentro, pela kiwi, com um caminho que tem find e um nome de ação.
    const e = await runKiwiCall({} as KiwiToolContext, { fazer: "ler", alvo: "Notas/How to find notes_read.md", opcoes: { como: "arquivo" } }, { writes: false, proposes: false, memory: false }).catch((x) => x);
    expect(e).toBeInstanceOf(ToolError);
    expect((e as ToolError).message).toBe("Notas/How to find notes_read.md é uma nota: leia com `kiwi ler/nota`");
  });
});
