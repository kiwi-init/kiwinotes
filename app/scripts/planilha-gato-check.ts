// O Kiwi Cat editando a planilha ao vivo (T21114, spec #21065): o app de verdade (o AppEngine headless) com o agente
// falso (`/tool sheets_read` e `/tool sheets_edit`), num WebKit headless, sem nada na tela de ninguém e sem o agente
// de verdade. A planilha e o csv são inventados (o estoque de uma loja de exemplo).
//
// - O gato grava: a janela aberta recarrega do disco e toca as operações por cima, célula por célula, com a etiqueta
//   dele; no fim as células ficam realçadas e o realce some; a grade fica igual ao arquivo.
// - A linha que ele insere entra na grade, e a fórmula recalcula.
// - Uma tecla no meio pula para o fim.
// - Com Reduzir movimento, tudo de uma vez, com o realce.
// - Os prints, em WebP, no claro e no escuro.
//
//   bun scripts/planilha-gato-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import * as XLSX from "xlsx";
import { fakeRegistry } from "../src/agent/fake/registry";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21114"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-T21114-"));
const vault = join(data, "vault");
const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

// O estoque da loja de exemplo: quantidade × preço no total, e a soma embaixo.
const estoque = XLSX.utils.aoa_to_sheet([
  ["Produto", "Qtd", "Preço", "Total"],
  ["Caneca", 2, 30, null],
  ["Caderno", 3, 20, null],
  ["Lápis", 10, 2, null],
  ["Soma", null, null, null],
]);
for (const r of [2, 3, 4]) estoque[`D${r}`] = { t: "n", f: `B${r}*C${r}`, v: Number(estoque[`B${r}`].v) * Number(estoque[`C${r}`].v) };
estoque.D5 = { t: "n", f: "SUM(D2:D4)", v: 140 };
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, estoque, "Estoque");
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Fornecedor"], ["Empresa X"]]), "Fornecedores");
put("Loja/estoque.xlsx", new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer));
put("Loja/clientes.csv", "Nome;Cidade;Pedidos\r\nAna;Cidade A;3\r\nBeto;Cidade B;5\r\n");

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

/** `row` é a linha do Excel (a 1 é a de cima); `col`, de 1 em diante. */
const cellAt = (row: number, col: number) => `.kn-grid-row[aria-rowindex='${row}'] [aria-colindex='${col + 1}']`;
const text = (p: Page, row: number, col: number) => p.locator(cellAt(row, col)).evaluate((el) => el.firstChild?.textContent ?? "");
const shot = async (p: Page, name: string) => {
  const png = join(out, `${name}.png`);
  await p.screenshot({ path: png });
  const r = spawnSync("cwebp", ["-quiet", "-q", "85", png, "-o", join(out, `${name}.webp`)]);
  if (r.status === 0) rmSync(png);
};
/** O gato grava pela ferramenta, como o agente faria: lê, e muda pela versão que leu. */
async function catEdits(rel: string, mudancas: unknown[]) {
  const { version } = await invoke("files.read", { path: rel, as: "binary" });
  const before = readFileSync(join(vault, rel));
  await invoke("agent.ask", {
    text: [
      `Acerto o ${rel}.`,
      `/tool sheets_read ${JSON.stringify({ caminho: rel })}`,
      `/tool sheets_edit ${JSON.stringify({ caminho: rel, versao: version, mudancas })}`,
    ].join("\n"),
  });
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

  // 1. O xlsx aberto, no claro e com animação: o gato insere a linha da jarra e digita nela e na caneca.
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 900, height: 480, motion: true, browser: "webkit", query: { note: "Loja/estoque.xlsx" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      await catEdits("Loja/estoque.xlsx", [
        { tipo: "inserir_linhas", linha: 4, quantidade: 1 },
        { tipo: "celulas", celulas: { A4: "Jarra de vidro", B4: 4, C4: 15, D4: "=B4*C4", B2: 5 } },
      ]);
      await p.waitForSelector(".kn-grid-cell[data-kiwi='typing'] .kn-kiwi-tag", { timeout: 5000 });
      assert.equal((await p.locator(".kn-kiwi-tag").innerText()).trim(), "Kiwi");
      // No meio: uma célula já pronta e realçada, a da vez com a etiqueta.
      await p.waitForSelector(".kn-grid-cell[data-kiwi='done']", { timeout: 5000 });
      await p.waitForSelector(".kn-grid-cell[data-kiwi='typing'][aria-colindex='4'] .kn-kiwi-tag-still", { timeout: 5000 });
      await shot(p, "01-gato-digitando-claro");
      checks.push("o gato grava e a grade toca: a célula da vez com a etiqueta Kiwi, as prontas realçadas");
      await p.waitForSelector(".kn-file-table-wrap[data-kiwi-play='fading']", { timeout: 8000 });
      assert.equal(await p.locator(".kn-grid-cell[data-kiwi='typing']").count(), 0);
      await shot(p, "02-realce-claro");
      await p.waitForFunction(() => !document.querySelector(".kn-file-table-wrap[data-kiwi-play]"), null, { timeout: 8000 });
      // A grade fica igual ao arquivo: a linha nova, a fórmula recalculada e a soma que acompanhou.
      assert.equal(await text(p, 4, 1), "Jarra de vidro");
      assert.equal(await text(p, 4, 4), "60");
      assert.equal(await text(p, 2, 4), "150");
      assert.equal(await text(p, 5, 1), "Lápis");
      assert.equal(await text(p, 6, 1), "Soma");
      assert.equal(await text(p, 6, 4), "290");
      const wb = XLSX.read(readFileSync(join(vault, "Loja/estoque.xlsx")), { type: "buffer" });
      const s = wb.Sheets.Estoque!;
      assert.equal(s.D4!.f, "B4*C4");
      assert.equal(s.D6!.f, "SUM(D2:D5)");
      checks.push("no fim o realce some, e a grade fica igual ao arquivo (a linha nova dentro da soma, B4*C4 = 60, a soma 290)");

      // 2. Uma tecla no meio pula para o fim.
      await catEdits("Loja/estoque.xlsx", [{ tipo: "celulas", celulas: { A2: "Caneca grande", A3: "Caderno pautado", A5: "Lápis preto" } }]);
      await p.waitForSelector(".kn-grid-cell[data-kiwi='typing']", { timeout: 5000 });
      await p.locator(".kn-grid").press("Shift");
      await p.waitForSelector(".kn-file-table-wrap[data-kiwi-play='fading']", { timeout: 1000 });
      assert.equal(await text(p, 5, 1), "Lápis preto");
      checks.push("uma tecla no meio pula para o fim, com tudo escrito");
      assert.deepEqual(w.report.problems, [], "problemas na página");
    } finally {
      await w.close();
    }
  }

  // 3. O csv no escuro, com Reduzir movimento: tudo de uma vez, realçado, sem a etiqueta.
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "dark", width: 900, height: 480, motion: false, browser: "webkit", query: { note: "Loja/clientes.csv" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      await catEdits("Loja/clientes.csv", [{ tipo: "celulas", celulas: { C2: 4, A4: "Carla", B4: "Cidade C", C4: 1 } }]);
      await p.waitForSelector(".kn-file-table-wrap[data-kiwi-play]", { timeout: 5000 });
      assert.equal(await p.locator(".kn-grid-cell[data-kiwi='typing']").count(), 0, "sem digitar com Reduzir movimento");
      assert.equal(await p.locator(".kn-grid-cell[data-kiwi='done']").count(), 4);
      assert.equal(await text(p, 4, 1), "Carla");
      await shot(p, "03-reduzir-movimento-escuro");
      assert.equal(readFileSync(join(vault, "Loja/clientes.csv"), "utf8"), "Nome;Cidade;Pedidos\r\nAna;Cidade A;4\r\nBeto;Cidade B;5\r\nCarla;Cidade C;1\r\n");
      checks.push("com Reduzir movimento, tudo de uma vez e realçado; o csv grava com o mesmo separador");
      await p.waitForFunction(() => !document.querySelector(".kn-file-table-wrap[data-kiwi-play]"), null, { timeout: 8000 });

      // 4. No escuro com animação, para o print do gato digitando.
      await w.close();
    } catch (e) {
      await w.close();
      throw e;
    }
  }
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "dark", width: 900, height: 480, motion: true, browser: "webkit", query: { note: "Loja/clientes.csv" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      await catEdits("Loja/clientes.csv", [{ tipo: "celulas", celulas: { A5: "Elisa", B5: "Cidade D", C5: 2 } }]);
      await p.waitForSelector(".kn-grid-cell[data-kiwi='typing'][aria-colindex='3']", { timeout: 5000 });
      await p.waitForTimeout(150);
      await shot(p, "04-gato-digitando-escuro");
      await p.waitForFunction(() => !document.querySelector(".kn-file-table-wrap[data-kiwi-play]"), null, { timeout: 10000 });
      assert.equal(await text(p, 5, 3), "2");
      checks.push("o csv no escuro, o gato digitando");
    } finally {
      await w.close();
    }
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
