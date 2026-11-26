// A memória, as rotinas, o placar, as trilhas, as respostas, as propostas e a Atividade do agente em inglês (T29272,
// spec #28171). No hub de verdade, com o AppEngine headless e o agente de mentira (`KIWI_FAKE_AGENT`), num WebKit
// headless: nada aparece na tela de ninguém. A escolha da língua vai ligada só aqui (`KIWI_LANGUAGE_CHOICE=1`), enquanto
// o app a esconde. Em cada parte, nenhuma frase em português do catálogo dela (`activity.pt.ts` e `common.pt.ts`) pode
// aparecer, algumas frases em inglês têm de aparecer, e o print fica na pasta.
//
//   bun scripts/agent-english-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, settingsTab, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { enActivity } from "../src/shared/i18n/activity.en.ts";
import { enAgent } from "../src/shared/i18n/agent.en.ts";
import { ptAgent } from "../src/shared/i18n/agent.pt.ts";
import { ptActivity } from "../src/shared/i18n/activity.pt.ts";
import { enCommon } from "../src/shared/i18n/common.en.ts";
import { ptCommon } from "../src/shared/i18n/common.pt.ts";
import type { Entry } from "../src/shared/i18n/index.ts";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T29272-english"));
mkdirSync(out, { recursive: true });
// O placar é dos Ajustes do agente (T29271, `agent.placar.*`).
const placarOnly = <T extends object>(part: T) => Object.fromEntries(Object.entries(part).filter(([k]) => k.startsWith("agent.placar."))) as Record<string, Entry>;
const EN = { ...enCommon, ...enActivity, ...placarOnly(enAgent) } as Record<string, Entry>;
type PlacarKey = Extract<keyof typeof enAgent, `agent.placar.${string}`>;
const en = (key: keyof typeof enActivity | keyof typeof enCommon | PlacarKey) => EN[key] as string;

/** Os pedaços em português que não podem aparecer: o maior trecho de cada frase entre os `{params}`, com 12 letras ou mais. */
const PT_PIECES = (() => {
  const forms = (e: Entry) => (typeof e === "string" ? [e] : Object.values(e));
  const pieces = new Set<string>();
  for (const [key, pt] of Object.entries({ ...ptCommon, ...ptActivity, ...placarOnly(ptAgent) }) as [string, Entry][]) {
    const enForms = forms(EN[key]!);
    for (const f of forms(pt)) {
      if (enForms.includes(f)) continue;
      const longest = f.split(/\{\w+\}/).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0] ?? "";
      if (longest.length >= 12) pieces.add(longest);
    }
  }
  return [...pieces];
})();

const data = mkdtempSync(join(tmpdir(), "kiwi-agent-english-"));
writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, language: "en" }));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages, KIWI_SYSTEM_LANG: "en-US", KIWI_LANGUAGE_CHOICE: "1" };
const cli = async (args: string[]) => {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe", env });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
};
const ctx: UiContext = {
  data,
  send: async (msg) => {
    const r = await request(data, msg);
    assert.ok(r);
    return r;
  },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => {
      if (!("id" in line)) onMsg(line);
    });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
const invoke = async (cap: string, args: unknown = {}) => {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
};
const idle = async () => {
  for (let n = 0; (await invoke("agent.status")).busy; n++) {
    assert.ok(n < 300, "o agente não terminou");
    await Bun.sleep(100);
  }
};

const problems: string[] = [];
const shots: string[] = [];
/** Uma parte da tela em inglês: nenhum pedaço do catálogo em português, as frases pedidas em inglês, e o print dela. */
async function check(p: Page, sel: string, name: string, want: (string | RegExp)[]) {
  const el = p.locator(sel).first();
  await el.waitFor({ timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  await Bun.sleep(400);
  // O `textContent`, não o `innerText`: o título da seção é maiúsculo só pelo CSS.
  const text = (await el.textContent()) ?? "";
  for (const piece of PT_PIECES) if (text.includes(piece)) problems.push(`${name}: "${piece}"`);
  for (const w of want) if (typeof w === "string" ? !text.includes(w) : !w.test(text)) problems.push(`${name}: falta "${w}"`);
  const file = join(out, `${name}.png`);
  await el.screenshot({ path: file });
  shots.push(file);
}
const section = (title: string) => `.kn-section:has(h2:text-is("${title}"))`;

const browser = await webkit.launch({ headless: true });
await cli(["start", "--no-helper"]);
let page: Page | null = null;
try {
  assert.equal((await invoke("app.locale")).locale, "en", "o app devia estar em English");
  await invoke("agent.enable", { consent: true });
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) {
    assert.ok(n < 200, "o adaptador de mentira não ficou pronto");
    await Bun.sleep(100);
  }

  // Os dados: uma nota para o faro, um projeto para a mudança, a memória, uma rotina nova e os pedidos.
  await invoke("notes.create", { folder: "Projetos", title: "Exemplo", content: "# Exemplo\n\n## Prazo\n\nO prazo do Exemplo é março, pelo cronograma.\n" });
  await invoke("notes.create", { folder: "Kiwi", title: "Kiwi", content: "# Kiwi\n\n## Prazo\n\nMarço.\n" });
  await invoke("projects.mark", { folder: "Kiwi" });
  await invoke("agent.routineCreate", { name: "Weekly review", prompt: "List what is due this week.", time: "18:30", days: [1, 3, 5], folder: "Rotinas" });
  for (const text of [
    "Qual é o prazo do Exemplo?",
    "o que tem sobre o cronograma de março?",
    "lembra que eu prefiro respostas curtas",
    'Mude o prazo do Kiwi\n/tool project_diary_add {"projeto":"Kiwi","texto":"Prazo novo: abril."}',
  ]) {
    await invoke("agent.ask", { text });
    await idle();
  }

  // Ajustes › Agente: a memória, as rotinas, o placar, as trilhas e as respostas.
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 900, height: 2600, motion: false, browser: "webkit", query: { section: "settings", topic: "agent", tab: "memory" } });
  const p = w.page;
  page = p;
  await check(p, ".kn-agent-memory", "1-memoria", [en("mem.clearAll"), "1 of"]);
  await check(p, ".kn-agent-routines", "2-rotinas", [en("routines.title"), en("routines.runNow"), "Mon, Wed and Fri at 6:30 PM"]);
  // A hora do placar é a de agora: AM antes do meio-dia, PM depois (T30888; o " PM" fixo caía em todo run da manhã).
  // O placar fica no medidor de uso, na aba Avançado; as trilhas e as respostas, na Memória (spec #31754).
  await settingsTab(p, "agent", "advanced");
  await check(p, section(en("agent.placar.section")), "3-placar", [en("agent.placar.section"), en("agent.placar.found"), en("agent.placar.col.last"), /\d:\d\d [AP]M/]);
  await settingsTab(p, "agent", "memory");
  await check(p, section(en("trails.learning")), "4-trilhas", [en("trails.waiting"), "· once"]);
  await check(p, section(en("answers.title")), "5-respostas", [en("answers.none")]);
  await w.close();

  // A proposta da rotina, depois dos Ajustes: o balão dela não cobre as seções de cima.
  await invoke("agent.ask", { text: "todo dia às 7h, faz a lista do que vence hoje" });
  await idle();

  // A Atividade do agente: os pedidos, a mudança, a memória e a proposta da rotina.
  const a = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 900, height: 2600, motion: false, browser: "webkit", query: { section: "settings", topic: "activity" } });
  page = a.page;
  await check(a.page, ".kn-activity-list, .kn-activity-empty", "6-atividade", [en("common.undo"), en("common.see"), "today, ", "Read 1 note", "Noted in the memory"]);
  await check(a.page, ".kn-proposal", "7-proposta", [en("proposal.create"), en("proposal.adjust"), en("common.discard"), "Kiwi proposes the routine"]);
  await a.close();
} catch (e) {
  // O print de onde parou, para ver o porquê.
  await page?.screenshot({ path: join(out, "falhou.png") }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop();
}

console.log(JSON.stringify({ out, shots: shots.length, pieces: PT_PIECES.length, problems }, null, 2));
// A saída explícita: um socket que sobra (do registro ou do WebKit) não segura o processo até o timeout do CI.
process.exit(problems.length ? 1 : 0);
