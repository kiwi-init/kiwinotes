// O pacote do aberto nas Notas (T19969, spec #19269): o arquivo vai só como cartão, o nome dito antes de mexer, e a
// pergunta quando nada está aberto.
import { describe, expect, test } from "bun:test";

import { buildIndex, sniff } from "./faro.ts";
import { buildPackage, PACKAGE_END, PACKAGE_HEAD_NONE } from "./pacote.ts";
import type { VaultReader } from "./tools/reader.ts";

const notes: Record<string, string> = { "Pessoal/Lista de compras.md": "# Lista de compras\n\n- pão\n" };
const reader = {
  get: async (path: string) => {
    if (!(path in notes)) throw new Error("sem nota");
    return { path, title: path.split("/").pop()!.replace(/\.md$/, ""), mtime: "2026-11-10T00:00:00.000Z", content: notes[path]! };
  },
  list: async () => ({ notes: [], folders: [] }),
} as unknown as VaultReader;
const deps = { reader, seen: async (_p: string, c: string) => c };
const idx = buildIndex({
  notes: [{ path: "Pessoal/Lista de compras.md", title: "Lista de compras", folder: "Pessoal", size: 20, mtime: "2026-11-10T00:00:00.000Z" }],
  folders: ["Pessoal"],
  projects: [],
  meetings: [],
});

describe("o pacote do aberto nas Notas", () => {
  test("um csv aberto vai como cartão, sem o conteúdo, e com o nome dito antes", async () => {
    const pedido = "nesse arquivo, monta uma tabela com os totais";
    const p = (await buildPackage(deps, sniff(pedido, idx, { openNote: "Dados/dados-exemplo.csv" }), pedido))!;
    expect(p.text).toContain("arquivo aberto nas Notas: Dados/dados-exemplo.csv. O texto não vai junto: leia com kiwi ler/arquivo.");
    expect(p.text).toContain("kiwi escrever/arquivo");
    expect(p.text).toContain('("No dados-exemplo.csv:")');
    expect(p.delivered).toEqual([{ path: "Dados/dados-exemplo.csv", kind: "arquivo", text: false }]);
  });

  test("um tipo que o Kiwi não lê diz isso, sem inventar", async () => {
    const pedido = "o que tem nesse arquivo?";
    const p = (await buildPackage(deps, sniff(pedido, idx, { openNote: "Fotos/praia-exemplo.heic" }), pedido))!;
    expect(p.text).toContain("O Kiwi não lê esse tipo de arquivo");
  });

  test("uma nota aberta vai com o texto, como antes, e com o nome dito antes", async () => {
    const pedido = "nessa nota, põe leite";
    const p = (await buildPackage(deps, sniff(pedido, idx, { openNote: "Pessoal/Lista de compras.md" }), pedido))!;
    expect(p.text).toContain("- pão");
    expect(p.text).toContain('("No Lista de compras.md:")');
  });

  test("pela citação do nome, o nome não vem como apontado", async () => {
    const pedido = "o que tem na Lista de compras?";
    const p = (await buildPackage(deps, sniff(pedido, idx, { openNote: "Dados/dados-exemplo.csv" }), pedido))!;
    expect(p.text).not.toContain("A pessoa apontou");
  });

  test("sem nada aberto, o agente pergunta qual", async () => {
    const pedido = "nesse arquivo, monta uma tabela";
    const p = (await buildPackage(deps, sniff(pedido, idx), pedido))!;
    expect(p).toEqual({ text: `${PACKAGE_HEAD_NONE}\n${PACKAGE_END}`, delivered: [] });
  });
});
