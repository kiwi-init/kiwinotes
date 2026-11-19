// O docx como no Word nas Notas (T21151, spec #21080), na janela de verdade: o AppEngine headless e a janela Notas num
// WebKit headless, com um relatório inventado de 20 páginas (o `docx-prova/make-doc.ts`). Confere as páginas, o ⌘F com
// as marcas, o zoom, nenhum pedido de rede, o arquivo igual byte a byte depois de abrir, rolar e fechar, e o motor solto ao
// trocar de arquivo. O tempo de abrir segue a régua (`ABRE_MS` e `medirAte`, de test/regua): o motor desenha num canvas,
// e esta é a prova do item 1 para o docx. Nada na tela de ninguém; os dados num tmp.
//
//   bun scripts/docx-check.ts [pasta dos prints]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Bookmark, Document, InternalHyperlink, Packer, PageBreak, Paragraph, TextRun } from "docx";
import { type Page, webkit } from "playwright-core";
import { partBytes, partText, readZip, writeZip } from "../src/shared/sheet/zip.ts";
import { ABRE_MS, medirAte } from "../test/regua/conferir.ts";
import { CHANGED_OUTSIDE } from "../ui/notes/files/docxSaver.ts";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21151-docx"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-docx-"));
const vault = join(data, "vault");
const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

const REPORT = "Docs/relatorio-estoque.docx";
mkdirSync(join(vault, "Docs"), { recursive: true });
const made = Bun.spawnSync([process.execPath, join(import.meta.dir, "docx-prova/make-doc.ts"), join(vault, REPORT)], { cwd: app });
assert.equal(made.exitCode, 0, made.stderr.toString());
put("Docs/proposta.docx", readFileSync(join(app, "test/fixtures/files/proposta.docx")));
put("Leia-me.md", "# Leia-me\n\nUma nota de exemplo.\n");
// Um link de dentro do documento, como o de um sumário: na 1ª página, aponta para um marcador na 4ª.
const INDICE = "Docs/indice.docx";
put(
  INDICE,
  await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new InternalHyperlink({ anchor: "conclusao", children: [new TextRun({ text: "Ir para a conclusão", style: "Hyperlink" })] })] }),
            ...[1, 2, 3].map((n) => new Paragraph({ children: [new TextRun(`Parte ${n} do relatório da loja de exemplo.`), new PageBreak()] })),
            new Paragraph({ children: [new Bookmark({ id: "conclusao", children: [new TextRun("Conclusão: o estoque fechou o mês em dia.")] })] }),
          ],
        },
      ],
    }),
  ),
);
// O docx que a pessoa edita (T21152): a proposta, numa cópia.
const EDITAR = "Docs/editar.docx";
const PROPOSTA = new Uint8Array(readFileSync(join(app, "test/fixtures/files/proposta.docx")));
put(EDITAR, PROPOSTA);
/** O texto do corpo de um docx, sem as marcas, e os trechos dele. */
const bodyOf = (bytes: Uint8Array) => {
  const parts = readZip(bytes);
  const xml = partText(bytes, parts.find((q) => q.name === "word/document.xml")!);
  return { parts, xml, text: xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "") };
};
/** A proposta com um parágrafo a mais no fim, como outro app gravaria. */
const fromOutside = (text: string) => {
  const { parts, xml } = bodyOf(PROPOSTA);
  const next = xml.replace("</w:body>", `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>`);
  assert.notEqual(next, xml, "o parágrafo de fora entrou");
  return writeZip(PROPOSTA, parts, new Map([["word/document.xml", new TextEncoder().encode(next)]]));
};
// O docx com controle de alterações (T21152): digitar logo depois da inserção do Bruno faz o motor gravar o parágrafo
// novo com uma letra por trecho, e é o tidyDocx que junta.
const EXTRAS = "Docs/extras.docx";
const extras = Bun.spawnSync([process.execPath, join(import.meta.dir, "docx-prova/make-extras.ts"), join(vault, EXTRAS)], { cwd: app });
assert.equal(extras.exitCode, 0, extras.stderr.toString());
// O docx que a pessoa formata e onde cola (T23238): outra cópia da proposta.
const FORMATAR = "Docs/formatar.docx";
put(FORMATAR, PROPOSTA);
const disk = (rel: string) => new Uint8Array(readFileSync(join(vault, rel)));
/** Os trechos (`w:r`) e os parágrafos (`w:p`) de um document.xml que têm `text`. */
const runsWith = (xml: string, text: string) => [...xml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((m) => m[0]).filter((r) => r.includes(text));
const parasWith = (xml: string, text: string) => [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]).filter((r) => r.replace(/<[^>]+>/g, "").includes(text));
const hasTag = (xml: string, tag: string) => new RegExp(`<w:${tag}(?: [^>]*)?/?>`).test(xml);
/** Espera o disco mudar (a gravação vem um instante depois da última tecla). */
const diskChange = async (rel: string, from: string, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (sha(rel) !== from) return disk(rel);
    await Bun.sleep(50);
  }
  throw new Error(`o ${rel} não mudou no disco em ${ms} ms`);
};
const sha = (rel: string) => createHash("sha256").update(readFileSync(join(vault, rel))).digest("hex");
const before = { report: sha(REPORT), proposta: sha("Docs/proposta.docx") };

async function cli(args: string[]): Promise<string> {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  const code = await p.exited;
  return code === 0 ? text : Promise.reject(new Error(text + (await new Response(p.stderr).text())));
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

const shot = async (p: Page, name: string) => {
  await p.screenshot({ path: join(out, `${name}.png`) });
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "85", join(out, `${name}.png`), "-o", join(out, `${name}.webp`)]);
  if (webp.exitCode !== 0) console.log(`sem o cwebp: ${name} ficou em PNG`);
};
const pageWidth = (p: Page) => p.locator(".docx-page").first().evaluate((el) => el.getBoundingClientRect().width);

let failed = false;
const report: string[] = [];
const check = async (name: string, fn: () => Promise<string | void>) => {
  try {
    report.push(`ok     ${name}${(await fn()) ?? ""}`);
  } catch (e) {
    failed = true;
    report.push(`FALHOU ${name}: ${(e as Error).message}`);
  }
};

await cli(["start", "--no-helper"]);
const browser = await webkit.launch({ headless: true });
try {
  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme, width: 1100, height: 760, motion: false, browser: "webkit", query: { note: REPORT } });
    const p = w.page;
    try {
      await check(`${theme}: o relatório abre em páginas, como no Word`, async () => {
        // A 1ª medida é a da janela que acabou de abrir; se passa do teto, a página recarrega e mede de novo (a regra da régua).
        let again = false;
        const { ms, ok, fria } = await medirAte(async () => {
          if (again) await p.reload();
          again = true;
          await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
          await p.waitForFunction(() => /\d+ páginas/.test(document.querySelector(".kn-file-pdf-page")?.textContent ?? ""), null, { timeout: 30000 });
        }, ABRE_MS);
        if (!ok) throw new Error(fria ? `a 1ª abertura levou ${ms[0]} ms (o teto dela é ${2 * ABRE_MS})` : `levou ${ms.join(", ")} ms em ${ms.length} medidas (o máximo é ${ABRE_MS})`);
        const pages = await p.locator(".kn-file-pdf-page").textContent();
        assert.equal(pages, "20 páginas");
        const text = await p.locator(".docx-page").first().innerText();
        assert.ok(text.includes("Relatório de estoque") && text.includes("Página 1 de 20"), text.slice(0, 200));
        // A folha é branca nos dois temas, como o papel.
        const bg = await p.locator(".docx-page").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.equal(bg, "rgb(255, 255, 255)");
        await p.waitForTimeout(600);
        // Sem anel de foco em volta das páginas.
        const ring = await p.locator(".docx-pages").evaluate((el) => getComputedStyle(el).boxShadow);
        assert.equal(ring, "none");
        await shot(p, `docx-${theme}`);
        assert.equal(await p.evaluate(() => window.__kiwiDocxLive), 1, "um motor vivo");
        return `: 20 páginas, a primeira com o cabeçalho e o rodapé, em ${ms.join(", ")} ms`;
      });
      if (theme === "dark") continue;

      await check("⌘F: acha sem acento, marca na página e anda pelos achados", async () => {
        await p.locator(".kn-file-docx-scroll").click({ position: { x: 20, y: 200 } });
        await p.keyboard.press("Meta+f");
        const focused = await p.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`);
        assert.equal(focused, "INPUT.kn-file-pdf-query");
        await p.keyboard.type("garrafa termica");
        await p.waitForFunction(() => /^1 de \d+$/.test(document.querySelector(".kn-file-pdf-count")?.textContent ?? ""), null, { timeout: 5000 });
        const count = (await p.locator(".kn-file-pdf-count").textContent())!;
        const total = Number(count.split(" de ")[1]);
        // "a garrafa térmica ficou abaixo do mínimo" uma vez por mês, e mais nas observações.
        assert.ok(total >= 10, count);
        await p.waitForSelector(".kn-file-docx-mark[data-current]", { timeout: 5000 });
        await p.keyboard.press("Enter");
        await p.keyboard.press("Enter");
        await p.waitForFunction(() => document.querySelector(".kn-file-pdf-count")?.textContent?.startsWith("3 de"), null, { timeout: 5000 });
        // O achado da vez à vista, embaixo da marca: o texto dele é o termo.
        await p.waitForTimeout(400);
        const under = await p.evaluate(() => {
          const m = document.querySelector<HTMLElement>(".kn-file-docx-mark[data-current]")!;
          const r = m.getBoundingClientRect();
          const scroll = document.querySelector(".kn-file-docx-scroll")!.getBoundingClientRect();
          return { visible: r.top >= scroll.top && r.bottom <= scroll.bottom, w: r.width, h: r.height };
        });
        assert.ok(under.visible && under.w > 40 && under.h > 8, JSON.stringify(under));
        await shot(p, "docx-busca");
        await p.keyboard.press("Escape");
        await p.waitForFunction(() => !document.querySelector(".kn-file-docx-mark"), null, { timeout: 5000 });
        return `: ${total} achados, a marca da vez à vista; o Esc limpa`;
      });

      await check("zoom: ⌘+ e ⌘0 desenham as páginas de novo na escala", async () => {
        const w0 = await pageWidth(p);
        await p.locator(".kn-file-docx-scroll").click({ position: { x: 20, y: 200 } });
        await p.keyboard.press("Meta+Equal");
        await p.waitForTimeout(400);
        const w1 = await pageWidth(p);
        const label = (await p.locator(".kn-file-pdf-zoom").textContent())!;
        const zoom = Number.parseInt(label, 10) / 100;
        assert.ok(zoom > 1, label);
        assert.ok(Math.abs(w1 / w0 - zoom) < 0.02, `${label}: ${w0} → ${w1}`);
        await shot(p, "docx-zoom");
        await p.keyboard.press("Meta+Digit0");
        await p.waitForTimeout(400);
        assert.ok(Math.abs((await pageWidth(p)) / w0 - 1) < 0.01);
        return `: ${label}, a página de ${Math.round(w0)} para ${Math.round(w1)} px`;
      });

      await check("tudo local e sem erro na página", async () => {
        assert.deepEqual(w.report.blocked, []);
        assert.deepEqual(w.report.problems, []);
      });

      // Caixa 6 do spec #21080 (T23170): rolar não é editar. Pela roda e pelo teclado até a última página e de volta; o
      // arquivo segue igual mesmo com o documento aberto, depois da espera de quem grava sozinho.
      await check("rolar até o fim e voltar não grava", async () => {
        const scroll = p.locator(".kn-file-docx-scroll");
        await scroll.hover();
        for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 2400);
        await scroll.click({ position: { x: 20, y: 20 } });
        await p.keyboard.press("PageDown");
        await p.keyboard.press("End");
        await p.waitForFunction(() => {
          const el = document.querySelector(".kn-file-docx-scroll")!;
          return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        }, null, { timeout: 5000 });
        const bottom = await scroll.evaluate((el) => el.scrollTop);
        await p.keyboard.press("Home");
        await p.waitForFunction(() => document.querySelector(".kn-file-docx-scroll")!.scrollTop < 4, null, { timeout: 5000 });
        await p.waitForTimeout(1200);
        assert.equal(sha(REPORT), before.report, "o relatório mudou no disco com ele aberto");
        return `: até ${Math.round(bottom)} px e de volta, o arquivo igual`;
      });

      await check("trocar de arquivo solta o motor", async () => {
        assert.equal(await p.evaluate(() => window.__kiwiDocxLive), 1, "o motor vivo antes de trocar");
        await p.click(".kn-crumb-bt");
        await p.click(".kn-tree-pop .kn-side-item[data-kind='note']");
        await p.waitForSelector(".kn-note-editor .cm-content", { timeout: 10000 });
        assert.equal(await p.locator(".docx-page, .docx-paginated-surface").count(), 0);
        // O DOM sai com o React mesmo sem o `destroy`: a conta do motor é a prova de que ele foi solto (revisão do T21151).
        assert.equal(await p.evaluate(() => window.__kiwiDocxLive), 0, "o motor solto");
      });
    } finally {
      await w.close();
    }
  }

  // O docx dos testes das Notas: o texto, a tabela e a imagem dentro das páginas.
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: { note: "Docs/proposta.docx" } });
    const p = w.page;
    try {
      await check("proposta.docx: título, tabela e imagem nas páginas", async () => {
        await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
        await p.waitForTimeout(400);
        const text = await p.locator(".docx-paginated-surface").innerText();
        for (const t of ["Proposta de mudança", "R$ 2.400,00", "& o orçamento <aprovado>.", "um link perigoso"]) assert.ok(text.includes(t), t);
        assert.ok((await p.locator(".docx-page img, .docx-page canvas, .docx-page svg image").count()) > 0, "a imagem");
        assert.deepEqual(w.report.blocked, []);
        await shot(p, "docx-proposta");
      });
    } finally {
      await w.close();
    }
  }

  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: { note: INDICE } });
    const p = w.page;
    try {
      await check("um link de dentro do documento rola até o marcador", async () => {
        await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
        assert.equal(await p.locator(".kn-file-pdf-page").textContent(), "4 páginas");
        const scroll = p.locator(".kn-file-docx-scroll");
        const before = await scroll.evaluate((el) => el.scrollTop);
        await p.locator(".docx-page a.docx-hyperlink", { hasText: "Ir para a conclusão" }).click();
        await p.waitForFunction((y) => document.querySelector(".kn-file-docx-scroll")!.scrollTop > y + 1000, before, { timeout: 5000 });
        await p.waitForTimeout(300);
        // A conclusão, na 4ª página, à vista.
        const seen = await p.evaluate(() => {
          const area = document.querySelector(".kn-file-docx-scroll")!.getBoundingClientRect();
          const last = [...document.querySelectorAll<HTMLElement>(".docx-page")].find((el) => el.innerText.includes("Conclusão"));
          const r = last?.getBoundingClientRect();
          return !!r && r.bottom > area.top && r.top < area.bottom;
        });
        assert.ok(seen, "a página da conclusão à vista");
      });
    } finally {
      await w.close();
    }
  }

  // Editar nas páginas e gravar (T21152).
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: { note: EDITAR } });
    const p = w.page;
    const typeAtEndOf = async (text: string, typed: string) => {
      const box = (await p.locator(".docx-page").first().getByText(text).first().boundingBox())!;
      await p.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
      await p.keyboard.press("End");
      await p.keyboard.type(typed, { delay: 15 });
    };
    // Quando um passo falha: o que a tela mostra, o aviso, os erros da página e o fim do texto no disco.
    const diag = async () => {
      const shown = await p.evaluate(() => ({
        state: document.querySelector(".kn-file")?.getAttribute("data-state"),
        live: window.__kiwiDocxLive,
        text: (document.querySelector(".docx-paginated-surface")?.textContent ?? "").slice(0, 120),
        note: document.querySelector(".kn-file-text-note")?.textContent ?? null,
      }));
      return `\n       tela: ${JSON.stringify(shown)}\n       disco: ${JSON.stringify(bodyOf(disk(EDITAR)).text.slice(0, 160))}\n       página: ${JSON.stringify(w.report.problems.slice(-5))}`;
    };
    const step = (name: string, fn: () => Promise<string | void>) =>
      check(name, async () => {
        try {
          return await fn();
        } catch (e) {
          await shot(p, `falhou-${name.slice(0, 24).replace(/\W+/g, "-")}`).catch(() => {});
          throw new Error(`${(e as Error).message.split("\n")[0]}${await diag()}`);
        }
      });
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
      await step("editar nas páginas grava o docx, e o resto do arquivo fica", async () => {
        const start = sha(EDITAR);
        await typeAtEndOf("Proposta de mudança", " da Ana");
        const t0 = Date.now();
        const saved = await diskChange(EDITAR, start);
        const after = Date.now() - t0;
        const { parts, xml, text } = bodyOf(saved);
        assert.ok(text.includes("Proposta de mudança da Ana"), text.slice(0, 120));
        // Os trechos juntos: nada de uma letra por trecho.
        const single = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].filter((m) => m[1]!.length === 1).length;
        assert.ok(single <= 1, `${single} trechos de uma letra`);
        // As outras partes do zip, com os mesmos bytes.
        const orig = readZip(PROPOSTA);
        const changed = parts.filter((q) => {
          const o = orig.find((x) => x.name === q.name);
          return !o || Buffer.compare(Buffer.from(partBytes(saved, q)), Buffer.from(partBytes(PROPOSTA, o))) !== 0;
        });
        assert.deepEqual(changed.map((q) => q.name), ["word/document.xml"], `mudaram: ${changed.map((q) => q.name).join(", ")}`);
        assert.equal(await p.locator(".kn-file-text-note").count(), 0, "sem aviso");
        // A dica do cabeçalho e do rodapé, que aparece ao editar, sai em português.
        const hints = await p.evaluate(() => {
          const el = document.querySelector(".docx-pages") ?? document.body;
          const css = getComputedStyle(el);
          return ["add-header", "add-footer", "edit-header", "edit-footer"].map((k) => css.getPropertyValue(`--docx-hf-${k}`));
        });
        assert.ok(hints.every((h) => h.includes("Clique duas vezes")), `dicas: ${hints.join(" | ")}`);
        await shot(p, "docx-editado");
        return `: grava ${after} ms depois da última tecla; só o document.xml mudou`;
      });

      await step("⌘Z desfaz e grava de novo", async () => {
        const start = sha(EDITAR);
        for (let i = 0; i < 12 && (await p.locator(".docx-paginated-surface").innerText()).includes("da Ana"); i++) {
          await p.keyboard.press("Meta+z");
          await p.waitForTimeout(80);
        }
        const saved = await diskChange(EDITAR, start);
        assert.ok(!bodyOf(saved).text.includes("da Ana"));
        assert.ok(bodyOf(saved).text.includes("Proposta de mudança\n"));
      });

      await step("o arquivo mudou fora do Kiwi, sem edição por gravar: abre o novo, sem aviso", async () => {
        writeFileSync(join(vault, EDITAR), fromOutside("Nota do Bruno, de outro app."));
        await p.waitForFunction(() => document.querySelector(".docx-paginated-surface")?.textContent?.includes("Nota do Bruno"), null, { timeout: 10000 });
        assert.equal(await p.locator(".kn-file-text-note").count(), 0, "sem aviso");
      });

      await step("mudou fora com uma edição por gravar: vale o de fora, e a barra avisa", async () => {
        await typeAtEndOf("Proposta de mudança", " (rascunho)");
        const outside = fromOutside("Versão da Carla, de outro app.");
        writeFileSync(join(vault, EDITAR), outside);
        await p.waitForSelector(".kn-file-text-note", { timeout: 10000 });
        assert.equal(await p.locator(".kn-file-text-note").textContent(), CHANGED_OUTSIDE);
        await p.waitForFunction(() => document.querySelector(".docx-paginated-surface")?.textContent?.includes("Versão da Carla"), null, { timeout: 10000 });
        await p.waitForTimeout(800);
        assert.deepEqual(disk(EDITAR), outside, "o disco fica com o de fora");
        await shot(p, "docx-mudou-fora");
      });

      await step("sair do docx logo depois de digitar grava antes de sair", async () => {
        await p.waitForTimeout(300);
        const start = sha(EDITAR);
        await typeAtEndOf("Proposta de mudança", " final");
        // Antes dos 400 ms da gravação: troca para a nota.
        await p.click(".kn-crumb-bt");
        await p.click(".kn-tree-pop .kn-side-item[data-kind='note']");
        await p.waitForSelector(".kn-note-editor .cm-content", { timeout: 10000 });
        const saved = await diskChange(EDITAR, start, 3000);
        assert.ok(/Proposta de mudança final\n/.test(bodyOf(saved).text), `no disco: ${bodyOf(saved).text.slice(0, 80)}`);
        assert.equal(await p.evaluate(() => window.__kiwiDocxLive), 0, "o motor solto");
      });
    } finally {
      await w.close();
    }
  }

  // Os trechos de uma letra (T21152): o caso em que o motor grava o parágrafo novo letra por letra.
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: { note: EXTRAS } });
    const p = w.page;
    try {
      await check("um parágrafo novo depois de uma inserção grava num trecho só, não uma letra por trecho", async () => {
        await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
        const start = sha(EXTRAS);
        const box = (await p.locator(".docx-page").first().getByText("terça-feira").first().boundingBox())!;
        await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await p.keyboard.press("End");
        await p.keyboard.type(" A Ana conferiu a contagem de novo.", { delay: 5 });
        await p.keyboard.press("Enter");
        await p.keyboard.type("Linha nova escrita no Kiwi.", { delay: 5 });
        await diskChange(EXTRAS, start);
        // Espera a última gravação: o disco para de mudar.
        let last = sha(EXTRAS);
        for (let i = 0; i < 20; i++) {
          await p.waitForTimeout(250);
          const now = sha(EXTRAS);
          if (now === last && i > 3) break;
          last = now;
        }
        const { xml, text } = bodyOf(disk(EXTRAS));
        assert.ok(text.includes("Linha nova escrita no Kiwi."), text.slice(0, 200));
        const single = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].filter((m) => m[1]!.length === 1).length;
        assert.ok(xml.includes(">Linha nova escrita no Kiwi.</w:t>"), `o parágrafo novo saiu em ${single} trechos de uma letra`);
        return `: o parágrafo novo num trecho só (${single} trechos de uma letra no documento)`;
      });
    } finally {
      await w.close();
    }
  }

  // Formatar, colar e o mouse (T23238): a barra das Notas e os atalhos dela gravam no docx, o HTML de fora entra limpo.
  {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: { note: FORMATAR } });
    const p = w.page;
    const bar = p.locator(".kn-file-docx-fmt");
    /** Onde está uma palavra na 1ª página (o retângulo dela, pelo texto). */
    const wordBox = (word: string) =>
      p.evaluate((word) => {
        // O texto da página inteira (o motor quebra as palavras em pedaços e usa o espaço fixo), e cada letra no nó dela.
        const root = document.querySelector(".docx-page")!;
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const at: { node: Text; i: number }[] = [];
        let all = "";
        for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
          for (let i = 0; i < n.data.length; i++) at.push({ node: n, i });
          all += n.data.replace(/\u00a0/g, " ");
        }
        const k = all.indexOf(word);
        if (k < 0) throw new Error(`sem "${word}" na página`);
        const r = document.createRange();
        r.setStart(at[k]!.node, at[k]!.i);
        const end = at[k + word.length - 1]!;
        r.setEnd(end.node, end.i + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top, width: b.width, height: b.height };
      }, word);
    const selected = () => p.evaluate(() => (window.getSelection()?.toString() ?? "").replace(/\u00a0/g, " ").trim());
    const dbl = async (word: string) => {
      // Longe do último clique: o motor contaria este como o 3º.
      await p.waitForTimeout(600);
      const b = await wordBox(word);
      await p.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
      await p.waitForTimeout(150);
    };
    const caretAtEnd = async (word: string) => {
      const b = await wordBox(word);
      await p.mouse.click(b.x + b.width - 1, b.y + b.height / 2);
      await p.keyboard.press("End");
      await p.waitForTimeout(100);
    };
    /** Espera a gravação acabar: o disco mudou e parou de mudar. */
    const saved = async (start: string) => {
      await diskChange(FORMATAR, start);
      let last = sha(FORMATAR);
      for (let i = 0; i < 20; i++) {
        await p.waitForTimeout(150);
        const now = sha(FORMATAR);
        if (now === last && i > 3) break;
        last = now;
      }
      return bodyOf(disk(FORMATAR)).xml;
    };
    /** Um colar como o do macOS: o evento com o texto e o HTML na área de transferência. */
    const paste = (text: string, html: string | null) =>
      p.evaluate(
        ([text, html]) => {
          const dt = new DataTransfer();
          dt.setData("text/plain", text!);
          if (html) dt.setData("text/html", html);
          const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
          (document.activeElement ?? document.querySelector(".docx-pages"))!.dispatchEvent(ev);
        },
        [text, html] as const,
      );
    const fstep = (name: string, fn: () => Promise<string | void>) =>
      check(name, async () => {
        try {
          return await fn();
        } catch (e) {
          await shot(p, `falhou-${name.slice(0, 24).replace(/\W+/g, "-")}`).catch(() => {});
          throw new Error(`${(e as Error).message.split("\n")[0]}\n       página: ${JSON.stringify(w.report.problems.slice(-5))}`);
        }
      });
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });

      await fstep("o mouse: duplo, triplo clique e arrastar selecionam, e a barra aparece em cima; um clique a esconde", async () => {
        await dbl("documento");
        assert.equal(await selected(), "documento", "o duplo clique pega a palavra");
        await bar.waitFor({ state: "visible", timeout: 3000 });
        const word = await wordBox("documento");
        const box = (await bar.boundingBox())!;
        assert.ok(box.y + box.height <= word.y, `a barra em cima da palavra (barra ${box.y + box.height}, palavra ${word.y})`);
        const b = await wordBox("Cadeiras novas");
        await p.waitForTimeout(600);
        await p.mouse.click(b.x + 4, b.y + b.height / 2, { clickCount: 3 });
        await p.waitForTimeout(150);
        assert.ok((await selected()).includes("Cadeiras novas"), `o triplo clique pega o parágrafo: ${await selected()}`);
        await bar.waitFor({ state: "visible", timeout: 3000 });
        const from = await wordBox("descreve a mudança");
        await p.mouse.move(from.x + 1, from.y + from.height / 2);
        await p.mouse.down();
        await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 6 });
        await p.mouse.move(from.x + from.width - 1, from.y + from.height / 2, { steps: 6 });
        await p.mouse.up();
        await p.waitForTimeout(150);
        assert.equal(await selected(), "descreve a mudança", "arrastar seleciona");
        await bar.waitFor({ state: "visible", timeout: 3000 });
        await p.waitForTimeout(600);
        await p.mouse.click(from.x + 1, from.y + from.height / 2);
        await bar.waitFor({ state: "hidden", timeout: 3000 });
        assert.equal(await selected(), "", "o clique põe o cursor, sem seleção");
      });

      await fstep("a barra: negrito e alinhamento gravam no docx, e o botão acende", async () => {
        const start = sha(FORMATAR);
        await dbl("documento");
        await p.click(".kn-fmt-bold");
        await p.waitForSelector(".kn-fmt-bold[aria-pressed='true']", { timeout: 3000 });
        await shot(p, "docx-barra");
        await p.click(".kn-fmt-center");
        const xml = await saved(start);
        const runs = runsWith(xml, "documento");
        assert.ok(runs.some((r) => hasTag(r, "b")), `negrito: ${runs.join(" ").slice(0, 200)}`);
        assert.ok(!runsWith(xml, "descreve").some((r) => hasTag(r, "b")), "só a palavra");
        assert.ok(/<w:jc w:val="center"\/>/.test(parasWith(xml, "Este documento")[0] ?? ""), "centralizado");
      });

      await fstep("o teclado das Notas: ⇧⌘X tacha, ⌘1 põe o título e tira, ⇧⌘8 faz a lista", async () => {
        let start = sha(FORMATAR);
        await dbl("orçamento");
        await p.keyboard.press("Meta+Shift+x");
        let xml = await saved(start);
        assert.ok(runsWith(xml, "orçamento").some((r) => hasTag(r, "strike")), "tachado");
        start = sha(FORMATAR);
        await caretAtEnd("Este documento");
        await p.keyboard.press("Meta+1");
        xml = await saved(start);
        assert.ok(/<w:pStyle w:val="Heading1"\/>/.test(parasWith(xml, "Este documento")[0] ?? ""), "título 1");
        start = sha(FORMATAR);
        await p.keyboard.press("Meta+1");
        xml = await saved(start);
        assert.ok(!/<w:pStyle w:val="Heading1"\/>/.test(parasWith(xml, "Este documento")[0] ?? ""), `o ⌘1 de novo tira o título: ${parasWith(xml, "Este documento")[0]?.slice(0, 160)}`);
        start = sha(FORMATAR);
        await p.keyboard.press("Meta+Shift+8");
        xml = await saved(start);
        assert.ok(hasTag(parasWith(xml, "Este documento")[0] ?? "", "numPr"), "a lista");
      });

      await fstep("colar de uma página: fica o negrito e o itálico, sai a fonte e a cor", async () => {
        const start = sha(FORMATAR);
        await caretAtEnd("Iluminação");
        await p.keyboard.press("Enter");
        await paste(
          "Ana trouxe a lista",
          `<meta charset="utf-8"><p style="font-family:'Comic Sans MS';color:#ff0000;font-size:30px;background:yellow"><b>Ana</b> trouxe <span style="font-style:italic;color:#ff0000">a lista</span></p>`,
        );
        const xml = await saved(start);
        assert.ok(bodyOf(disk(FORMATAR)).text.includes("Ana trouxe a lista"), "o texto colado");
        assert.ok(runsWith(xml, "Ana").some((r) => hasTag(r, "b")), "o negrito");
        assert.ok(runsWith(xml, "a lista").some((r) => hasTag(r, "i")), "o itálico");
        const junk = ["Comic Sans", "FF0000", "w:sz w:val=\"60\"", "w:highlight", "w:shd"].filter((j) => xml.toUpperCase().includes(j.toUpperCase()));
        assert.deepEqual(junk, [], "sem o estilo de fora");
      });

      await fstep("colar texto com a fonte de fora e nada mais: entra como texto, na letra do documento", async () => {
        const start = sha(FORMATAR);
        await p.keyboard.press("Enter");
        await paste("Recado do Bruno", `<span style="font-family:'Comic Sans MS';color:#ff0000">Recado do Bruno</span>`);
        const xml = await saved(start);
        const runs = runsWith(xml, "Recado do Bruno");
        assert.ok(runs.length > 0, "o texto colado");
        assert.ok(!runs.some((r) => /Comic Sans|FF0000/i.test(r)), `sem a fonte e a cor: ${runs.join(" ").slice(0, 200)}`);
      });

      await fstep("colar de outro docx: o trecho copiado vem com a formatação do documento", async () => {
        const start = sha(FORMATAR);
        await dbl("documento");
        const html = await p.evaluate(() => {
          const dt = new DataTransfer();
          document.activeElement!.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
          return dt.getData("text/html");
        });
        assert.ok(html.includes("data-docx-fragment"), "a cópia do motor");
        await caretAtEnd("Recado do Bruno");
        await p.keyboard.press("Enter");
        await paste("documento", html);
        const xml = await saved(start);
        assert.ok(runsWith(xml, "documento").filter((r) => hasTag(r, "b")).length >= 2, "o negrito veio junto");
      });

      await fstep("o docx gravado reabre com a formatação", async () => {
        const again = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1100, height: 760, motion: false, browser: "webkit", query: { note: FORMATAR } });
        try {
          const q = again.page;
          await q.waitForSelector(".kn-file[data-state='ready'] .docx-page", { timeout: 30000 });
          const style = (word: string) =>
            q.evaluate((word) => {
              const walk = document.createTreeWalker(document.querySelector(".docx-page")!, NodeFilter.SHOW_TEXT);
              for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                if (!n.nodeValue!.replace(/\u00a0/g, " ").includes(word.split(" ")[0]!)) continue;
                const css = getComputedStyle(n.parentElement!);
                return { weight: Number(css.fontWeight), line: css.textDecorationLine, family: css.fontFamily };
              }
              return null;
            }, word);
          assert.ok(((await style("documento"))?.weight ?? 0) >= 600, `negrito: ${JSON.stringify(await style("documento"))}`);
          assert.ok((await style("orçamento"))?.line.includes("line-through"), `tachado: ${JSON.stringify(await style("orçamento"))}`);
          assert.ok(((await style("Ana"))?.weight ?? 0) >= 600, "o negrito colado");
          assert.ok(!/comic/i.test((await style("Recado do Bruno"))?.family ?? ""), "sem a fonte de fora");
        } finally {
          await again.close();
        }
      });
    } finally {
      await w.close();
    }
  }

  await check("o arquivo fica igual, byte a byte, depois de abrir, rolar e fechar", async () => {
    assert.deepEqual({ report: sha(REPORT), proposta: sha("Docs/proposta.docx") }, before);
  });
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}

for (const line of report) console.log(line);
console.log(`prints em ${out}`);
process.exit(failed ? 1 : 0);
