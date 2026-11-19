// O índice do texto de todo arquivo de texto (T21240, spec #21165), num cofre inventado num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { tempDir } from "../../test/tmp.ts";
import { isIndexedText, lineOf, TextIndex } from "./text-index.ts";
import { Vault, type VaultFile } from "./vault.ts";

const open: { close(): unknown }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) await o.close();
});

function folder(files: Record<string, string | Uint8Array>) {
  const base = tempDir("kiwi-text-index-");
  const root = path.join(base, "Notas");
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), data);
  }
  const stat = (rel: string): VaultFile | undefined => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return undefined;
    const s = statSync(abs);
    return { path: rel, size: s.size, mtime: s.mtime.toISOString() };
  };
  const all = () => Object.keys(files).map(stat).filter((f): f is VaultFile => !!f);
  const index = (maxBytes?: number) => {
    const t = new TextIndex({ root, dir: path.join(base, "dados", "text-index"), pause: async () => {}, ...(maxBytes ? { maxBytes } : {}) });
    open.push(t);
    return t;
  };
  return { base, root, stat, all, index };
}

const paths = (hits: { path: string }[]) => hits.map((h) => h.path).sort();

describe("o que entra no índice", () => {
  test("os textos editáveis, o csv e o tsv; nunca o .env nem a nota", () => {
    for (const p of ["a.txt", "b.py", "c.json", "d.yaml", "e.log", "f.csv", "g.tsv", "h.ts"]) expect(`${p} ${isIndexedText(p)}`).toBe(`${p} true`);
    for (const p of [".env", "x/.env.teste", "prod.env", "nota.md", "foto.png", "planilha.xlsx", "doc.pdf"]) expect(`${p} ${isIndexedText(p)}`).toBe(`${p} false`);
  });

  test("a linha e o trecho do 1º termo, sem acento nem maiúscula", () => {
    expect(lineOf("um\ndois\n  Três maçãs aqui\n", ["macas"])).toEqual({ line: 3, snippet: "Três maçãs aqui" });
    expect(lineOf("nada", ["outra"])).toBeNull();
  });

  test("numa linha com recuo e espaços no meio, o trecho tem o termo (revisão do T21240)", () => {
    const line = `    x = 1${" ".repeat(80)}# pedido de exemplo`;
    const at = lineOf(`import os\n${line}\n`, ["pedido"])!;
    expect(at.line).toBe(2);
    expect(at.snippet).toContain("pedido de exemplo");
    expect(at.snippet).toContain("x = 1");
    // Longe do começo, o corte em volta do termo também acerta.
    const far = lineOf(`${"\t".repeat(30)}${"palavra ".repeat(40)}  Ação final`, ["acao"])!;
    expect(far.snippet).toContain("Ação final");
  });
});

describe("a busca no conteúdo (spec #21165)", () => {
  test("uma palavra que só existe dentro de um .py, um .json, um .txt e um csv: os quatro, com a linha e o formato", async () => {
    const f = folder({
      "Codigo/horta.py": "import os\n\ndef plantar():\n    return 'carambola'\n",
      "Dados/frutas.json": '{\n  "fruta": "carambola"\n}\n',
      "Textos/lista.txt": "comprar carambola\n",
      "Dados/vendas.csv": "fruta;kg\ncarambola;3\n",
      "Outros/foto.png": "carambola",
      "Outros/.env": "FRUTA=carambola\n",
    });
    const t = f.index();
    await t.sync(f.all());
    const hits = await t.search("carambola", 20, f.stat);
    expect(paths(hits)).toEqual(["Codigo/horta.py", "Dados/frutas.json", "Dados/vendas.csv", "Textos/lista.txt"]);
    const py = hits.find((h) => h.path === "Codigo/horta.py")!;
    expect(py).toMatchObject({ title: "horta.py", line: 4, file: { format: "py" } });
    expect(py.snippet).toContain("return 'carambola'");
    expect(hits.find((h) => h.path === "Textos/lista.txt")).toMatchObject({ title: "lista", line: 1 });
  });

  test("o quadro branco e o diagrama: o texto dos cartões e os rótulos, nunca o JSON nem o XML (T22217)", async () => {
    const quadro = JSON.stringify({
      nodes: [
        { id: "n1", type: "text", text: "Plantar a carambola", x: 0, y: 0, width: 200, height: 60 },
        { id: "n2", type: "text", text: "Regar\ntoda manhã", x: 0, y: 120, width: 200, height: 60 },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2", label: "depois" }],
    });
    // O draw.io grava a página compactada: o rótulo só aparece depois de descompactar.
    const pagina = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Colher a carambola" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel>';
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(pagina))).toString("base64");
    const f = folder({
      "Quadros/horta.canvas": quadro,
      "Diagramas/colheita.drawio": `<mxfile><diagram id="d1" name="Pomar">${packed}</diagram></mxfile>`,
      "Quadros/quebrado.canvas": "{ isto não é um quadro carambola",
    });
    const t = f.index();
    await t.sync(f.all());
    expect(isIndexedText("a.canvas") && isIndexedText("b.drawio")).toBe(true);
    // A palavra do cartão e o rótulo da página compactada; o quadro que não abre fica só pelo nome.
    expect(paths(await t.search("carambola", 20, f.stat))).toEqual(["Diagramas/colheita.drawio", "Quadros/horta.canvas"]);
    // O texto das setas e o nome da página entram; o que é do formato, não.
    expect(paths(await t.search("depois", 20, f.stat))).toEqual(["Quadros/horta.canvas"]);
    expect(paths(await t.search("pomar", 20, f.stat))).toEqual(["Diagramas/colheita.drawio"]);
    for (const formato of ["fromNode", "width", "mxCell", "mxGeometry", "vertex"]) expect(await t.search(formato, 20, f.stat)).toEqual([]);
    // A linha seria a do texto extraído, não a do arquivo: o trecho vai, a linha não.
    const [hit] = await t.search("manhã", 20, f.stat);
    expect(hit).toMatchObject({ path: "Quadros/horta.canvas", file: { format: "canvas" } });
    expect(hit!.snippet).toContain("manhã");
    expect(hit!.line).toBeUndefined();
  });

  test("os filtros da busca: path:, -palavra, -path:, \"frase\"; o tag: é de nota", async () => {
    const f = folder({
      "A/um.py": "caju e manga\n",
      "B/dois.py": "caju sem a outra\n",
      "B/tres.txt": "manga caju\n",
    });
    const t = f.index();
    await t.sync(f.all());
    expect(paths(await t.search("caju path:B", 20, f.stat))).toEqual(["B/dois.py", "B/tres.txt"]);
    expect(paths(await t.search("caju -manga", 20, f.stat))).toEqual(["B/dois.py"]);
    expect(paths(await t.search("caju -path:B", 20, f.stat))).toEqual(["A/um.py"]);
    expect(paths(await t.search('"caju e manga"', 20, f.stat))).toEqual(["A/um.py"]);
    expect(await t.search("caju tag:fruta", 20, f.stat)).toEqual([]);
    // Pelo caminho também, como a busca do gato fazia.
    expect(paths(await t.search("tres", 20, f.stat))).toEqual(["B/tres.txt"]);
  });

  test("pela capacidade notes.search: a nota primeiro, depois o arquivo, para a barra, o ⌘K e o gato", async () => {
    const f = folder({ "Nota.md": "# Nota\n\nfalar de graviola\n", "Codigo/fruta.ts": "export const fruta = 'graviola';\n" });
    const v = new Vault({ root: f.root, debounceMs: 20, trash: async () => {} });
    open.push(v);
    const text = f.index();
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (x) => x },
      snippets: { load: async () => [], save: async (x) => x },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: v,
      textIndex: text,
    }) as Record<string, (a: unknown) => Promise<unknown>>;
    await caps["notes.list"]!(undefined);
    v.watch();
    await text.idle();
    const hits = (await caps["notes.search"]!({ query: "graviola", limit: 10 })) as { path: string; file?: { format: string }; line?: number }[];
    expect(hits.map((h) => h.path)).toEqual(["Nota.md", "Codigo/fruta.ts"]);
    expect(hits[1]).toMatchObject({ file: { format: "ts" }, line: 1 });
    // O arquivo que muda por fora entra pelo watcher.
    writeFileSync(path.join(f.root, "Codigo/fruta.ts"), "export const fruta = 'pitaya';\n");
    for (let i = 0; i < 100 && !(await caps["notes.search"]!({ query: "pitaya" }) as unknown[]).length; i++) await Bun.sleep(20);
    expect(((await caps["notes.search"]!({ query: "pitaya" })) as { path: string }[]).map((h) => h.path)).toEqual(["Codigo/fruta.ts"]);
  });
});

describe("a abertura seguinte e o que muda (spec #21165)", () => {
  test("a 2ª abertura não lê de novo os arquivos que não mudaram; lê só o que mudou", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`Codigo/m${i}.py`] = `valor = ${i}\n`;
    const f = folder(files);
    const first = f.index();
    await first.sync(f.all());
    expect(first.stats).toMatchObject({ read: 30, skipped: 0 });
    await first.close();

    writeFileSync(path.join(f.root, "Codigo/m7.py"), "valor = 'umbu'\n");
    const second = f.index();
    await second.sync(f.all());
    expect(second.stats).toMatchObject({ read: 1, skipped: 29 });
    expect(paths(await second.search("umbu", 10, f.stat))).toEqual(["Codigo/m7.py"]);
  });

  test("apagado ou renomeado: sai do índice; o novo nome entra", async () => {
    const f = folder({ "a/velho.txt": "tamarindo\n", "a/outro.txt": "tamarindo\n" });
    const t = f.index();
    await t.sync(f.all());
    rmSync(path.join(f.root, "a/outro.txt"));
    renameSync(path.join(f.root, "a/velho.txt"), path.join(f.root, "a/novo.txt"));
    await t.update(["a/outro.txt", "a/velho.txt", "a/novo.txt"], f.stat);
    expect(paths(await t.search("tamarindo", 10, f.stat))).toEqual(["a/novo.txt"]);
    expect(t.stats.removed).toBe(2);
    // A abertura com a lista de agora também tira o que sumiu.
    rmSync(path.join(f.root, "a/novo.txt"));
    await t.sync([]);
    expect(await t.search("tamarindo", 10, f.stat)).toEqual([]);
  });

  test("o índice fica nos dados do app, nunca na pasta de notas", async () => {
    const f = folder({ "a.txt": "x\n" });
    const t = f.index();
    await t.sync(f.all());
    expect(existsSync(path.join(f.base, "dados", "text-index", "index.sqlite"))).toBe(true);
    expect(statSync(path.join(f.base, "dados", "text-index", "index.sqlite")).mode & 0o777).toBe(0o600);
    expect(Bun.spawnSync(["ls", "-A", f.root]).stdout.toString().trim()).toBe("a.txt");
  });
});

describe("arquivos estranhos (spec #21165)", () => {
  test("acima do limite: só pelo nome, sem erro; no limite exato, pelo conteúdo", async () => {
    const max = 1024;
    const exact = `${"a".repeat(max - 8)} abacate`;
    const f = folder({ "grande-abacate.log": `${"x".repeat(max)} goiaba\n`, "exato.txt": exact });
    const t = f.index(max);
    await t.sync(f.all());
    expect(Buffer.byteLength(exact)).toBe(max);
    expect(t.stats).toMatchObject({ read: 1, nameOnly: 1 });
    expect(await t.search("goiaba", 10, f.stat)).toEqual([]);
    const byName = await t.search("abacate", 10, f.stat);
    expect(paths(byName)).toEqual(["exato.txt", "grande-abacate.log"]);
    expect(byName.find((h) => h.path === "grande-abacate.log")).toMatchObject({ snippet: "" });
    expect(byName.find((h) => h.path === "grande-abacate.log")!.line).toBeUndefined();
  });

  test("um .txt que é binário entra só pelo nome; um latin1 entra pelo conteúdo, com o acento", async () => {
    const f = folder({
      "bin.txt": new Uint8Array([0x6d, 0x61, 0x6d, 0x61, 0x6f, 0, 1, 2, 3]),
      "antigo.txt": Buffer.from("maçã e mamão\n", "latin1"),
    });
    const t = f.index();
    await t.sync(f.all());
    expect(t.stats).toMatchObject({ read: 1, nameOnly: 1 });
    expect(paths(await t.search("mamao", 10, f.stat))).toEqual(["antigo.txt"]);
    expect((await t.search("maca", 10, f.stat))[0]!.snippet).toBe("maçã e mamão");
  });

  test("a busca lê no máximo o orçamento; o resto vem aproximado, sem trecho (revisão do T21240, como o #524)", async () => {
    const files: Record<string, string> = {};
    const big = `${"linha de registro qualquer\n".repeat(2000)}pedido 7\n`; // ~54 KB
    for (let i = 0; i < 30; i++) files[`Logs/l${i}.log`] = big;
    files["Logs/enorme.log"] = `pedido\n${"x".repeat(200 * 1024)}\n`;
    const f = folder(files);
    const t = new TextIndex({ root: f.root, dir: path.join(f.base, "dados", "text-index"), pause: async () => {}, readTotal: 256 * 1024, readFile: 128 * 1024 });
    open.push(t);
    await t.sync(f.all());
    const hits = await t.search("pedido", 31, f.stat);
    expect(hits).toHaveLength(31);
    expect(t.lastSearchBytes).toBeLessThanOrEqual(256 * 1024);
    const read = hits.filter((h) => !h.approx);
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((h) => h.snippet.includes("pedido") && h.line)).toBe(true);
    const approx = hits.filter((h) => h.approx);
    expect(approx.map((h) => h.path)).toContain("Logs/enorme.log");
    expect(approx.every((h) => h.snippet === "" && h.line === undefined)).toBe(true);
    // A frase que não está no texto: a busca para no orçamento em vez de ler todos os candidatos.
    await t.search('"pedido 8"', 31, f.stat);
    expect(t.lastSearchBytes).toBeLessThanOrEqual(256 * 1024);
    // O -palavra vale também no aproximado: vai ao índice.
    expect(paths(await t.search("pedido -registro", 31, f.stat))).toEqual(["Logs/enorme.log"]);
  });

  test("um índice estragado é refeito, sem erro", async () => {
    const f = folder({ "a.txt": "pequi\n" });
    mkdirSync(path.join(f.base, "dados", "text-index"), { recursive: true });
    writeFileSync(path.join(f.base, "dados", "text-index", "index.sqlite"), "isto não é um banco");
    const t = f.index();
    await t.sync(f.all());
    expect(paths(await t.search("pequi", 10, f.stat))).toEqual(["a.txt"]);
  });
});
