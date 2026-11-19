// O Kiwi Cat editando a planilha ao vivo (T21114, spec #21033): o app de verdade (o AppEngine headless) com o agente
// falso (`/tool sheets_read` e `/tool sheets_edit`), num WebKit headless, sem nada na tela de ninguém e sem o agente
// de verdade. A planilha e o csv são inventados (o estoque de uma loja de exemplo).
//
// - O gato grava: a janela aberta recarrega do disco e toca as operações por cima, célula por célula, com a etiqueta
//   dele; no fim as células ficam realçadas e o realce some; a grade fica igual ao arquivo.
// - A linha que ele insere entra na grade, e a fórmula recalcula.
// - Uma tecla no meio pula para o fim.
// - Com Reduzir movimento, tudo de uma vez, com o realce.
// - A pessoa editando junto: a caixa aberta noutra célula segue a célula; a edição ainda por gravar é refeita sobre a
//   versão do gato; na mesma célula, o gato espera ela sair e não passa por cima.
// - A planilha fechada: ao abrir, o realce do que mudou, uma vez só.
// - Os prints, em WebP, no claro e no escuro, e o vídeo dos passos 5 a 8 (.webm).
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
// A gravação da pessoa presa no caminho (o passo da edição pendente): o `files.save` da janela espera o `release`.
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

/** `row` é a linha do Excel (a 1 é a de cima); `col`, de 1 em diante. */
const cellAt = (row: number, col: number) => `.kn-grid-row[aria-rowindex='${row}'] [aria-colindex='${col + 1}']`;
const text = (p: Page, row: number, col: number) => p.locator(cellAt(row, col)).evaluate((el) => el.firstChild?.textContent ?? "");
const shot = async (p: Page, name: string) => {
  const png = join(out, `${name}.png`);
  await p.screenshot({ path: png });
  const r = spawnSync("cwebp", ["-quiet", "-q", "85", png, "-o", join(out, `${name}.webp`)]);
  if (r.status === 0) rmSync(png);
};
/** O gato pede a mudança pela ferramenta, como o agente faria: lê, e muda pela versão que leu. Não espera gravar. */
async function catAsks(rel: string, mudancas: unknown[]) {
  const { version } = await invoke("files.read", { path: rel, as: "binary" });
  await invoke("agent.ask", {
    text: [
      `Acerto o ${rel}.`,
      `/tool sheets_read ${JSON.stringify({ caminho: rel })}`,
      `/tool sheets_edit ${JSON.stringify({ caminho: rel, versao: version, mudancas })}`,
    ].join("\n"),
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
      // A célula da vez dura uns 200 ms: o print é da que estiver com a etiqueta.
      await p.waitForSelector(".kn-grid-cell[data-kiwi='typing'] .kn-kiwi-tag", { timeout: 5000 });
      await shot(p, "04-gato-digitando-escuro");
      await p.waitForFunction(() => !document.querySelector(".kn-file-table-wrap[data-kiwi-play]"), null, { timeout: 10000 });
      assert.equal(await text(p, 5, 3), "2");
      checks.push("o csv no escuro, o gato digitando");
    } finally {
      await w.close();
    }
  }

  // 5 a 8. A pessoa editando enquanto o gato edita, e a planilha fechada (com o vídeo).
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 1, theme: "light", width: 900, height: 480, motion: true, browser: "webkit", video: out, query: { note: "Loja/clientes.csv" } });
    const p = w.page;
    const csv = () => readFileSync(join(vault, "Loja/clientes.csv"), "utf8");
    const waitDisk = async (want: string, why: string) => {
      for (let n = 0; csv() !== want; n++) {
        assert.ok(n < 200, `${why}: o disco ficou ${JSON.stringify(csv())}`);
        await Bun.sleep(50);
      }
    };
    const box = ".kn-grid-editor";
    /** Abre um arquivo pela árvore (o botão "Notas" do topo). */
    const openFile = async (rel: string) => {
      await p.locator(".kn-crumb-bt").click();
      const item = p.locator(`.kn-tree-pop .kn-side-item[data-path="${rel}"]`);
      await item.waitFor({ timeout: 1500 }).catch(() => p.click(".kn-tree-pop button[data-all='expand']"));
      await item.click();
    };
    const settle = () => p.waitForFunction(() => !document.querySelector(".kn-file-table-wrap[data-kiwi-play]"), null, { timeout: 10000 });
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 15000 });
      await p.waitForTimeout(600);

      // 5. A caixa aberta noutra célula: a pessoa digita em C3 (o Beto), e o gato insere uma linha em cima e escreve
      //    nela. A caixa desce com a célula, com o que ela digitou, e o Enter grava por cima da versão do gato.
      await p.locator(cellAt(3, 3)).click();
      await p.keyboard.type("8");
      await p.waitForSelector(box);
      await catEdits("Loja/clientes.csv", [{ tipo: "inserir_linhas", linha: 2 }, { tipo: "celulas", celulas: { A2: "Bruna", B2: "Cidade E", C2: 1 } }]);
      await p.waitForSelector(`.kn-grid-row[aria-rowindex='4'] ${box}`, { timeout: 5000 });
      assert.equal(await p.locator(box).inputValue(), "8");
      await p.waitForTimeout(700);
      await shot(p, "05-caixa-aberta-segue-a-celula");
      await p.keyboard.press("Enter");
      await waitDisk("Nome;Cidade;Pedidos\r\nBruna;Cidade E;1\r\nAna;Cidade A;4\r\nBeto;Cidade B;8\r\nCarla;Cidade C;1\r\nElisa;Cidade D;2\r\n", "a caixa aberta");
      await settle();
      checks.push("caixa aberta noutra célula: ela desce com a linha que o gato inseriu, e o que a pessoa digitou grava (disco conferido)");

      // 6. A edição pendente: a pessoa grava C5 (a Carla), mas a gravação dela fica presa no caminho; nesse meio-tempo
      //    o gato insere outra linha em cima. A dela é refeita sobre a versão do gato, na linha nova, e nada se perde.
      holding = true;
      await p.locator(cellAt(5, 3)).click();
      await p.keyboard.type("3");
      await p.keyboard.press("Enter");
      for (let n = 0; !held.length; n++) {
        assert.ok(n < 100, "a gravação da pessoa não saiu");
        await Bun.sleep(20);
      }
      await catEdits("Loja/clientes.csv", [{ tipo: "inserir_linhas", linha: 2 }, { tipo: "celulas", celulas: { A2: "Caio", B2: "Cidade G", C2: 2 } }]);
      release();
      await waitDisk("Nome;Cidade;Pedidos\r\nCaio;Cidade G;2\r\nBruna;Cidade E;1\r\nAna;Cidade A;4\r\nBeto;Cidade B;8\r\nCarla;Cidade C;3\r\nElisa;Cidade D;2\r\n", "a edição pendente");
      await settle();
      assert.equal(await text(p, 6, 3), "3");
      assert.equal(await p.locator(".kn-file-notice, [role='status']").filter({ hasText: "não foi gravada" }).count(), 0, "sem o aviso de edição perdida");
      checks.push("edição pendente quando o gato grava: ela é refeita na linha nova, sem o aviso de perda (disco conferido)");

      // 7. A mesma célula: a pessoa digita em C4 (a Ana) e o gato quer mudar C4. Ele espera; o Enter dela grava, e o
      //    gato, que relê, não passa por cima.
      await p.locator(cellAt(4, 3)).click();
      await p.keyboard.type("6");
      await p.waitForSelector(box);
      const before7 = csv();
      await catAsks("Loja/clientes.csv", [{ tipo: "celulas", celulas: { C4: 9 } }]);
      await p.waitForTimeout(1500);
      assert.equal(csv(), before7, "o gato esperou a pessoa sair da célula");
      await shot(p, "06-mesma-celula-o-gato-espera");
      await p.keyboard.press("Enter");
      const ana6 = before7.replace("Ana;Cidade A;4", "Ana;Cidade A;6");
      await waitDisk(ana6, "o Enter da pessoa");
      await p.waitForTimeout(2000);
      assert.equal(csv(), ana6, "o gato não passou por cima do valor dela");
      checks.push("mesma célula: o gato espera; a pessoa grava 6, e o 9 dele não passa por cima (disco conferido)");

      // 7b. A mesma célula, e a pessoa sai sem mudar (Esc): só então o gato escreve.
      await p.locator(cellAt(4, 3)).click();
      await p.keyboard.type("1");
      await p.waitForSelector(box);
      await catAsks("Loja/clientes.csv", [{ tipo: "celulas", celulas: { C4: 9 } }]);
      await p.waitForTimeout(1200);
      assert.equal(csv(), ana6, "o gato espera a caixa fechar");
      await p.keyboard.press("Escape");
      await waitDisk(ana6.replace("Ana;Cidade A;6", "Ana;Cidade A;9"), "o gato depois do Esc");
      await settle();
      checks.push("mesma célula com Esc: o gato escreve só depois que a pessoa sai (disco conferido)");

      // 8. A planilha fechada: o gato muda o estoque com o csv na tela. Ao abrir, o que mudou está realçado de uma vez;
      //    na segunda abertura, não mais.
      await catEdits("Loja/estoque.xlsx", [{ tipo: "celulas", celulas: { C3: 25 } }]);
      await openFile("Loja/estoque.xlsx");
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-file-table-wrap[data-kiwi-play]", { timeout: 8000 });
      assert.equal(await p.locator(".kn-grid-cell[data-kiwi='typing']").count(), 0, "fechada: só o realce, sem digitar");
      assert.equal(await p.locator(`${cellAt(3, 3)}[data-kiwi='done']`).count(), 1, "C3 realçada");
      assert.equal(await p.locator(`${cellAt(3, 4)}[data-kiwi='done']`).count(), 1, "o total recalculado realçado");
      await shot(p, "07-fechada-realce-ao-abrir");
      await settle();
      await openFile("Loja/clientes.csv");
      await p.waitForFunction(() => document.querySelector(".kn-file-title")?.textContent?.includes("clientes"), null, { timeout: 8000 });
      await openFile("Loja/estoque.xlsx");
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 8000 });
      await p.waitForTimeout(600);
      assert.equal(await p.locator(".kn-file-table-wrap[data-kiwi-play]").count(), 0, "a segunda abertura sem realce");
      const wb = XLSX.read(readFileSync(join(vault, "Loja/estoque.xlsx")), { type: "buffer" });
      assert.equal(wb.Sheets.Estoque!.C3!.v, 25);
      assert.equal(wb.Sheets.Estoque!.D3!.v, 75);
      checks.push("planilha fechada: ao abrir, C3 e o total realçados de uma vez; na segunda abertura, nada (disco conferido)");
      assert.deepEqual(w.report.problems, [], "problemas na página");
    } finally {
      release();
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
