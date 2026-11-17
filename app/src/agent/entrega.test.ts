// O registro de entrega (ADR 0013 peça 4, T14682): a conta pura, e as leituras e as escritas de verdade, pelas
// ferramentas do Kiwi sobre um cofre num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { Vault } from "../notes/vault.ts";
import { NoteVersions } from "../notes/versions.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { tempDir } from "../../test/tmp.ts";
import { DoubtAnswers } from "../guardrail/answers.ts";
import { SecretGuard } from "../guardrail/filter.ts";
import { DoubtQuestions } from "../guardrail/questions.ts";
import { buildPackage } from "./pacote.ts";
import { RegistroEntrega, textDiff } from "./entrega.ts";
import { readerFromCapabilities } from "./tools/reader.ts";
import { runKiwiTool, type KiwiToolContext, type WriteJournal } from "./tools/tools.ts";
import { writerFromCapabilities } from "./tools/writer.ts";

describe("a conta do registro", () => {
  test("novo, igual (pelo texto que o agente viu), a nota inteira cobre a seção, e a janela nova zera", () => {
    const r = new RegistroEntrega();
    r.novoPedido();
    expect(r.conferir("A.md", "v1", "texto")).toEqual({ kind: "novo" });
    r.entregou("A.md", "v1", "texto");
    r.novoPedido();
    expect(r.conferir("A.md", "v1", "texto")).toEqual({ kind: "igual", pedido: 1 });
    expect(r.conferir("A.md", "v1", "text", "Prazo")).toEqual({ kind: "igual", pedido: 1 });
    // Mesma versão, texto outro (o filtro liberou um segredo): não é igual.
    expect(r.conferir("A.md", "v1", "texto com o segredo liberado").kind).not.toBe("igual");
    // Sem versão (um leitor que não tem), vale igual: é o texto que decide.
    r.entregou("B.md", undefined, "x");
    expect(r.conferir("B.md", undefined, "x")).toEqual({ kind: "igual", pedido: 2 });
    r.zerar();
    expect(r.conferir("A.md", "v1", "texto")).toEqual({ kind: "novo" });
    expect(r.pedido).toBe(0);
  });

  test("mudou pouco: só a diferença; mudou muito: o texto de novo", () => {
    const r = new RegistroEntrega();
    r.novoPedido();
    const antes = Array.from({ length: 40 }, (_, i) => `linha ${i + 1} da nota`).join("\n");
    r.entregou("A.md", "v1", antes);
    const depois = antes.replace("linha 20 da nota", "linha 20 trocada");
    const e = r.conferir("A.md", "v2", depois);
    expect(e.kind).toBe("diferenca");
    const diff = (e as { diff: string }).diff;
    expect(diff).toContain("- linha 20 da nota");
    expect(diff).toContain("+ linha 20 trocada");
    expect(diff).toContain("@@ linha 19");
    expect(diff.length).toBeLessThan(depois.length / 5);
    expect(r.conferir("A.md", "v3", "um texto todo outro")).toEqual({ kind: "novo" });
  });

  test("a escrita do agente: com a nota inteira anotada, a versão nova vale; as seções saem", () => {
    const r = new RegistroEntrega();
    r.novoPedido();
    r.entregou("A.md", "v1", "a");
    r.entregou("A.md", "v1", "s", "Prazo");
    r.escreveu("A.md", "v2", "a + b");
    expect(r.conferir("A.md", "v2", "a + b")).toEqual({ kind: "igual", pedido: 1 });
    // Só a seção anotada: o agente não sabe o resto, e a nota vai de novo.
    r.entregou("B.md", "v1", "s", "Prazo");
    r.escreveu("B.md", "v2", "tudo");
    expect(r.conferir("B.md", "v2", "tudo")).toEqual({ kind: "novo" });
    expect(r.tamanho).toBe(1);
  });

  test("a diferença marca o que saiu e o que entrou, com a linha do texto novo", () => {
    expect(textDiff("a\nb\nc", "a\nB\nc")).toBe("@@ linha 1\n  a\n- b\n+ B\n  c");
    expect(textDiff("a\nb", "a\nb\nc")).toBe("@@ linha 2\n  b\n+ c");
  });
});

// Maior que o aviso de "já está com você" (um texto menor vai como está), na nota e em cada seção.
const KIWI =
  "# Kiwi\n\nO Kiwi é um app de notas, com o ditado e as reuniões no Mac, e o agente que a pessoa escolher.\n\n" +
  "## Prazo\n\nO prazo do Kiwi é março. A primeira versão sai antes, com o ditado e as notas, e as reuniões vêm depois, no segundo semestre.\n\n" +
  "## Equipe\n\nAna e Bruno, com a Carla nas reuniões de quinta e o Davi no desenho das telas novas.\n";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const base = tempDir("kiwi-entrega-");
  dirs.push(base);
  const root = path.join(base, "KiwiNotes");
  mkdirSync(path.join(root, "Projetos"), { recursive: true });
  writeFileSync(path.join(root, "Projetos/Kiwi.md"), KIWI);
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    versions: new NoteVersions({ dir: path.join(base, "history") }),
  });
  const journal: WriteJournal = { keep: async () => "copia", drop: async () => {} };
  const registro = new RegistroEntrega();
  registro.novoPedido();
  const reader = readerFromCapabilities(caps as never);
  const ctx: KiwiToolContext = { reader, writer: writerFromCapabilities(caps as never), journal, registro };
  const call = async (name: string, args: unknown) => (await runKiwiTool(ctx, name, args)).value as Record<string, any>;
  return { root, ctx, registro, reader, call };
}

describe("o registro nas ferramentas", () => {
  test("ler de novo sem mudança: 'já está com você', com a versão; numa conversa nova, o texto de novo", async () => {
    const { root, registro, call } = setup();
    const first = await call("notes_read", { path: "Projetos/Kiwi.md" });
    expect(first.texto).toContain("março");
    registro.novoPedido();
    const again = await call("notes_read", { path: "Projetos/Kiwi.md" });
    expect(again.texto).toBeUndefined();
    expect(again.jaEntregue).toBe("Já está com você, do pedido 1 desta conversa: não mudou. Se não tiver mais o texto, leia de novo.");
    expect(again.versao).toBe(first.versao);
    expect(JSON.stringify(again).length).toBeLessThan(200);
    // A seção de uma nota que já foi inteira, na mesma versão, também já está lá.
    expect((await call("notes_read", { path: "Projetos/Kiwi.md", section: "Prazo" })).jaEntregue).toBeDefined();
    // A saída (revisão do T14682): o agente que não tem mais o texto lê de novo no mesmo pedido, e ele vai.
    expect((await call("notes_read", { path: "Projetos/Kiwi.md" })).texto).toContain("março");
    registro.novoPedido();
    expect((await call("notes_read", { path: "Projetos/Kiwi.md" })).jaEntregue).toBeDefined();
    // Um texto menor que o aviso vai como está.
    writeFileSync(path.join(root, "Projetos/Curta.md"), "# Curta\n\nsó isto\n");
    await call("notes_read", { path: "Projetos/Curta.md" });
    registro.novoPedido();
    expect((await call("notes_read", { path: "Projetos/Curta.md" })).texto).toContain("só isto");
    registro.zerar();
    registro.novoPedido();
    expect((await call("notes_read", { path: "Projetos/Kiwi.md" })).texto).toContain("março");
  });

  test("a pessoa mudou a nota: vai só a diferença", async () => {
    const { root, registro, call } = setup();
    const long = `${KIWI}\n${Array.from({ length: 30 }, (_, i) => `- item ${i + 1}`).join("\n")}\n`;
    writeFileSync(path.join(root, "Projetos/Kiwi.md"), long);
    await call("notes_read", { path: "Projetos/Kiwi.md" });
    registro.novoPedido();
    writeFileSync(path.join(root, "Projetos/Kiwi.md"), long.replace("O prazo do Kiwi é março.", "O prazo do Kiwi é abril."));
    const r = await call("notes_read", { path: "Projetos/Kiwi.md" });
    expect(r.texto).toBeUndefined();
    expect(r.diferenca).toContain("- O prazo do Kiwi é março.");
    expect(r.diferenca).toContain("+ O prazo do Kiwi é abril.");
    expect(r.aviso).toContain("vai só a diferença");
    // A versão nova vai junto: a escrita seguinte confere por ela.
    expect(r.versao).toBeDefined();
  });

  test("com o filtro: a leitura repetida conta os segredos segurados, e a escrita não pergunta a dúvida de novo", async () => {
    const { root, ctx, registro } = setup();
    const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    writeFileSync(path.join(root, "Projetos/Kiwi.md"), `${KIWI}
## Acesso

token: ${token}
id: Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya
`);
    const answers = new DoubtAnswers(tempDir("kiwi-entrega-doubt-"));
    const asked: unknown[] = [];
    const questions = new DoubtQuestions({ answers, timeoutMs: 50, onPending: (_r, items) => asked.push(...items) });
    const g: KiwiToolContext = { ...ctx, guard: new SecretGuard(), decider: { answers, questions, request: "p1" } };
    const r1 = await runKiwiTool(g, "notes_read", { path: "Projetos/Kiwi.md" });
    expect(asked).toHaveLength(1);
    expect(r1.held).toBe(2);
    registro.novoPedido();
    const r2 = await runKiwiTool(g, "notes_read", { path: "Projetos/Kiwi.md" });
    expect((r2.value as { jaEntregue?: string }).jaEntregue).toBeDefined();
    expect(r2.held).toBe(2);
    const versao = (r2.value as { versao: string }).versao;
    // A leitura pergunta outra vez (sem resposta no prazo, a dúvida volta); a escrita, nunca.
    const antes = asked.length;
    await runKiwiTool(g, "notes_append", { path: "Projetos/Kiwi.md", section: "Prazo", text: "Talvez abril.", version: versao });
    expect(asked).toHaveLength(antes);
  });

  test("a escrita do agente atualiza o registro: ele não relê o que escreveu, e escreve de novo pela versão nova", async () => {
    const { registro, call } = setup();
    const r1 = await call("notes_read", { path: "Projetos/Kiwi.md" });
    await call("notes_append", { path: "Projetos/Kiwi.md", section: "Prazo", text: "Talvez abril.", version: r1.versao });
    registro.novoPedido();
    const r2 = await call("notes_read", { path: "Projetos/Kiwi.md" });
    expect(r2.jaEntregue).toBeDefined();
    expect(r2.versao).not.toBe(r1.versao);
    await call("notes_append", { path: "Projetos/Kiwi.md", text: "Fim.", version: r2.versao });
  });

  test("o pacote: a nota que o agente já tem vai como 'já está com você', no mesmo texto do cartão", async () => {
    const { registro, reader } = setup();
    const target = { kind: "nota" as const, path: "Projetos/Kiwi.md", title: "Kiwi", names: ["Kiwi"] };
    const result = { kind: "certo" as const, hit: { target, said: "Kiwi", score: 1, how: "nome" as const } };
    const deps = { reader, seen: async (_p: string, c: string) => c, registro };
    const p1 = await buildPackage(deps, result, "qual o prazo do Kiwi?");
    expect(p1!.text).toContain("O prazo do Kiwi é março.");
    registro.novoPedido();
    const p2 = await buildPackage(deps, result, "e a equipe do Kiwi?");
    expect(p2!.text).not.toContain("O prazo do Kiwi é março.");
    expect(p2!.text).toContain("nota: Projetos/Kiwi.md");
    expect(p2!.text).toContain("Já está com você, do pedido 1");
  });
});
