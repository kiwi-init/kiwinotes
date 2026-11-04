import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import {
  attachmentName,
  attachmentPath,
  Attachments,
  attachmentsFolder,
  embedFor,
  MAX_ATTACHMENT_BYTES,
  resolveAttachment,
  rewriteAttachmentLinks,
} from "./attachments.ts";
import { Vault } from "./vault.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4ab0000000049454e44ae426082", "hex");
const b64 = PNG.toString("base64");

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

async function setup(folder = "Anexos") {
  const root = mkdtempSync(path.join(tmpdir(), "kiwi-anexos-"));
  dirs.push(root);
  const vault = new Vault({ root, trash: async () => {} });
  await vault.open();
  return { root, vault, att: new Attachments(vault, () => folder) };
}

describe("os nomes e os caminhos (T2594)", () => {
  test("o nome colado vira um nome seguro, com a extensão em minúsculas", () => {
    expect(attachmentName("Captura de Tela 2026-11-04 às 10.12.PNG")).toBe("Captura de Tela 2026-11-04 às 10.12.png");
    expect(attachmentName("a/b/../foto?.jpg")).toBe("foto.jpg");
    expect(attachmentName(".png")).toBe("Anexo.png");
    expect(() => attachmentName("script.js")).toThrow(/not an attachment type/);
    expect(() => attachmentName("sem-extensao")).toThrow();
  });

  test("um caminho de anexo não sai do vault nem entra em pasta oculta", () => {
    expect(attachmentPath("Anexos/foto.png")).toBe("Anexos/foto.png");
    for (const bad of ["../foto.png", "/etc/foto.png", "~/foto.png", ".obsidian/foto.png", "Anexos/./foto.png", "a\\b.png", "nota.md"]) {
      expect(() => attachmentPath(bad)).toThrow();
    }
  });

  test("a pasta de anexos é relativa e fica no vault; vazia é a raiz", () => {
    expect(attachmentsFolder("Anexos")).toBe("Anexos");
    expect(attachmentsFolder("/Arquivos/Imagens/")).toBe("Arquivos/Imagens");
    expect(attachmentsFolder("")).toBe("");
    for (const bad of ["..", "../fora", ".hidden", "a/../b", 3]) expect(() => attachmentsFolder(bad)).toThrow();
  });

  test("o ![[alvo]] acha o anexo como o Obsidian: pelo nome em qualquer pasta, o caminho mais curto ganha", () => {
    const files = ["Anexos/foto.png", "Projetos/Anexos/foto.png", "Projetos/planta.pdf"];
    expect(resolveAttachment("foto.png", files)).toBe("Anexos/foto.png");
    expect(resolveAttachment("FOTO.png", files)).toBe("Anexos/foto.png");
    expect(resolveAttachment("Projetos/Anexos/foto.png", files)).toBe("Projetos/Anexos/foto.png");
    expect(resolveAttachment("Anexos/foto.png|200", files)).toBe("Anexos/foto.png");
    expect(resolveAttachment("planta.pdf", files)).toBe("Projetos/planta.pdf");
    expect(resolveAttachment("nao.png", files)).toBeNull();
    // O embed usa só o nome quando o nome basta.
    expect(embedFor("Anexos/foto.png", files)).toBe("![[foto.png]]");
    expect(embedFor("Projetos/Anexos/foto.png", files)).toBe("![[Projetos/Anexos/foto.png]]");
  });

  test("trocar o alvo mantém o embed, o tamanho e o apelido", () => {
    const before = ["Anexos/foto.png"];
    const after = ["Anexos/casa.png"];
    const r = rewriteAttachmentLinks("A ![[foto.png]] e ![[foto.png|300]] e [[Anexos/foto.png]] e ![[outra.png]]", "Anexos/foto.png", "Anexos/casa.png", before, after);
    expect(r.content).toBe("A ![[casa.png]] e ![[casa.png|300]] e [[casa.png]] e ![[outra.png]]");
    expect(r.count).toBe(3);
  });
});

describe("attachments.save, read e rename", () => {
  test("grava em Anexos/, com nome único, e devolve o embed", async () => {
    const { root, att } = await setup();
    const a = await att.save("foto.png", b64);
    expect(a).toEqual({ path: "Anexos/foto.png", embed: "![[foto.png]]", size: PNG.length });
    expect(readFileSync(path.join(root, "Anexos/foto.png")).equals(PNG)).toBe(true);
    const b = await att.save("foto.png", b64);
    expect(b.path).toBe("Anexos/foto 1.png");
    expect(b.embed).toBe("![[foto 1.png]]");
  });

  test("com o mesmo nome em outra pasta, o embed leva o caminho", async () => {
    const { root, att } = await setup("Anexos");
    mkdirSync(path.join(root, "A"));
    writeFileSync(path.join(root, "A/x.png"), PNG);
    const a = await att.save("x.png", b64);
    expect(a.path).toBe("Anexos/x.png");
    expect(a.embed).toBe("![[Anexos/x.png]]");
  });

  test("recusa o que não é anexo, o que não é base64, o vazio e o grande demais", async () => {
    const { att } = await setup();
    await expect(att.save("x.exe", b64)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(att.save("x.png", "não é base64!")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(att.save("x.png", "")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    const big = "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 10) / 3) * 4);
    await expect(att.save("x.png", big)).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });

  test("uma pasta de anexos que é link simbólico para fora é recusada", async () => {
    const { root, vault } = await setup();
    const outside = mkdtempSync(path.join(tmpdir(), "kiwi-fora-"));
    dirs.push(outside);
    symlinkSync(outside, path.join(root, "Anexos"));
    const att = new Attachments(vault, () => "Anexos");
    await expect(att.save("x.png", b64)).rejects.toMatchObject({ code: "E_OUTSIDE_VAULT" });
    expect(existsSync(path.join(outside, "x.png"))).toBe(false);
  });

  test("read devolve o data: URL pelo ![[…]], pelo nome ou pelo caminho; o que não existe dá E_NOT_FOUND", async () => {
    const { att } = await setup();
    await att.save("foto.png", b64);
    for (const link of ["![[foto.png]]", "foto.png", "Anexos/foto.png", "![[foto.png|200]]"]) {
      const r = await att.read(link);
      expect(r.path).toBe("Anexos/foto.png");
      expect(r.mime).toBe("image/png");
      expect(r.dataUrl).toBe(`data:image/png;base64,${b64}`);
    }
    await expect(att.read("![[sumiu.png]]")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(att.read("")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });

  test("read não acha arquivo em pasta oculta", async () => {
    const { root, att } = await setup();
    mkdirSync(path.join(root, ".obsidian"));
    writeFileSync(path.join(root, ".obsidian/x.png"), PNG);
    await expect(att.read("x.png")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("rename move o arquivo e troca os links nas notas", async () => {
    const { root, vault, att } = await setup();
    await att.save("foto.png", b64);
    await vault.create("", "Casa", "Planta ![[foto.png]] e de novo ![[foto.png|300]].\n");
    await vault.create("Projetos", "Outra", "Sem anexo.\n");
    const r = await att.rename("Anexos/foto.png", "Anexos/Casa/sala.png");
    expect(r).toEqual({ path: "Anexos/Casa/sala.png", updatedLinks: 2 });
    expect(existsSync(path.join(root, "Anexos/foto.png"))).toBe(false);
    expect(existsSync(path.join(root, "Anexos/Casa/sala.png"))).toBe(true);
    expect((await vault.get("Casa.md")).content).toBe("Planta ![[sala.png]] e de novo ![[sala.png|300]].\n");
    expect((await vault.get("Projetos/Outra.md")).content).toBe("Sem anexo.\n");
  });

  test("rename recusa trocar o tipo, o que não existe e o nome que já existe", async () => {
    const { att } = await setup();
    await att.save("a.png", b64);
    await att.save("b.png", b64);
    await expect(att.rename("Anexos/a.png", "Anexos/a.jpg")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(att.rename("Anexos/zz.png", "Anexos/y.png")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(att.rename("Anexos/a.png", "Anexos/b.png")).rejects.toMatchObject({ code: "E_EXISTS" });
    await expect(att.rename("Anexos/a.png", "../a.png")).rejects.toMatchObject({ code: "E_OUTSIDE_VAULT" });
  });
});

describe("as capacidades (contrato 1.9.0)", () => {
  async function caps(withAttachments = true) {
    const { root, vault } = await setup();
    let settings: AppSettings = { ...DEFAULT_SETTINGS, attachmentsFolder: "Imagens" };
    const c = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: {
        load: async () => settings,
        save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }),
      },
      clipboardWrite: () => {},
      notes: vault,
      ...(withAttachments ? { attachments: new Attachments(vault, () => settings.attachmentsFolder) } : {}),
    });
    return { root, call: (cap: string, args: unknown) => directInvoke(c, cap, args) };
  }

  test("save, read e rename pelo contrato, na pasta das Configurações", async () => {
    const { call } = await caps();
    expect(await call("attachments.save", { name: "foto.png", data: b64 })).toMatchObject({ ok: true, value: { path: "Imagens/foto.png", embed: "![[foto.png]]" } });
    expect(await call("attachments.read", { link: "![[foto.png]]" })).toMatchObject({ ok: true, value: { mime: "image/png" } });
    expect(await call("attachments.rename", { path: "Imagens/foto.png", newPath: "Imagens/b.png" })).toMatchObject({ ok: true, value: { path: "Imagens/b.png" } });
    expect(await call("attachments.save", { name: "foto.png" })).toMatchObject({ ok: false });
    expect(await call("attachments.save", { name: "foto.png", data: b64, x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });

  test("a pasta de anexos nas Configurações não sai do vault", async () => {
    const { call } = await caps();
    expect(await call("settings.set", { attachmentsFolder: "Arquivos/Imagens" })).toMatchObject({ ok: true, value: { attachmentsFolder: "Arquivos/Imagens" } });
    expect(await call("attachments.save", { name: "x.png", data: b64 })).toMatchObject({ ok: true, value: { path: "Arquivos/Imagens/x.png" } });
    for (const bad of ["../fora", ".oculta", 7]) {
      expect(await call("settings.set", { attachmentsFolder: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
  });

  test("um host sem anexos responde E_NO_ATTACHMENTS", async () => {
    const { call } = await caps(false);
    expect(await call("attachments.read", { link: "x.png" })).toMatchObject({ ok: false, code: "E_NO_ATTACHMENTS" });
  });
});
