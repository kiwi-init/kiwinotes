// O download do adaptador (spec #8368), contra um registro do npm falso e local: nada aqui vai à internet.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AgentError } from "../errors.ts";
import { fakeRegistry, packTarball, type FakeRegistry } from "../fake/registry.ts";
import { adapterDir, adapterEntry, downloadAdapter, installedAdapter, integrityOf, removeAdapter } from "./download.ts";
import { ADAPTER_PACKAGE, ADAPTER_PACKAGES, ADAPTER_VERSION, tarballUrl } from "./pinned.ts";

const registries: FakeRegistry[] = [];
afterEach(() => {
  for (const r of registries.splice(0)) r.stop();
});

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "kiwi-adapter-"));
}

/** Um registro com o adaptador (com o `dist/index.js`) e duas dependências. */
function registry(): FakeRegistry {
  const r = fakeRegistry([
    { name: ADAPTER_PACKAGE, version: ADAPTER_VERSION, files: { "dist/index.js": "console.log('adaptador falso')" } },
    { name: "@anthropic-ai/claude-agent-sdk", version: "0.3.322", files: { "sdk.mjs": "export {}" } },
    { name: "zod", version: "4.6.7", files: { "index.js": "module.exports = {}" } },
  ]);
  registries.push(r);
  return r;
}

async function rejection(p: Promise<unknown>): Promise<AgentError> {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error("era para falhar");
}

/** O que sobrou na pasta do adaptador, fora a versão pronta. */
function leftovers(root: string): string[] {
  return existsSync(root) ? readdirSync(root) : [];
}

describe("a lista fixa", () => {
  test("são os cinco pacotes do adaptador 0.106.0, com o integrity sha512 do npm", () => {
    expect(ADAPTER_PACKAGES.map((p) => `${p.name}@${p.version}`)).toEqual([
      "@agentclientprotocol/claude-agent-acp@0.106.0",
      "@anthropic-ai/claude-agent-sdk@0.3.322",
      "@agentclientprotocol/sdk@2.6.0",
      "diff@9.0.0",
      "zod@4.6.7",
    ]);
    for (const p of ADAPTER_PACKAGES) expect(p.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
  });

  test("sem a cópia do Claude Code: nenhum pacote de plataforma do SDK (o …-darwin-arm64 tem 324 MB)", () => {
    for (const p of ADAPTER_PACKAGES) expect(p.name).not.toMatch(/claude-agent-sdk-(darwin|linux|win32)/);
  });

  test("o endereço de cada .tgz segue o do npm, com e sem escopo", () => {
    expect(tarballUrl({ name: "@agentclientprotocol/sdk", version: "2.6.0" })).toBe("https://registry.npmjs.org/@agentclientprotocol/sdk/-/sdk-2.6.0.tgz");
    expect(tarballUrl({ name: "zod", version: "4.6.7" }, "http://127.0.0.1:9/")).toBe("http://127.0.0.1:9/zod/-/zod-4.6.7.tgz");
  });

  test("o integrity é o do npm: sha512 em base64", () => {
    expect(integrityOf(new TextEncoder().encode("kiwi"))).toBe(
      `sha512-${new Bun.CryptoHasher("sha512").update("kiwi").digest("base64")}`,
    );
  });
});

describe("o download", () => {
  test("baixa só a lista, confere e abre cada pacote em node_modules, com o marcador no fim", async () => {
    const r = registry();
    const root = tmp();
    const got = await downloadAdapter({ root, registry: r.url, packages: r.pinned });
    expect(got.already).toBe(false);
    expect(got.dir).toBe(adapterDir({ root }));
    expect(got.packages.map((p) => p.name)).toEqual(r.pinned.map((p) => p.name));
    expect(r.requests.map((q) => q.path).sort()).toEqual(r.pinned.map((p) => new URL(tarballUrl(p, r.url)).pathname).sort());
    expect(existsSync(adapterEntry(got.dir))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(got.dir, "node_modules", "zod", "package.json"), "utf8"))).toEqual({ name: "zod", version: "4.6.7" });
    expect(installedAdapter({ root }, r.pinned)).toBe(got.dir);
    expect(leftovers(root)).toEqual([ADAPTER_VERSION]);
  });

  test("nada da pessoa vai junto: um GET sem cookie, sem conta e sem token", async () => {
    const r = registry();
    await downloadAdapter({ root: tmp(), registry: r.url, packages: r.pinned });
    for (const q of r.requests) {
      const names = Object.keys(q.headers).map((h) => h.toLowerCase());
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
    }
  });

  test("já baixado: nada vai à rede", async () => {
    const r = registry();
    const root = tmp();
    await downloadAdapter({ root, registry: r.url, packages: r.pinned });
    const before = r.requests.length;
    const again = await downloadAdapter({ root, registry: r.url, packages: r.pinned });
    expect(again).toMatchObject({ already: true, packages: [] });
    expect(r.requests.length).toBe(before);
  });

  test("nada baixa sozinho: só perguntar se está instalado não faz pedido nenhum", () => {
    const r = registry();
    expect(installedAdapter({ root: tmp() }, r.pinned)).toBeNull();
    expect(r.requests).toEqual([]);
  });

  test("um pacote adulterado é recusado e apagado: nada fica instalado nem pela metade", async () => {
    const r = registry();
    r.serve("zod", packTarball({ name: "zod", version: "4.6.7", files: { "index.js": "roubar()" } }));
    const root = tmp();
    const err = await rejection(downloadAdapter({ root, registry: r.url, packages: r.pinned }));
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe("E_ADAPTER_TAMPERED");
    expect(err.message).toBe("Um pacote do adaptador do Claude Code chegou diferente do esperado e foi apagado. Nada foi instalado. Tente de novo mais tarde.");
    expect(err.detail).toContain("zod@4.6.7");
    expect(leftovers(root)).toEqual([]);
    expect(installedAdapter({ root }, r.pinned)).toBeNull();
  });

  test("um .tgz com o integrity certo mas outro pacote dentro também é recusado", async () => {
    const wrong = packTarball({ name: "zod", version: "4.6.7", manifest: { name: "outro", version: "6.6.6" } });
    const r = registry();
    r.serve("zod", wrong);
    const pinned = r.pinned.map((p) => (p.name === "zod" ? { ...p, integrity: integrityOf(wrong) } : p));
    const root = tmp();
    const err = await rejection(downloadAdapter({ root, registry: r.url, packages: pinned }));
    expect(err.code).toBe("E_ADAPTER_TAMPERED");
    expect(err.detail).toContain("outro@6.6.6");
    expect(leftovers(root)).toEqual([]);
  });

  test("sem rede: um erro claro, e nada fica", async () => {
    const r = registry();
    const url = r.url;
    r.stop();
    const root = tmp();
    const err = await rejection(downloadAdapter({ root, registry: url, packages: r.pinned }));
    expect(err.code).toBe("E_ADAPTER_OFFLINE");
    expect(err.message).toBe("Sem conexão com a internet. O Kiwi precisa de rede para baixar o adaptador do Claude Code.");
    expect(leftovers(root)).toEqual([]);
  });

  test("um pacote que o registro não tem (404) é um download que falhou, e nada fica", async () => {
    const r = registry();
    r.serve("zod", null);
    const root = tmp();
    const err = await rejection(downloadAdapter({ root, registry: r.url, packages: r.pinned }));
    expect(err.code).toBe("E_ADAPTER_DOWNLOAD");
    expect(err.detail).toContain("HTTP 404");
    expect(leftovers(root)).toEqual([]);
  });

  test("uma versão antiga e o resto de um download que caiu saem quando a nova fica pronta", async () => {
    const r = registry();
    const root = tmp();
    mkdirSync(path.join(root, "0.1.0", "node_modules"), { recursive: true });
    mkdirSync(path.join(root, `${ADAPTER_VERSION}.part-1-2`), { recursive: true });
    await downloadAdapter({ root, registry: r.url, packages: r.pinned });
    expect(leftovers(root)).toEqual([ADAPTER_VERSION]);
  });

  test("uma pasta sem o marcador, ou com o marcador de outra lista, não conta como baixada", async () => {
    const r = registry();
    const root = tmp();
    const { dir } = await downloadAdapter({ root, registry: r.url, packages: r.pinned });
    expect(installedAdapter({ root }, ADAPTER_PACKAGES)).toBeNull();
    writeFileSync(path.join(dir, "kiwi-adapter.json"), "{}");
    expect(installedAdapter({ root }, r.pinned)).toBeNull();
  });

  test("remover apaga o adaptador baixado", async () => {
    const r = registry();
    const root = tmp();
    await downloadAdapter({ root, registry: r.url, packages: r.pinned });
    removeAdapter({ root });
    expect(existsSync(root)).toBe(false);
    expect(installedAdapter({ root }, r.pinned)).toBeNull();
  });
});
