// O `files.save` com bytes para o docx (T21152, spec #21080): grava com a versão dos bytes, e um docx com senha, ou bytes
// que não são um docx, nunca vão para o disco. Dados inventados (a proposta de mudança da sala).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { inspectDocx } from "../shared/docx-file.ts";
import { partText, readZip, writeZip } from "../shared/sheet/zip.ts";
import { bytesVersion, Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const PROPOSTA = new Uint8Array(readFileSync(path.join(import.meta.dir, "../../test/fixtures/files/proposta.docx")));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
/** Um Compound File inventado: o começo dele e, no docx cifrado, o nome do fluxo `EncryptedPackage` em UTF-16LE. */
const compound = (encrypted: boolean) => {
  const b = new Uint8Array(1024);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (encrypted) b.set([..."EncryptedPackage"].flatMap((c) => [c.charCodeAt(0), 0]), 640);
  return b;
};
const CFB = compound(true);
/** O formato antigo do Office (o `.doc` de antes de 2007), sem senha: o mesmo começo, sem o fluxo do docx cifrado. */
const OLD = compound(false);

/** A proposta com uma frase a mais, como o motor gravaria. */
function edited(): Uint8Array {
  const parts = readZip(PROPOSTA);
  const doc = parts.find((p) => p.name === "word/document.xml")!;
  const xml = partText(PROPOSTA, doc).replace("</w:body>", "<w:p><w:r><w:t>A Ana revisou.</w:t></w:r></w:p></w:body>");
  return writeZip(PROPOSTA, parts, new Map([["word/document.xml", new TextEncoder().encode(xml)]]));
}

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, Uint8Array>) {
  const dir = tempDir("kiwinotes-docx-save-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

const code = (p: Promise<unknown>) => p.then((r) => ((r as { saved: boolean }).saved ? "saved" : "stale"), (e) => (e as { code?: string }).code);

describe("inspectDocx", () => {
  test("docx, docx com senha e o que não é docx", () => {
    expect(inspectDocx(PROPOSTA)).toEqual({ editable: true });
    expect(inspectDocx(CFB)).toEqual({ editable: false, reason: "password" });
    // O .doc antigo começa igual, e não tem senha (revisão do T23170).
    expect(inspectDocx(OLD)).toEqual({ editable: false, reason: "not-docx" });
    expect(inspectDocx(new TextEncoder().encode("não é zip"))).toEqual({ editable: false, reason: "not-docx" });
    // Um zip que não tem o documento do Word (um xlsx, por exemplo).
    const parts = readZip(PROPOSTA);
    const semDoc = writeZip(PROPOSTA, parts, new Map(), new Set(["word/document.xml"]));
    expect(inspectDocx(semDoc)).toEqual({ editable: false, reason: "not-docx" });
  });
});

describe("gravar um docx do cofre (T21152)", () => {
  test("grava os bytes com a versão do read binário", async () => {
    const { v, root } = await vault({ "Docs/proposta.docx": PROPOSTA });
    const before = await v.readFile("Docs/proposta.docx", "binary");
    if (!("base64" in before)) throw new Error("no bytes");
    expect(before.version).toBe(bytesVersion(PROPOSTA));
    const next = edited();
    const r = await v.saveFileBytes("Docs/proposta.docx", b64(next), before.version);
    expect(r).toMatchObject({ saved: true, version: bytesVersion(next) });
    expect(new Uint8Array(readFileSync(path.join(root, "Docs/proposta.docx")))).toEqual(next as Uint8Array<ArrayBuffer>);
  });

  test("versão velha não escreve e devolve o arquivo de agora", async () => {
    const { v, root } = await vault({ "proposta.docx": PROPOSTA });
    const r = await v.saveFileBytes("proposta.docx", b64(edited()), "velha");
    expect(r).toMatchObject({ saved: false, current: { version: bytesVersion(PROPOSTA) } });
    expect(new Uint8Array(readFileSync(path.join(root, "proposta.docx")))).toEqual(PROPOSTA);
  });

  test("docx com senha, ou bytes que não são docx: E_BAD_ARGS, e o disco fica igual", async () => {
    const { v, root } = await vault({ "senha.docx": CFB, "proposta.docx": PROPOSTA });
    expect(await code(v.saveFileBytes("senha.docx", b64(PROPOSTA), bytesVersion(CFB)))).toBe("E_BAD_ARGS");
    expect(new Uint8Array(readFileSync(path.join(root, "senha.docx")))).toEqual(CFB);
    expect(await code(v.saveFileBytes("proposta.docx", b64(new TextEncoder().encode("não é zip")), bytesVersion(PROPOSTA)))).toBe("E_BAD_ARGS");
    expect(await code(v.saveFileBytes("proposta.docx", b64(CFB), bytesVersion(PROPOSTA)))).toBe("E_BAD_ARGS");
    expect(new Uint8Array(readFileSync(path.join(root, "proposta.docx")))).toEqual(PROPOSTA);
  });

  test("o .doc antigo continua de fora", async () => {
    const { v } = await vault({ "velho.doc": OLD });
    expect(await code(v.saveFileBytes("velho.doc", b64(PROPOSTA), bytesVersion(OLD)))).toBe("E_BAD_ARGS");
  });
});
