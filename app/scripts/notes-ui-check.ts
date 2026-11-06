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
// Um erro fora de um `step` (a página que não abre) não deixa o Vite órfão segurando o stderr: no CI, o passo travaria.
process.on("exit", () => vite.kill());
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
// A árvore fica num popover atrás do botão "Notas" do topo (T4363): abre antes de clicar nela.
async function openTree() {
  if ((await page.getAttribute(".kn-crumb-bt", "aria-expanded")) !== "true") await page.click(".kn-crumb-bt");
  await page.waitForSelector(".kn-side", { state: "visible" });
}
// Os nomes da seção "Notas" da árvore (as pastas e as notas da raiz), sem os Recentes e as Fixadas de cima.
const treeNames = () =>
  page.evaluate(() => {
    const head = [...document.querySelectorAll(".kn-side-head")].find((h) => h.textContent === "Notas");
    const names: string[] = [];
    for (let el = head?.nextElementSibling; el && !el.classList.contains("kn-side-head"); el = el.nextElementSibling) {
      const name = el.querySelector(".kn-side-item:not(.kn-side-trash) .kn-side-name");
      if (name) names.push(name.textContent ?? "");
    }
    return names;
  });
// Fora do cursor, o bloco é desenhado (T2983): o link de nota é um <a href="kiwi-note:…"> dentro do .cm-rendered.
const noteLink = (text: string) => page.locator('.cm-rendered a[href^="kiwi-note"]', { hasText: text }).first();

await page.goto(URL);
await page.waitForSelector(".kn-title");

await step("abre a Caixa de entrada e lista o vault", async () => {
  expectEq(await title(), "Caixa de entrada");
  expectEq(await treeNames(), ["Diário", "Pessoas", "Projetos", "Reuniões", "Caixa de entrada"]);
});

await step("clique num [[link]] abre a nota", async () => {
  await noteLink("Ana").click();
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ana");
  // Quem cita a nota fica no popover do "citada em N", na linha de baixo do título.
  await page.click(".kn-meta-bt >> text=citada em");
  await page.waitForSelector(".kn-back-pop .kn-back");
  const back = await page.$$eval(".kn-back .kn-link", (els) => els.map((e) => e.textContent));
  expectEq(back.sort(), ["2026-11-02 Planejamento", "Caixa de entrada", "Site novo"]);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".kn-back-pop", { state: "detached" });
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
  await page.click(".cm-rendered li:has-text('Pedir o orçamento') input[type=checkbox]");
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
  await page.waitForSelector(".cm-content >> text=Versão do Obsidian.");
  if (await page.$(".kn-conflict")) throw new Error("mostrou conflito sem edição pendente");
});

// Revisão do T1317 (#1488): trocar de nota nunca descarta texto não gravado.
async function sideClick(name: string) {
  await openTree();
  await page.locator(".kn-side-item[data-kind=note]", { hasText: name }).first().click();
}
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

// T1506: fechar a janela com o save falhando não perde a edição (rascunho no localStorage da janela).
const draftKeys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("kiwi.notes.draft.")));
async function typeWithSaveFailing(text: string) {
  await sideClick("Ana");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ana");
  await page.evaluate(() => {
    (window as any).__kiwiNotesMock.save = async () => {
      throw new Error("E_FAILED");
    };
  });
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(text);
  await page.waitForSelector(".kn-save-alert");
  // "Fecha a janela": a página some sem o save passar (e o vault de mentira volta ao começo).
  await page.goto(`${URL}?note=${encodeURIComponent("Pessoas/Ana.md")}`);
  await page.waitForSelector(".kn-title");
}

await step("rascunho: edição que não gravou volta ao reabrir, e 'Recuperar' grava", async () => {
  await typeWithSaveFailing("\nRASCUNHO QUE NÃO GRAVOU");
  await page.waitForSelector(".kn-draft >> text=não foi gravada");
  if ((await editorText()).includes("RASCUNHO")) throw new Error("o editor já abriu com o rascunho, sem perguntar");
  await page.click(".kn-draft >> text=Recuperar");
  await settle();
  if (!(await editorText()).includes("RASCUNHO QUE NÃO GRAVOU")) throw new Error("o rascunho não voltou ao editor");
  if (!(await content("Pessoas/Ana.md")).includes("RASCUNHO QUE NÃO GRAVOU")) throw new Error("não gravou");
  expectEq(await draftKeys(), []);
});

await step("rascunho: 'Descartar' fica com o que está no disco e apaga o rascunho", async () => {
  await typeWithSaveFailing(" OUTRO RASCUNHO");
  await page.waitForSelector(".kn-draft");
  await page.click(".kn-draft >> text=Descartar");
  await page.waitForTimeout(200);
  if (await page.$(".kn-draft")) throw new Error("o aviso ficou");
  if ((await editorText()).includes("OUTRO RASCUNHO")) throw new Error("o rascunho entrou");
  expectEq(await draftKeys(), []);
});

await step("rascunho: edição que gravou não deixa rascunho", async () => {
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" gravou");
  await settle();
  expectEq(await draftKeys(), []);
  await page.goto(`${URL}?note=${encodeURIComponent("Pessoas/Ana.md")}`);
  await page.waitForSelector(".kn-title");
  await page.waitForTimeout(300);
  if (await page.$(".kn-draft")) throw new Error("ofereceu rascunho de algo que gravou");
});

// T1530: rascunho de nota que sumiu.
const putDraft = (path: string, body: string) =>
  page.evaluate(([p, b]) => localStorage.setItem(`kiwi.notes.draft.v1:${p}`, JSON.stringify({ path: p, body: b, baseVersion: "1", at: new Date().toISOString() })), [path, body]);

await step("nota apagada com a janela aberta leva o rascunho junto", async () => {
  await putDraft("Projetos/Site novo.md", "rascunho de uma nota que vai sumir");
  await page.evaluate(() => (window as any).__kiwiNotesMock.delete("Projetos/Site novo.md"));
  await page.waitForFunction(() => !localStorage.getItem("kiwi.notes.draft.v1:Projetos/Site novo.md"), undefined, { timeout: 3000 });
});

await step("rascunho órfão ao abrir: 'Recuperar como nota nova' cria na Caixa de entrada", async () => {
  await putDraft("Projetos/Nome Antigo.md", "TEXTO DE UMA NOTA RENOMEADA FORA");
  await page.goto(URL);
  await page.waitForSelector(".kn-orphan >> text=Nome Antigo");
  await page.click(".kn-orphan >> text=Recuperar como nota nova");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Nome Antigo");
  if (!(await content("Caixa de entrada/Nome Antigo.md")).includes("TEXTO DE UMA NOTA RENOMEADA FORA")) throw new Error("não criou");
  expectEq(await draftKeys(), []);
  if (await page.$(".kn-orphan")) throw new Error("o aviso ficou");
});

await step("rascunho órfão recuperado volta com o frontmatter (tags e propriedades)", async () => {
  await page.evaluate(() =>
    localStorage.setItem(
      "kiwi.notes.draft.v1:Projetos/Com Tags.md",
      JSON.stringify({ path: "Projetos/Com Tags.md", body: "Corpo do rascunho.\n", frontmatter: "---\ntags: [projeto]\nstatus: ativo\n---\n", baseVersion: "1", at: new Date().toISOString() }),
    ),
  );
  await page.goto(URL);
  await page.waitForSelector(".kn-orphan >> text=Com Tags");
  await page.click(".kn-orphan >> text=Recuperar como nota nova");
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Com Tags");
  expectEq(await content("Caixa de entrada/Com Tags.md"), "---\ntags: [projeto]\nstatus: ativo\n---\nCorpo do rascunho.\n");
  if (!(await page.textContent(".kn-meta"))?.includes("#projeto")) throw new Error("a tag não apareceu");
});

await step("o rascunho escrito pela janela leva o frontmatter da nota", async () => {
  await page.goto(`${URL}?note=${encodeURIComponent("Projetos/Mudança de escritório.md")}`);
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement)?.value === "Mudança de escritório");
  await page.evaluate(() => {
    (window as any).__kiwiNotesMock.save = async () => {
      throw new Error("E_FAILED");
    };
  });
  await page.click(".cm-content");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" x");
  await page.waitForSelector(".kn-save-alert");
  const d = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((k) => k.includes("Mudança"))!;
    return JSON.parse(localStorage.getItem(k)!).frontmatter as string;
  });
  expectEq(d, "---\ntags: [projeto]\n---\n");
  await page.click("text=Descartar a edição");
  await page.evaluate(() => {
    const m = (window as any).__kiwiNotesMock;
    m.save = m.__save ?? m.save;
  });
});

await step("rascunho órfão: 'Descartar' apaga sem criar nada", async () => {
  await putDraft("Sumida.md", "texto que a pessoa não quer mais");
  await page.goto(URL);
  await page.waitForSelector(".kn-orphan >> text=Sumida");
  await page.click(".kn-orphan >> text=Descartar");
  await page.waitForTimeout(200);
  if (await page.$(".kn-orphan")) throw new Error("o aviso ficou");
  expectEq(await draftKeys(), []);
  if (await page.evaluate(() => (window as any).__kiwiNotesMock.notes.has("Caixa de entrada/Sumida.md"))) throw new Error("criou nota");
});

// T1584: comentário do Obsidian e legenda do ditado.
await step("%%comentário%% some fora da linha do cursor e aparece apagado nela; bloco some inteiro", async () => {
  const body = "Texto visível %%segredo de uma linha%% depois.\n\n%%\nbloco escondido\nem duas linhas\n%%\nFim.\n\nCódigo: `a %%fica%% b`\n";
  await page.goto(`${URL}?note=${encodeURIComponent("Pessoas/Ana.md")}`);
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement)?.value === "Ana");
  // Muda "fora" com a nota aberta e sem nada pendente: ela recarrega sozinha.
  await page.evaluate((b) => (window as any).__kiwiNotesMock.editOutside("Pessoas/Ana.md", b), body);
  await page.waitForSelector(".cm-content >> text=Fim.");
  const shown = await editorText();
  for (const hidden of ["segredo", "bloco escondido", "em duas linhas"]) if (shown.includes(hidden)) throw new Error(`apareceu: ${hidden}`);
  if (!shown.includes("Texto visível") || !shown.includes("depois.")) throw new Error(shown);
  if (!shown.includes("a %%fica%% b")) throw new Error("comentário dentro de código sumiu");
  await page.locator(".cm-line", { hasText: "Texto visível" }).click({ position: { x: 4, y: 8 } });
  await page.waitForSelector(".cm-comment >> text=segredo de uma linha");
  expectEq(await content("Pessoas/Ana.md"), body);
});

await step("a legenda do ditado fica pequena e verde, sem mostrar o id", async () => {
  const body = "Ficou decidido começar pela tomografia.\n*🎙 ditado às 14:30* %%dictation:2026-11-03T17:30:12.345Z-ab12%%\n";
  await page.goto(`${URL}?note=${encodeURIComponent("Pessoas/Ana.md")}`);
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement)?.value === "Ana");
  // Muda "fora" com a nota aberta e sem nada pendente: ela recarrega sozinha.
  await page.evaluate((b) => (window as any).__kiwiNotesMock.editOutside("Pessoas/Ana.md", b), body);
  await page.waitForSelector(".cm-said");
  const said = await page.$eval(".cm-said", (e) => ({ text: e.textContent, size: getComputedStyle(e).fontSize, color: getComputedStyle(e).color }));
  expectEq(said.text, "🎙 ditado às 14:30");
  expectEq(said.size, "11px");
  const expected = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent-text)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expectEq(said.color, expected);
});

await step("⌘K cria nota nova quando não há título igual", async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Ideia nova");
  await page.waitForTimeout(200);
  // Os comandos da paleta também usam .kn-palette-create, e "Ideia nova" acha o "Nova nota": clica no "Criar …".
  await page.locator(".kn-palette-create", { hasText: "Criar “Ideia nova”" }).click();
  await page.waitForFunction(() => (document.querySelector(".kn-title") as HTMLInputElement).value === "Ideia nova");
  if (!(await content("Ideia nova.md") === "")) throw new Error("não criou");
});

await step("clique num link para nota que não existe cria a nota", async () => {
  await page.click(".cm-content");
  await page.keyboard.type("veja [[Nota fantasma]] depois");
  await settle();
  await page.click(".kn-title"); // tira o foco do editor: o link vira link
  await noteLink("Nota fantasma").click();
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
