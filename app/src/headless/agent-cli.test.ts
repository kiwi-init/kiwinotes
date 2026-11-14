// O agente pela CLI headless (spec #8339, T8678): ligar, baixar o adaptador, pedir, cancelar, desligar e remover, com o
// agente falso e um registro do npm falso e local (as chaves `KIWI_FAKE_AGENT`, `KIWI_ADAPTER_REGISTRY` e
// `KIWI_ADAPTER_PACKAGES`, que só valem no headless). Nada abre na tela, nada vai à internet.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fakeRegistry } from "../agent/fake/registry.ts";
import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("kn-agent-cli-");
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
    // Cinco chamadas à CLI: num runner lento do CI passam dos 5 s padrão (#394).
  }, 30_000);

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
    // No app, as de escrita (spec #8356) vêm junto.
    expect((await ask("/ferramentas")).at(-1).text).toBe(
      "ferramentas: notes_search, notes_outline, notes_read, notes_list, meetings_list, meetings_get, projects_list, project_status, files_read, notes_create, notes_append, notes_write, project_diary_add, notes_organize_folder, files_create, meeting_propose, project_summary_propose, notes_add_references, memory_remember, memory_forget",
    );
    await invoke("agent.disable");
  }, 60_000);

  test("o projeto marcado pela CLI (spec #9874): o agente falso vê como ele está, e não consegue marcar nem desmarcar", async () => {
    await invoke("agent.enable");
    await invoke("agent.download");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready");
    const PLANO = "# Plano\n\n## Fazer\n\n- [ ] escrever o spec\n- [x] abrir a issue\n- [ ] testar\n\n```md\n- [ ] dentro do código não conta\n```\n";
    expect((await invoke("notes.create", { folder: "Clientes/Acme", title: "Plano", content: PLANO })).json!.ok).toBe(true);

    // A CLI marca: a nota com o nome da pasta nasce só com o título.
    const marked = (await invoke("projects.mark", { folder: "Clientes/Acme" })).json!;
    expect(marked).toMatchObject({ ok: true, value: { created: true, project: { name: "Acme", folder: "Clientes/Acme", main: "Clientes/Acme/Acme.md", notes: 2 } } });
    expect((await invoke("notes.get", { path: "Clientes/Acme/Acme.md" })).json!.value.content).toBe("# Acme\n");

    const ask = async (text: string) => {
      const id = (await invoke("agent.ask", { text })).json!.value.id as string;
      await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === id && (e.payload.type === "done" || e.payload.type === "error")));
      return (await agentEvents()).filter((e) => e.event === "agent.turn" && e.payload.id === id).map((e) => e.payload);
    };
    const listed = JSON.parse((await ask("/tool projects_list {}")).at(-1).text);
    expect(listed).toMatchObject({ total: 1, projetos: [{ nome: "Acme", pasta: "Clientes/Acme", notaPrincipal: "Clientes/Acme/Acme.md", notas: 2 }] });

    const turn = await ask('/tool project_status {"projeto":"Acme"}');
    const status = JSON.parse(turn.at(-1).text);
    expect(status).toMatchObject({
      projeto: "Acme",
      pasta: "Clientes/Acme",
      notaPrincipal: "Clientes/Acme/Acme.md",
      sumario: [{ nivel: 1, titulo: "Acme" }],
      tarefasAbertas: { total: 2, notas: 1, porNota: [{ path: "Clientes/Acme/Plano.md", abertas: 2 }] },
    });
    expect(status.recentes.map((n: { path: string }) => n.path).sort()).toEqual(["Clientes/Acme/Acme.md", "Clientes/Acme/Plano.md"]);
    // O status ao vivo diz qual projeto foi visto.
    expect(turn).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "project_status", target: "Acme" }));

    // Marcar e desmarcar é da pessoa: o agente não tem essas ferramentas.
    for (const name of ["projects_mark", "projects_unmark", "project_mark"]) {
      expect((await ask(`/tool ${name} {"folder":"Clientes/Acme"}`)).at(-1).text).toMatch(/erro/);
    }
    expect((await invoke("projects.list")).json!.value.projects).toHaveLength(1);
    await invoke("agent.disable");
  }, 60_000);

  test("o agente escreve nas notas (spec #8356): cria, acrescenta e troca, com a cópia de antes nas Versões e no registro", async () => {
    await invoke("agent.enable");
    await invoke("agent.download");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready");
    expect((await invoke("notes.create", { folder: "Projetos", title: "Lista", content: "# Lista\n\n## Fazer\n\n- comprar pão\n" })).json!.ok).toBe(true);

    const ask = async (text: string) => {
      const id = (await invoke("agent.ask", { text })).json!.value.id as string;
      await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === id && (e.payload.type === "done" || e.payload.type === "error")));
      return (await agentEvents()).filter((e) => e.event === "agent.turn" && e.payload.id === id).map((e) => e.payload);
    };
    const tool = async (name: string, args: unknown) => {
      const done = (await ask(`/tool ${name} ${JSON.stringify(args)}`)).at(-1);
      expect(done.type).toBe("done");
      return done.text.startsWith("erro") ? { error: done.text as string } : { value: JSON.parse(done.text) };
    };
    const get = async (p: string) => (await invoke("notes.get", { path: p })).json!.value as { content: string; version: string };

    const created = await tool("notes_create", { folder: "Projetos", title: "Resumo", text: "# Resumo\n\nfeito pelo agente\n" });
    expect(created.value.path).toBe("Projetos/Resumo.md");
    expect((await get("Projetos/Resumo.md")).content).toBe("# Resumo\n\nfeito pelo agente\n");

    await tool("notes_append", { path: "Projetos/Lista.md", section: "Fazer", text: "- lavar o carro" });
    expect((await get("Projetos/Lista.md")).content).toBe("# Lista\n\n## Fazer\n\n- comprar pão\n- lavar o carro\n");

    const { versao } = (await tool("notes_read", { path: "Projetos/Lista.md" })).value;
    const turn = await ask(`/tool notes_write ${JSON.stringify({ path: "Projetos/Lista.md", section: "Fazer", text: "- nada", version: versao })}`);
    expect(turn).toContainEqual(expect.objectContaining({ type: "status", status: "running", tool: "notes_write", target: "Projetos/Lista.md › Fazer" }));
    expect((await get("Projetos/Lista.md")).content).toBe("# Lista\n\n## Fazer\n\n- nada\n");

    // A versão lida, velha: nada é escrito.
    expect((await tool("notes_write", { path: "Projetos/Lista.md", text: "x", version: versao })).error).toMatch(/^erro da ferramenta: E_CHANGED/);
    // O agente não muda uma nota de reunião, nem apaga.
    expect((await tool("notes_delete", { path: "Projetos/Lista.md" })).error).toContain("não tem a ferramenta");

    // O texto de antes está nas Versões da nota, sem esperar os 2 minutos do histórico.
    const versions = (await invoke("notes.versions", { path: "Projetos/Lista.md" })).json!.value.versions as { id: string }[];
    const texts: string[] = [];
    for (const v of versions) texts.push((await invoke("notes.version", { path: "Projetos/Lista.md", id: v.id })).json!.value.content);
    expect(texts).toContain("# Lista\n\n## Fazer\n\n- comprar pão\n");
    expect(texts).toContain("# Lista\n\n## Fazer\n\n- comprar pão\n- lavar o carro\n");

    // O registro: pela capacidade do app e pela CLI, o mesmo.
    const log = (await invoke("agent.activity", { limit: 10 })).json!.value.requests as { request: string; reads: unknown[]; changes: { kind: string; path: string; copy?: string }[] }[];
    const changes = log.flatMap((r) => r.changes).map((c) => [c.kind, c.path, !!c.copy]);
    expect(changes).toEqual([
      ["replaced", "Projetos/Lista.md", true],
      ["appended", "Projetos/Lista.md", true],
      ["created", "Projetos/Resumo.md", false],
    ]);
    expect(log.some((r) => r.reads.some((x: any) => x.tool === "notes_read" && x.target === "Projetos/Lista.md"))).toBe(true);
    const fromCli = await cli(["agent", "activity", "--limit", "10"]);
    expect(fromCli.code).toBe(0);
    expect(fromCli.json!.value.requests).toEqual(log);
    expect((await cli(["agent", "activity", "--limit", "0"])).code).toBe(2);
    expect((await invoke("agent.activity", { limit: 0 })).json!.code).toBe("E_BAD_ARGS");
    await invoke("agent.disable");
  }, 90_000);

  test("o desfazer (spec #9353): `agent undo` volta a nota, manda a criada para a Lixeira, e o registro anota", async () => {
    await invoke("agent.enable");
    await invoke("agent.download");
    await until(async () => (await invoke("agent.status")).json!.value.adapter.phase === "ready");
    const PLANO = "# Plano\n\n## Prazo\n\nO prazo do Kiwi é março.\n";
    expect((await invoke("notes.create", { folder: "Projetos", title: "Plano", content: PLANO })).json!.ok).toBe(true);
    const ask = async (text: string) => {
      const id = (await invoke("agent.ask", { text })).json!.value.id as string;
      await until(async () => (await agentEvents()).some((e) => e.event === "agent.turn" && e.payload.id === id && (e.payload.type === "done" || e.payload.type === "error")));
      return id;
    };
    const get = async (p: string) => (await invoke("notes.get", { path: p })).json!.value as { content: string; version: string };

    // O agente falso troca o prazo, e cria uma nota, cada um num pedido.
    const { version } = await get("Projetos/Plano.md");
    const write = await ask(`/tool notes_write ${JSON.stringify({ path: "Projetos/Plano.md", section: "Prazo", text: "O prazo é abril.", version })}`);
    expect((await get("Projetos/Plano.md")).content).toBe("# Plano\n\n## Prazo\n\nO prazo é abril.\n");
    const create = await ask(`/tool notes_create ${JSON.stringify({ folder: "Projetos", title: "Do agente", text: "criada pelo agente" })}`);
    await invoke("agent.disable");

    // O desfazer não precisa do agente ligado. A nota volta, e a janela recebe o `notes.changed`, como de qualquer mudança.
    const undone = await cli(["agent", "undo", write, "--change", "1"]);
    expect(undone.code).toBe(0);
    expect(undone.json).toEqual({ ok: true, value: { request: write, notes: [{ path: "Projetos/Plano.md", result: "restored", changes: [1] }] } });
    expect((await get("Projetos/Plano.md")).content).toBe(PLANO);
    const { out } = await cli(["events"]);
    expect(out.split("\n").filter((l) => l.includes('"notes.changed"') && l.includes("Projetos/Plano.md")).length).toBeGreaterThan(0);
    // O texto do agente está nas Versões.
    const versions = (await invoke("notes.versions", { path: "Projetos/Plano.md" })).json!.value.versions as { id: string }[];
    const texts: string[] = [];
    for (const v of versions) texts.push((await invoke("notes.version", { path: "Projetos/Plano.md", id: v.id })).json!.value.content);
    expect(texts).toContain("# Plano\n\n## Prazo\n\nO prazo é abril.\n");

    // A tela "Atividade do agente" (spec #9480): o registro avisa, também num desfazer pela CLI, e o [Ver] mostra o antes.
    expect(out.split("\n").some((l) => l.includes('"agent.activityChanged"') && l.includes(write))).toBe(true);
    expect((await invoke("agent.change", { request: write, change: 1 })).json).toMatchObject({
      ok: true,
      value: { request: write, change: 1, path: "Projetos/Plano.md", kind: "replaced", section: "Prazo", before: PLANO, state: "undone" },
    });
    expect((await invoke("agent.change", { request: create, change: 1 })).json).toMatchObject({
      ok: true,
      value: { kind: "created", before: "", state: "exact", after: "criada pelo agente" },
    });
    expect((await invoke("agent.change", { request: write, change: 2 })).json).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect((await invoke("agent.change", { request: write })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect((await invoke("agent.change", { request: write, change: 1, x: 1 })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });

    // De novo: nada muda, e diz.
    expect((await cli(["agent", "undo", write])).json!.value.notes).toEqual([
      { path: "Projetos/Plano.md", result: "already", changes: [1], message: "Já tinha sido desfeita." },
    ]);

    // A nota criada vai para a Lixeira; nos 10 minutos, o Desfazer das Notas a traz de volta.
    expect((await cli(["agent", "undo", create])).json!.value.notes).toEqual([{ path: "Projetos/Do agente.md", result: "trashed", changes: [1] }]);
    expect((await invoke("notes.get", { path: "Projetos/Do agente.md" })).json).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect((await invoke("notes.restore", { path: "Projetos/Do agente.md" })).json).toMatchObject({ ok: true });
    expect((await get("Projetos/Do agente.md")).content).toBe("criada pelo agente");

    // O registro mostra o que foi desfeito e quando, pela capacidade e pela CLI.
    const log = (await cli(["agent", "activity", "--limit", "20"])).json!.value.requests as { id: string; changes: { undone?: string }[] }[];
    expect(log.find((r) => r.id === write)!.changes[0]!.undone).toBeString();
    expect(log.find((r) => r.id === create)!.changes[0]!.undone).toBeString();

    // Os erros: o pedido que não existe, e o uso errado.
    expect(await cli(["agent", "undo", "nao-existe"])).toMatchObject({ code: 1, json: { ok: false, code: "E_NOT_FOUND" } });
    expect((await cli(["agent", "undo"])).code).toBe(2);
    expect((await cli(["agent", "undo", write, "--change", "0"])).code).toBe(2);
    expect((await invoke("agent.undo", { request: write, change: 0 })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect((await invoke("agent.undo", { request: write, x: 1 })).json).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  }, 90_000);

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
