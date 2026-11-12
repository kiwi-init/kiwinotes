// A prova do adaptador (spec #8368).
//
// - **Sempre:** a leitura do isolamento na linha de comando e a lista dos processos filhos.
// - **A prova do builder** (`KIWI_ADAPTER_PROOF=1`): baixa a lista fixa de verdade do npm (é a única ida à rede, e é por
//   isso que ela não roda no `bun test` comum) e abre o adaptador de verdade, pelo Bun, com um `claude` falso que anota
//   como foi chamado. Prova que o adaptador chama o programa que o Kiwi indicou, com o isolamento, sem pedido nenhum.
//   `KIWI_ADAPTER_CACHE=<pasta>` guarda o download entre uma rodada e outra.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeFakeClaudeExecutable } from "../fake/index.ts";
import { downloadAdapter } from "./download.ts";
import { adapterRoot } from "./open.ts";
import { childProcesses, isolationOf, runAdapterProof, sameProgram } from "./proof.ts";

describe("ler o isolamento na linha de comando", () => {
  const isolated =
    "/u/.local/bin/claude --output-format stream-json --verbose --input-format stream-json --tools= --setting-sources= --strict-mcp-config --permission-mode=default --session-id=x --no-session-persistence";

  test("o Claude Code isolado: sem configurações, sem ferramentas, sem MCP e no modo default", () => {
    expect(isolationOf(isolated)).toEqual({
      semConfiguracoesPessoais: true,
      semFerramentas: true,
      semServidoresMcp: true,
      modoDePermissao: "default",
      pulaPermissoes: false,
      semRegistroDaSessao: true,
    });
  });

  test("o que não está isolado aparece", () => {
    const loose = "/u/claude --input-format stream-json --tools=default --setting-sources=user,project --mcp-config {} --permission-mode=bypassPermissions --allow-dangerously-skip-permissions";
    expect(isolationOf(loose)).toEqual({
      semConfiguracoesPessoais: false,
      semFerramentas: false,
      semServidoresMcp: false,
      modoDePermissao: "bypassPermissions",
      pulaPermissoes: true,
      semRegistroDaSessao: false,
    });
    expect(isolationOf(`${isolated} --mcp-config {"mcpServers":{}}`).semServidoresMcp).toBe(false);
  });

  test("o mesmo programa pelo link ou pelo caminho da versão (o Claude Code nativo usa um link)", async () => {
    const { mkdirSync, symlinkSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(path.join(tmpdir(), "kiwi-same-"));
    mkdirSync(path.join(dir, "versions"));
    writeFileSync(path.join(dir, "versions", "2.1.322"), "");
    symlinkSync(path.join(dir, "versions", "2.1.322"), path.join(dir, "claude"));
    expect(sameProgram(path.join(dir, "versions", "2.1.322"), path.join(dir, "claude"))).toBe(true);
    expect(sameProgram(path.join(dir, "outro"), path.join(dir, "claude"))).toBe(false);
  });

  test("os processos filhos, com a linha de comando", async () => {
    const child = Bun.spawn(["/bin/sleep", "30"]);
    try {
      await Bun.sleep(100);
      const kids = childProcesses(process.pid);
      expect(kids).toContainEqual({ pid: child.pid, command: "/bin/sleep 30" });
    } finally {
      child.kill();
    }
  });
});

describe.skipIf(!process.env.KIWI_ADAPTER_PROOF)("a prova do builder, com o adaptador de verdade e um claude falso", () => {
  test(
    "o adaptador, aberto pelo Bun, chama o claude indicado pelo Kiwi, isolado, e a sessão abre sem pedido",
    async () => {
      const data = mkdtempSync(path.join(tmpdir(), "kiwi-proof-"));
      const cache = process.env.KIWI_ADAPTER_CACHE;
      const root = cache ? path.join(cache, "adapter") : adapterRoot(data);
      const dl = await downloadAdapter({ root });
      // A prova abre pelo caminho normal (`<dados>/agent/adapter`): com o cache, ele vira um link para lá.
      if (cache) {
        const { mkdirSync, symlinkSync } = await import("node:fs");
        mkdirSync(path.dirname(adapterRoot(data)), { recursive: true });
        symlinkSync(root, adapterRoot(data));
      }
      const log = path.join(data, "calls.jsonl");
      const claude = writeFakeClaudeExecutable(path.join(data, "bin"));
      const report = await runAdapterProof({ data, claudePath: claude, env: { ...process.env, KIWI_FAKE_CLAUDE_LOG: log } });

      expect(report.ok).toBe(true);
      expect(report.sessao).toMatchObject({ abriu: true, pedidosEnviados: 0, agente: "Claude Agent 0.106.0" });
      expect(report.abriuOClaudeIndicado).toBe(true);
      expect(report.processo?.comando.startsWith(`${claude} `)).toBe(true);
      expect(report.isolamento).toEqual({
        semConfiguracoesPessoais: true,
        semFerramentas: true,
        semServidoresMcp: true,
        modoDePermissao: "default",
        pulaPermissoes: false,
        semRegistroDaSessao: true,
      });
      expect(report.comandosChegaram).toBe(true);

      // O próprio falso anotou como foi chamado: uma vez, na pasta de trabalho do agente, com o isolamento.
      const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; cwd: string });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.argv).toEqual(
        expect.arrayContaining(["--setting-sources=", "--tools=", "--strict-mcp-config", "--permission-mode=default", "--no-session-persistence"]),
      );
      expect(calls[0]!.argv).not.toContain("--allow-dangerously-skip-permissions");
      expect(calls[0]!.argv.some((a) => a.startsWith("--mcp-config"))).toBe(false);
      expect(calls[0]!.cwd).toEndWith(path.join("agent", "work"));
      console.log(JSON.stringify({ download: { already: dl.already, packages: dl.packages.length }, report }, null, 2));
    },
    120_000,
  );
});
