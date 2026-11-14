// A notificação quando o agente espera uma resposta (spec #9839, T10525), pela CLI headless: o agente falso, o aviso
// falso (`KIWI_FAKE_NOTICES`, que registra cada pedido em <dados>/fake-notices.jsonl) e uma janela principal de mentira.
// Nada chama o macOS: nem notificação, nem o pedido de permissão.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fakeRegistry } from "../agent/fake/registry.ts";
import { request } from "../../scripts/cli.ts";
import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
// O tempDir apaga de novo no fim da suíte: o headless que sai ainda grava nos dados e recriava a pasta (CI do #442).
const root = tempDir("kn-notice-cli-");
const data = path.join(root, "data");
const reg = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "// adaptador falso" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "module.exports = {}" } },
]);
const packages = path.join(root, "packages.json");
writeFileSync(packages, JSON.stringify(reg.pinned));
const env = {
  ...process.env,
  KIWI_HEADLESS_DATA: "",
  KIWI_FAKE_AGENT: "1",
  KIWI_ADAPTER_REGISTRY: reg.url,
  KIWI_ADAPTER_PACKAGES: packages,
  KIWI_AGENT_IDLE_MS: "60000",
  KIWI_DOUBT_TIMEOUT_MS: "1500",
  KIWI_FAKE_NOTICES: "notDetermined",
};

afterAll(async () => {
  await cli(["stop"]);
  reg.stop();
});

async function cli(args: string[]): Promise<{ code: number; json: Record<string, any> | null }> {
  const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], { stdout: "pipe", stderr: "pipe", env });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  try {
    return { code, json: JSON.parse(out) };
  } catch {
    return { code, json: null };
  }
}

// Os pedidos vão direto pelo socket de controle, como a CLI manda, sem um processo do Bun para cada um (T12910): o prazo
// da dúvida é curto (1,5 s), e no runner carregado do release o clique e a resposta, cada um num `bun cli.ts`, chegavam
// depois dele. O prazo tirava a notificação antes do clique, e a ordem saía "post, remove, show".
const ctl = async (msg: Record<string, unknown>): Promise<{ json: Record<string, any> | null }> => ({ json: await request(data, msg) });
const invoke = (cap: string, args: unknown = {}) => ctl({ cmd: "invoke", cap, args });
const notice = (args: Record<string, unknown>) => ctl({ ...args, cmd: "notice" });

async function until<T>(get: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error("demorou demais");
    await Bun.sleep(50);
  }
}

type Call = { op: string; id?: string; title?: string; body?: string };
const calls = (): Call[] => {
  const f = path.join(data, "fake-notices.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Call) : [];
};

/** Abre um pedido que lê a nota e espera o cartão: devolve o pedido e o cartão. */
async function askDoubt(note: string): Promise<{ request: string; card: { id: string; items: { fingerprint: string }[] } }> {
  const request = (await invoke("agent.ask", { text: `/tool notes_read {"path":"${note}"}` })).json!.value.id as string;
  const card = await until(async () => {
    const c = (await invoke("agent.question")).json!.value;
    return c && c.request === request ? c : null;
  });
  return { request, card };
}

const DOUBT = "Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya";

describe("a notificação quando o agente espera, pela CLI (spec #9839)", () => {
  test("o botão pede uma vez; fora da vista avisa sem o trecho; o clique traz a janela; a resposta e o prazo retiram", async () => {
    expect((await cli(["start", "--no-helper"])).code).toBe(0);

    // Nunca pedida: a linha começa com o botão, e nada pediu nada.
    expect((await invoke("agent.notice")).json!.value).toEqual({ permission: "notDetermined", enabled: true });
    expect(calls()).toEqual([]);
    // O clique em "Ligar as notificações": um pedido só, e a resposta chega no evento.
    await invoke("agent.noticeAllow");
    await until(async () => (await invoke("agent.notice")).json!.value.permission === "allowed");
    await invoke("agent.noticeAllow");
    expect(calls()).toEqual([{ op: "request" }]);
    expect((await invoke("agent.noticeSet", { enabled: "sim" })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });

    await invoke("agent.enable", { consent: true });
    await invoke("agent.download");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready", 30_000);
    await invoke("notes.create", { title: "Servidores", content: `# Servidores\n\nO id do PACS novo: ${DOUBT}\n` });

    // A janela fora da vista: uma notificação, com a nota e sem o trecho.
    const first = await askDoubt("Servidores.md");
    const id = `kiwi.doubt.${first.card.id}`;
    await until(() => calls().some((c) => c.op === "post"));
    expect(calls().slice(1)).toEqual([{ op: "post", id, title: "O agente espera uma resposta sua", body: "Dúvida em Servidores. Clique para responder." }]);
    // O clique: a janela principal vem para a frente.
    expect((await notice({ click: id })).json!.value).toMatchObject({ view: true, shown: 1 });
    // A resposta fecha o cartão e retira a notificação.
    await invoke("agent.answer", { card: first.card.id, fingerprint: first.card.items[0]!.fingerprint, answer: "hold" });
    await until(() => calls().some((c) => c.op === "remove"));
    expect(calls().slice(1).map((c) => c.op)).toEqual(["post", "show", "remove"]);

    // Fora da vista de novo, e sem resposta: o prazo passa e a notificação sai.
    await invoke("agent.forget", { fingerprint: first.card.items[0]!.fingerprint });
    await notice({ view: false });
    await askDoubt("Servidores.md");
    await until(() => calls().length === 6, 10_000);
    expect(calls().slice(4).map((c) => c.op)).toEqual(["post", "remove"]);

    // Desligado: nada.
    expect((await invoke("agent.noticeSet", { enabled: false })).json!.value).toEqual({ permission: "allowed", enabled: false });
    await askDoubt("Servidores.md");
    await Bun.sleep(300);
    expect(calls().length).toBe(6);

    expect(readFileSync(path.join(data, "fake-notices.jsonl"), "utf8")).not.toContain(DOUBT);
  }, 90_000);
});
