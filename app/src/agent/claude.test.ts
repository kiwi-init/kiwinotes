// Achar o Claude Code, a versão e o login (spec #4576), com o `claude` falso. Nenhum teste roda o de verdade.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { claudeAuth, claudeSearchDirs, claudeStatus, claudeVersion, findClaude } from "./claude.ts";
import { FAKE_CLAUDE } from "./fake/index.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kn-claude-");
  dirs.push(d);
  return d;
}

function file(p: string, mode: number): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "#!/bin/sh\n");
  chmodSync(p, mode);
  return p;
}

describe("achar o claude", () => {
  test("o primeiro executável das pastas, na ordem; um arquivo sem permissão de execução não conta", () => {
    const d = tmp();
    file(path.join(d, "a", "claude"), 0o644);
    const b = file(path.join(d, "b", "claude"), 0o755);
    file(path.join(d, "c", "claude"), 0o755);
    expect(findClaude([path.join(d, "a"), path.join(d, "b"), path.join(d, "c")])).toBe(b);
  });

  test("uma pasta chamada claude não conta, e sem nenhum o resultado é null", () => {
    const d = tmp();
    mkdirSync(path.join(d, "x", "claude"), { recursive: true });
    expect(findClaude([path.join(d, "x"), path.join(d, "nao-existe")])).toBeNull();
  });

  test("procura no PATH e depois nas pastas do instalador (um app aberto pelo Finder não tem o PATH do terminal)", () => {
    const dirsFound = claudeSearchDirs({ PATH: "/um:/dois:/um" }, "/Users/p");
    expect(dirsFound).toEqual(["/um", "/dois", "/Users/p/.local/bin", "/Users/p/.claude/local", "/opt/homebrew/bin", "/usr/local/bin"]);
  });
});

describe("a versão e o login", () => {
  test("a versão sai do --version", async () => {
    expect(await claudeVersion(FAKE_CLAUDE)).toBe("2.1.322");
  });

  test("logado: só o loggedIn e o método; a conta e o e-mail não saem daqui", async () => {
    const auth = await claudeAuth(FAKE_CLAUDE);
    expect(auth).toEqual({ loggedIn: true, method: "claude.ai" });
    expect(JSON.stringify(auth)).not.toContain("exemplo");
  });

  test("não logado: exit 1 e authMethod none", async () => {
    expect(await claudeAuth(["env", "KIWI_FAKE_CLAUDE_LOGGED_IN=0", ...FAKE_CLAUDE])).toEqual({ loggedIn: false });
  });

  test("um programa que não responde a tempo é morto e conta como sem versão", async () => {
    expect(await claudeVersion(["sleep", "30"], 100)).toBeNull();
  });

  test("o status junta tudo, sem nada de credencial", async () => {
    const s = await claudeStatus(FAKE_CLAUDE);
    expect(s).toEqual({ installed: true, path: FAKE_CLAUDE[1], version: "2.1.322", loggedIn: true, method: "claude.ai" });
  });

  test("sem programa, ou com um que não roda, não está instalado nem logado", async () => {
    expect(await claudeStatus(null)).toEqual({ installed: false, loggedIn: false });
    expect(await claudeStatus([path.join(tmp(), "nao-existe")])).toEqual({ installed: false, loggedIn: false });
  });
});
