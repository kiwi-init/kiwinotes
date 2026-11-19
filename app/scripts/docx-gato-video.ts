// O vídeo do #21155 (T23627): o gato no docx aberto (uma frase, um parágrafo três páginas abaixo, uma célula) e no
// fechado. Mesmo caminho do docx-gato-check: AppEngine headless, agente falso, WebKit headless. Dados inventados.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { type Page, webkit } from "playwright-core";
import { fakeRegistry } from "../src/agent/fake/registry";
import { docxBodyParagraphs } from "../ui/notes/files/docxText";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T23627"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-T23627-"));
const vault = join(data, "vault");
const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};


const REL = "Loja/estoque.docx";
const FECHADO = "Loja/fornecedores.docx";
const docx = async (children: (Paragraph | Table)[]) => new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
const produtos = ["Canecas", "Cadernos", "Lápis", "Borrachas", "Réguas", "Canetas", "Pastas", "Grampos"];
const cell = (t: string) => new TableCell({ children: [new Paragraph(t)] });
put(
  REL,
  await docx([
    new Paragraph({ text: "Relatório de estoque da loja", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun("A loja vendeu "), new TextRun({ text: "40 canecas", bold: true }), new TextRun(" em março.")] }),
    ...Array.from({ length: 130 }, (_, i) => new Paragraph(`Semana ${i + 1}: ${produtos[i % 8]} conferidos na prateleira ${(i % 5) + 1}, sem falta.`)),
    new Paragraph({ text: "Estoque no fim do mês", heading: HeadingLevel.HEADING_2 }),
    new Table({ rows: [["Produto", "Estoque"], ["Canecas", "12"], ["Cadernos", "0"], ["Lápis", "85"]].map((r) => new TableRow({ children: r.map(cell) })) }),
    new Paragraph("Beto fecha o caixa no sábado."),
  ]),
);
put(FECHADO, await docx([new Paragraph({ text: "Fornecedores", heading: HeadingLevel.HEADING_1 }), new Paragraph("Empresa X entrega às terças."), new Paragraph("Empresa Y entrega às quintas.")]));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
  return text;
}
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
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}

const shot = async (p: Page, name: string) => {
  const png = join(out, `${name}.png`);
  await p.screenshot({ path: png });
  const r = spawnSync("cwebp", ["-quiet", "-q", "85", png, "-o", join(out, `${name}.webp`)]);
  if (r.status === 0) rmSync(png);
};
const disk = (rel = REL) => docxBodyParagraphs(new Uint8Array(readFileSync(join(vault, rel)))).map((p) => p.text);
/** O gato pede a mudança pela ferramenta, como o agente faria: lê, e muda pela versão que leu. Não espera gravar. */
async function catAsks(rel: string, mudancas: unknown[]) {
  const { version } = await invoke("files.read", { path: rel, as: "binary" });
  await invoke("agent.ask", {
    text: [`Acerto o ${rel}.`, `/tool docx_read ${JSON.stringify({ caminho: rel })}`, `/tool docx_edit ${JSON.stringify({ caminho: rel, versao: version, mudancas })}`].join("\n"),
  });
}
/** O gato grava, e o script espera o arquivo mudar no disco. */
async function catEdits(rel: string, mudancas: unknown[]) {
  const before = readFileSync(join(vault, rel));
  await catAsks(rel, mudancas);
  for (let n = 0; Buffer.compare(readFileSync(join(vault, rel)), before) === 0; n++) {
    assert.ok(n < 150, `o gato não gravou ${rel}`);
    await Bun.sleep(50);
  }
}

const checks: string[] = [];
let failed = false;
const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) {
    assert.ok(n < 200);
    await Bun.sleep(100);
  }

  const w = await openWindow(browser, ctx, { window: "notes", scale: 1, theme: "light", width: 1100, height: 720, motion: true, browser: "webkit", video: out, query: { note: REL } });
  const p = w.page;
  const settle = () => p.waitForFunction(() => !document.querySelector(".kn-file-docx-kiwi, .kn-file-docx-kiwi-cursor"), null, { timeout: 12000 });
  /** Abre um arquivo pela árvore (o botão "Notas" do topo). */
  const openFile = async (rel: string) => {
    await p.locator(".kn-crumb-bt").click();
    const item = p.locator(`.kn-tree-pop .kn-side-item[data-path="${rel}"]`);
    await item.waitFor({ timeout: 1500 }).catch(() => p.click(".kn-tree-pop button[data-all='expand']"));
    await item.click();
    // A árvore abre ao passar o mouse: ele sai dela, para ela fechar e não cobrir o documento no print.
    await p.mouse.move(900, 560);
  };

  const n = (t: string, rel = REL) => disk(rel).findIndex((s) => s.startsWith(t)) + 1;
  const scrollTop = () =>
    p.evaluate(() => {
      for (let e = document.querySelector(".docx-paginated-surface") as HTMLElement | null; e; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== "visible") return e.scrollTop;
      return -1;
    });
  try {
    await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
    await p.waitForTimeout(1200);
    // 1. Uma frase no fim de um parágrafo, à vista.
    await catEdits(REL, [{ tipo: "trocar", paragrafo: 2, de: "em março.", para: "em março. As azuis saíram mais que as verdes." }]);
    await p.waitForSelector(".kn-file-docx-kiwi-cursor .kn-kiwi-tag", { timeout: 15000 });
    await shot(p, "1-frase-entrando");
    await settle();
    await p.waitForTimeout(1200);
    // 2. Um parágrafo novo três páginas abaixo: a página rola até lá.
    const top0 = await scrollTop();
    await catEdits(REL, [{ tipo: "inserir", depois_de: n("Semana 100"), texto: "Semana 100, à tarde: chegaram 20 cadernos novos." }]);
    await p.waitForSelector(".kn-file-docx-kiwi-cursor .kn-kiwi-tag", { timeout: 15000 });
    await p.waitForTimeout(700);
    await p.waitForTimeout(1500);
    await shot(p, "2-paragrafo-fora-da-tela");
    const top1 = await scrollTop();
    assert.ok(top1 > top0 + 1000, `a página não rolou: ${top0} -> ${top1}`);
    checks.push(`a página rolou até o parágrafo novo (${top0} -> ${top1} px)`);
    await settle();
    await p.waitForTimeout(1200);
    // 3. Uma linha nova na tabela, abaixo dos cadernos: a tela insere a linha e escreve cada célula.
    await catEdits(REL, [{ tipo: "inserir_linha", depois_de: n("Cadernos"), celulas: ["Borrachas", "30"] }]);
    await p.waitForSelector(".kn-file-docx-kiwi-cursor .kn-kiwi-tag", { timeout: 15000 });
    await p.waitForTimeout(450);
    await shot(p, "3-linha-da-tabela");
    await settle();
    await p.waitForTimeout(1200);
    const t = disk();
    assert.ok(t.includes("A loja vendeu 40 canecas em março. As azuis saíram mais que as verdes."));
    assert.ok(t.includes("Semana 100, à tarde: chegaram 20 cadernos novos."));
    const c = n("Cadernos");
    assert.deepEqual(t.slice(c - 1, c + 3), ["Cadernos", "0", "Borrachas", "30"]);
    const tela = await p.evaluate(() => document.querySelector(".kn-file .docx-paginated-surface")!.textContent!.includes("Borrachas"));
    assert.ok(tela, "a linha nova não está na tela");
    checks.push("frase, parágrafo e linha da tabela no disco e na tela");
    // 4. O docx fechado: ao abrir, o realce.
    await catEdits(FECHADO, [{ tipo: "trocar", paragrafo: 3, de: "quintas", para: "sextas" }]);
    await p.waitForTimeout(800);
    await openFile(FECHADO);
    await p.waitForSelector(".kn-file[data-state='ready'] .kn-file-docx-kiwi", { timeout: 15000 });
    await p.waitForTimeout(400);
    await shot(p, "4-fechado-realce-ao-abrir");
    await settle();
    await p.waitForTimeout(1000);
    checks.push("docx fechado: o realce ao abrir");
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } catch (e) {
    await shot(p, "falhou").catch(() => {});
    throw e;
  } finally {
    await w.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop();
}
for (const c of checks) console.log(`ok     ${c}`);
console.log(failed ? "FALHOU" : `ok: ${out}`);
process.exit(failed ? 1 : 0);
