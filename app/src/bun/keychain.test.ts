// A chave no Keychain (spec #31616, T31627). Nada aqui toca o Keychain da pessoa: o falso na memória, ou um
// `.keychain-db` temporário criado e apagado pelo próprio teste, fora da lista de busca do Mac. Sem diálogo nenhum.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ELEVENLABS_KEYCHAIN, elevenLabsKey, KeychainError, KeychainSecret, memoryKeychain, securityRunner } from "./keychain.ts";

// Uma chave de exemplo, montada por partes.
const KEY = "sk_" + "exemplo0123456789abcdef";

describe("com o Keychain falso", () => {
  test("gravar, ler, trocar e apagar", async () => {
    const kc = memoryKeychain();
    const s = elevenLabsKey({ run: kc.run });
    expect(await s.getKey()).toBeNull();
    expect(await s.hasKey()).toBe(false);
    await s.setKey(`  ${KEY}\n`);
    expect(await s.getKey()).toBe(KEY);
    expect(await s.hasKey()).toBe(true);
    await s.setKey(`${KEY}-2`);
    expect(await s.getKey()).toBe(`${KEY}-2`);
    await s.deleteKey();
    expect(await s.getKey()).toBeNull();
    // Apagar sem chave não é erro.
    await s.deleteKey();
  });

  test("o serviço e a conta do contrato", async () => {
    const kc = memoryKeychain();
    await elevenLabsKey({ run: kc.run }).setKey(KEY);
    expect([...kc.items.keys()]).toEqual([`${ELEVENLABS_KEYCHAIN.service}\u0000${ELEVENLABS_KEYCHAIN.account}`]);
    expect(ELEVENLABS_KEYCHAIN).toEqual({ service: "com.kiwinotes.elevenlabs", account: "api-key" });
  });

  test("uma chave fora do formato não chega ao Keychain, e o erro não a repete", async () => {
    const kc = memoryKeychain();
    const s = elevenLabsKey({ run: kc.run });
    for (const bad of ["curta", 'sk_exemplo" -s outro', "sk_exemplo0000\nfind-generic-password", "sk exemplo 0000", ""]) {
      const e = await s.setKey(bad).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(KeychainError);
      if (bad) expect((e as Error).message).not.toContain(bad.trim());
    }
    expect(kc.lines).toEqual([]);
  });

  test("um erro do security diz o código, nunca a chave", async () => {
    const s = elevenLabsKey({ run: async () => ({ code: 51, stdout: KEY }) });
    for (const op of [() => s.getKey(), () => s.setKey(KEY), () => s.deleteKey()]) {
      const e = await op().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(KeychainError);
      expect((e as Error).message).toContain("security 51");
      expect((e as Error).message).not.toContain(KEY);
    }
  });

  test("serviço, conta ou caminho com aspas ou quebra são recusados", () => {
    expect(() => new KeychainSecret({ service: 'a"b', account: "x" })).toThrow(KeychainError);
    expect(() => new KeychainSecret({ service: "a", account: "x\ny" })).toThrow(KeychainError);
    expect(() => new KeychainSecret({ service: "a", account: "x", keychain: "/tmp/a\\b" })).toThrow(KeychainError);
  });
});

// O `security` de verdade, num Keychain temporário: confere as linhas e os códigos que o falso imita.
describe.skipIf(process.platform !== "darwin")("com o security, num Keychain temporário", () => {
  let dir = "";
  let file = "";
  const sec = (...args: string[]) => Bun.spawnSync(["/usr/bin/security", ...args], { stdout: "ignore", stderr: "ignore" }).exitCode;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kiwi-keychain-"));
    file = path.join(dir, "teste.keychain-db");
    expect(sec("create-keychain", "-p", "exemplo", file)).toBe(0);
  });
  afterAll(() => {
    sec("delete-keychain", file);
    rmSync(dir, { recursive: true, force: true });
  });

  test("gravar, ler, trocar e apagar, sem a chave na linha de comando", async () => {
    const seen: string[] = [];
    const real = securityRunner();
    const run = async (line: string) => {
      seen.push(line);
      return real(line);
    };
    const s = new KeychainSecret({ service: "com.kiwinotes.exemplo", account: "api-key", keychain: file, run });
    expect(await s.getKey()).toBeNull();
    await s.setKey(KEY);
    expect(await s.getKey()).toBe(KEY);
    await s.setKey(`${KEY}-2`);
    expect(await s.getKey()).toBe(`${KEY}-2`);
    await s.deleteKey();
    expect(await s.getKey()).toBeNull();
    await s.deleteKey();
    // A chave só passou pelo stdin do `security -i`, numa linha do add.
    expect(seen.filter((l) => l.includes(KEY)).every((l) => l.startsWith("add-generic-password "))).toBe(true);
  });

  test("o Keychain temporário não entra na lista de busca do Mac", () => {
    const list = Bun.spawnSync(["/usr/bin/security", "list-keychains"], { stdout: "pipe", stderr: "ignore" }).stdout.toString();
    expect(list).not.toContain(file);
  });
});
