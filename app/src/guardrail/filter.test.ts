// O filtro do guardrail (spec #9818): o guard sozinho, e as ferramentas do Kiwi com ele, sobre um cofre de verdade num
// tmp (as capacidades das janelas). Só exemplos inventados, no formato certo: nenhum segredo de verdade.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { Vault } from "../notes/vault.ts";
import { NoteVersions } from "../notes/versions.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { readerFromCapabilities } from "../agent/tools/reader.ts";
import { READ_MAX_CHARS, runKiwiTool, ToolError } from "../agent/tools/tools.ts";
import { writerFromCapabilities } from "../agent/tools/writer.ts";
import { GuardError, MARKER, removedSecrets, SecretGuard } from "./filter.ts";

// Inventados, no formato de verdade.
const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const AWS = "AKIA" + "Q7XZ3K9P2M4N8R6T";
const PWD = "Kiwi#2024";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const markers = (t: string) => [...t.matchAll(MARKER)].map((m) => m[0]);

describe("o guard (spec #9818)", () => {
  test("cada segredo vira um marcador, o mesmo segredo da mesma nota leva sempre o mesmo número, e o resto vai igual", () => {
    const g = new SecretGuard("k7q2");
    const text = `# Acessos\n\nO token é ${GH}.\nsenha: ${PWD}\nDe novo: ${GH}\nIP 10.0.0.12, srv-pacs-01.\n`;
    const a = g.read("Acessos.md", text);
    expect(a.text).not.toContain(GH);
    expect(a.text).not.toContain(PWD);
    expect(a.text).toContain("IP 10.0.0.12, srv-pacs-01.");
    expect(a.held).toBe(2);
    expect(markers(a.text)).toEqual(["‹segredo 1 · k7q2›", "‹segredo 2 · k7q2›", "‹segredo 1 · k7q2›"]);
    // Outra leitura da mesma nota: os mesmos números.
    expect(g.read("Acessos.md", text).text).toBe(a.text);
    // O mesmo valor em outra nota leva outro número: um marcador é preso à nota.
    expect(markers(g.read("Outra.md", `token: ${GH}`).text)).toEqual(["‹segredo 3 · k7q2›"]);
  });

  test("a escrita põe o original de volta, só na nota de onde ele saiu", () => {
    const g = new SecretGuard("k7q2");
    const seen = g.read("Acessos.md", `token: ${GH}`).text;
    const m = markers(seen)[0]!;
    expect(g.write("Acessos.md", `novo token: ${m}`)).toBe(`novo token: ${GH}`);
    expect(() => g.write("Outra.md", `copiado: ${m}`)).toThrow(GuardError);
    // De outra sessão (ou de antes de o app reabrir), ou um número que esta sessão não deu: recusado.
    expect(() => g.write("Acessos.md", "‹segredo 1 · zzzz›")).toThrow(/outra sessão/);
    expect(() => g.write("Acessos.md", "‹segredo 99 · k7q2›")).toThrow(/não foi dado/);
    // Só parece marcador: é texto.
    expect(g.write("Acessos.md", "‹segredo 1› e ‹segredo 1 · K7Q2›")).toBe("‹segredo 1› e ‹segredo 1 · K7Q2›");
  });

  test("um marcador escrito na própria nota volta igual, e não conta como segredo", () => {
    const g = new SecretGuard("k7q2");
    const literal = "Exemplo do filtro: ‹segredo 4 · abcd›.";
    const r = g.read("Notas.md", literal);
    expect(r.held).toBe(0);
    expect(r.text).toBe("Exemplo do filtro: ‹segredo 1 · k7q2›.");
    expect(g.write("Notas.md", r.text)).toBe(literal);
  });

  test("o pedido sai filtrado, e um marcador dele não volta em nota nenhuma", () => {
    const g = new SecretGuard("k7q2");
    const r = g.request(`Guarde este token na nota Acessos: ${GH}`);
    expect(r.text).not.toContain(GH);
    expect(r.held).toBe(1);
    expect(() => g.write("Acessos.md", markers(r.text)[0]!)).toThrow(/um pedido/);
  });

  test("a dúvida também é segurada", () => {
    const g = new SecretGuard("k7q2");
    const doubt = "Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya";
    const r = g.read("Solto.md", `Anotei isto: ${doubt}`);
    expect(r.text).not.toContain(doubt);
    expect(r.held).toBe(1);
  });

  test("quantos segredos uma escrita tirou", () => {
    expect(removedSecrets(`senha: ${PWD}\ntoken ${GH}`, `senha: trocar\ntoken ${GH}`)).toBe(1);
    expect(removedSecrets(`token ${GH}`, `token ${GH} e mais`)).toBe(0);
  });

  test("numa nota de 800 KB, o filtro soma no máximo 100 ms", () => {
    const line = `| srv-pacs-${"0".padStart(2, "0")} | 10.20.30.40 | 1.2.840.113619.2.55.3 | Unidade Centro | ok |\n`;
    let text = "";
    while (text.length < 800_000) text += line;
    text += `\nsenha: ${PWD}\n`;
    const g = new SecretGuard();
    g.read("Grande.md", text); // aquece
    const best = Math.min(
      ...[0, 1, 2].map(() => {
        const t = performance.now();
        g.read("Grande.md", text);
        return performance.now() - t;
      }),
    );
    expect(best).toBeLessThan(100);
  });
});

/** Um cofre de verdade num tmp, as capacidades das janelas e um guard, como o agente usa. */
function vault(files: Record<string, string>) {
  const base = mkdtempSync(path.join(tmpdir(), "kiwi-guard-"));
  dirs.push(base);
  const root = path.join(base, "KiwiNotes");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
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
  const guard = new SecretGuard("k7q2");
  const copies: string[] = [];
  const ctx = {
    reader: readerFromCapabilities(caps as never),
    writer: writerFromCapabilities(caps as never),
    journal: { keep: async (_p: string, before: string) => (copies.push(before), `p/copy-${copies.length}.md`), drop: async () => {} },
    guard,
  };
  const tool = async (name: string, a: unknown) => runKiwiTool(ctx, name, a);
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  return { tool, read, guard };
}

const ACESSOS = `# Acessos\n\n## PACS\n\nservidor srv-pacs-01 (10.0.0.12)\nsenha: ${PWD}\n\n## GitHub ${GH}\n\nO token do deploy.\n`;
const REUNIAO = `---\ntype: meeting\ndate: 2026-11-13\nduration: 60\n---\n\n## Transcrição\n\n**Ana** (00:00): A chave da AWS é ${AWS}, anota aí.\n`;

describe("as ferramentas com o filtro (spec #9818)", () => {
  test("as quatro de leitura entregam o segredo trocado e o resto igual; o registro conta quantos", async () => {
    const t = vault({ "Acessos.md": ACESSOS, "Reunião.md": REUNIAO, "Ideias.md": "o prazo do Kiwi é março\n" });
    const r = await t.tool("notes_read", { path: "Acessos.md" });
    const texto = r.value.texto as string;
    expect(texto).not.toContain(PWD);
    expect(texto).not.toContain(GH);
    expect(texto).toContain("servidor srv-pacs-01 (10.0.0.12)");
    expect(r.held).toBe(2);
    // A versão é a da nota real: é ela que a escrita confere.
    expect(r.value.versao).toBeString();

    const o = await t.tool("notes_outline", { path: "Acessos.md" });
    expect(JSON.stringify(o.value)).not.toContain(GH);
    expect((o.value.secoes as { titulo: string }[]).map((s) => s.titulo)).toContain(`GitHub ${markers(texto)[1]}`);
    expect(o.value.caracteres).toBe(texto.length);

    const m = await t.tool("meetings_get", { path: "Reunião.md" });
    expect(m.value.texto as string).not.toContain(AWS);
    expect(m.value.texto as string).toContain("anota aí");
    expect(m.held).toBe(1);
  });

  test("a busca devolve o trecho filtrado, e não devolve um achado que só casa dentro de um segredo", async () => {
    const t = vault({ "Acessos.md": ACESSOS, "Ideias.md": "o prazo do Kiwi é março\n" });
    const ok = await t.tool("notes_search", { query: "servidor" });
    const hits = ok.value.resultados as { path: string; trecho: string }[];
    expect(hits.map((h) => h.path)).toContain("Acessos.md");
    for (const h of hits) expect(h.trecho).not.toContain(PWD);
    // Um marcador na borda do trecho sai inteiro, nunca pela metade (revisão do T9833).
    const t2 = vault({ "Borda.md": `servidor ${"palavra ".repeat(16)}senha: ${PWD} e depois ${"mais ".repeat(40)}\n` });
    for (const h of (await t2.tool("notes_search", { query: "servidor" })).value.resultados as { trecho: string }[]) {
      expect((h.trecho.match(/‹/g) ?? []).length).toBe((h.trecho.match(/›/g) ?? []).length);
      expect(h.trecho).toMatch(/‹segredo 1 · k7q2›/);
    }
    // Procurar o próprio segredo não confirma nada.
    const oracle = await t.tool("notes_search", { query: PWD });
    expect(oracle.value.resultados).toEqual([]);
  });

  test("um token partido na borda de um pedaço é pego: os pedaços são do texto já filtrado", async () => {
    // Palavras sem quebra de linha: o corte cai no meio do token (sem o filtro, ele sairia partido em dois pedaços).
    const pad = "palavra ".repeat(READ_MAX_CHARS).slice(0, READ_MAX_CHARS - 10).replace(/\S*$/, "");
    const t = vault({ "Longa.md": `${pad}${GH}\nfim\n` });
    let offset = 0;
    let all = "";
    for (;;) {
      const r = await t.tool("notes_read", { path: "Longa.md", offset });
      const piece = r.value.texto as string;
      expect(piece).not.toContain(GH.slice(0, 12));
      expect(piece).not.toContain(GH.slice(-12));
      // E um marcador nunca sai partido entre dois pedaços.
      expect((piece.match(/‹/g) ?? []).length).toBe((piece.match(/›/g) ?? []).length);
      all += piece;
      if (r.value.proximoOffset === undefined) break;
      offset = r.value.proximoOffset as number;
    }
    expect(all).toBe(t.guard.read("Longa.md", `${pad}${GH}\nfim\n`).text);
  });

  test("a escrita com um marcador grava o original, também no nome da seção; de outra nota é recusada", async () => {
    const t = vault({ "Acessos.md": ACESSOS, "Ideias.md": "ideias\n" });
    const r = await t.tool("notes_read", { path: "Acessos.md" });
    const [pwd, gh] = markers(r.value.texto as string);
    // A seção do token, pelo nome que o agente vê, com o texto que mantém o marcador da senha em outra seção intacta.
    const w = await t.tool("notes_write", { path: "Acessos.md", section: `GitHub ${gh}`, text: "O token do deploy, renovado em novembro.", version: r.value.versao });
    expect(w.change?.removedSecrets).toBeUndefined();
    expect(t.read("Acessos.md")).toContain(`## GitHub ${GH}\n\nO token do deploy, renovado em novembro.`);
    expect(t.read("Acessos.md")).toContain(`senha: ${PWD}`);
    // O marcador da senha numa nota que não é a dele.
    await expect(t.tool("notes_append", { path: "Ideias.md", text: `a senha do PACS: ${pwd}` })).rejects.toMatchObject({ code: "E_SECRET_MARKER" });
    await expect(t.tool("notes_create", { title: "Cópia", text: `token ${gh}` })).rejects.toBeInstanceOf(ToolError);
    expect(t.read("Ideias.md")).toBe("ideias\n");
    // Um texto que só parece marcador é gravado como texto.
    await t.tool("notes_append", { path: "Ideias.md", text: "o marcador é tipo ‹segredo 1›" });
    expect(t.read("Ideias.md")).toContain("‹segredo 1›");
  });

  test("a escrita que tira um segredo vale, e fica anotada", async () => {
    const t = vault({ "Acessos.md": ACESSOS });
    const r = await t.tool("notes_read", { path: "Acessos.md", section: "PACS" });
    const w = await t.tool("notes_write", { path: "Acessos.md", section: "PACS", text: "servidor srv-pacs-01 (10.0.0.12)\nsenha: trocada em novembro", version: r.value.versao });
    expect(w.change?.removedSecrets).toBe(1);
    expect(t.read("Acessos.md")).not.toContain(PWD);
  });
});
