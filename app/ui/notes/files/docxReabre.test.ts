// O docx gravado pelo Kiwi reabre no Kiwi e numa segunda leitura (T23915, caixa 5 do spec #21080). O relatório difícil
// inventado da `docx-prova` (títulos, listas, 10 tabelas, 10 imagens, cabeçalho e rodapé) passa pelo caminho de gravar
// do #200: o motor edita e grava (`save()`, as partes intocadas de volta e os trechos juntos, como o `docxEngine`), e o
// `files.save` com bytes grava no disco. O que ficou no disco é lido duas vezes:
// - pelo motor do Kiwi (`openTreeSession`, o mesmo da tela), contando pela árvore dele;
// - por uma leitura que não passa pelo motor nem pelo zip do Kiwi: o jszip, que confere o CRC de cada parte, e o
//   @xmldom/xmldom, que lê o XML. As duas, só em devDependencies e na versão do lock.
// As duas contam o mesmo que o original: parágrafos, tabelas, linhas, células, imagens (com o png de cada uma no
// pacote), o cabeçalho e o rodapé. Tudo inventado (#17952).

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openTreeSession } from "@docx-editor.dev/core/binding";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

import { relatorioDocx } from "../../../scripts/docx-prova/relatorio.ts";
import { bytesVersion, Vault } from "../../../src/notes/vault.ts";
import { tempDir } from "../../../test/tmp.ts";
import { keepUntouchedParts } from "./docxParts.ts";
import { tidyDocx } from "./docxRuns.ts";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
/** Um png de 1×1 no lugar de cada gráfico: o relatório sem o WebKit. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const EDIT = "Revisado pela Ana. ";

interface Counts {
  paragraphs: number;
  tables: number;
  rows: number;
  cells: number;
  images: number;
  header: string;
  footer: string;
}

// ── 1ª leitura: o motor do Kiwi ───────────────────────────────────────────────────────────────────────────────────

interface EngineNode {
  kind?: string;
  children?: readonly EngineNode[];
  value?: string;
}

function engineKinds(root: EngineNode): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (n: EngineNode) => {
    if (n.kind) out.set(n.kind, (out.get(n.kind) ?? 0) + 1);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

function engineText(root: EngineNode): string {
  let s = "";
  const walk = (n: EngineNode) => {
    if (n.kind === "textValue" && typeof n.value === "string") s += n.value;
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return s;
}

function byEngine(bytes: Uint8Array): Counts & { body: string } {
  const r = openTreeSession(bytes);
  if (!r.ok) throw new Error(`o motor não reabriu o docx: ${r.reason}`);
  const k = engineKinds(r.session.part().root as EngineNode);
  const hf = r.session.headerFooterParts();
  const header = hf.headers.get("default");
  const footer = hf.footers.get("default");
  if (!header || !footer) throw new Error("o motor não achou o cabeçalho ou o rodapé");
  return {
    paragraphs: k.get("paragraph") ?? 0,
    tables: k.get("table") ?? 0,
    rows: k.get("tableRow") ?? 0,
    cells: k.get("tableCell") ?? 0,
    images: k.get("drawing") ?? 0,
    header: engineText(header.root as EngineNode),
    footer: engineText(footer.root as EngineNode),
    body: r.session.bodyText(),
  };
}

// ── 2ª leitura: jszip e @xmldom/xmldom, sem o motor ───────────────────────────────────────────────────────────────

function parseXml(xml: string, name: string): Document {
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (m: string) => { throw new Error(`${name}: XML com erro: ${m}`); },
      fatalError: (m: string) => { throw new Error(`${name}: XML quebrado: ${m}`); },
    },
  }).parseFromString(xml, "application/xml");
  return doc;
}

const all = (doc: Document | Element, ns: string, tag: string) => Array.from(doc.getElementsByTagNameNS(ns, tag)) as Element[];
/** O texto, com o código dos campos (o `PAGE` do rodapé), na ordem do documento, como o motor o lê. */
const textOf = (doc: Document) =>
  (Array.from(doc.getElementsByTagName("*")) as Element[])
    .filter((e) => e.namespaceURI === W && (e.localName === "t" || e.localName === "instrText"))
    .map((t) => t.textContent ?? "")
    .join("");

async function byXml(bytes: Uint8Array): Promise<Counts & { body: string }> {
  // O CRC de cada parte é conferido ao ler: um zip quebrado não passa.
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const read = async (name: string) => {
    const f = zip.file(name);
    if (!f) throw new Error(`falta a parte ${name}`);
    return parseXml(await f.async("string"), name);
  };

  // Toda parte que o [Content_Types].xml declara existe e, se é XML, lê sem erro.
  const types = await read("[Content_Types].xml");
  for (const o of all(types, "http://schemas.openxmlformats.org/package/2006/content-types", "Override")) {
    const name = o.getAttribute("PartName")!.replace(/^\//, "");
    if (/xml$/.test(o.getAttribute("ContentType") ?? "")) await read(name);
    else expect(zip.file(name)).not.toBeNull();
  }

  const doc = await read("word/document.xml");
  const rels = await read("word/_rels/document.xml.rels");
  const target = new Map(all(rels, PR, "Relationship").map((r) => [r.getAttribute("Id")!, `word/${r.getAttribute("Target")!.replace(/^\/?word\//, "")}`]));

  // Cada imagem aponta, pelo r:embed, para um png que está no pacote.
  const blips = all(doc, A, "blip");
  for (const b of blips) {
    const part = target.get(b.getAttributeNS(R, "embed") ?? "");
    const png = part ? await zip.file(part)?.async("uint8array") : undefined;
    expect(png?.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  }

  const furniture = async (tag: string) => {
    const refs = all(doc, W, tag).filter((r) => r.getAttributeNS(W, "type") === "default");
    expect(refs).toHaveLength(1);
    return textOf(await read(target.get(refs[0]!.getAttributeNS(R, "id") ?? "")!));
  };

  const body = all(doc, W, "body")[0]!;
  return {
    paragraphs: all(body, W, "p").length,
    tables: all(body, W, "tbl").length,
    rows: all(body, W, "tr").length,
    cells: all(body, W, "tc").length,
    images: all(body, W, "drawing").length,
    header: await furniture("headerReference"),
    footer: await furniture("footerReference"),
    body: all(body, W, "t").map((t) => t.textContent ?? "").join(""),
  };
}

// ── o caminho de gravar do #200 ───────────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Abre o relatório no motor, digita no 2º parágrafo, grava como o `docxEngine` e pelo `files.save`; devolve o disco. */
async function editAndSave(original: Uint8Array): Promise<Uint8Array> {
  const dir = tempDir("kiwinotes-docx-reabre-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  mkdirSync(path.join(root, "Docs"), { recursive: true });
  const rel = "Docs/relatorio.docx";
  writeFileSync(path.join(root, rel), original);
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();

  const r = openTreeSession(original);
  if (!r.ok) throw new Error(r.reason);
  const ids = r.session.paragraphIds();
  const res = r.session.applyTreeOps([{ op: "insertText", paragraphId: ids[1]!, offset: 0, text: EDIT }]);
  expect(res.committed).toBe(true);
  // O mesmo que o `save()` do `docxEngine`: o motor grava, as partes intocadas voltam e os trechos iguais se juntam.
  const saved = tidyDocx(keepUntouchedParts(r.session.save(), original));

  const out = await v.saveFileBytes(rel, Buffer.from(saved).toString("base64"), bytesVersion(original));
  expect((out as { saved: boolean }).saved).toBe(true);
  return new Uint8Array(readFileSync(path.join(root, rel)));
}

describe("o docx gravado reabre no Kiwi e numa 2ª leitura (T23915)", () => {
  let original: Uint8Array;
  beforeAll(async () => {
    original = await relatorioDocx(Array.from({ length: 10 }, () => PNG));
  });

  test("o original: as duas leituras contam o mesmo", async () => {
    const { body: _a, ...engine } = byEngine(original);
    const { body: _b, ...xml } = await byXml(original);
    expect(engine).toEqual(xml);
    // O relatório tem de tudo: senão, a comparação não prova nada.
    expect(engine).toMatchObject({ tables: 10, rows: 130, cells: 520, images: 10 });
    expect(engine.paragraphs).toBeGreaterThan(700);
    expect(engine.header).toContain("Relatório de estoque");
    expect(engine.footer).toContain("Página");
  });

  test("editado e gravado: o motor e a 2ª leitura reabrem com tudo o que havia, e com a edição", async () => {
    const disk = await editAndSave(original);
    expect(disk).not.toEqual(original);
    const { body: _o, ...before } = await byXml(original);

    for (const [who, read] of [["o motor", byEngine(disk)], ["jszip + xmldom", await byXml(disk)]] as const) {
      const { body, ...counts } = read;
      expect(counts, who).toEqual(before);
      expect(body.includes(EDIT + "Loja de exemplo"), who).toBe(true);
    }
  });
});
