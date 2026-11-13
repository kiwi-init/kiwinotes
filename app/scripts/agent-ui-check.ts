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
// - a tela "Atividade do agente" (spec #9480), em Ajustes › Agente: cinco pedidos do agente falso (só leu; trocou o
//   prazo; duas escritas na mesma nota; criou uma nota; acrescentou numa nota que a pessoa editou depois), a lista, o
//   [Ver] da 1ª de duas escritas, os desfazer recusados com o motivo, o pedido inteiro desfeito, um desfazer de fora
//   que a lista vê sozinha, um pedido novo que aparece sozinho, o agente desligado, o teclado e o escuro. O roteiro é
//   montado depois dos pedidos, com o id de cada um. E a seção vazia, com o agente desligado (`atividade-vazia`), e o
//   pedido que passa dos 30 dias com a tela aberta (`atividade-prazo`).
// - o filtro do guardrail (spec #9818), em Ajustes › Agente: uma nota com um token e uma senha inventados; o agente
//   falso lê (e recebe os marcadores), troca a seção da senha sem o marcador, e um pedido chega com um token colado. A
//   Atividade diz quantos segredos o Kiwi segurou e onde, e avisa a escrita que tirou um segredo (`guardrail`).
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

/** O roteiro da Atividade do agente (spec #9480): sai do `activityReady`, que sabe o id dos pedidos. */
const activityFile = path.join(work, "ajustes-atividade.json");

/** Antes da janela: o agente pronto, a nota Ideias, e os cinco pedidos dele, já terminados. */
async function activityReady(data: string, env: Record<string, string>): Promise<void> {
  await agentReady(data, env);
  const invoke = async (cap: string, args: unknown) => {
    const r = await cli(["invoke", cap, JSON.stringify(args), "--data", data], env);
    if (r.code !== 0) throw new Error(`${cap}: ${r.out}`);
    return JSON.parse(r.out) as { value: any };
  };
  const tool = (name: string, args: unknown) => `/tool ${name} ${JSON.stringify(args)}`;
  const ask = async (text: string) => {
    const { id } = (await invoke("agent.ask", { text })).value as { id: string };
    for (const end = Date.now() + 30_000; ; ) {
      const done = (await cli(["events", "--data", data], env)).out
        .split("\n")
        .some((l) => l.includes('"agent.turn"') && l.includes(`"${id}"`) && /"type":"(done|error)"/.test(l));
      if (done) return id;
      if (Date.now() > end) throw new Error(`o pedido não terminou: ${text}`);
      await Bun.sleep(200);
    }
  };
  await invoke("notes.create", { title: "Ideias", content: "# Ideias\n\n- um app de notas que escuta\n" });
  const kiwi = "Projetos/Kiwi.md";
  const read = await ask(`Qual é o prazo do Kiwi?\n${tool("notes_read", { path: kiwi })}`);
  const prazo = await ask(
    `Mude o prazo do Kiwi para abril\n${tool("notes_read", { path: kiwi })}\n${tool("notes_write", { path: kiwi, section: "Prazo", text: "O prazo do Kiwi é abril.", version: versionOf(KIWI) })}`,
  );
  const ideias = await ask(
    `Anote duas ideias para o gato\n${tool("notes_append", { path: "Ideias.md", text: "- o gato acorda quando o agente pensa" })}\n${tool("notes_append", { path: "Ideias.md", text: "- o gato dorme depois de 5 minutos" })}`,
  );
  const resumo = await ask(`Faça um resumo do Kiwi\n${tool("notes_create", { folder: "Projetos", title: "Resumo do Kiwi", text: "# Resumo do Kiwi\n\nPrazo: abril.\n" })}`);
  const equipe = await ask(`Ponha o gato na equipe\n${tool("notes_append", { path: kiwi, section: "Equipe", text: "E o Kiwi-cat." })}`);
  // A pessoa escreve no Kiwi depois do agente: o desfazer do último pedido não pode passar por cima.
  const now = (await invoke("notes.get", { path: kiwi })).value as { content: string; version: string };
  await invoke("notes.save", { path: kiwi, content: `${now.content}\nUma linha da pessoa.\n`, baseVersion: now.version });
  void read;

  const section = ".kn-section:has(h2:text-is('Atividade do agente'))";
  const req = (id: string) => `${section} .kn-activity-req[data-request='${id}']`;
  const steps = [
    { waitFor: ".kn-tab", name: "o hub abre" },
    { click: ".kn-tab:has-text('Configurações')" },
    { waitFor: section, name: "a seção Atividade do agente" },
    { expectCount: `${section} .kn-activity-req`, count: 5, name: "os cinco pedidos" },
    { expectText: `${section} .kn-activity-req:first-child .kn-activity-text`, text: "Ponha o gato na equipe", name: "do mais novo ao mais velho" },
    { expectText: req(prazo), text: "Mude o prazo do Kiwi para abril", name: "o começo do pedido, sem as linhas do agente falso" },
    { expectText: req(prazo), text: "Leu 1 nota.", name: "o que foi lido" },
    { expectText: req(prazo), text: "Trocou Projetos/Kiwi › Prazo", name: "a mudança, com a seção" },
    { expectText: req(read), text: "Não mudou nada.", name: "o pedido que só leu" },
    { expectText: req(resumo), text: "Criou Projetos/Resumo do Kiwi", name: "a nota criada" },
    { screenshot: "1-lista.png", selector: section },
    { click: `${req(ideias)} .kn-activity-change:first-child button:has-text('Ver')`, name: "[Ver] da 1ª de duas escritas na mesma nota" },
    { expectText: `${req(ideias)} .kn-activity-view .kn-diff-add`, text: "o gato acorda quando o agente pensa", name: "a linha que a 1ª escrita pôs" },
    { expectCount: `${req(ideias)} .kn-activity-view .kn-diff-add`, count: 1, name: "só ela: não a 2ª escrita" },
    { click: `${req(prazo)} .kn-activity-change:first-child button:has-text('Ver')`, name: "[Ver] da troca do prazo" },
    { expectText: `${req(prazo)} .kn-activity-view .kn-diff-del`, text: "O prazo do Kiwi é março.", name: "o antes, riscado" },
    { expectText: `${req(prazo)} .kn-activity-view .kn-diff-add`, text: "O prazo do Kiwi é abril.", name: "o que o agente deixou" },
    // A pessoa e o agente mexeram no Kiwi depois, mas a escrita seguinte do agente guardou a cópia: o depois é exato.
    { expectCount: `${req(prazo)} .kn-activity-view .kn-activity-notice`, count: 0, name: "o depois é o texto exato do agente, sem aviso" },
    { screenshot: "2-ver.png", selector: section },
    { click: `${req(prazo)} .kn-activity-change:first-child button:has-text('Desfazer')`, name: "desfaz a troca do prazo" },
    { expectText: `${req(prazo)} .kn-activity-outcome`, text: "Desfaça antes aquele pedido", name: "recusado: o agente escreveu de novo no Kiwi depois" },
    { expectText: `${req(prazo)} .kn-activity-outcome`, text: "no pedido de hoje, ", name: "pela hora do pedido, não por um código" },
    { click: `${req(equipe)} .kn-activity-change:first-child button:has-text('Desfazer')`, name: "desfaz o pedido da equipe" },
    { expectText: `${req(equipe)} .kn-activity-outcome`, text: "mudou depois do agente, então ficou como está", name: "recusado: a pessoa escreveu depois" },
    { expectCount: `${req(equipe)} button:has-text('Desfazer')`, count: 1, name: "nada mudou: o botão continua" },
    { expectCount: `${req(prazo)} .kn-activity-view .kn-diff-add`, count: 1, name: "e o [Ver] aberto continua, porque nada mudou" },
    { screenshot: "3-recusado.png", selector: section },
    { click: `${req(ideias)} button:has-text('Desfazer o pedido')`, name: "desfaz o pedido inteiro das ideias" },
    { expectText: `${req(ideias)} .kn-activity-outcome`, text: "Ideias voltou ao texto de antes.", name: "a nota voltou" },
    { expectCount: `${req(ideias)} .kn-activity-undone`, count: 2, name: "as duas mudanças dizem Desfeito, com a hora" },
    { expectCount: `${req(ideias)} button:has-text('Desfazer')`, count: 0, name: "e os botões somem, o do pedido também" },
    { screenshot: "4-desfeito.png", selector: section },
    { invoke: "agent.undo", args: { request: resumo }, name: "um desfazer por fora (como a CLI): a nota criada vai para a Lixeira" },
    { waitFor: `${req(resumo)} .kn-activity-undone`, timeout: 10000, name: "a lista vê sozinha" },
    { invoke: "agent.ask", args: { text: `Releia a equipe\n${tool("notes_read", { path: kiwi })}` }, name: "um pedido novo" },
    { expectCount: `${section} .kn-activity-req`, count: 6, timeout: 20000, name: "aparece sozinho na lista" },
    { wait: 1500 },
    { invoke: "agent.disable", args: {}, name: "desliga o agente" },
    { waitFor: section, name: "a seção continua com o agente desligado" },
    // Pelo teclado: o Tab chega ao [Ver] (no WebKit, o Alt+Tab, como o Tab do Safari com o acesso total pelo teclado), e o
    // Enter abre e fecha.
    { click: `${req(resumo)} .kn-activity-when`, name: "o ponto de partida do Tab: a hora do pedido" },
    { press: "Alt+Tab", name: "o Tab vai para o [Ver]" },
    { expectText: `${req(resumo)} button:focus`, text: "Ver", name: "o foco está no [Ver]" },
    { press: "Enter", name: "o Enter abre o [Ver] da nota criada, já desfeita" },
    { expectText: `${req(resumo)} .kn-activity-view`, text: "nas Versões da nota", name: "o aviso do desfeito" },
    { press: "Enter", name: "o Enter fecha" },
    { expectCount: `${req(resumo)} .kn-activity-view`, count: 0, name: "fechado" },
    {
      invoke: "settings.set",
      args: { appearance: { mode: "dark", darkTheme: "channels-oled", lightTheme: "channels-light", textSize: "default", font: "system", motion: "full" } },
      name: "o escuro",
    },
    { waitFor: "html[data-theme='dark'] body", name: "a janela pinta no escuro" },
    // O [Ver] do prazo continua aberto: o desfazer dele foi recusado, e nada mudou.
    { expectCount: `${req(prazo)} .kn-activity-view`, count: 1, name: "o [Ver] do prazo, aberto desde antes da recusa" },
    { screenshot: "5-escuro.png", selector: section },
  ];
  writeFileSync(activityFile, JSON.stringify({ window: "hub", size: "900x2200", steps }, null, 2));
}

/** A seção vazia, com o agente desligado: ela aparece, e diz em uma linha que o agente ainda não fez nada. */
function emptyActivityScript(): string {
  const section = ".kn-section:has(h2:text-is('Atividade do agente'))";
  const steps = [
    { waitFor: ".kn-tab", name: "o hub abre" },
    { click: ".kn-tab:has-text('Configurações')" },
    { waitFor: section, name: "a seção aparece com o agente desligado" },
    { expectText: section, text: "O agente ainda não fez nada.", name: "e diz que ainda não há nada" },
    { expectCount: `${section} .kn-activity-req`, count: 0 },
    { screenshot: "vazia.png", selector: section },
  ];
  const file = path.join(work, "ajustes-atividade-vazia.json");
  writeFileSync(file, JSON.stringify({ window: "hub", size: "900x1400", steps }, null, 2));
  return file;
}

/**
 * O pedido que passa dos 30 dias com a tela aberta (revisão do T9493): um pedido gravado direto no registro, a 30 dias
 * menos 45 s, sem agente. A seção abre com ele; passado o prazo, o [Desfazer] diz que não há mais o que desfazer, fora
 * da lista, e o pedido sai dela.
 */
const EXPIRES_IN_MS = 45_000;
async function expiringReady(data: string): Promise<void> {
  const at = new Date(Date.now() - 30 * 24 * 3600_000 + EXPIRES_IN_MS);
  const iso = at.toISOString();
  const dir = path.join(data, "agent", "activity", `${iso.replace(/[:.]/g, "-")}_velho`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "copy-1.md"), "# Ideias\n");
  writeFileSync(
    path.join(dir, "request.json"),
    JSON.stringify({
      id: "velho",
      at: iso,
      request: "Um pedido de quase 30 dias",
      reads: [],
      copies: 1,
      changes: [{ at: iso, kind: "appended", path: "Ideias.md", before: 9, after: 20, version: versionOf("# Ideias\n- do agente\n"), copy: "velho/copy-1.md" }],
    }),
  );
}
function expiringScript(): string {
  const section = ".kn-section:has(h2:text-is('Atividade do agente'))";
  const req = `${section} .kn-activity-req[data-request='velho']`;
  const steps = [
    { waitFor: ".kn-tab", name: "o hub abre" },
    { click: ".kn-tab:has-text('Configurações')" },
    { waitFor: req, name: "o pedido de quase 30 dias está na lista" },
    // O roteiro espera no máximo 10 s por passo: o prazo passa em vários.
    ...Array.from({ length: Math.ceil((EXPIRES_IN_MS + 3000) / 10_000) }, () => ({ wait: 10_000, name: "o prazo passa com a tela aberta" })),
    { click: `${req} button:has-text('Desfazer')`, name: "o clique depois do prazo" },
    { expectText: `${section} .kn-activity-gone`, text: "passou dos 30 dias: não há mais o que desfazer", name: "a seção diz, fora da lista" },
    { expectCount: req, count: 0, name: "e tira o pedido da lista" },
    { expectCount: `${section} .kn-activity-empty`, count: 0, name: "sem dizer que o agente nunca fez nada" },
    { screenshot: "prazo.png", selector: section },
  ];
  const file = path.join(work, "ajustes-atividade-prazo.json");
  writeFileSync(file, JSON.stringify({ window: "hub", size: "900x1400", steps }, null, 2));
  return file;
}

/** O roteiro do filtro do guardrail (spec #9818): sai do `guardrailReady`. */
const guardrailFile = path.join(work, "ajustes-guardrail.json");
// Inventados, no formato de verdade.
const FAKE_GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const ACESSOS = `# Acessos\n\n## PACS\n\nservidor srv-pacs-01 (10.0.0.12)\nsenha: Kiwi#2024\n\n## GitHub\n\ntoken: ${FAKE_GH}\n`;

async function guardrailReady(data: string, env: Record<string, string>): Promise<void> {
  await agentReady(data, env);
  const invoke = async (cap: string, args: unknown) => {
    const r = await cli(["invoke", cap, JSON.stringify(args), "--data", data], env);
    if (r.code !== 0) throw new Error(`${cap}: ${r.out}`);
    return JSON.parse(r.out) as { value: any };
  };
  const tool = (name: string, args: unknown) => `/tool ${name} ${JSON.stringify(args)}`;
  /** Um pedido até o fim; devolve o texto que o agente falso respondeu. */
  const ask = async (text: string) => {
    const { id } = (await invoke("agent.ask", { text })).value as { id: string };
    for (const end = Date.now() + 30_000; ; ) {
      const done = (await cli(["events", "--data", data], env)).out
        .split("\n")
        .find((l) => l.includes('"agent.turn"') && l.includes(`"${id}"`) && /"type":"(done|error)"/.test(l));
      if (done) return (JSON.parse(done.slice(done.indexOf("{"))).payload?.text as string) ?? "";
      if (Date.now() > end) throw new Error(`o pedido não terminou: ${text}`);
      await Bun.sleep(200);
    }
  };
  await invoke("notes.create", { title: "Acessos", content: ACESSOS });
  const said = await ask(`Leia os acessos do PACS\n${tool("notes_read", { path: "Acessos.md" })}`);
  if (said.includes(FAKE_GH) || said.includes("Kiwi#2024")) throw new Error("o segredo chegou ao agente");
  const versao = /"versao":"([0-9a-f]{16})"/.exec(said)?.[1];
  if (!versao) throw new Error(`sem a versão na leitura: ${said}`);
  await ask(`Anote que a senha do PACS foi trocada\n${tool("notes_write", { path: "Acessos.md", section: "PACS", text: "servidor srv-pacs-01 (10.0.0.12)\nsenha: trocada em novembro", version: versao })}`);
  await ask(`Guarde este token na nota: ${FAKE_GH}`);
  await invoke("agent.disable", {});
  const section = ".kn-section:has(h2:text-is('Atividade do agente'))";
  const steps = [
    { waitFor: ".kn-tab", name: "o hub abre" },
    { click: ".kn-tab:has-text('Configurações')" },
    { waitFor: section, name: "a seção Atividade do agente" },
    { expectText: section, text: "O Kiwi segurou 2 segredos em Acessos.", name: "a leitura: 2 segredos segurados na nota" },
    { expectText: section, text: "O Kiwi segurou 1 segredo no pedido.", name: "o pedido com um token colado" },
    { expectText: section, text: "Esta mudança tirou 1 segredo da nota.", name: "a escrita que tirou a senha, avisada" },
    { expectText: section, text: "Guarde este token na nota: ‹segredo", name: "o pedido aparece já filtrado" },
    { screenshot: "guardrail.png", selector: section },
  ];
  writeFileSync(guardrailFile, JSON.stringify({ window: "hub", size: "900x1600", steps }, null, 2));
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
  ok = (await scenario("atividade", activityFile, {}, { before: activityReady, prefix: "atividade-" })) && ok;
  ok = (await scenario("atividade-vazia", emptyActivityScript(), {}, { prefix: "atividade-" })) && ok;
  ok = (await scenario("atividade-prazo", expiringScript(), {}, { before: expiringReady, prefix: "atividade-" })) && ok;
  ok = (await scenario("guardrail", guardrailFile, {}, { before: guardrailReady, prefix: "guardrail-" })) && ok;
} finally {
  reg.stop();
  rmSync(work, { recursive: true, force: true });
}
console.log(`prints em ${out}`);
process.exit(ok ? 0 : 1);
