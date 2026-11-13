// O agente pela CLI headless (spec #8339, T8678): ligar, baixar o adaptador, pedir, cancelar, desligar e remover, com o
// agente falso e um registro do npm falso e local (as chaves `KIWI_FAKE_AGENT`, `KIWI_ADAPTER_REGISTRY` e
// `KIWI_ADAPTER_PACKAGES`, que só valem no headless). Nada abre na tela, nada vai à internet.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fakeRegistry } from "../agent/fake/registry.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
const root = mkdtempSync(path.join(tmpdir(), "kn-agent-cli-"));
const data = path.join(root, "data");
const reg = fakeRegistry(
  [
    { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": crypto.getRandomValues(new Uint8Array(32 * 1024)) } },
    { name: "zod", version: "4.6.7", files: { "index.js": "module.exports = {}" } },
  ],
  { slow: { chunk: 8 * 1024, delayMs: 20 } },
);
const packages = path.join(root, "packages.json");
writeFileSync(packages, JSON.stringify(reg.pinned));
const env = {
  ...process.env,
  KIWI_HEADLESS_DATA: "",
  KIWI_FAKE_AGENT: "1",
  KIWI_ADAPTER_REGISTRY: reg.url,
  KIWI_ADAPTER_PACKAGES: packages,
  KIWI_AGENT_IDLE_MS: "60000",
};

afterAll(async () => {
  await cli(["stop"]);
  reg.stop();
  rmSync(root, { recursive: true, force: true });
});

async function cli(args: string[]): Promise<{ code: number; json: Record<string, any> | null; out: string }> {
  const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], { stdout: "pipe", stderr: "pipe", env });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(out);
  } catch {
    json = null;
  }
  return { code, json, out };
}

const invoke = (cap: string, args: unknown = {}) => cli(["invoke", cap, JSON.stringify(args)]);

async function until<T>(get: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error("demorou demais");
    await Bun.sleep(50);
  }
}

/** Os eventos `agent.*` do histórico do headless. */
async function agentEvents(): Promise<{ event: string; payload: any }[]> {
  const { out } = await cli(["events"]);
  return out
    .split("\n")
    .filter((l) => l.includes('"agent.'))
    .map((l) => JSON.parse(l) as { event: string; payload: any });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("o agente pela CLI headless (T8678)", () => {
  test("o caminho inteiro: ligar, baixar, pedir, cancelar, desligar, remover e sair", async () => {
    expect((await cli(["start", "--no-helper"])).code).toBe(0);

    // Desligado de fábrica: pedir e baixar recusam, e nada foi à rede.
    expect((await invoke("agent.status")).json!.value).toMatchObject({ enabled: false, consented: false, adapter: { phase: "missing" }, program: "closed" });
    expect((await invoke("agent.ask", { text: "oi" })).json).toMatchObject({ ok: false, code: "E_AGENT_DISABLED" });
    expect((await invoke("agent.download")).json).toMatchObject({ ok: false, code: "E_AGENT_DISABLED" });
    expect(reg.requests).toEqual([]);

    // Ligar: a primeira vez pede o aceite.
    expect((await invoke("agent.enable")).json).toMatchObject({ ok: false, code: "E_AGENT_CONSENT" });
    expect((await invoke("agent.enable", { consent: true })).json!.value).toMatchObject({ enabled: true, consented: true });

    // Baixar: volta logo, e o progresso em bytes chega no evento.
    expect((await invoke("agent.download")).json!.value.adapter.phase).toBe("downloading");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready");
    const progress = (await agentEvents()).filter((e) => e.event === "agent.status" && e.payload.adapter.phase === "downloading");
    expect(progress.some((e) => e.payload.adapter.done > 0 && e.payload.adapter.done < e.payload.adapter.total)).toBe(true);

    // O estado do Claude Code (o falso) só com refresh.
    expect((await invoke("agent.status", { refresh: true })).json!.value.claude).toMatchObject({ installed: true, loggedIn: true, versionOk: true });

    // Pedir: volta com o id, e a resposta chega ao vivo.
    const asked = (await invoke("agent.ask", { text: "oi" })).json!;
    expect(asked.ok).toBe(true);
    const id = asked.value.id as string;
    await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === id && e.payload.type === "done"));
    const turn = (await agentEvents()).filter((e) => e.event === "agent.turn" && e.payload.id === id).map((e) => e.payload);
    expect(turn.map((e) => e.type)).toEqual(["started", "status", "status", "text", "text", "done"]);
    expect(turn.at(-1)).toMatchObject({ stopReason: "end_turn", text: 'Você disse: "oi". Este é o turno 1 desta sessão.' });
    const open = (await invoke("agent.status")).json!.value;
    expect(open).toMatchObject({ program: "open", session: { model: "default", effort: "default" } });

    // Cancelar um pedido longo.
    const slow = (await invoke("agent.ask", { text: "/lento" })).json!.value.id as string;
    await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === slow && e.payload.type === "text"));
    expect((await invoke("agent.cancel")).json!.ok).toBe(true);
    await until(async () =>
      (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === slow && e.payload.type === "done" && e.payload.stopReason === "cancelled"),
    );

    // Desligar fecha o programa na hora; o fake anota o pid na pasta de trabalho dele.
    const pid = Number(readFileSync(path.join(data, "agent", "work", ".fake-agent.pid"), "utf8"));
    expect(alive(pid)).toBe(true);
    expect((await invoke("agent.disable")).json!.value).toMatchObject({ enabled: false, program: "closed" });
    await until(async () => !alive(pid));

    // Remover apaga o download.
    expect((await invoke("agent.remove")).json!.value.adapter.phase).toBe("missing");
    expect(existsSync(path.join(data, "agent", "adapter"))).toBe(false);
  }, 60_000);

  test("os argumentos errados são recusados", async () => {
    expect((await invoke("agent.status", { x: 1 })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect((await invoke("agent.configure", { model: "../x" })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect((await invoke("agent.ask", { text: 3 })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect((await invoke("agent.ask", { text: "  " })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect((await invoke("settings.set", { agent: { enabled: true } })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });

  test("o agente lê o cofre pelas ferramentas do Kiwi (spec #7496): responde a uma pergunta sobre uma nota", async () => {
    await invoke("agent.enable");
    await invoke("agent.download");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready");
    expect((await invoke("notes.create", { folder: "Projetos", title: "Kiwi", content: "# Kiwi\n\n## Prazo\n\nO prazo do Kiwi é março.\n" })).json!.ok).toBe(true);

    const ask = async (text: string) => {
      const id = (await invoke("agent.ask", { text })).json!.value.id as string;
      await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === id && (e.payload.type === "done" || e.payload.type === "error")));
      return (await agentEvents()).filter((e) => e.event === "agent.turn" && e.payload.id === id).map((e) => e.payload);
    };

    const turn = await ask("Qual é o prazo do Kiwi?");
    expect(turn.at(-1)).toMatchObject({ type: "done" });
    expect(turn.at(-1).text).toContain("Pela nota Projetos/Kiwi.md");
    expect(turn.at(-1).text).toContain("março");
    // O que foi lido aparece no status ao vivo.
    expect(turn).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "notes_read", target: "Projetos/Kiwi.md" }));

    // A fronteira do cofre vale pelas ferramentas também.
    const outside = await ask('/tool notes_read {"path":"../fora.md"}');
    expect(outside.at(-1).text).toMatch(/^erro da ferramenta: E_OUTSIDE_VAULT/);
    expect((await ask("/ferramentas")).at(-1).text).toBe("ferramentas: notes_search, notes_outline, notes_read, notes_list, meetings_list, meetings_get");
    await invoke("agent.disable");
  }, 60_000);

  test("quando o app sai, o programa do agente sai junto", async () => {
    await invoke("agent.enable");
    await invoke("agent.download");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready");
    const id = (await invoke("agent.ask", { text: "oi" })).json!.value.id as string;
    await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === id && e.payload.type === "done"));
    const pid = Number(readFileSync(path.join(data, "agent", "work", ".fake-agent.pid"), "utf8"));
    expect(alive(pid)).toBe(true);
    expect((await cli(["stop"])).code).toBe(0);
    await until(async () => !alive(pid));
  }, 60_000);
});
