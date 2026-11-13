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
//   do Kiwi ("Lendo Projetos/Kiwi.md…");
// - a escrita (spec #8356), na janela Notas: com a nota aberta, o agente falso acrescenta numa seção, troca outra com a
//   versão lida e cria uma nota nova, e a janela mostra cada mudança. O roteiro é montado aqui, com a versão da nota.
// - o desfazer (spec #9353), na janela Notas: o agente falso troca o prazo e cria uma nota, cada um num pedido; com a
//   nota aberta, o `agent.undo` volta o texto de antes, e a nota criada sai da árvore (vai para a Lixeira). O roteiro é
//   montado depois dos pedidos, com o id de cada um.
// Sai com 1 se algum roteiro falhar. `KIWI_AGENT_UI_ONLY=escrita` roda só um cenário (pelo nome).

import { createHash } from "node:crypto";
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
async function scenario(
  name: string,
  script: string,
  env: Record<string, string>,
  o: { window?: string; before?: (data: string, env: Record<string, string>) => Promise<void>; prefix?: string } = {},
): Promise<boolean> {
  if (process.env.KIWI_AGENT_UI_ONLY && process.env.KIWI_AGENT_UI_ONLY !== name) return true;
  const data = path.join(work, name);
  const shots = path.join(work, `shots-${name}`);
  const base = { KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: reg.url, KIWI_ADAPTER_PACKAGES: packages, ...env };
  try {
    const up = await cli(["start", "--no-helper", "--data", data], base);
    if (up.code !== 0) throw new Error(`o headless não subiu: ${up.out}`);
    await o.before?.(data, base);
    const r = await cli(["ui", o.window ?? "hub", "--script", path.isAbsolute(script) ? script : path.join(scripts, script), "--out", shots, "--data", data]);
    const report = JSON.parse(r.out.slice(r.out.indexOf("{"))) as { ok: boolean; failedAt?: number; problems?: string[]; steps?: { error?: string }[] };
    for (const f of new Bun.Glob("*.png").scanSync(shots)) {
      const to = o.prefix ? `${o.prefix}${f}` : script === "ajustes-agente.json" ? f : script === "ajustes-agente-notas.json" ? `notas-${f}` : `0-${name}.png`;
      renameSync(path.join(shots, f), path.join(out, to));
    }
    const failed = report.steps?.find((s) => s.error)?.error;
    console.log(`${report.ok ? "ok  " : "FALHOU"} ${name}${failed ? `: ${failed}` : ""}${report.problems?.length ? ` · ${report.problems.join(" | ")}` : ""}`);
    return report.ok && !report.problems?.length;
  } finally {
    await cli(["stop", "--data", data]);
  }
}

const KIWI = "# Kiwi\n\nO app de notas do harry.\n\n## Prazo\n\nO prazo do Kiwi é março.\n\n## Equipe\n\nharry e jow.\n";
const APPENDED = KIWI.replace("O prazo do Kiwi é março.\n", "O prazo do Kiwi é março.\nPode mudar para abril, diz o agente.\n");
const versionOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Antes da janela: a nota no cofre, e o agente ligado com o adaptador baixado. */
async function agentReady(data: string, env: Record<string, string>): Promise<void> {
  const invoke = async (cap: string, args: unknown) => {
    const r = await cli(["invoke", cap, JSON.stringify(args), "--data", data], env);
    if (r.code !== 0) throw new Error(`${cap}: ${r.out}`);
    return JSON.parse(r.out) as { value: any };
  };
  await invoke("notes.create", { folder: "Projetos", title: "Kiwi", content: KIWI });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download", {});
  for (const end = Date.now() + 60_000; (await invoke("agent.status", {})).value.adapter.phase !== "ready"; ) {
    if (Date.now() > end) throw new Error("o adaptador não baixou");
    await Bun.sleep(200);
  }
}

/** O roteiro da escrita na janela Notas (spec #8356), com a versão que o notes_write pede. */
function writeScript(): string {
  const ask = (name: string, args: unknown) => ({ invoke: "agent.ask", args: { text: `/tool ${name} ${JSON.stringify(args)}` }, name: `o agente: ${name}` });
  const editor = ".kn-note-editor .cm-content";
  const steps = [
    { waitFor: ".kn-crumb-bt", name: "a janela Notas abre" },
    { click: ".kn-crumb-bt", name: "abre a árvore" },
    { click: ".kn-tree-pop .kn-side-item[data-kind='folder']:has-text('Projetos')", name: "abre a pasta Projetos" },
    { click: ".kn-tree-pop .kn-side-item[data-kind='note']:has-text('Kiwi')", name: "abre a nota Kiwi" },
    { expectText: editor, text: "O prazo do Kiwi é março.", name: "a nota aberta, como estava" },
    { screenshot: "1-antes.png" },
    ask("notes_append", { path: "Projetos/Kiwi.md", section: "Prazo", text: "Pode mudar para abril, diz o agente." }),
    { expectText: editor, text: "Pode mudar para abril, diz o agente.", timeout: 20000, name: "a janela mostra o que o agente acrescentou na seção" },
    { screenshot: "2-acrescentou.png" },
    { wait: 1500 },
    ask("notes_write", { path: "Projetos/Kiwi.md", section: "Equipe", text: "harry, jow e o Kiwi-cat.", version: versionOf(APPENDED) }),
    { expectText: editor, text: "harry, jow e o Kiwi-cat.", timeout: 20000, name: "a janela mostra a seção trocada pelo agente" },
    { screenshot: "3-trocou.png" },
    { wait: 1500 },
    ask("notes_create", { folder: "Projetos", title: "Resumo do Kiwi", text: "# Resumo do Kiwi\n\nPrazo: março, talvez abril.\n" }),
    { wait: 1500 },
    { click: ".kn-crumb-bt", name: "abre a árvore" },
    { waitFor: ".kn-tree-pop .kn-side-item[data-kind='note']:has-text('Resumo do Kiwi')", timeout: 20000, name: "a nota que o agente criou aparece na árvore" },
    { click: ".kn-tree-pop .kn-side-item[data-kind='note']:has-text('Resumo do Kiwi')", name: "abre a nota criada" },
    { expectText: editor, text: "Prazo: março, talvez abril.", name: "com o texto do agente" },
    { screenshot: "4-criou.png" },
  ];
  const file = path.join(work, "notas-agente-escreve.json");
  writeFileSync(file, JSON.stringify({ window: "notes", size: "1100x800", steps }, null, 2));
  return file;
}

/** O roteiro do desfazer (spec #9353): o arquivo sai do `undoReady`, que sabe o id dos pedidos. */
const undoFile = path.join(work, "notas-agente-desfaz.json");

/** Antes da janela: o agente pronto, e dois pedidos dele (troca o prazo; cria uma nota), já terminados. */
async function undoReady(data: string, env: Record<string, string>): Promise<void> {
  await agentReady(data, env);
  const invoke = async (cap: string, args: unknown) => {
    const r = await cli(["invoke", cap, JSON.stringify(args), "--data", data], env);
    if (r.code !== 0) throw new Error(`${cap}: ${r.out}`);
    return JSON.parse(r.out) as { value: any };
  };
  const ask = async (name: string, args: unknown) => {
    const { id } = (await invoke("agent.ask", { text: `/tool ${name} ${JSON.stringify(args)}` })).value as { id: string };
    for (const end = Date.now() + 30_000; ; ) {
      const done = (await cli(["events", "--data", data], env)).out
        .split("\n")
        .some((l) => l.includes('"agent.turn"') && l.includes(`"${id}"`) && /"type":"(done|error)"/.test(l));
      if (done) return id;
      if (Date.now() > end) throw new Error(`o pedido ${name} não terminou`);
      await Bun.sleep(200);
    }
  };
  const write = await ask("notes_write", { path: "Projetos/Kiwi.md", section: "Prazo", text: "O prazo é abril, diz o agente.", version: versionOf(KIWI) });
  const create = await ask("notes_create", { folder: "Projetos", title: "Resumo do Kiwi", text: "# Resumo do Kiwi\n\nPrazo: abril.\n" });
  await invoke("agent.disable", {});
  const editor = ".kn-note-editor .cm-content";
  const resumo = ".kn-tree-pop .kn-side-item[data-kind='note']:has-text('Resumo do Kiwi')";
  const steps = [
    { waitFor: ".kn-crumb-bt", name: "a janela Notas abre" },
    { click: ".kn-crumb-bt", name: "abre a árvore" },
    { click: ".kn-tree-pop .kn-side-item[data-kind='folder']:has-text('Projetos')", name: "abre a pasta Projetos" },
    { expectCount: resumo, count: 1, name: "a nota que o agente criou está na árvore" },
    { click: ".kn-tree-pop .kn-side-item[data-kind='note']:has-text('Kiwi'):not(:has-text('Resumo'))", name: "abre a nota Kiwi" },
    { expectText: editor, text: "O prazo é abril, diz o agente.", name: "a nota com a troca do agente" },
    { screenshot: "1-o-agente-mudou.png" },
    { invoke: "agent.undo", args: { request: write }, name: "desfaz o pedido que trocou o prazo" },
    { expectText: editor, text: "O prazo do Kiwi é março.", timeout: 20000, name: "a janela mostra o texto de antes" },
    { screenshot: "2-desfeito.png" },
    { invoke: "agent.undo", args: { request: create }, name: "desfaz o pedido que criou a nota" },
    { wait: 1500 },
    { click: ".kn-crumb-bt", name: "abre a árvore" },
    { waitFor: ".kn-tree-pop .kn-side-item[data-kind='note']:has-text('Kiwi')", name: "a árvore abriu" },
    { expectCount: resumo, count: 0, name: "a nota criada saiu da árvore (foi para a Lixeira)" },
    { screenshot: "3-criada-na-lixeira.png" },
  ];
  writeFileSync(undoFile, JSON.stringify({ window: "notes", size: "1100x800", steps }, null, 2));
}

let ok = true;
try {
  ok = (await scenario("fluxo", "ajustes-agente.json", {})) && ok;
  ok = (await scenario("nao-instalado", "ajustes-agente-estado.json", { KIWI_FAKE_CLAUDE_VERSION: "x" })) && ok;
  ok = (await scenario("nao-logado", "ajustes-agente-estado.json", { KIWI_FAKE_CLAUDE_LOGGED_IN: "0" })) && ok;
  ok = (await scenario("versao-antiga", "ajustes-agente-estado.json", { KIWI_FAKE_CLAUDE_VERSION: "2.0.9" })) && ok;
  ok = (await scenario("sem-rede", "ajustes-agente-sem-rede.json", { KIWI_ADAPTER_REGISTRY: "http://127.0.0.1:9" })) && ok;
  ok = (await scenario("notas", "ajustes-agente-notas.json", { KIWI_FAKE_AGENT_TOOL_DELAY_MS: "1500" })) && ok;
  ok = (await scenario("escrita", writeScript(), {}, { window: "notes", before: agentReady, prefix: "escrita-" })) && ok;
  ok = (await scenario("desfazer", undoFile, {}, { window: "notes", before: undoReady, prefix: "desfazer-" })) && ok;
} finally {
  reg.stop();
  rmSync(work, { recursive: true, force: true });
}
console.log(`prints em ${out}`);
process.exit(ok ? 0 : 1);
