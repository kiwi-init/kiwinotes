// O Kiwi Cat editando o docx ao vivo (T21231, spec #21155): o app de verdade (o AppEngine headless) com o agente falso
// (`/tool docx_read` e `/tool docx_edit`), num WebKit headless, sem nada na tela de ninguém e sem o agente de verdade.
// O relatório é inventado (o de uma loja de exemplo).
//
// - O gato grava com o docx aberto: a tela toca as mudanças por cima do documento, com o cursor e a etiqueta dele, o
//   texto entrando e o realce que some; ela fica com o texto do arquivo, sem abrir de novo e sem aviso.
// - O parágrafo que ele apaga sai da tela.
// - A pessoa com o cursor no parágrafo que ele quer mudar: ele espera ela sair.
// - A edição da pessoa ainda gravando quando ele grava: ela fica, por cima da versão dele (disco conferido).
// - O que a tela não toca (um parágrafo novo no início): o documento abre do disco, só com o realce.
// - O docx fechado: ao abrir, o realce do que mudou, uma vez só.
// - Os prints, em WebP, e o vídeo de tudo (.webm).
//
//   bun scripts/docx-gato-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { type Page, webkit } from "playwright-core";
import { fakeRegistry } from "../src/agent/fake/registry";
import { docxBodyParagraphs } from "../ui/notes/files/docxText";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21231"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-T21231-"));
const vault = join(data, "vault");
const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

const REL = "Loja/relatorio.docx";
const FECHADO = "Loja/fornecedores.docx";
const docx = async (paras: Paragraph[]) => new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: paras }] })));
put(
  REL,
  await docx([
    new Paragraph({ text: "Relatório da loja", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun("A loja vendeu "), new TextRun({ text: "40 canecas", bold: true }), new TextRun(" em março.")] }),
    new Paragraph("Os cadernos acabaram na segunda semana."),
    new Paragraph("Ana revisa na sexta."),
    new Paragraph("Beto fecha o caixa."),
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
// A gravação da pessoa presa no caminho (o passo da edição ainda gravando): o `files.save` da janela espera o `release`.
let holding = false;
const held: (() => void)[] = [];
const release = () => {
  holding = false;
  for (const go of held.splice(0)) go();
};
const ctx: UiContext = {
  data,
  send: async (msg) => {
    const m = msg as { cmd?: string; cap?: string };
    if (holding && m.cmd === "invoke" && m.cap === "files.save") await new Promise<void>((go) => held.push(go));
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
const waitDisk = async (want: (t: string[]) => boolean, why: string, rel = REL) => {
  for (let n = 0; !want(disk(rel)); n++) {
    assert.ok(n < 200, `${why}: o disco ficou ${JSON.stringify(disk(rel))}`);
    await Bun.sleep(50);
  }
};
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

  const w = await openWindow(browser, ctx, { window: "notes", scale: 1, theme: "light", width: 1000, height: 640, motion: true, browser: "webkit", video: out, query: { note: REL } });
  const p = w.page;
  const surface = ".docx-paginated-surface";
  const screenText = () => p.locator(surface).innerText();
  /** Uma marca no documento montado: some se a tela abrir o arquivo de novo. */
  const tag = () => p.evaluate(() => ((document.querySelector(".docx-paginated-surface")!.firstElementChild as HTMLElement).dataset.probe = "1"));
  const sameMount = () => p.evaluate(() => (document.querySelector(".docx-paginated-surface")!.firstElementChild as HTMLElement | null)?.dataset.probe === "1");
  const settle = () => p.waitForFunction(() => !document.querySelector(".kn-file-docx-kiwi, .kn-file-docx-kiwi-cursor"), null, { timeout: 12000 });
  const clickEnd = async (text: string) => {
    const box = (await p.locator(".docx-page").first().getByText(text).first().boundingBox())!;
    await p.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await p.keyboard.press("End");
  };
  const noNotice = async () => assert.equal(await p.locator(".kn-file-text-note").count(), 0, "sem aviso");
  /** Abre um arquivo pela árvore (o botão "Notas" do topo). */
  const openFile = async (rel: string) => {
    await p.locator(".kn-crumb-bt").click();
    const item = p.locator(`.kn-tree-pop .kn-side-item[data-path="${rel}"]`);
    await item.waitFor({ timeout: 1500 }).catch(() => p.click(".kn-tree-pop button[data-all='expand']"));
    await item.click();
    await p.locator(".kn-tree-pop").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(300);
  };
  try {
    await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
    await p.waitForTimeout(600);
    await tag();
    // A pessoa com o cursor nos cadernos, longe do que o gato muda agora (o documento abre com ele no título).
    await clickEnd("Os cadernos acabaram");

    // 1. O gato troca, reescreve e insere com o docx aberto.
    const cursorShows = p.waitForSelector(".kn-file-docx-kiwi-cursor .kn-kiwi-tag", { timeout: 15000 });
    await catEdits(REL, [
      { tipo: "reescrever", paragrafo: 1, texto: "Relatório de março" },
      { tipo: "trocar", paragrafo: 2, de: "40 canecas", para: "52 canecas" },
      { tipo: "inserir", depois_de: 2, texto: "As canecas azuis saíram mais que as verdes." },
    ]);
    await cursorShows.catch(async (e) => {
      throw new Error(`sem o cursor do gato (mesma montagem: ${await sameMount()}): ${e}`);
    });
    assert.equal((await p.locator(".kn-kiwi-tag").first().innerText()).trim(), "Kiwi");
    await p.waitForFunction(() => document.querySelector(".docx-paginated-surface")?.textContent?.includes("As canecas"), null, { timeout: 8000 });
    assert.ok(Number(await p.locator(".kn-file-docx-kiwi-cursor .kn-kiwi-tag").first().evaluate((t) => getComputedStyle(t).opacity)) > 0.9, "a etiqueta à vista");
    await shot(p, "01-gato-digitando");
    checks.push("o gato grava e a tela toca: o cursor com a etiqueta Kiwi, o texto entrando");
    await p.waitForSelector(".kn-file-docx-kiwi[data-fading]", { timeout: 8000 });
    assert.equal(await p.locator(".kn-file-docx-kiwi-cursor").count(), 0);
    await shot(p, "02-realce");
    await settle();
    const t1 = await screenText();
    for (const s of ["Relatório de março", "A loja vendeu 52 canecas em março.", "As canecas azuis saíram mais que as verdes."]) assert.ok(t1.includes(s), `a tela sem "${s}"`);
    assert.ok(!t1.includes("40 canecas"));
    assert.deepEqual(disk().slice(0, 3), ["Relatório de março", "A loja vendeu 52 canecas em março.", "As canecas azuis saíram mais que as verdes."]);
    assert.ok(await sameMount(), "a tela tocou por cima, sem abrir de novo");
    await noNotice();
    checks.push("no fim o realce some, a tela tem o texto do arquivo, sem abrir de novo e sem aviso (disco conferido)");

    // 2. Apagar um parágrafo.
    await catEdits(REL, [{ tipo: "apagar", paragrafo: 6 }]);
    await p.waitForFunction(() => !document.querySelector(".docx-paginated-surface")?.textContent?.includes("Beto fecha"), null, { timeout: 8000 });
    await settle();
    assert.ok(!disk().includes("Beto fecha o caixa."));
    assert.ok(await sameMount());
    checks.push("o parágrafo que ele apaga sai da tela, sem abrir de novo");

    // 3. O mesmo parágrafo: a pessoa com o cursor na Ana; o gato espera ela sair.
    await clickEnd("Ana revisa na sexta.");
    const before3 = disk();
    await catAsks(REL, [{ tipo: "trocar", paragrafo: 5, de: "sexta", para: "quinta" }]);
    await p.waitForTimeout(1500);
    assert.deepEqual(disk(), before3, "o gato esperou a pessoa sair do parágrafo");
    await shot(p, "03-mesmo-paragrafo-o-gato-espera");
    await clickEnd("Os cadernos acabaram");
    await waitDisk((t) => t.includes("Ana revisa na quinta."), "o gato depois que a pessoa saiu");
    await p.waitForFunction(() => document.querySelector(".docx-paginated-surface")?.textContent?.includes("na quinta"), null, { timeout: 8000 });
    await settle();
    checks.push("mesmo parágrafo: o gato espera a pessoa sair, e só então escreve (disco conferido)");

    // 4. A edição da pessoa ainda gravando quando o gato grava: ela fica, por cima da versão dele.
    holding = true;
    await p.keyboard.type(" Até o dia 20.", { delay: 15 });
    for (let n = 0; !held.length; n++) {
      assert.ok(n < 150, "a gravação da pessoa não saiu");
      await Bun.sleep(20);
    }
    await catEdits(REL, [{ tipo: "trocar", paragrafo: 2, de: "52 canecas", para: "60 canecas" }]);
    await p.waitForFunction(() => document.querySelector(".docx-paginated-surface")?.textContent?.includes("60 canecas"), null, { timeout: 8000 });
    release();
    await waitDisk((t) => t.includes("A loja vendeu 60 canecas em março.") && t.includes("Os cadernos acabaram na segunda semana. Até o dia 20."), "a edição da pessoa e a do gato");
    await settle();
    await noNotice();
    assert.ok(await sameMount(), "sem abrir de novo");
    checks.push("a edição da pessoa ainda gravando: ela grava por cima da versão do gato, nada se perde, sem aviso (disco conferido)");

    // 5. O que a tela não toca: um parágrafo novo no início. O documento abre do disco, só com o realce.
    await catEdits(REL, [{ tipo: "inserir", depois_de: 0, texto: "Rascunho para a reunião" }]);
    await p.waitForSelector(".kn-file-docx-kiwi", { timeout: 10000 });
    assert.equal(await p.locator(".kn-file-docx-kiwi-cursor").count(), 0, "do disco: sem o cursor");
    assert.ok((await screenText()).includes("Rascunho para a reunião"));
    assert.ok(!(await sameMount()), "abriu do disco");
    await shot(p, "04-abre-do-disco-com-realce");
    await settle();
    await noNotice();
    checks.push("o que a tela não sabe tocar: abre do disco, com o realce e sem aviso");

    // 6. O docx fechado: o gato muda o de fornecedores com o relatório na tela. Ao abrir, o realce; na segunda vez, não.
    await catEdits(FECHADO, [{ tipo: "trocar", paragrafo: 3, de: "quintas", para: "sextas" }]);
    await openFile(FECHADO);
    await p.waitForSelector(".kn-file[data-state='ready'] .kn-file-docx-kiwi", { timeout: 15000 });
    assert.equal(await p.locator(".kn-file-docx-kiwi-cursor").count(), 0, "fechado: só o realce");
    assert.ok((await screenText()).includes("Empresa Y entrega às sextas."));
    await shot(p, "05-fechado-realce-ao-abrir");
    await settle();
    await openFile(REL);
    await p.waitForFunction(() => document.querySelector(".kn-file-title")?.textContent?.includes("relatorio"), null, { timeout: 8000 });
    await openFile(FECHADO);
    await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 15000 });
    await p.waitForTimeout(800);
    assert.equal(await p.locator(".kn-file-docx-kiwi").count(), 0, "a segunda abertura sem realce");
    checks.push("docx fechado: ao abrir, o realce do que mudou; na segunda abertura, nada (disco conferido)");
    assert.deepEqual(w.report.problems, [], "problemas na página");
  } catch (e) {
    await shot(p, "falhou").catch(() => {});
    throw e;
  } finally {
    release();
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
