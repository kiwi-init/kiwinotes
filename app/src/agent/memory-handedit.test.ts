// Varredura T12585: a memória editada à mão no cofre perde texto em silêncio na próxima mudança do agente.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { forgetFact, formatMemory, inspectMemory, MEMORY_FILE, mergeMemory, parseMemory, readMemory, rememberFact, writeMemory } from "./memory.ts";

function vaultWith(text: string) {
  const root = mkdtempSync(path.join(tmpdir(), "kn-mem-"));
  mkdirSync(path.dirname(path.join(root, MEMORY_FILE)), { recursive: true });
  writeFileSync(path.join(root, MEMORY_FILE), text);
  return root;
}
const remember = (root: string, fact: string) => writeMemory(root, rememberFact(readMemory(root), fact).facts);
const file = (root: string) => readFileSync(path.join(root, MEMORY_FILE), "utf8");

describe("a memória editada à mão", () => {
  test("o 61º fato escrito à mão não some quando o agente esquece outro", () => {
    const root = vaultWith(Array.from({ length: 61 }, (_, i) => `- fato ${i + 1}`).join("\n") + "\n");
    writeMemory(root, forgetFact(readMemory(root), "fato 1").facts);
    expect(file(root)).toContain("fato 61");
  });
  test("um fato longo escrito à mão não é cortado quando o agente anota outro", () => {
    const longo = "x".repeat(400);
    const root = vaultWith(`- ${longo}\n`);
    remember(root, "fato novo");
    expect(file(root)).toContain(longo);
  });
  test("um parágrafo escrito à mão não some quando o agente anota outro", () => {
    const root = vaultWith("- prefiro respostas curtas\n\nUma observação minha, fora da lista.\n");
    remember(root, "fato novo");
    expect(file(root)).toContain("Uma observação minha");
  });
});

// T12771 (spec #12749): o que o Kiwi faz com o arquivo escrito à mão.
describe("a memória escrita à mão: o que vai ao agente e o que fica (T12771)", () => {
  const HEAD = "# O que o agente sabe sobre você\n\nO agente do Kiwi escreve aqui o que aprende sobre você, um fato por linha. Você vê e muda tudo em Ajustes › Agente › Memória, ou aqui mesmo.\n\n";

  test("o agente lê só os fatos válidos; os longos, os depois dos 60 e as outras linhas ficam de fora, contados", () => {
    const longo = "y".repeat(301);
    const text = `${HEAD}- a\nUma nota minha.\n- ${longo}\n## Trabalho\n${Array.from({ length: 60 }, (_, i) => `- f${i}`).join("\n")}\n- A.\n`;
    const m = inspectMemory(text);
    expect(m.facts).toHaveLength(60);
    expect(m.facts[0]).toBe("a");
    expect(m.facts.at(-1)).toBe("f58");
    expect(m.skipped).toEqual([
      { text: longo, reason: "long" },
      { text: "f59", reason: "over" },
    ]);
    // O cabeçalho do Kiwi não conta; o parágrafo e o título, sim. O "- A." repetido não é nem fato nem de fora.
    expect(m.outside).toBe(2);
    expect(parseMemory(text)).toEqual(m.facts);
  });

  test("o arquivo do Kiwi sai com os mesmos bytes de antes: anotar, esquecer e esvaziar", () => {
    expect(mergeMemory(formatMemory(["a", "b"]), ["a", "b", "c"])).toBe(formatMemory(["a", "b", "c"]));
    expect(mergeMemory(formatMemory(["a", "b", "c"]), ["a", "c"])).toBe(formatMemory(["a", "c"]));
    expect(mergeMemory(formatMemory(["a"]), [])).toBe(formatMemory([]));
    expect(mergeMemory(formatMemory([]), ["a"])).toBe(formatMemory(["a"]));
    expect(mergeMemory(null, [" a ", "A.", ""])).toBe(formatMemory(["a"]));
  });

  test("só as linhas dos fatos mudam: o esquecido volta no lugar, o anotado vai depois do último, e o resto fica", () => {
    const text = "# Minha memória\n\nSobre mim:\n* mora em BH\n- trabalha com PACS\n\n## Gostos\n- café sem açúcar\n";
    // Esquecer o do meio e trazer de volta: a linha volta entre os vizinhos; o `*` e os títulos ficam.
    const sem = mergeMemory(text, ["mora em BH", "café sem açúcar"]);
    expect(sem).toBe("# Minha memória\n\nSobre mim:\n* mora em BH\n\n## Gostos\n- café sem açúcar\n");
    expect(mergeMemory(sem, ["mora em BH", "trabalha com PACS", "café sem açúcar"])).toBe("# Minha memória\n\nSobre mim:\n* mora em BH\n- trabalha com PACS\n\n## Gostos\n- café sem açúcar\n");
    // Anotar: depois do último fato da lista.
    expect(mergeMemory(text, ["mora em BH", "trabalha com PACS", "café sem açúcar", "tem um gato"])).toEndWith("- café sem açúcar\n- tem um gato\n");
    // Editar em Ajustes (o mesmo fato com outra escrita): a linha muda no lugar.
    expect(mergeMemory(text, ["Mora em Belo Horizonte", "trabalha com PACS", "café sem açúcar"])).toContain("Sobre mim:\n- Mora em Belo Horizonte\n- trabalha com PACS\n");
    // Um arquivo sem nenhum fato, só com texto: os fatos vão no fim, depois de uma linha em branco.
    expect(mergeMemory("Só um parágrafo.", ["a"])).toBe("Só um parágrafo.\n\n- a\n");
  });

  test("os fatos de fora ficam, a menos que a lista diga quais ficam; o 61º vira fato quando outro sai", () => {
    const longo = "z".repeat(320);
    const text = `- ${longo}\n${Array.from({ length: 61 }, (_, i) => `- f${i + 1}`).join("\n")}\n`;
    const facts = inspectMemory(text).facts;
    expect(inspectMemory(mergeMemory(text, facts)).skipped).toHaveLength(2);
    // Apagar o longo pela lista: só ele sai.
    const semLongo = mergeMemory(text, facts, ["f61"]);
    expect(semLongo).not.toContain(longo);
    expect(inspectMemory(semLongo).skipped).toEqual([{ text: "f61", reason: "over" }]);
    // Apagar um fato da lista: o 61º passa a ir ao agente.
    expect(inspectMemory(mergeMemory(semLongo, facts.slice(1))).facts.at(-1)).toBe("f61");
    // "Apagar tudo": todos os fatos saem, os de fora também.
    expect(inspectMemory(mergeMemory(text, [], []))).toEqual({ facts: [], skipped: [], outside: 0 });
  });
});
