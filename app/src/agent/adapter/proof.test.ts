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
import { childProcesses, commandsWaiter, isolationOf, mcpServerNames, opensProgram, redactToken, runAdapterProof, sameProgram } from "./proof.ts";
import { EMPTY_READER } from "../tools/reader.ts";
import { KiwiToolServer } from "../tools/server.ts";
import { tempDir } from "../../../test/tmp.ts";

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
      servidoresMcp: [],
      liberadas: [],
    });
  });

  test("com as ferramentas do Kiwi (spec #7496): o servidor do --mcp-config e as ferramentas liberadas", () => {
    const config = JSON.stringify({ mcpServers: { kiwi: { type: "http", url: "http://127.0.0.1:5/mcp", headers: { "X-Kiwi-Token": "abc}{\"" } } } });
    const cmd = `${isolated} --mcp-config ${config} --allowedTools=mcp__kiwi__*`;
    expect(isolationOf(cmd)).toMatchObject({ servidoresMcp: ["kiwi"], liberadas: ["mcp__kiwi__*"], semServidoresMcp: false });
    const two = JSON.stringify({ mcpServers: { kiwi: {}, github: {} } });
    expect(mcpServerNames(`${isolated} --mcp-config ${two}`)).toEqual(["github", "kiwi"]);
    expect(mcpServerNames(`${isolated} --mcp-config {quebrado`)).toEqual(["?"]);
    expect(mcpServerNames(isolated)).toEqual([]);
  });

  test("a senha do servidor sai da linha de comando do relatório", () => {
    expect(redactToken('claude --mcp-config {"h":"segredo123"} --x', "segredo123")).toBe('claude --mcp-config {"h":"***"} --x');
    expect(redactToken("claude --x", null)).toBe("claude --x");
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
      servidoresMcp: [],
      liberadas: [],
    });
    expect(isolationOf(`${isolated} --mcp-config {"mcpServers":{}}`).semServidoresMcp).toBe(false);
  });

  test("o mesmo programa pelo link ou pelo caminho da versão (o Claude Code nativo usa um link)", async () => {
    const { mkdirSync, symlinkSync, writeFileSync } = await import("node:fs");
    const dir = tempDir("kiwi-same-");
    mkdirSync(path.join(dir, "versions"));
    writeFileSync(path.join(dir, "versions", "2.1.322"), "");
    symlinkSync(path.join(dir, "versions", "2.1.322"), path.join(dir, "claude"));
    expect(sameProgram(path.join(dir, "versions", "2.1.322"), path.join(dir, "claude"))).toBe(true);
    expect(sameProgram(path.join(dir, "outro"), path.join(dir, "claude"))).toBe(false);
  });

  test("o programa aberto, mesmo com espaço no caminho", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = path.join(tempDir("kiwi-espaco-"), "Application Support");
    mkdirSync(dir);
    const claude = path.join(dir, "claude");
    writeFileSync(claude, "");
    expect(opensProgram(`${claude} --input-format stream-json`, claude)).toBe(true);
    expect(opensProgram(`/outro/claude --input-format stream-json`, claude)).toBe(false);
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

describe("a espera pela lista de comandos (T8603)", () => {
  test("o teto só conta a partir do wait(): uma abertura lenta não come o tempo da lista", async () => {
    const w = commandsWaiter();
    await Bun.sleep(300); // a abertura (o claude, o adaptador) leva mais que o teto inteiro
    setTimeout(() => w.arrived(), 50);
    expect(await w.wait(200)).toBe(true);
  });

  test("a lista que chega durante a abertura conta, sem esperar", async () => {
    const w = commandsWaiter();
    w.arrived();
    const t0 = performance.now();
    expect(await w.wait(5000)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("sem a lista, o wait() dá false no teto", async () => {
    expect(await commandsWaiter().wait(50)).toBe(false);
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
        servidoresMcp: [],
        liberadas: [],
      });
      expect(report.comandosChegaram).toBe(true);
      expect(report.ferramentasDoKiwi).toBeNull();

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

  test(
    "um claude lento na versão e no login (2,6 s cada) ainda dá a lista de comandos, porque o teto conta depois de abrir",
    async () => {
      const data = mkdtempSync(path.join(tmpdir(), "kiwi-proof-lento-"));
      const cache = process.env.KIWI_ADAPTER_CACHE;
      const root = cache ? path.join(cache, "adapter") : adapterRoot(data);
      await downloadAdapter({ root });
      if (cache) {
        const { mkdirSync, symlinkSync } = await import("node:fs");
        mkdirSync(path.dirname(adapterRoot(data)), { recursive: true });
        symlinkSync(root, adapterRoot(data));
      }
      const claude = writeFakeClaudeExecutable(path.join(data, "bin"), { KIWI_FAKE_CLAUDE_DELAY_MS: "2600" });
      const report = await runAdapterProof({ data, claudePath: claude });
      expect(report).toMatchObject({ ok: true, comandosChegaram: true });
      expect(report.comandos.length).toBeGreaterThan(0);
    },
    120_000,
  );
});

describe("o claude falso como cliente MCP (spec #7496)", () => {
  test("com um --mcp-config, ele conecta no servidor do Kiwi ao abrir e pede a lista, como o Claude Code", async () => {
    const methods: string[] = [];
    const server = new KiwiToolServer({ reader: EMPTY_READER, onRequest: (m) => methods.push(m) });
    const config = server.start();
    const dir = tempDir("kiwi-fake-mcp-");
    const log = path.join(dir, "calls.jsonl");
    const claude = writeFakeClaudeExecutable(path.join(dir, "bin"), { KIWI_FAKE_CLAUDE_LOG: log });
    const mcpConfig = JSON.stringify({ mcpServers: { kiwi: { type: "http", url: config.url, headers: Object.fromEntries(config.headers.map((h) => [h.name, h.value])) } } });
    const p = Bun.spawn([claude, "--input-format", "stream-json", "--mcp-config", mcpConfig], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    try {
      const end = Date.now() + 10_000;
      while (!methods.includes("tools/list") && Date.now() < end) await Bun.sleep(20);
      expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
      while (Date.now() < end && !readFileSync(log, "utf8").includes('"mcp"')) await Bun.sleep(20);
      const mcp = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.mcp)!.mcp;
      expect(mcp).toEqual({ nome: "kiwi", ferramentas: ["notes_search", "notes_outline", "notes_read", "notes_list", "meetings_list", "meetings_get", "projects_list", "project_status"] });
    } finally {
      (p.stdin as import("bun").FileSink).end();
      p.kill();
      server.stop();
    }
  });
});

describe.skipIf(!process.env.KIWI_ADAPTER_PROOF)("a prova com as ferramentas do Kiwi (spec #7496), com o adaptador de verdade e um claude falso", () => {
  test(
    "a sessão abre com só o servidor do Kiwi e só as ferramentas dele liberadas; o claude pede a lista; a senha não aparece",
    async () => {
      const data = mkdtempSync(path.join(tmpdir(), "kiwi-proof-tools-"));
      const cache = process.env.KIWI_ADAPTER_CACHE;
      const root = cache ? path.join(cache, "adapter") : adapterRoot(data);
      await downloadAdapter({ root });
      if (cache) {
        const { mkdirSync, symlinkSync } = await import("node:fs");
        mkdirSync(path.dirname(adapterRoot(data)), { recursive: true });
        symlinkSync(root, adapterRoot(data));
      }
      const log = path.join(data, "calls.jsonl");
      const claude = writeFakeClaudeExecutable(path.join(data, "bin"), { KIWI_FAKE_CLAUDE_LOG: log });
      const report = await runAdapterProof({ data, claudePath: claude, tools: true });
      expect(report.ok).toBe(true);
      expect(report.sessao).toMatchObject({ abriu: true, pedidosEnviados: 0 });
      expect(report.isolamento).toMatchObject({ semConfiguracoesPessoais: true, semFerramentas: true, servidoresMcp: ["kiwi"], liberadas: ["mcp__kiwi__*"], pulaPermissoes: false });
      expect(report.ferramentasDoKiwi).toMatchObject({ conectou: true, pediuALista: true });
      expect(report.ferramentasDoKiwi!.metodos).toEqual(expect.arrayContaining(["initialize", "tools/list"]));
      expect(report.processo!.comando).toContain('"X-Kiwi-Token":"***"');
      expect(report.processo!.comando).not.toMatch(/"X-Kiwi-Token":"[0-9a-f]{64}"/);
      const mcp = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.mcp)?.mcp;
      expect(mcp?.ferramentas).toHaveLength(6);
      console.log(JSON.stringify(report, null, 2));
    },
    120_000,
  );
});
