import { describe, expect, test } from "bun:test";

import { buildIndex, joinSpelledLetters, sniff, soundKey } from "./faro.ts";

const note = (path: string) => ({ path, title: path.split("/").pop()!.replace(/\.(md|txt)$/, ""), folder: path.split("/").slice(0, -1).join("/"), size: 100, mtime: "2026-11-10T00:00:00.000Z" });

describe("o som (ADR 0013 peça 1, T14359)", () => {
  test("o nome do ditado e o nome certo dão a mesma chave", () => {
    for (const [said, real] of [
      ["legasi pê erre", "Legacy PR"],
      ["rêde nórti", "Rede Norte"],
      ["portau clientis", "Portal Clientes"],
      ["mudansa bêta", "Mudança Beta"],
      ["relatório quê um", "Relatório Q1"],
      ["fotô grafia", "Fotografia"],
      ["lista de compra", "Lista de compras"],
    ])
      expect(soundKey(said)).toBe(soundKey(real));
    expect(soundKey("ideias de viagem")).not.toBe(soundKey("Relatório Q1"));
  });

  test("as siglas faladas viram letras; 'a', 'e' e 'o' soltos não", () => {
    expect(joinSpelledLetters("legasi pê erre")).toBe("legasi pr");
    expect(joinSpelledLetters("relatório quê um e me diz")).toBe("relatório q1 e me diz");
    expect(joinSpelledLetters("o que tem")).toBe("o que tem");
  });
});

describe("as citações", () => {
  const idx = buildIndex({
    notes: [
      note("Projetos/Legacy PR/Plano de Mudança.md"),
      note("Projetos/Legacy PR/Legacy PR.md"),
      note("Projetos/Portal Clientes/Relatório Q1.md"),
      note("Projetos/Portal Clientes/Relatório Q1 rascunho.txt"),
      note("Áreas/x/relatório pendência 88.md"),
      note("Pessoal/Lista de compras.md"),
      note("A/prazo/um.md"),
      note("Reuniões/2026-11-12 · Status.md"),
      note("Reuniões/2026-11-13 · Alinhamento.md"),
    ],
    folders: ["Projetos", "Projetos/Legacy PR", "Projetos/Portal Clientes", "Pessoal", "A", "A/prazo", "B/prazo", "C/prazo", "D/prazo", "Áreas", "Áreas/x", "Reuniões"],
    projects: [{ name: "Legacy PR", folder: "Projetos/Legacy PR", main: "Projetos/Legacy PR/Legacy PR.md" }],
    meetings: [
      { path: "Reuniões/2026-11-12 · Status.md", title: "Status", date: "2026-11-12" },
      { path: "Reuniões/2026-11-13 · Alinhamento.md", title: "Alinhamento", date: "2026-11-13" },
    ],
  });
  const certo = (r: ReturnType<typeof sniff>) => (r.kind === "certo" ? r.hit.target.path : r.kind);

  test("o nome inteiro ganha das palavras soltas; digitado e falado", () => {
    expect(certo(sniff("Qual é o prazo no Plano de Mudança do Legacy PR?", idx))).toBe("Projetos/Legacy PR/Plano de Mudança.md");
    expect(certo(sniff("Qual é o prazo no plano de mudança do legasi pê erre?", idx))).toBe("Projetos/Legacy PR/Plano de Mudança.md");
  });

  test("as palavras em outra ordem, e o número do nome é obrigatório", () => {
    expect(certo(sniff("Abre o rascunho do Relatório Q1", idx))).toBe("Projetos/Portal Clientes/Relatório Q1 rascunho.txt");
    expect(certo(sniff("as pendências do relatório quê um", idx))).toBe("Projetos/Portal Clientes/Relatório Q1.md");
  });

  test("o projeto e a nota principal dele são um alvo só; a palavra do tipo puxa a pasta", () => {
    const r = sniff("Como está o projeto Legacy PR?", idx);
    expect(r).toMatchObject({ kind: "certo", hit: { target: { kind: "projeto", path: "Projetos/Legacy PR" } } });
    expect(certo(sniff("O que tem na pasta Pessoal?", idx))).toBe("Pessoal");
  });

  test('um nome de muitos alvos ("prazo") não é citação; "essa nota" e "a última reunião" são apontados', () => {
    expect(sniff("qual o prazo?", idx).kind).toBe("nada");
    expect(certo(sniff("resume essa nota", idx, { openNote: "Pessoal/Lista de compras.md" }))).toBe("Pessoal/Lista de compras.md");
    expect(sniff("resume essa nota", idx).kind).toBe("nada");
    expect(certo(sniff("o que foi decidido na última reunião?", idx))).toBe("Reuniões/2026-11-13 · Alinhamento.md");
  });

  describe("o aberto nas Notas (T19969, spec #19269)", () => {
    const csv = "Dados/dados-exemplo.csv";
    const aberto = (r: ReturnType<typeof sniff>) => (r.kind === "certo" ? `${r.hit.target.kind}:${r.hit.target.path}` : r.kind);

    test("as frases, digitadas e faladas, apontam o arquivo aberto", () => {
      for (const pedido of [
        "tá vendo o arquivo que eu tô com aberto aqui? escreve nele um resumo",
        "nesse arquivo, monta uma tabela com nome e total",
        "neste arquivo tem quantas linhas?",
        "o que tá aberto fala de quê?",
        "soma a coluna B dessa planilha",
        "nessa tabela, qual o maior valor?",
        "resume esse documento",
        "nesse CSV, quantas linhas?",
        "nesse cê esse vê, quantas linhas?",
        "o arquivo aberto tem cabeçalho?",
        "tá vendo esse aqui?",
      ])
        expect([pedido, aberto(sniff(pedido, idx, { openNote: csv }))]).toEqual([pedido, `arquivo:${csv}`]);
    });

    test("uma nota aberta é nota: o arquivo, a nota e o .txt", () => {
      expect(aberto(sniff("nesse arquivo, põe um título", idx, { openNote: "Pessoal/Lista de compras.md" }))).toBe("nota:Pessoal/Lista de compras.md");
      expect(aberto(sniff("nesse arquivo, põe um título", idx, { openNote: "Soltas/rascunho-exemplo.txt" }))).toBe("nota:Soltas/rascunho-exemplo.txt");
      expect(aberto(sniff("resume esse pdf", idx, { openNote: "Docs/manual-exemplo.pdf" }))).toBe("arquivo:Docs/manual-exemplo.pdf");
    });

    test("sem apontar, o aberto não entra; \"uma tabela\" não aponta", () => {
      expect(sniff("monta uma tabela com nome e total", idx, { openNote: csv }).kind).toBe("nada");
      expect(sniff("o que é um arquivo csv?", idx, { openNote: csv }).kind).toBe("nada");
    });

    test("outra nota citada pelo nome vale mais que o aberto", () => {
      expect(aberto(sniff("copia esse arquivo para a Lista de compras", idx, { openNote: csv }))).toBe("nota:Pessoal/Lista de compras.md");
      expect(aberto(sniff("escreve aqui na Lista de compras", idx, { openNote: csv }))).toBe("nota:Pessoal/Lista de compras.md");
    });

    test("uma palavra solta que é o nome de uma nota não tira o aberto da frente (revisão do T19969)", () => {
      const comuns = buildIndex({
        notes: ["Pessoal/Total.md", "Pessoal/Resumo.md", "Pessoal/Tabela.md", "Pessoal/Coluna.md", "Projeto X/Linhas.md", "Pessoal/Lista de compras.md", "Pessoal/Lista de tarefas.md", "Projeto X/Maior valor.md"].map(note),
        folders: ["Pessoal", "Projeto X"],
        projects: [],
        meetings: [],
      });
      for (const pedido of [
        "nesse csv, quantas linhas?",
        "soma a coluna B dessa planilha",
        "resume esse documento",
        "nesse arquivo, faz um resumo",
        "soma o total dessa planilha",
        "nesse arquivo, monta uma tabela com nome e total",
        "nessa planilha, qual o maior valor na coluna B?",
        "nesse arquivo, quanto dá no total?",
        // Um nome de várias palavras fora do lugar de destino também é só o que a pessoa disse (rodada 2).
        "nesse arquivo, monta uma lista de tarefas",
        "qual o maior valor dessa planilha?",
        "nessa tabela, qual o maior valor?",
      ])
        expect([pedido, aberto(sniff(pedido, comuns, { openNote: csv }))]).toEqual([pedido, `arquivo:${csv}`]);
      // A citação forte vale: o nome inteiro, ou a palavra depois de "nota" ou "para o".
      expect(aberto(sniff("copia esse arquivo para a Lista de compras", comuns, { openNote: csv }))).toBe("nota:Pessoal/Lista de compras.md");
      expect(aberto(sniff("põe os totais desse arquivo na nota Resumo", comuns, { openNote: csv }))).toBe("nota:Pessoal/Resumo.md");
      expect(aberto(sniff("copia esse arquivo para o Total", comuns, { openNote: csv }))).toBe("nota:Pessoal/Total.md");
      expect(aberto(sniff("escreve aqui na Lista de tarefas", comuns, { openNote: csv }))).toBe("nota:Pessoal/Lista de tarefas.md");
      expect(aberto(sniff("põe o maior valor desse arquivo no Maior valor", comuns, { openNote: csv }))).toBe("nota:Projeto X/Maior valor.md");
    });

    test("sem nada aberto, a frase pede a pergunta; o \"aqui\" sozinho não", () => {
      expect(sniff("nesse arquivo, monta uma tabela", idx)).toEqual({ kind: "nada", semAberto: true });
      expect(sniff("o que tá aberto?", idx)).toEqual({ kind: "nada", semAberto: true });
      expect(sniff("aqui está a lista de amanhã", idx)).toEqual({ kind: "nada" });
    });
  });
});
