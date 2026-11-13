// A seção Agente dos Ajustes (spec #8373, T8762), de ponta a ponta e fora da tela: o headless com o agente falso e um
// registro do npm falso, lento e local (as chaves de teste do #8339, que só valem no headless), e a janela de verdade num
// WebKit headless. Nada abre o Claude Code nem vai à internet.
//
//   bun scripts/agent-ui-check.ts [pasta-dos-prints]
//
// Roda os roteiros de `scripts/ui-scripts/`:
// - `ajustes-agente.json`: ligar com a tela do aviso, baixar, cancelar e tentar de novo, testar, cancelar no meio, os
//   erros do agente, trocar o modelo, desligar e remover;
// - `ajustes-agente-estado.json`, com o `claude` falso não instalado, não logado e numa versão antiga;
// - `ajustes-agente-sem-rede.json`, com o registro fora do ar;
// - `ajustes-agente-notas.json` (spec #7496): o Testar pergunta sobre uma nota, e o agente falso lê pelas ferramentas
//   do Kiwi ("Lendo Projetos/Kiwi.md…").
// Sai com 1 se algum roteiro falhar.

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fakeRegistry } from "../src/agent/fake/registry.ts";

const app = path.resolve(import.meta.dir, "..");
const scripts = path.join(app, "scripts", "ui-scripts");
const out = path.resolve(process.argv[2] ?? path.join(tmpdir(), "kiwi-agent-ui"));
const work = mkdtempSync(path.join(tmpdir(), "kiwi-agent-ui-"));
mkdirSync(out, { recursive: true });

// Uns 4,4 MB, como a lista fixa de verdade, servidos aos poucos: dá tempo de ver o progresso e de cancelar.
const random = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return b;
};
const reg = fakeRegistry(
  [
    { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "", "dist/blob.bin": random(3_000_000) } },
    { name: "zod", version: "4.6.7", files: { "blob.bin": random(1_400_000) } },
  ],
  { slow: { chunk: 64 * 1024, delayMs: 60 } },
);
const packages = path.join(work, "packages.json");
writeFileSync(packages, JSON.stringify(reg.pinned));

async function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const p = Bun.spawn([process.execPath, path.join(app, "scripts", "cli.ts"), ...args], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const text = await new Response(p.stdout).text();
  return { code: await p.exited, out: text };
}

/** Um cenário: o headless com o ambiente dele, um roteiro, e os prints com um prefixo. */
async function scenario(name: string, script: string, env: Record<string, string>): Promise<boolean> {
  const data = path.join(work, name);
  const shots = path.join(work, `shots-${name}`);
  const base = { KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: reg.url, KIWI_ADAPTER_PACKAGES: packages, ...env };
  try {
    const up = await cli(["start", "--no-helper", "--data", data], base);
    if (up.code !== 0) throw new Error(`o headless não subiu: ${up.out}`);
    const r = await cli(["ui", "hub", "--script", path.join(scripts, script), "--out", shots, "--data", data]);
    const report = JSON.parse(r.out.slice(r.out.indexOf("{"))) as { ok: boolean; failedAt?: number; problems?: string[]; steps?: { error?: string }[] };
    for (const f of new Bun.Glob("*.png").scanSync(shots)) {
      const to = script === "ajustes-agente.json" ? f : script === "ajustes-agente-notas.json" ? `notas-${f}` : `0-${name}.png`;
      renameSync(path.join(shots, f), path.join(out, to));
    }
    const failed = report.steps?.find((s) => s.error)?.error;
    console.log(`${report.ok ? "ok  " : "FALHOU"} ${name}${failed ? `: ${failed}` : ""}${report.problems?.length ? ` · ${report.problems.join(" | ")}` : ""}`);
    return report.ok && !report.problems?.length;
  } finally {
    await cli(["stop", "--data", data]);
  }
}

let ok = true;
try {
  ok = (await scenario("fluxo", "ajustes-agente.json", {})) && ok;
  ok = (await scenario("nao-instalado", "ajustes-agente-estado.json", { KIWI_FAKE_CLAUDE_VERSION: "x" })) && ok;
  ok = (await scenario("nao-logado", "ajustes-agente-estado.json", { KIWI_FAKE_CLAUDE_LOGGED_IN: "0" })) && ok;
  ok = (await scenario("versao-antiga", "ajustes-agente-estado.json", { KIWI_FAKE_CLAUDE_VERSION: "2.0.9" })) && ok;
  ok = (await scenario("sem-rede", "ajustes-agente-sem-rede.json", { KIWI_ADAPTER_REGISTRY: "http://127.0.0.1:9" })) && ok;
  ok = (await scenario("notas", "ajustes-agente-notas.json", { KIWI_FAKE_AGENT_TOOL_DELAY_MS: "1500" })) && ok;
} finally {
  reg.stop();
  rmSync(work, { recursive: true, force: true });
}
console.log(`prints em ${out}`);
process.exit(ok ? 0 : 1);
