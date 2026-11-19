// As trilhas (ADR 0013 decisão 4 = A, T14682; as palavras, spec #21283, T21325): a contagem, o disco e o faro. Os
// pedidos, as notas e as pastas são todos inventados (#17952).

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { buildIndex, sniff } from "./faro.ts";
import { PALAVRAS_COMUNS } from "./palavras-comuns.ts";
import { aprendendo, type LugarDaNota, notaDaMaioria, palavraComum, palavrasDoNome, palavrasDoPedido, type Trilha, TrilhaStore, trilhasDoPedido } from "./trilhas.ts";

const note = (p: string) => ({ path: p, title: p.split("/").pop()!.replace(/\.(md|txt)$/, ""), folder: p.split("/").slice(0, -1).join("/"), size: 100, mtime: "2026-11-10T00:00:00.000Z" });
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function store(now = () => 1_000) {
  const d = tempDir("kiwi-trilhas-");
  dirs.push(d);
  return { dir: d, s: new TrilhaStore(d, now) };
}

/** Os 30 pedidos falados (inventados), cheios do enchimento da fala, e a nota a que levam. */
const FALADOS: [pedido: string, nota: string][] = [
  ["na verdade eu queria ver o cronograma do lançamento", "Trabalho/Lançamento.md"],
  ["beleza, então me mostra realmente o orçamento da reforma", "Casa/Reforma.md"],
  ["basicamente o que ficou combinado com o encanador", "Casa/Reforma.md"],
  ["tipo assim, cadê a planilha do fornecedor", "Trabalho/Fornecedores.md"],
  ["olha, na real, eu preciso do cardápio da semana", "Cozinha/Cardápio.md"],
  ["então, sei lá, qual era o adubo do canteiro", "Jardim/Canteiro.md"],
  ["ah, verdade, e a palestra de quinta", "Agenda/Palestra.md"],
  ["sabe aquela ideia da colheita do tomate", "Jardim/Colheita.md"],
  ["realmente, o condomínio subiu de novo?", "Casa/Condomínio.md"],
  ["bom, basicamente quero o roteiro de Lisboa", "Viagens/Lisboa.md"],
  ["é verdade que o cronograma atrasou?", "Trabalho/Lançamento.md"],
  ["beleza, e o orçamento da reforma, fechou?", "Casa/Reforma.md"],
  ["então, olha, o encanador respondeu?", "Casa/Reforma.md"],
  ["na verdade, mostra a planilha do fornecedor de novo", "Trabalho/Fornecedores.md"],
  ["tá bom, o cardápio já está pronto?", "Cozinha/Cardápio.md"],
  ["certo, certo, e o adubo do canteiro?", "Jardim/Canteiro.md"],
  ["exatamente, a palestra mudou de horário?", "Agenda/Palestra.md"],
  ["entendi, e a colheita do tomate, rendeu?", "Jardim/Colheita.md"],
  ["realmente não lembro do condomínio", "Casa/Condomínio.md"],
  ["obviamente o roteiro de Lisboa tem museu", "Viagens/Lisboa.md"],
  ["pois é, o cronograma do lançamento mudou", "Trabalho/Lançamento.md"],
  ["claro, o orçamento da reforma veio alto", "Casa/Reforma.md"],
  ["enfim, o que o encanador falou mesmo", "Casa/Reforma.md"],
  ["tranquilo, abre a planilha do fornecedor", "Trabalho/Fornecedores.md"],
  ["normalmente o cardápio tem sopa?", "Cozinha/Cardápio.md"],
  ["simplesmente esqueci o adubo do canteiro", "Jardim/Canteiro.md"],
  ["provavelmente a palestra vai lotar", "Agenda/Palestra.md"],
  ["certamente a colheita do tomate foi boa", "Jardim/Colheita.md"],
  ["sinceramente, o condomínio está caro", "Casa/Condomínio.md"],
  ["literalmente, cadê o roteiro de Lisboa", "Viagens/Lisboa.md"],
];

describe("as palavras comuns (spec #21283)", () => {
  test("a lista: as 3 mil do FrequencyWords, fixa no repo, com a origem e a licença", () => {
    const ws = PALAVRAS_COMUNS.split(/\s+/).filter(Boolean);
    expect(ws).toHaveLength(3000);
    expect(new Set(ws).size).toBe(3000);
    for (const w of ["verdade", "realmente", "beleza", "basicamente"]) expect(ws).toContain(w);
    for (const w of ["orçamento", "reforma"]) expect(ws).not.toContain(w);
    const root = path.join(import.meta.dir, "../../..");
    expect(readFileSync(path.join(root, "NOTICE"), "utf8")).toContain("FrequencyWords");
    expect(readFileSync(path.join(root, "licenses/FrequencyWords-CC-BY-SA-4.0.md"), "utf8")).toContain("CC BY-SA 4.0");
  });

  test("nada é baixado: a lista e as trilhas não abrem rede", () => {
    for (const f of ["palavras-comuns.ts", "trilhas.ts"]) {
      const src = readFileSync(path.join(import.meta.dir, f), "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(src).not.toMatch(/\bfetch\(|https?:\/\/|node:https?|node:net|Bun\.connect/);
    }
  });

  test("os 30 pedidos falados: o enchimento nunca vira palavra-chave, nem na segunda vez", () => {
    const { s } = store();
    for (const [pedido, nota] of FALADOS) s.aprender(pedido, nota);
    const todas = s.list().flatMap((t) => [...t.palavras, ...(t.candidatas?.palavras ?? [])]);
    expect(todas.length).toBeGreaterThan(10);
    for (const w of todas) expect(palavraComum(w)).toBe(false);
    for (const w of ["verdade", "beleza", "realmente", "basicamente", "então", "olha", "certo", "claro", "enfim"]) {
      expect(todas.map((x) => x.toLowerCase())).not.toContain(w);
    }
    // As raras que se repetiram valem.
    expect(s.list().find((t) => t.path === "Casa/Reforma.md")?.palavras).toEqual(expect.arrayContaining(["orçamento", "reforma"]));
  });
});

describe("as palavras do pedido", () => {
  test("só as raras: sem as curtas, as comuns, os números e as repetidas; o plural casa o singular", () => {
    expect(palavrasDoPedido("Qual é o orçamento da viagem para Lisboa?").palavras).toEqual(["orçamento", "Lisboa"]);
    expect(palavrasDoPedido("o que tem sobre isso em 2026?").chaves).toEqual([]);
    expect(palavrasDoPedido("na verdade, beleza, realmente, basicamente").chaves).toEqual([]);
    expect(palavrasDoPedido("os canteiros").chaves).toEqual(palavrasDoPedido("o canteiro").chaves);
  });

  test("raras de verdade: o nome próprio, a sigla e o código; não a primeira palavra só por ser maiúscula", () => {
    expect(palavrasDoPedido("o roteiro de Lisboa").fortes).toEqual(["lisboa"]);
    expect(palavrasDoPedido("a planilha da ONG").fortes).toEqual(["ong"]);
    expect(palavrasDoPedido("o relatório Q3 do adubo").fortes).toEqual(["q3"]);
    expect(palavrasDoPedido("Cronograma do canteiro").fortes).toEqual([]);
  });

  test("a pasta da maioria: a primeira nota lida nela", () => {
    expect(notaDaMaioria([])).toBeNull();
    expect(notaDaMaioria(["Ideias.md", "Jardim/A.md", "Jardim/B.md", "Casa/C.md"])).toBe("Jardim/A.md");
    expect(notaDaMaioria(["Casa/C.md", "Jardim/A.md"])).toBe("Casa/C.md");
  });
});

describe("o nome da pasta vale mais (spec #21283)", () => {
  const horta = (nota: string): LugarDaNota => {
    const dir = nota.split("/")[0]!;
    return { nomes: [dir, nota.split("/")[1]!.replace(".md", "")], vizinhos: ["Horta Norte", "Horta Sul", "Horta Escola"].filter((x) => x !== dir) };
  };

  test("a palavra do nome da pasta vira palavra-chave na primeira vez, mesmo comum; e pelas variações", () => {
    const { s } = store();
    const t = s.aprender("na verdade, como está a horta norte?", "Horta Norte/Plantio.md", null, horta("Horta Norte/Plantio.md"))!;
    expect(aprendendo(t)).toBe(false);
    expect(t.palavras).toEqual(["horta", "norte"]);
    expect(t.fortes).toEqual(["norte"]);
    // Sem acento, no plural e pela sigla.
    expect(palavrasDoNome("as hortas do norte", { nomes: ["Horta Norte"], vizinhos: [] }).chaves).toEqual(["horta", "norte"]);
    expect(palavrasDoNome("o reuniao de amanhã", { nomes: ["Reunião"], vizinhos: [] }).chaves).toEqual(["reuniao"]);
    expect(palavrasDoNome("e a HN, como vai?", { nomes: ["Horta Norte"], vizinhos: [] }).chaves).toEqual(["hn"]);
  });

  test("entre pastas irmãs, o pedaço único é o forte, e o repetido sozinho não casa", () => {
    const { s } = store();
    s.aprender("como está a horta norte?", "Horta Norte/Plantio.md", null, horta("Horta Norte/Plantio.md"));
    s.aprender("e a horta escola, plantou?", "Horta Escola/Plantio.md", null, horta("Horta Escola/Plantio.md"));
    const casadas = (p: string) => trilhasDoPedido(p, s.list()).map((c) => c.trilha.path);
    expect(casadas("e a horta norte?")).toEqual(["Horta Norte/Plantio.md"]);
    expect(casadas("o que tem no norte?")).toEqual(["Horta Norte/Plantio.md"]);
    expect(casadas("e a escola?")).toEqual(["Horta Escola/Plantio.md"]);
    expect(casadas("e a horta?")).toEqual([]);
  });

  test("a sigla das iniciais só vale em maiúsculas: \"em\" e \"da\" não viram palavra-chave (revisão do T21325)", () => {
    const { s } = store();
    const ensaio: LugarDaNota = { nomes: ["Ensaio Mensal", "Pauta"], vizinhos: ["Ensaio Anual"] };
    expect(palavrasDoNome("o que ficou em aberto", ensaio).chaves).toEqual([]);
    expect(palavrasDoNome("o que ficou da conversa", { nomes: ["Diário Antigo"], vizinhos: [] }).chaves).toEqual([]);
    expect(s.aprender("o que ficou em aberto", "Ensaio Mensal/Pauta.md", null, ensaio)).toBeNull();
    expect(trilhasDoPedido("escreve um poema em verso", s.list())).toEqual([]);
    // Escrita como sigla, vale; e uma trilha com ela só casa com a sigla escrita assim.
    expect(palavrasDoNome("e o EM de março?", ensaio)).toMatchObject({ chaves: ["em"], fortes: ["em"] });
    s.aprender("e o EM de março?", "Ensaio Mensal/Pauta.md", null, ensaio);
    expect(trilhasDoPedido("e o EM de abril?", s.list()).map((c) => c.trilha.path)).toEqual(["Ensaio Mensal/Pauta.md"]);
    expect(trilhasDoPedido("escreve um poema em verso", s.list())).toEqual([]);
  });

  test("uma palavra sozinha que não é forte fica em Aprendendo, sem parecer trilha que vale", () => {
    const { s } = store();
    const t = s.aprender("e a horta?", "Horta Norte/Plantio.md", null, horta("Horta Norte/Plantio.md"))!;
    expect(aprendendo(t)).toBe(true);
    expect(t.candidatas?.palavras).toEqual(["horta"]);
    // Com o pedaço único na próxima, vira trilha.
    const u = s.aprender("e a horta do norte?", "Horta Norte/Plantio.md", null, horta("Horta Norte/Plantio.md"))!;
    expect(u.id).toBe(t.id);
    expect(u).toMatchObject({ palavras: ["horta", "norte"], fortes: ["norte"], vezes: 2 });
  });
});

describe("fora do nome: rara e na segunda vez", () => {
  test("a primeira vez fica aprendendo e não casa; a segunda guarda só as palavras que vieram nas duas", () => {
    const { s } = store();
    const um = s.aprender("na verdade, o cronograma do lançamento e o fornecedor", "Trabalho/Plano.md")!;
    expect(aprendendo(um)).toBe(true);
    expect(um.candidatas?.palavras).toEqual(["cronograma", "lançamento", "fornecedor"]);
    expect(trilhasDoPedido("o cronograma do lançamento", s.list())).toEqual([]);
    const dois = s.aprender("beleza, e o cronograma do lançamento, saiu?", "Trabalho/Plano.md")!;
    expect(dois).toMatchObject({ id: um.id, palavras: ["cronograma", "lançamento"], vezes: 2 });
    expect(aprendendo(dois)).toBe(false);
    expect(trilhasDoPedido("realmente, o cronograma do lançamento", s.list()).map((c) => c.palavras)).toEqual([["cronograma", "lançamento"]]);
  });

  test("uma palavra que aparece em muitas notas não vira palavra-chave", () => {
    const { s } = store();
    const muitas = new Set(["cronograma"]);
    const lugar: LugarDaNota = { nomes: ["Trabalho", "Plano"], vizinhos: [], muitas };
    s.aprender("o cronograma do lançamento", "Trabalho/Plano.md", null, lugar);
    const t = s.aprender("e o cronograma do lançamento?", "Trabalho/Plano.md", null, lugar)!;
    // Sobra só "lançamento", sozinha e fraca: fica em Aprendendo, e "cronograma" não entra nem lá.
    expect(t.palavras).toEqual([]);
    expect(t.candidatas?.palavras).toEqual(["lançamento"]);
    expect(t.candidatas?.chaves).not.toContain("cronograma");
  });

  test("uma trilha de uma palavra comum não casa com nada; a de uma palavra rara de verdade casa", () => {
    const comum: Trilha = { id: "a", palavras: ["festa"], chaves: ["festa"], path: "A.md", vezes: 3, em: 1 };
    const rara: Trilha = { id: "b", palavras: ["Lisboa"], chaves: ["lisboa"], fortes: ["lisboa"], path: "B.md", vezes: 1, em: 1 };
    const fraca: Trilha = { id: "c", palavras: ["cronograma"], chaves: ["cronograma"], path: "C.md", vezes: 1, em: 1 };
    expect(trilhasDoPedido("a festa de sábado", [comum])).toEqual([]);
    expect(trilhasDoPedido("e o cronograma?", [fraca])).toEqual([]);
    expect(trilhasDoPedido("o roteiro de Lisboa", [rara]).map((c) => c.trilha.id)).toEqual(["b"]);
    // A sigla e o código, aprendidos duas vezes, valem sozinhos.
    const { s } = store();
    s.aprender("a planilha da ONG", "D.md");
    s.aprender("de novo a ONG", "D.md");
    expect(trilhasDoPedido("e a ONG?", s.list()).map((c) => c.trilha.path)).toEqual(["D.md"]);
  });
});

describe("o disco", () => {
  test("aprende, conta de novo a mesma, apaga uma a uma, e o arquivo é só do dono", () => {
    const { dir, s } = store();
    const t = s.aprender("orçamento da viagem para Lisboa", "Pessoal/Gastos.md")!;
    expect(t).toMatchObject({ palavras: [], candidatas: { palavras: ["orçamento", "Lisboa"] }, path: "Pessoal/Gastos.md", vezes: 1 });
    expect(s.aprender("e o orçamento de Lisboa?", "Pessoal/Gastos.md")).toMatchObject({ palavras: ["orçamento", "Lisboa"], fortes: ["lisboa"], vezes: 2 });
    expect(s.list()).toHaveLength(1);
    // Outra nota, as mesmas palavras: outra trilha.
    s.aprender("orçamento de Lisboa", "Pessoal/Outra.md");
    expect(s.list()).toHaveLength(2);
    expect(s.aprender("o que tem sobre isso?", "Pessoal/Gastos.md")).toBeNull();
    const file = path.join(dir, "trilhas.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // De novo, do disco.
    const again = new TrilhaStore(dir);
    expect(again.list().map((x) => x.vezes)).toEqual([2, 1]);
    expect(again.apagar(t.id)).toBe(true);
    expect(again.apagar(t.id)).toBe(false);
    expect(new TrilhaStore(dir).list().map((x) => x.path)).toEqual(["Pessoal/Outra.md"]);
  });

  test("as trilhas antigas são limpas uma vez: saem as palavras comuns, e a vazia e a de uma palavra fraca somem", () => {
    const { dir } = store();
    const velha = (id: string, palavras: string[], p: string): Trilha => ({ id, palavras, chaves: palavras.map((w) => w.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")), path: p, vezes: 2, em: 5 });
    writeFileSync(
      path.join(dir, "trilhas.json"),
      JSON.stringify({ version: 1, trilhas: [velha("a", ["verdade", "compras", "festa"], "Festa.md"), velha("b", ["verdade", "orçamento", "Lisboa"], "Lisboa.md"), velha("c", ["realmente", "beleza"], "X.md"), velha("d", ["verdade", "encanador"], "Casa.md"), velha("e", ["Orçamento", "Q3"], "Q3.md")] }),
    );
    const s = new TrilhaStore(dir);
    // A trilha antiga não sabe a posição da palavra: a maiúscula de "Lisboa" e de "Orçamento" pode ser do começo da
    // frase, e só o código fica forte. A "d" ficou com uma palavra fraca e sai.
    expect(s.list().map((t) => [t.id, t.palavras, t.fortes])).toEqual([
      ["b", ["orçamento", "Lisboa"], undefined],
      ["e", ["Orçamento", "Q3"], ["q3"]],
    ]);
    const disco = JSON.parse(readFileSync(path.join(dir, "trilhas.json"), "utf8"));
    expect(disco.version).toBe(2);
    expect(disco.trilhas).toHaveLength(2);
    // Só uma vez: abrir de novo não muda nada.
    expect(new TrilhaStore(dir).list().map((t) => t.id)).toEqual(["b", "e"]);
  });

  test("um arquivo estragado vai para o lado, e as trilhas começam de novo", () => {
    const { dir, s } = store();
    writeFileSync(path.join(dir, "trilhas.json"), "{nada");
    expect(s.list()).toEqual([]);
    expect(existsSync(path.join(dir, "trilhas.json.bad"))).toBe(true);
    expect(readFileSync(path.join(dir, "trilhas.json.bad"), "utf8")).toBe("{nada");
    expect(readdirSync(dir).sort()).toEqual(["trilhas.json.bad"]);
  });
});

describe("o faro pela trilha", () => {
  const idx = buildIndex({ notes: [note("Pessoal/Gastos.md"), note("Pessoal/Lisboa.md"), note("Ideias.md")], folders: ["Pessoal"], projects: [], meetings: [] });
  const duasVezes = (s: TrilhaStore, pedido: string, nota: string) => {
    s.aprender(pedido, nota);
    s.aprender(pedido, nota);
  };

  test("o pedido com metade das palavras ou mais sobe a nota; com uma só de três, não", () => {
    const { s } = store();
    duasVezes(s, "como ficou o orçamento do encanador e do condomínio?", "Pessoal/Gastos.md");
    expect(sniff("como ficou o orçamento do encanador?", idx)).toEqual({ kind: "nada" });
    const r = sniff("me diz o orçamento do encanador", idx, { trilhas: s.list() });
    expect(r.kind).toBe("certo");
    expect(r.kind === "certo" && r.hit).toMatchObject({ target: { path: "Pessoal/Gastos.md" }, how: "trilha", said: "orçamento encanador" });
    expect(sniff("o encanador foi bom", idx, { trilhas: s.list() })).toEqual({ kind: "nada" });
  });

  test("a trilha aprendendo não sobe nada", () => {
    const { s } = store();
    s.aprender("o orçamento do encanador", "Pessoal/Gastos.md");
    expect(sniff("o orçamento do encanador", idx, { trilhas: s.list() })).toEqual({ kind: "nada" });
  });

  test("o nome exato vale mais que a trilha; a nota que saiu do cofre não volta", () => {
    const { s } = store();
    duasVezes(s, "orçamento do encanador", "Pessoal/Gastos.md");
    duasVezes(s, "passagens compradas no cardápio", "Sumiu.md");
    const r = sniff("o orçamento do encanador para Lisboa", idx, { trilhas: s.list() });
    expect(r.kind).toBe("provavel");
    expect(r.kind === "provavel" && r.hits.map((h) => h.target.path)).toEqual(["Pessoal/Lisboa.md", "Pessoal/Gastos.md"]);
    expect(sniff("as passagens do cardápio", idx, { trilhas: s.list() })).toEqual({ kind: "nada" });
  });

  test("a trilha de uma palavra rara de verdade casa com ela", () => {
    const { s } = store();
    duasVezes(s, "o que tem sobre a ONG?", "Ideias.md");
    expect(trilhasDoPedido("e a ONG?", s.list())).toHaveLength(1);
    expect(sniff("e a ONG?", idx, { trilhas: s.list() }).kind).toBe("certo");
  });
});
