import { describe, expect, test } from "bun:test";

import {
  addProperty,
  convertValue,
  formatDate,
  inferType,
  linkLabel,
  linkTarget,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
} from "./frontmatter-properties.ts";
import { splitFrontmatter } from "./frontmatter.ts";

const FM = `---
# a reunião da semana
status: em andamento
tags: [reunião, cliente/acme]
data: 2026-11-06
inicio: 2026-11-06T14:30
responsável: "[[Ana Souza]]"
concluída: false
prioridade: 2
participantes:
  - Ana
  - Bruno
extra:
  nested: 1
---
`;

describe("readProperties", () => {
  test("lê cada chave na ordem, com o tipo deduzido do valor", () => {
    expect(readProperties(FM)!.map((p) => [p.key, p.type, p.value])).toEqual([
      ["status", "text", "em andamento"],
      ["tags", "list", ["reunião", "cliente/acme"]],
      ["data", "date", "2026-11-06"],
      ["inicio", "datetime", "2026-11-06T14:30"],
      ["responsável", "link", "[[Ana Souza]]"],
      ["concluída", "checkbox", false],
      ["prioridade", "number", 2],
      ["participantes", "list", ["Ana", "Bruno"]],
      ["extra", "text", null],
    ]);
  });

  test("um valor aninhado fica só para ler, com o YAML dele", () => {
    expect(readProperties(FM)!.at(-1)!.raw).toBe("nested: 1");
  });

  test("sem frontmatter é uma lista vazia; YAML quebrado ou que não é mapa é null", () => {
    expect(readProperties("")).toEqual([]);
    expect(readProperties("---\nchave: [aberta\n---\n")).toBeNull();
    expect(readProperties("---\n- um\n- dois\n---\n")).toBeNull();
  });

  test("tags num texto só viram a lista, como as tags do engine", () => {
    expect(readProperties("---\ntags: um, dois tres\n---\n")![0]!.value).toEqual(["um", "dois", "tres"]);
  });
});

describe("as edições", () => {
  test("setProperty troca só aquele valor: o comentário, as aspas e o resto ficam", () => {
    const next = setProperty(FM, "status", "feito");
    expect(next).toBe(FM.replace("status: em andamento", "status: feito"));
    expect(setProperty(FM, "responsável", "[[Bruno]]")).toContain('responsável: "[[Bruno]]"');
  });

  test("uma lista em linha continua em linha, e a em bloco em bloco", () => {
    expect(setProperty(FM, "tags", ["a", "b", "c"])).toContain("tags: [a, b, c]");
    expect(setProperty(FM, "participantes", ["Ana"])).toContain("participantes:\n  - Ana\n");
  });

  test("um texto que parece número ou caixa sai entre aspas, para não mudar de tipo", () => {
    const next = setProperty("", "codigo", "123");
    expect(readProperties(next)![0]).toMatchObject({ type: "text", value: "123" });
    expect(readProperties(setProperty("", "x", "true"))![0]!.type).toBe("text");
  });

  test("cria o frontmatter quando a nota não tem, e uma chave nova vai para o fim", () => {
    expect(setProperty("", "status", "novo")).toBe("---\nstatus: novo\n---\n");
    expect(setProperty("---\na: 1\n---\n", "b", true)).toBe("---\na: 1\nb: true\n---\n");
  });

  test("renameProperty mantém o lugar e recusa um nome vazio ou que já existe", () => {
    const next = renameProperty(FM, "prioridade", "peso")!;
    expect(readProperties(next)!.map((p) => p.key)).toEqual(["status", "tags", "data", "inicio", "responsável", "concluída", "peso", "participantes", "extra"]);
    expect(renameProperty(FM, "prioridade", "status")).toBeNull();
    expect(renameProperty(FM, "prioridade", "  ")).toBeNull();
    expect(renameProperty(FM, "prioridade", "prioridade")).toBe(FM);
  });

  test("removeProperty tira a chave; tirar a última apaga o bloco", () => {
    expect(readProperties(removeProperty(FM, "data"))!.some((p) => p.key === "data")).toBe(false);
    expect(removeProperty("---\nsó: 1\n---\n", "só")).toBe("");
  });

  test("addProperty escolhe um nome livre", () => {
    const one = addProperty("")!;
    expect(one).toEqual({ frontmatter: "---\npropriedade:\n---\n", key: "propriedade" });
    expect(addProperty(one.frontmatter)!.key).toBe("propriedade 2");
    expect(addProperty("---\nx: [\n---\n")).toBeNull();
  });

  test("um frontmatter que não muda volta igual, byte a byte", () => {
    const samples = [
      FM,
      "---\ntitle: Nota\naliases:\n  - Outra\ncreated: 2026-01-02T10:00:00\n---\n",
      "---\nlista: [\"a b\", 'c']\nvazio:\ntexto: >-\n  linha um\n  linha dois\n---\n",
      "---\nk: v # comentário no fim\n\n# um comentário solto\nn: 1.50\n---\n",
    ];
    for (const fm of samples) expect(renameProperty(fm, "__nada__", "x") ?? setProperty(fm, readProperties(fm)![0]!.key, readProperties(fm)![0]!.value)).toBe(fm);
  });

  test("um frontmatter com CRLF continua com CRLF", () => {
    expect(setProperty("---\r\na: 1\r\n---\r\n", "a", 2)).toBe("---\r\na: 2\r\n---\r\n");
  });

  test("YAML quebrado não é reescrito", () => {
    const broken = "---\nchave: [aberta\n---\n";
    expect(setProperty(broken, "chave", "x")).toBe(broken);
    expect(removeProperty(broken, "chave")).toBe(broken);
  });
});

describe("os tipos", () => {
  test("inferType", () => {
    expect(inferType("x", "2026-01-02")).toBe("date");
    expect(inferType("x", "2026-01-02 08:00")).toBe("datetime");
    expect(inferType("x", "[[Nota]]")).toBe("link");
    expect(inferType("x", "texto")).toBe("text");
    expect(inferType("aliases", null)).toBe("list");
    expect(inferType("x", null)).toBe("text");
  });

  test("convertValue leva o valor para o tipo novo", () => {
    expect(convertValue("3,5", "number")).toBe(3.5);
    expect(convertValue("abc", "number")).toBeNull();
    expect(convertValue(["a", "b"], "text")).toBe("a, b");
    expect(convertValue("a", "list")).toEqual(["a"]);
    expect(convertValue(null, "list")).toEqual([]);
    expect(convertValue("sim", "checkbox")).toBe(true);
    expect(convertValue("talvez", "checkbox")).toBe(false);
    expect(convertValue("2026-11-06T10:00", "date")).toBe("2026-11-06");
    expect(convertValue("2026-11-06", "datetime")).toBe("2026-11-06T00:00");
    expect(convertValue("Ana", "link")).toBe("[[Ana]]");
    expect(convertValue(["[[Ana]]", "x"], "link")).toBe("[[Ana]]");
    expect(convertValue(true, "text")).toBe("true");
  });

  test("formatDate e os links", () => {
    expect(formatDate("2026-11-06")).toBe("6 nov 2026");
    expect(formatDate("2026-01-09T08:05")).toBe("9 jan 2026, 08:05");
    expect(formatDate("ontem")).toBe("ontem");
    expect(linkTarget("[[Ana Souza|Ana]]")).toBe("Ana Souza");
    expect(linkLabel("[[Ana Souza|Ana]]")).toBe("Ana");
    expect(linkLabel("[[Ana Souza]]")).toBe("Ana Souza");
  });
});

describe("o trecho que muda", () => {
  const SRC = "---\nk: v # c\nlista: [\"a b\", 'c']\nvazio:\ntexto: >-\n  um\n  dois\nseq:\n  - a\n  - b\n# solto\nn: 1\n---\n";

  test("cada edição mexe só na sua chave", () => {
    expect(setProperty(SRC, "k", "w")).toBe(SRC.replace("k: v # c", "k: w # c"));
    expect(setProperty(SRC, "vazio", "agora")).toBe(SRC.replace("vazio:\n", "vazio: agora\n"));
    expect(setProperty(SRC, "seq", ["x"])).toBe(SRC.replace("seq:\n  - a\n  - b\n", "seq:\n  - x\n"));
    expect(setProperty(SRC, "texto", "outro")).toBe(SRC.replace("texto: >-\n  um\n  dois\n", "texto: >-\n  outro\n"));
    expect(setProperty(SRC, "n", 2)).toBe(SRC.replace("n: 1", "n: 2"));
    expect(setProperty(SRC, "novo", true)).toBe(SRC.replace("n: 1\n", "n: 1\nnovo: true\n"));
  });

  test("remover e renomear também", () => {
    expect(removeProperty(SRC, "k")).toBe(SRC.replace("k: v # c\n", ""));
    expect(removeProperty(SRC, "vazio")).toBe(SRC.replace("vazio:\n", ""));
    expect(removeProperty(SRC, "seq")).toBe(SRC.replace("seq:\n  - a\n  - b\n", ""));
    expect(removeProperty(SRC, "n")).toBe(SRC.replace("n: 1\n", ""));
    expect(renameProperty(SRC, "texto", "resumo")).toBe(SRC.replace("texto: >-", "resumo: >-"));
    expect(renameProperty(SRC, "n", "123")).toBe(SRC.replace("n: 1", '"123": 1'));
  });
});

test("um frontmatter só com comentário aceita a primeira propriedade", () => {
  expect(readProperties("---\n# nada ainda\n---\n")).toEqual([]);
  expect(setProperty("---\n# nada ainda\n---\n", "a", 1)).toBe("---\n# nada ainda\na: 1\n---\n");
});

describe("o bloco fecha só numa linha `---` na coluna 0", () => {
  test("um bloco vazio ganha a propriedade dentro dele", () => {
    expect(readProperties("---\n---\n")).toEqual([]);
    expect(addProperty("---\n---\n")?.frontmatter).toBe("---\npropriedade:\n---\n");
    expect(addProperty("---\r\n---\r\n")?.frontmatter).toBe("---\r\npropriedade:\r\n---\r\n");
    expect(setProperty("---\n\n---\n", "a", 1)).toBe("---\na: 1\n---\n");
  });

  test("um `---` no fim de um valor não fecha o bloco", () => {
    const note = "---\ntitle: Parte 1 ---\nstatus: aberto\n---\n# Corpo\n";
    const { frontmatter, body } = splitFrontmatter(note);
    expect(readProperties(frontmatter)?.map((p) => [p.key, p.value])).toEqual([
      ["title", "Parte 1 ---"],
      ["status", "aberto"],
    ]);
    expect(setProperty(frontmatter, "status", "fechado") + body).toBe(note.replace("status: aberto", "status: fechado"));
  });

  test("um `---` indentado num texto em bloco não fecha o bloco", () => {
    const note = "---\nnota: |\n  antes\n  ---\n  depois\nstatus: aberto\n---\nCorpo\n";
    const { frontmatter, body } = splitFrontmatter(note);
    expect(readProperties(frontmatter)?.map((p) => [p.key, p.value])).toEqual([
      ["nota", "antes\n---\ndepois\n"],
      ["status", "aberto"],
    ]);
    expect(setProperty(frontmatter, "status", "fechado") + body).toBe(note.replace("status: aberto", "status: fechado"));
    expect(removeProperty(frontmatter, "status") + body).toBe(note.replace("status: aberto\n", ""));
  });
});
