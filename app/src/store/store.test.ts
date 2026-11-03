import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DictionaryStore, MAX_ALIASES, sanitizeTerms, sttVocabulary } from "./dictionary.ts";
import { HistoryStore } from "./history.ts";
import { expandSnippets, sanitizeSnippets, SnippetStore } from "./snippets.ts";
import { fold, foldWithMap } from "./text.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kiwi-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("texto", () => {
  test("fold tira acento e maiúscula", () => {
    expect(fold("Ação É Çedilha")).toBe("acao e cedilha");
  });
  test("foldWithMap aponta para o original", () => {
    const { folded, map } = foldWithMap("É açaí");
    expect(folded).toBe("e acai");
    expect(map[2]).toBe(2);
    expect(map[folded.length]).toBe(6);
  });
});

describe("dicionário", () => {
  test("limpa, tira repetidos sem olhar maiúscula/acento e aceita string solta", () => {
    expect(
      sanitizeTerms([" DICOM ", "dicom", { term: "kubectl", aliases: ["cube control", "Cube Control", "kubectl", ""] }, { term: "" }, 42, null]),
    ).toEqual([
      { term: "DICOM", aliases: [] },
      { term: "kubectl", aliases: ["cube control"] },
    ]);
  });

  test("salva legível, só para o usuário, e lê de volta", async () => {
    const store = new DictionaryStore(dir);
    expect(await store.load()).toEqual([]);
    await store.save([{ term: "PACS", aliases: ["packs"] }, "Healthcare API"]);
    expect(await store.load()).toEqual([
      { term: "PACS", aliases: ["packs"] },
      { term: "Healthcare API", aliases: [] },
    ]);
    const raw = await readFile(store.file, "utf8");
    expect(raw).toContain('"term": "PACS"');
    expect((await stat(store.file)).mode & 0o777).toBe(0o600);
    expect(sttVocabulary(await store.load())).toEqual(["PACS", "Healthcare API"]);
  });

  test("arquivo editado à mão com lixo não derruba", async () => {
    const store = new DictionaryStore(dir);
    await writeFile(store.file, JSON.stringify({ version: 1, terms: [{ term: "ok" }, { nope: true }] }));
    expect(await store.load()).toEqual([{ term: "ok", aliases: [] }]);
  });
});

describe("snippets", () => {
  const snippets = [
    { trigger: "meu e-mail", text: "davi@example.com" },
    { trigger: "meu e-mail do trabalho", text: "davi@empresa.com" },
    { trigger: "assinatura", text: "Abraço,\nDavi" },
  ];

  test("o ditado inteiro é o gatilho: sai só o texto", () => {
    expect(expandSnippets("Meu e-mail.", snippets)).toBe("davi@example.com");
    expect(expandSnippets("meu email", snippets)).toBe("davi@example.com");
    expect(expandSnippets("Meu E mail!", snippets)).toBe("davi@example.com");
    expect(expandSnippets("Assinatura.", snippets)).toBe("Abraço,\nDavi");
  });

  test("no meio da frase troca só o gatilho", () => {
    expect(expandSnippets("Manda pro meu e-mail, por favor.", snippets)).toBe("Manda pro davi@example.com, por favor.");
  });

  test("no meio da frase, o hífen ou o espaço dentro da palavra não importa (T914)", () => {
    const plain = [{ trigger: "meu email", text: "davi@example.com" }];
    expect(expandSnippets("Manda pro meu e-mail agora.", plain)).toBe("Manda pro davi@example.com agora.");
    expect(expandSnippets("Manda pro meu e mail agora.", plain)).toBe("Manda pro davi@example.com agora.");
    expect(expandSnippets("Manda pro meu email agora.", plain)).toBe("Manda pro davi@example.com agora.");
    // Ainda só palavra inteira.
    expect(expandSnippets("Manda pro meu emails agora.", plain)).toBe("Manda pro meu emails agora.");
  });

  test("o STT errou o gatilho por pouco: dispara pela forma falada (T985)", () => {
    for (const trigger of ["meu email", "meu e-mail"]) {
      const snip = [{ trigger, text: "davi@example.com" }];
      expect(expandSnippets("Manda para meu imeio.", snip)).toBe("Manda para davi@example.com.");
      expect(expandSnippets("Manda para meu emeio agora.", snip)).toBe("Manda para davi@example.com agora.");
      expect(expandSnippets("Meu imeio.", snip)).toBe("davi@example.com");
    }
  });

  test("o que só parece o gatilho não dispara (T985)", () => {
    const snip = [{ trigger: "meu e-mail", text: "davi@example.com" }];
    for (const text of [
      "O meu emprego é longe.",
      "O meu mais bonito.",
      "O meu e mais o seu.",
      "Meu irmão chegou.",
      "No meio do caminho.",
      "Meu meio de transporte.",
      "Meu mel é doce.",
      "Manda um e-mail para mim.",
    ]) {
      expect(expandSnippets(text, snip)).toBe(text);
    }
    // Uma palavra só: nada de forma aproximada ("assinaturas" não é "assinatura").
    const one = [{ trigger: "assinatura", text: "Abraço, Davi" }];
    expect(expandSnippets("Revisa as assinaturas.", one)).toBe("Revisa as assinaturas.");
    expect(expandSnippets("Põe a assinatura.", one)).toBe("Põe a Abraço, Davi.");
  });

  test("o gatilho certo ganha do aproximado", () => {
    const snips = [
      { trigger: "meu e-mail", text: "davi@example.com" },
      { trigger: "meu emeio", text: "outro" },
    ];
    expect(expandSnippets("Manda para meu emeio.", snips)).toBe("Manda para outro.");
  });

  test("o gatilho mais longo ganha", () => {
    expect(expandSnippets("Usa o meu e-mail do trabalho.", snippets)).toBe("Usa o davi@empresa.com.");
  });

  test("o texto de um snippet não dispara outro (uma passada só)", () => {
    const nested = [
      { trigger: "assinatura", text: "Abraço, Davi. Meu e-mail segue." },
      { trigger: "meu e-mail", text: "davi@x.com" },
    ];
    expect(expandSnippets("manda a assinatura", nested)).toBe("manda a Abraço, Davi. Meu e-mail segue.");
    expect(expandSnippets("assinatura e meu e-mail", nested)).toBe("Abraço, Davi. Meu e-mail segue. e davi@x.com");
  });

  test("não dispara dentro de outra palavra", () => {
    expect(expandSnippets("A assinaturas do contrato.", snippets)).toBe("A assinaturas do contrato.");
  });

  test("acento e maiúscula não importam no gatilho", () => {
    expect(expandSnippets("Endereço de casa", [{ trigger: "endereco de casa", text: "Rua X, 10" }])).toBe("Rua X, 10");
  });

  test("sanitize: gatilho curto demais, vazio ou repetido sai", () => {
    expect(
      sanitizeSnippets([
        { trigger: "a", text: "x" },
        { trigger: "ok", text: " " },
        { trigger: "Meu E-mail", text: "1" },
        { trigger: "meu email", text: "2" },
      ]),
    ).toEqual([{ trigger: "Meu E-mail", text: "1" }]);
  });

  test("salva e lê", async () => {
    const store = new SnippetStore(dir);
    await store.save(snippets);
    expect(await store.load()).toEqual(snippets);
  });
});

describe("histórico", () => {
  test("grava em JSONL por dia, só para o usuário, e busca do mais novo para o mais velho", async () => {
    const h = new HistoryStore(dir);
    await h.add({ raw: "hum o deploy quebrou", text: "O deploy quebrou.", app: { name: "Slack" }, at: new Date(2026, 10, 1, 9) });
    await h.add({ raw: "reunião às quatro", text: "Reunião às quatro.", app: { name: "Mail" }, at: new Date(2026, 10, 2, 10) });
    await h.add({ raw: "o pacs voltou", text: "O PACS voltou.", app: { name: "Slack" }, at: new Date(2026, 10, 2, 11) });

    const all = await h.search();
    expect(all.entries.map((e) => e.text)).toEqual(["O PACS voltou.", "Reunião às quatro.", "O deploy quebrou."]);
    expect(all.nextBefore).toBeUndefined();

    const file = path.join(h.dir, "2026-11-02.jsonl");
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(h.dir)).mode & 0o777).toBe(0o700);
  });

  test("busca sem acento, por todas as palavras, no cru, no final e no app", async () => {
    const h = new HistoryStore(dir);
    await h.add({ raw: "reunião às quatro", text: "Reunião às quatro.", app: { name: "Mail" } });
    await h.add({ raw: "hum o deploy quebrou", text: "O deploy quebrou.", app: { name: "Slack" } });
    expect((await h.search({ query: "REUNIAO" })).entries).toHaveLength(1);
    expect((await h.search({ query: "deploy slack" })).entries).toHaveLength(1);
    expect((await h.search({ query: "hum" })).entries).toHaveLength(1);
    expect((await h.search({ query: "deploy mail" })).entries).toHaveLength(0);
  });

  test("paginação com before", async () => {
    const h = new HistoryStore(dir);
    for (let i = 0; i < 5; i++) await h.add({ raw: `${i}`, text: `ditado ${i}`, at: new Date(2026, 10, 2, 10, i) });
    const first = await h.search({ limit: 2 });
    expect(first.entries.map((e) => e.text)).toEqual(["ditado 4", "ditado 3"]);
    const second = await h.search({ limit: 2, before: first.nextBefore });
    expect(second.entries.map((e) => e.text)).toEqual(["ditado 2", "ditado 1"]);
    const third = await h.search({ limit: 2, before: second.nextBefore });
    expect(third.entries.map((e) => e.text)).toEqual(["ditado 0"]);
    expect(third.nextBefore).toBeUndefined();
  });

  test("apagar tira só aquele ditado, e linha estragada não esconde as outras", async () => {
    const h = new HistoryStore(dir);
    const a = await h.add({ raw: "a", text: "A.", at: new Date(2026, 10, 2, 10) });
    await h.add({ raw: "b", text: "B.", at: new Date(2026, 10, 2, 11) });
    await writeFile(path.join(h.dir, "2026-11-02.jsonl"), `${await readFile(path.join(h.dir, "2026-11-02.jsonl"), "utf8")}{quebrado\n`);
    expect(await h.delete(a.id)).toBe(true);
    expect(await h.delete("não existe")).toBe(false);
    expect((await h.search()).entries.map((e) => e.text)).toEqual(["B."]);
  });

  test("apagar ao mesmo tempo que chegam ditados não perde nenhum", async () => {
    const h = new HistoryStore(dir);
    const first = await h.add({ raw: "x", text: "x" });
    for (let i = 0; i < 30; i++) await h.add({ raw: `${i}`, text: `${i}` });
    await Promise.all([h.delete(first.id), ...Array.from({ length: 20 }, (_, i) => h.add({ raw: `n${i}`, text: `n${i}` }))]);
    expect((await h.search({ limit: 500 })).entries).toHaveLength(50);
  });

  test("uma escrita que falha não trava as próximas", async () => {
    const h = new HistoryStore(dir);
    await expect(h.add({ raw: null as unknown as string, text: "x" })).rejects.toThrow();
    await h.add({ raw: "ok", text: "Ok." });
    expect((await h.search()).entries.map((e) => e.text)).toEqual(["Ok."]);
  });

  test("com before, pula os dias mais novos que o cursor", async () => {
    const h = new HistoryStore(dir);
    const old = await h.add({ raw: "a", text: "antigo", at: new Date(2026, 9, 1, 10) });
    await h.add({ raw: "b", text: "novo", at: new Date(2026, 10, 2, 10) });
    await h.add({ raw: "c", text: "mais antigo", at: new Date(2026, 8, 1, 10) });
    const page = await h.search({ before: old.id });
    expect(page.entries.map((e) => e.text)).toEqual(["mais antigo"]);
  });

  test("com before, não pula o dia de um ditado feito noutro fuso (#416)", async () => {
    const h = new HistoryStore(dir);
    // Ditado às 10h (hora daqui), mas gravado num fuso 20 h à frente: o arquivo dele é o do dia seguinte.
    const at = new Date(2026, 9, 1, 10);
    const ahead = new Date(at.getTime() + 20 * 3600_000);
    const p = (n: number) => String(n).padStart(2, "0");
    const file = `${ahead.getFullYear()}-${p(ahead.getMonth() + 1)}-${p(ahead.getDate())}.jsonl`;
    const entry = { id: `${at.toISOString()}-abcd`, at: at.toISOString(), raw: "v", text: "da viagem" };
    await h.add({ raw: "x", text: "cursor", at: new Date(at.getTime() + 3600_000) });
    await writeFile(path.join(dir, "history", file), `${JSON.stringify(entry)}\n`);
    const cursor = (await h.search()).entries.find((e) => e.text === "cursor")!;
    expect((await h.search({ before: cursor.id })).entries.map((e) => e.text)).toEqual(["da viagem"]);
  });

  test("as páginas saem em ordem e não pulam nada quando um arquivo de dia tem um ditado de outro fuso (T914)", async () => {
    const h = new HistoryStore(dir);
    await h.add({ raw: "x", text: "cria a pasta", at: new Date(2026, 0, 1, 10) });
    // 23h UTC de 03/11 ditado em UTC+2 (arquivo de 04/11) e 05h UTC de 04/11 ditado em UTC−8 (arquivo de 03/11).
    const line = (iso: string, text: string) => `${JSON.stringify({ id: `${iso}-abcd`, at: iso, raw: text, text })}\n`;
    await writeFile(path.join(dir, "history", "2026-11-04.jsonl"), line("2026-11-03T23:00:00.000Z", "leste"));
    await writeFile(path.join(dir, "history", "2026-11-03.jsonl"), line("2026-11-04T05:00:00.000Z", "oeste"));
    const seen: string[] = [];
    let before: string | undefined;
    do {
      const page = await h.search({ limit: 1, before });
      seen.push(...page.entries.map((e) => e.text));
      before = page.nextBefore;
    } while (before);
    expect(seen).toEqual(["oeste", "leste", "cria a pasta"]);
  });

  test("avisa quem está ouvindo", async () => {
    const h = new HistoryStore(dir);
    const seen: string[] = [];
    const off = h.onAdded((e) => seen.push(e.text));
    await h.add({ raw: "x", text: "X." });
    off();
    await h.add({ raw: "y", text: "Y." });
    expect(seen).toEqual(["X."]);
  });
});

test("um termo guarda no máximo 50 aliases (T1378)", () => {
  const aliases = Array.from({ length: 80 }, (_, i) => `forma ${i}`);
  const [t] = sanitizeTerms([{ term: "kubectl", aliases }]);
  expect(MAX_ALIASES).toBe(50);
  expect(t!.aliases).toEqual(aliases.slice(0, 50));
});
