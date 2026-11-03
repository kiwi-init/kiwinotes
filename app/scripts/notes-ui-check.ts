// Dirige a janela Notas (T1317) num Chromium headless, sem janela na tela de ninguém, contra o Vite com o vault de
// mentira (ui/notes/mock.ts). Cobre o que o `bun test` não alcança: clique em link, ⌘K, checkbox, tabela, autocomplete,
// renomear, conflito com edição de fora, HTML que fica texto e link externo.
//
//   bun scripts/notes-ui-check.ts [pasta-para-screenshots]
//
// Usa o chrome-headless-shell do cache do Playwright (~/Library/Caches/ms-playwright), ou o de KIWI_CHROMIUM.
// Sobe o Vite em 127.0.0.1:5191 (não no 5178 do dev, que pode estar em uso) e derruba no fim.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "playwright-core";

function chromiumPath(): string {
  if (process.env.KIWI_CHROMIUM) return process.env.KIWI_CHROMIUM;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const d of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse() : []) {
    for (const sub of readdirSync(join(cache, d))) {
      const exe = join(cache, d, sub, "chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error("sem chrome-headless-shell: rode `bunx playwright-core install chromium-headless-shell` ou defina KIWI_CHROMIUM");
}

const PORT = 5191;
const URL = `http://127.0.0.1:${PORT}/notes/index.html`;
const shots = process.argv[2] ? resolve(process.argv[2]) : undefined;
const appDir = resolve(import.meta.dir, "..");

const vite = Bun.spawn(["bun", "x", "vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: appDir, stdout: "ignore", stderr: "inherit" });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {}
  if (i > 100) throw new Error("o Vite não subiu");
  await Bun.sleep(100);
}

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
const dialogs: string[] = [];
page.on("dialog", (d) => {
  dialogs.push(d.message());
  void d.dismiss();
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

let failed = 0;
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`ok      ${name}`);
  } catch (e) {
    failed++;
    console.log(`FALHOU  ${name}: ${String(e).split("\n")[0]}`);
  }
}
const expectEq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const title = () => page.inputValue(".kn-title");
const content = (path: string) => page.evaluate((p) => (window as any).__kiwiNotesMock.notes.get(p)?.content as string, path);
const settle = () => page.waitForTimeout(700); // o autosave espera 500 ms

await page.goto(URL);
await page.waitForSelector(".kn-title");

await step("abre a Caixa de entrada e lista o vault", async () => {
  expectEq(await title(), "Caixa de entrada");
  const side = await page.$$eval(".kn-side-item", (els) => els.map((e) => e.textContent));
  expectEq(side, ["Diário", "Pessoas", "Projetos", "Reuniões", "Caixa de entrada"]);
});

await step("clique num [[link]] abre a nota", async () => {
  await page.click(".cm-wikilink >> text=Ana");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ana");
  const back = await page.$$eval(".kn-back .kn-link", (els) => els.map((e) => e.textContent));
  expectEq(back.sort(), ["2026-11-02 Planejamento", "Caixa de entrada", "Site novo"]);
});

await step("⌘K acha por título e abre com Enter", async () => {
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".kn-palette");
  await page.keyboard.type("mudan");
  await page.waitForTimeout(250);
  const first = await page.textContent(".kn-palette-it[aria-selected=true] .kn-palette-title");
  if (!first?.startsWith("Mudança de escritório")) throw new Error(`primeiro: ${first}`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Mudança de escritório");
  if (await page.$(".kn-palette")) throw new Error("a paleta não fechou");
});

await step("⌘K acha por texto (notes.search), com trecho", async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("lista de compras");
  await page.waitForSelector(".kn-palette-snippet");
  const t = await page.textContent(".kn-palette-it[aria-selected=true] .kn-palette-title");
  if (!t?.startsWith("2026-11-03")) throw new Error(`primeiro: ${t}`);
  await page.keyboard.press("Escape");
});

if (shots) await page.screenshot({ path: `${shots}/notas-projeto.png` });

await step("checkbox marca a tarefa no .md", async () => {
  await page.click(".cm-line:has-text('Pedir o orçamento') .cm-task-box");
  await settle();
  const c = await content("Projetos/Mudança de escritório.md");
  if (!c.includes("- [x] Pedir o orçamento da mudança")) throw new Error(c);
});

await step("tabela: clicar na célula vira texto; Tab vai para a próxima e alinha", async () => {
  await page.click(".cm-md-table td >> text=Fio Certo");
  await page.waitForSelector(".cm-md-table", { state: "detached" });
  await page.keyboard.press("Tab");
  const sel = await page.evaluate(() => getSelection()?.toString());
  expectEq(sel, "1.800");
  await page.keyboard.type("2.000");
  await settle();
  const c = await content("Projetos/Mudança de escritório.md");
  if (!/\| Rede +\| Fio Certo +\| 2\.000 \|/.test(c)) throw new Error(c.slice(c.indexOf("| Item")));
  const rows = c.slice(c.indexOf("| Item")).trim().split("\n");
  if (new Set(rows.map((r) => r.length)).size !== 1) throw new Error(`colunas desalinhadas:\n${rows.join("\n")}`);
});

await step("autocomplete do [[ completa o link", async () => {
  await page.click(".kn-title");
  await page.keyboard.press("Enter"); // foca o editor
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("\nFalar com a [[Ana");
  await page.waitForSelector(".cm-tooltip-autocomplete");
  await page.keyboard.press("Enter");
  await settle();
  const c = await content("Projetos/Mudança de escritório.md");
  if (!c.trimEnd().endsWith("Falar com a [[Ana]]")) throw new Error(c.slice(-60));
});

await step("HTML no texto fica texto (nenhum script roda)", async () => {
  await page.keyboard.type("\n<img src=x onerror=alert(1)> <script>alert(2)</script>");
  await settle();
  // O CodeMirror põe <img class="cm-widgetBuffer"> ao lado dos widgets; qualquer outra img seria o HTML da nota.
  if (await page.$(".cm-content img:not(.cm-widgetBuffer)")) throw new Error("virou <img>");
  expectEq(dialogs, []);
});

await step("⌘-clique: link https abre fora, javascript: não faz nada", async () => {
  await page.evaluate(() => {
    (window as any).__opened = [];
    window.open = ((u: string) => {
      (window as any).__opened.push(u);
      return null;
    }) as typeof window.open;
  });
  // Linha em branco antes: a linha "<img …>" de cima abre um bloco HTML que vai até ela (CommonMark).
  await page.keyboard.type("\n\n[site](https://example.com)\n[mal](javascript:alert(3))");
  await page.locator(".cm-line", { hasText: "example.com" }).click({ modifiers: ["Meta"], position: { x: 12, y: 10 } });
  await page.locator(".cm-line", { hasText: "javascript:" }).click({ modifiers: ["Meta"], position: { x: 12, y: 10 } });
  expectEq(await page.evaluate(() => (window as any).__opened), ["https://example.com/"]);
  expectEq(dialogs, []);
  expectEq(page.url(), URL);
});

await step("renomear pelo título atualiza os links de quem cita", async () => {
  await page.fill(".kn-title", "Mudança do escritório");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".kn-side-item[aria-current=page]")?.textContent === "Mudança do escritório");
  const c = await content("Reuniões/2026-11-02 Planejamento.md");
  if (!c.includes("[[Mudança do escritório]]")) throw new Error(c);
});

await step("edição de fora com edição pendente: aviso, e 'Manter a minha' grava", async () => {
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  // Digita (fica pendente, o autosave espera 500 ms) e, antes de gravar, a nota muda no Obsidian.
  await page.keyboard.type("\nminha linha");
  await page.evaluate(() => (window as any).__kiwiNotesMock.editOutside("Projetos/Mudança do escritório.md", "Mudou no Obsidian.\n"));
  await page.waitForSelector(".kn-conflict");
  await page.click("text=Manter a minha");
  await settle();
  const c = await content("Projetos/Mudança do escritório.md");
  if (!c.endsWith("minha linha")) throw new Error(c.slice(-40));
});

await step("edição de fora sem nada pendente: a nota recarrega sozinha", async () => {
  await page.evaluate(() => (window as any).__kiwiNotesMock.editOutside("Projetos/Mudança do escritório.md", "Versão do Obsidian.\n"));
  await page.waitForSelector(".cm-line >> text=Versão do Obsidian.");
  if (await page.$(".kn-conflict")) throw new Error("mostrou conflito sem edição pendente");
});

// Revisão do T1317 (#1488): trocar de nota nunca descarta texto não gravado.
const sideClick = (name: string) => page.locator(".kn-side-item", { hasText: name }).first().click();
const editorText = () => page.$eval(".cm-content", (e) => e.textContent ?? "");

await step("conflito na tela: clicar em outra nota não troca nem perde o texto; 'Manter a minha' grava", async () => {
  await sideClick("Site novo");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Site novo");
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("\nTEXTO QUE EU DIGITEI");
  await page.evaluate(() => (window as any).__kiwiNotesMock.editOutside("Projetos/Site novo.md", "Mudou no Obsidian.\n"));
  await page.waitForSelector(".kn-conflict");
  await sideClick("Caixa de entrada");
  await page.waitForTimeout(400);
  expectEq(await title(), "Site novo");
  if (!(await editorText()).includes("TEXTO QUE EU DIGITEI")) throw new Error("o texto sumiu do editor");
  await page.click("text=Manter a minha");
  await settle();
  if (!(await content("Projetos/Site novo.md")).includes("TEXTO QUE EU DIGITEI")) throw new Error("não gravou");
  await sideClick("Caixa de entrada");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Caixa de entrada");
});

await step("save que falha: aviso na tela, trocar de nota não descarta, 'Tentar de novo' grava", async () => {
  await sideClick("Ana");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ana");
  await page.evaluate(() => {
    const m = (window as any).__kiwiNotesMock;
    m.__save = m.save;
    m.save = async () => {
      throw new Error("E_FAILED");
    };
  });
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("\nOUTRO TEXTO MEU");
  await page.waitForSelector(".kn-save-alert >> text=Não deu para gravar");
  await sideClick("Caixa de entrada");
  await page.waitForTimeout(400);
  expectEq(await title(), "Ana");
  if (!(await editorText()).includes("OUTRO TEXTO MEU")) throw new Error("o texto sumiu do editor");
  await page.evaluate(() => {
    const m = (window as any).__kiwiNotesMock;
    m.save = m.__save;
  });
  await page.click("text=Tentar de novo");
  await settle();
  if (!(await content("Pessoas/Ana.md")).includes("OUTRO TEXTO MEU")) throw new Error("não gravou");
  if (await page.$(".kn-save-alert")) throw new Error("o aviso ficou");
});

await step("save que falha: 'Descartar a edição' volta ao disco e deixa trocar", async () => {
  await page.evaluate(() => {
    (window as any).__kiwiNotesMock.save = async () => {
      throw new Error("E_FAILED");
    };
  });
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" DESCARTAR ISTO");
  await page.waitForSelector(".kn-save-alert");
  await page.click("text=Descartar a edição");
  await page.waitForTimeout(300);
  if ((await editorText()).includes("DESCARTAR ISTO")) throw new Error("não descartou");
  await page.evaluate(() => {
    const m = (window as any).__kiwiNotesMock;
    m.save = m.__save;
  });
  await sideClick("Caixa de entrada");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Caixa de entrada");
});

await step("dois saves seguidos (o do timer e o da troca de nota) não dão conflito falso", async () => {
  await sideClick("Ana");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ana");
  await page.evaluate(() => {
    const m = (window as any).__kiwiNotesMock;
    m.save = async (...a: unknown[]) => {
      await new Promise((r) => setTimeout(r, 400));
      return m.__save.apply(m, a);
    };
  });
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" SAVE LENTO");
  await page.waitForTimeout(600); // o timer já disparou o 1º save, que ainda está gravando
  await page.keyboard.type(" E MAIS");
  await sideClick("Caixa de entrada"); // a troca pede o 2º save
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Caixa de entrada", undefined, { timeout: 5000 });
  if (await page.$(".kn-save-alert")) throw new Error("conflito falso");
  if (!(await content("Pessoas/Ana.md")).includes("SAVE LENTO E MAIS")) throw new Error(await content("Pessoas/Ana.md"));
  await page.evaluate(() => {
    const m = (window as any).__kiwiNotesMock;
    m.save = m.__save;
  });
});

await step("⌘K cria nota nova quando não há título igual", async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Ideia nova");
  await page.waitForTimeout(200);
  await page.click(".kn-palette-create");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ideia nova");
  if (!(await content("Ideia nova.md") === "")) throw new Error("não criou");
});

await step("clique num link para nota que não existe cria a nota", async () => {
  await page.click(".cm-content");
  await page.keyboard.type("veja [[Nota fantasma]] depois");
  await settle();
  await page.click(".kn-title"); // tira o foco do editor: o link vira link
  await page.locator(".cm-wikilink", { hasText: "Nota fantasma" }).click();
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Nota fantasma");
});

await page.keyboard.press("Meta+k");
await page.keyboard.type("ana");
await page.waitForTimeout(300);
if (shots) await page.screenshot({ path: `${shots}/notas-busca.png` });

expectEq(errors, []);
console.log(errors.length ? `erros na página: ${errors.join(" | ")}` : "sem erro na página");
await browser.close();
vite.kill();
console.log(failed ? `${failed} FALHARAM` : "tudo ok");
process.exit(failed ? 1 : 0);
