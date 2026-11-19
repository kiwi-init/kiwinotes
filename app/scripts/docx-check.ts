// O docx como no Word nas Notas (T21151, spec #21080), na janela de verdade: o AppEngine headless e a janela Notas num
// WebKit headless, com um relatório inventado de 20 páginas (o `docx-prova/make-doc.ts`). Confere as páginas, o ⌘F com
// as marcas, o zoom, nenhum pedido de rede, o arquivo igual byte a byte depois de abrir e fechar, e o motor solto ao
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
import { ABRE_MS, medirAte } from "../test/regua/conferir.ts";
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

  await check("o arquivo fica igual, byte a byte, depois de abrir e fechar", async () => {
    assert.deepEqual({ report: sha(REPORT), proposta: sha("Docs/proposta.docx") }, before);
  });
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}

for (const line of report) console.log(line);
console.log(`prints em ${out}`);
process.exit(failed ? 1 : 0);
