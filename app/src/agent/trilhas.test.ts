// As trilhas (ADR 0013 decisão 4 = A, T14682): a contagem, o disco e o faro.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { buildIndex, sniff } from "./faro.ts";
import { palavrasDoPedido, TrilhaStore, trilhasDoPedido } from "./trilhas.ts";

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

describe("as palavras do pedido", () => {
  test("só as que dizem o assunto: sem as curtas, as comuns, os números e as repetidas; o plural casa o singular", () => {
    expect(palavrasDoPedido("Qual é o orçamento da viagem para Lisboa?").palavras).toEqual(["orçamento", "viagem", "Lisboa"]);
    expect(palavrasDoPedido("o que tem sobre isso em 2026?").chaves).toEqual([]);
    expect(palavrasDoPedido("os relatórios").chaves).toEqual(palavrasDoPedido("o relatório").chaves);
    expect(palavrasDoPedido("um dois três quatro cinco seis sete oito nove dezenas centenas milhares").palavras).toHaveLength(6);
  });
});

describe("o disco", () => {
  test("aprende, conta de novo a mesma, apaga uma a uma, e o arquivo é só do dono", () => {
    const { dir, s } = store();
    const t = s.aprender("orçamento da viagem para Lisboa", "Pessoal/Gastos.md")!;
    expect(t).toMatchObject({ palavras: ["orçamento", "viagem", "Lisboa"], path: "Pessoal/Gastos.md", vezes: 1 });
    expect(s.aprender("e o orçamento da viagem?", "Pessoal/Gastos.md")!.vezes).toBe(2);
    expect(s.list()).toHaveLength(1);
    // Outra nota, as mesmas palavras: outra trilha.
    s.aprender("orçamento da viagem", "Pessoal/Outra.md");
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

  test("um arquivo estragado vai para o lado, e as trilhas começam de novo", () => {
    const { dir, s } = store();
    writeFileSync(path.join(dir, "trilhas.json"), "{nada");
    expect(s.list()).toEqual([]);
    expect(existsSync(path.join(dir, "trilhas.json.bad"))).toBe(true);
    expect(readFileSync(path.join(dir, "trilhas.json.bad"), "utf8")).toBe("{nada");
  });
});

describe("o faro pela trilha", () => {
  const idx = buildIndex({ notes: [note("Pessoal/Gastos.md"), note("Pessoal/Lisboa.md"), note("Ideias.md")], folders: ["Pessoal"], projects: [], meetings: [] });

  test("o pedido com metade das palavras ou mais sobe a nota; com uma só de três, não", () => {
    const { s } = store();
    s.aprender("quanto ficou o orçamento da viagem?", "Pessoal/Gastos.md");
    expect(sniff("quanto ficou o orçamento da viagem?", idx)).toEqual({ kind: "nada" });
    const r = sniff("me diz o orçamento da viagem", idx, { trilhas: s.list() });
    expect(r.kind).toBe("certo");
    expect(r.kind === "certo" && r.hit).toMatchObject({ target: { path: "Pessoal/Gastos.md" }, how: "trilha", said: "orçamento viagem" });
    expect(sniff("a viagem foi boa", idx, { trilhas: s.list() })).toEqual({ kind: "nada" });
  });

  test("o nome exato vale mais que a trilha; a nota que saiu do cofre não volta", () => {
    const { s } = store();
    s.aprender("orçamento da viagem", "Pessoal/Gastos.md");
    s.aprender("passagens compradas", "Sumiu.md");
    const r = sniff("o orçamento da viagem a Lisboa", idx, { trilhas: s.list() });
    expect(r.kind).toBe("provavel");
    expect(r.kind === "provavel" && r.hits.map((h) => h.target.path)).toEqual(["Pessoal/Lisboa.md", "Pessoal/Gastos.md"]);
    expect(sniff("as passagens compradas", idx, { trilhas: s.list() })).toEqual({ kind: "nada" });
  });

  test("a trilha de uma palavra só casa com ela", () => {
    const { s } = store();
    s.aprender("o que tem sobre março?", "Ideias.md");
    expect(trilhasDoPedido("e março?", s.list())).toHaveLength(1);
    expect(sniff("e março?", idx, { trilhas: s.list() }).kind).toBe("certo");
  });
});
