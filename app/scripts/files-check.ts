// Os arquivos do agente (spec #11549, T11691–T11693): o agente lê uma planilha, um documento e um pdf do cofre, o
// segredo de um csv vira o marcador, e o Kiwi gera xlsx, docx e pdf com o que o agente manda, com a Atividade
// ([Abrir no Finder] e [Desfazer] para a Lixeira) e as licenças na tela Sobre. No hub de verdade, com o AppEngine
// headless e o agente falso, num WebKit headless. Os arquivos de exemplo são criados aqui, num tmp; nada na tela de
// ninguém (o [Abrir no Finder] não é clicado), nada no Claude Code de verdade.
//
//   bun scripts/files-check.ts [pasta]
//
// Sai na pasta: `arquivos.webp` (a folha com os prints) e `arquivos.mp4` (o vídeo do balão).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import * as XLSX from "xlsx";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11549-files"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-files-"));
const vault = join(data, "vault");
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
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
async function idle() {
  for (let n = 0; (await invoke("agent.status")).busy; n++) { assert.ok(n < 300); await Bun.sleep(100); }
}
/** Manda um pedido e devolve o texto da resposta (o `done` do `agent.turn`, pelos eventos da CLI). */
async function ask(text: string): Promise<string> {
  const { id } = (await invoke("agent.ask", { text })) as { id: string };
  for (const end = Date.now() + 30_000; ; ) {
    const done = (await cli(["events"]))
      .split("\n")
      .find((l) => l.includes('"agent.turn"') && l.includes(`"${id}"`) && /"type":"(done|error)"/.test(l));
    if (done) {
      await idle();
      return (JSON.parse(done.slice(done.indexOf("{"))).payload?.text as string) ?? "";
    }
    assert.ok(Date.now() < end, `o pedido não terminou: ${text}`);
    await Bun.sleep(200);
  }
}
const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

// Os arquivos de exemplo: inventados aqui, nunca de verdade.
async function samples() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Mês", "Exames"], ...Array.from({ length: 2400 }, (_, i) => [`Dia ${i + 1}`, 100 + (i % 50)])]), "Exames");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Total"], [253_000]]), "Resumo");
  put("Dados/exames.xlsx", new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
  put("Dados/contas.csv", "Serviço;Nota\nCI;ghp_0123456789abcdefghijABCDEFGHIJ012345\nBackup;ok\n");
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: "Plano de migração", heading: HeadingLevel.HEADING_1 }), new Paragraph("Começamos pelo arquivo de 2019.")] }] });
  put("Docs/plano.docx", new Uint8Array(await Packer.toBuffer(doc)));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const t of ["Laudo de teste: página um", "Laudo de teste: página dois"]) pdf.addPage([595, 842]).drawText(t, { x: 50, y: 780, size: 14, font });
  put("Docs/laudo.pdf", await pdf.save());
  const blank = await PDFDocument.create();
  blank.addPage([595, 842]);
  put("Docs/escaneado.pdf", await blank.save());
}

const shots: { file: string; caption: string }[] = [];
async function cornerShot(p: Page, sel: string, file: string, caption: string) {
  await Bun.sleep(400);
  const b = await p.locator(sel).first().boundingBox();
  const c = await p.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c, `${sel} e o gato na tela`);
  const x = Math.min(b.x, c.x) - 16;
  const y = Math.min(b.y, c.y) - 16;
  await p.screenshot({ path: join(out, file), clip: { x, y, width: Math.max(b.x + b.width, c.x + c.width) - x + 16, height: Math.max(b.y + b.height, c.y + c.height) - y + 16 } });
  shots.push({ file, caption });
}
/** Espera o balão da resposta com um texto. */
async function bubble(p: Page, has: string) {
  await p.waitForFunction((t) => [...document.querySelectorAll(".kn-bubble-ghost")].some((e) => e.textContent?.includes(t)), has, { timeout: 30000 });
  await Bun.sleep(1200);
}

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await samples();
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const videoDir = join(out, "video");
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 760, motion: false, browser: "webkit", query: { section: "about" }, video: videoDir });
  const q = h.page;
  await q.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });

  // 1. A planilha: o sumário (as abas) e a 1ª parte, com o cabeçalho.
  const xlsx = await ask("/ler-arquivo Dados/exames.xlsx");
  assert.ok(xlsx.includes("Li Dados/exames.xlsx (xlsx, 2 aba(s))") && xlsx.includes("| Mês | Exames |"), xlsx);
  await bubble(q, "Li Dados/exames.xlsx");
  await cornerShot(q, ".kn-bubble", "1-planilha.png", "1. O agente lê a planilha: as abas e a 1ª parte, com o cabeçalho");
  report.checks.push("files_read: the xlsx with two sheets, the summary and the first part with the header");

  // 2. O segredo do csv vira o marcador antes de ir ao agente.
  const csv = await ask("/ler-arquivo Dados/contas.csv");
  assert.ok(/\| CI \| ‹segredo [^›]+› \|/.test(csv) && !csv.includes("ghp_"), csv);
  await bubble(q, "Li Dados/contas.csv");
  // A resposta inteira, para o marcador aparecer no print.
  await q.locator(".kn-bubble-more").first().click();
  await q.waitForSelector(".kn-bubble-big", { timeout: 15000 });
  await q.waitForFunction(() => document.querySelector(".kn-bubble-big")?.textContent?.includes("‹segredo"), undefined, { timeout: 15000 });
  await cornerShot(q, ".kn-bubble-big", "2-segredo.png", "2. O segredo de um csv vira o marcador: o token não vai ao agente");
  await q.keyboard.press("Escape");
  report.checks.push("the guardrail: a token in a csv cell reaches the agent as the marker");

  // O docx e o pdf (com o aviso do pdf sem texto) só conferidos, sem print.
  assert.ok((await ask("/ler-arquivo Docs/plano.docx")).includes("# Plano de migração"));
  assert.ok((await ask("/ler-arquivo Docs/laudo.pdf")).includes("Laudo de teste: página um"));
  assert.ok((await ask("/ler-arquivo Docs/escaneado.pdf")).includes("Li Docs/escaneado.pdf (pdf, 1 página(s))"));
  const outside = await ask("/ler-arquivo ../fora.csv");
  assert.ok(outside.includes("E_OUTSIDE_VAULT"), outside);
  report.checks.push("the docx with its headings, the pdf page by page, a pdf without text, and a path outside the vault refused");

  // 3. O Kiwi gera xlsx, docx e pdf; cada um relido pelo files_read.
  for (const f of ["xlsx", "docx", "pdf", "csv", "txt"]) {
    const made = await ask(`/gerar-arquivo ${f} Saída/Exames`);
    assert.equal(made, `Gerei Saída/Exames.${f}.`);
    assert.ok(existsSync(join(vault, `Saída/Exames.${f}`)));
    const back = await ask(`/ler-arquivo Saída/Exames.${f}`);
    assert.ok(back.includes("Outubro") || back.includes("Relatório da migração"), `${f}: ${back}`);
  }
  await bubble(q, "Li Saída/Exames.txt");
  report.checks.push("files_create: xlsx, docx, pdf, csv and txt, each read back by files_read");
  report.problems.push(...h.report.problems);
  await h.close();

  // 4. A Atividade: o arquivo criado com [Abrir no Finder] e [Desfazer]; o [Desfazer] manda para a Lixeira.
  const s = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1600, motion: false, browser: "webkit", query: { section: "settings" } });
  const p = s.page;
  const req = (await invoke("agent.activity", {})).requests.find((r: any) => r.changes?.[0]?.path === "Saída/Exames.pdf");
  assert.ok(req, "o pedido que gerou o pdf");
  const item = `.kn-activity-req[data-request='${req.id}']`;
  await p.waitForSelector(item, { timeout: 15000 });
  const row = (await p.locator(item).textContent()) ?? "";
  assert.ok(row.includes("Criou Saída/Exames.pdf") && row.includes("Abrir no Finder") && row.includes("Desfazer") && !row.includes("Ver"), row);
  await p.locator(item).scrollIntoViewIfNeeded();
  await Bun.sleep(300);
  await p.locator(item).screenshot({ path: join(out, "3-atividade.png") });
  shots.push({ file: "3-atividade.png", caption: "3. O pdf gerado na Atividade: [Abrir no Finder] e [Desfazer]" });
  await p.locator(`${item} button:has-text('Desfazer')`).first().click();
  await p.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("Lixeira"), item, { timeout: 15000 });
  assert.ok(!existsSync(join(vault, "Saída/Exames.pdf")), "o [Desfazer] tirou o pdf do cofre");
  await Bun.sleep(300);
  await p.locator(item).screenshot({ path: join(out, "4-desfeito.png") });
  shots.push({ file: "4-desfeito.png", caption: "4. [Desfazer]: o pdf foi para a Lixeira" });
  report.checks.push("Activity: the generated file with [Abrir no Finder] and [Desfazer]; [Desfazer] sends it to the Trash");
  report.problems.push(...s.report.problems);
  await s.close();

  // 5. As licenças novas na tela Sobre.
  const a = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1200, motion: false, browser: "webkit", query: { section: "about" } });
  await a.page.waitForSelector(".kn-about-credits", { timeout: 15000 });
  const credits = (await a.page.locator(".kn-about-credits").textContent()) ?? "";
  assert.ok(credits.includes("pdf-lib, de Andrew Dillon (MIT)") && credits.includes("docx, de Dolan Miu (MIT)"), credits);
  await a.page.locator(".kn-about-credits").screenshot({ path: join(out, "5-sobre.png") });
  shots.push({ file: "5-sobre.png", caption: "5. As licenças do pdf-lib e do docx na tela Sobre" });
  report.checks.push("the About screen credits pdf-lib and docx with their licenses");
  report.problems.push(...a.report.problems);
  await a.close();

  // A folha em WebP e o vídeo do balão em mp4.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 22px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">Arquivos: o agente lê e o Kiwi gera (spec #11549)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:8px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await Bun.sleep(300);
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "folha.png"), "-o", join(out, "arquivos.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
  if (webm) {
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=980:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "arquivos.mp4")]);
    if (ff.exitCode !== 0) report.problems.push(`ffmpeg: ${ff.stderr.toString()}`);
  }
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
