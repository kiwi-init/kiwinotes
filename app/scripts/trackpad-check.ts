// O trackpad em todo arquivo (T21238, spec #21198), no app de verdade (o AppEngine headless) e num WebKit headless.
// Os arquivos são inventados aqui, num tmp. Nada na tela de ninguém, e nenhum gesto de verdade: a pinça vai como os
// eventos que o WebKit do app entrega (`gesturestart`/`gesturechange`/`gestureend`, com a escala e o ponto dos dedos) e
// como a rolagem com ctrl dos outros navegadores.
//
// - A pinça dá zoom centrada nos dedos na planilha (xlsx e csv), no docx, no pdf, na imagem, no texto e no código, e
//   na nota, no diagrama do draw.io e no vídeo (T22178): o que estava embaixo dos dedos continua lá, maior.
// - Na nota, o texto quebra de novo com o zoom: a letra embaixo dos dedos fica parada, e o clique com zoom cai na letra
//   certa.
// - ⌘+, ⌘− e ⌘0 fazem o mesmo.
// - Rolar na diagonal uma planilha de 50.000 linhas e 300 colunas, com a roda do trackpad, não mostra área em branco:
//   a cada quadro, os pontos da área da grade caem numa célula.
// - Rolar para o lado numa planilha larga, até passar da borda, nunca sai do arquivo.
//
//   bun scripts/trackpad-check.ts [pasta]          (ONLY=lista: só os arquivos com esse pedaço no nome;
//                                                   VIDEO=1: grava um vídeo de cada um, com a pinça devagar)
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Page, webkit } from "playwright-core";
import * as XLSX from "xlsx";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T21238-trackpad"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-trackpad-"));
const vault = join(data, "vault");

const put = (rel: string, bytes: Uint8Array | string) => {
  mkdirSync(dirname(join(vault, rel)), { recursive: true });
  writeFileSync(join(vault, rel), bytes);
};

// A planilha grande: 50.000 linhas e 300 colunas. Esparsa, para o arquivo ficar pequeno: a linha 1 com os títulos, a
// coluna A com o pedido, a última com o total, e uma célula a cada 50 no meio (o xml do xlsx tem um limite).
{
  const ws: XLSX.WorkSheet = {};
  const set = (r: number, c: number, v: string | number) => {
    ws[XLSX.utils.encode_cell({ r, c })] = typeof v === "number" ? { t: "n", v } : { t: "s", v };
  };
  for (let c = 0; c < 300; c++) set(0, c, c === 0 ? "Pedido" : c === 299 ? "Total" : `Item ${c}`);
  for (let r = 1; r < 50_000; r++) {
    set(r, 0, r);
    set(r, 299, (r % 97) + 0.5);
    for (let c = 1 + (r % 50); c < 299; c += 50) set(r, c, (r * c) % 1000);
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 49_999, c: 299 } });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, "Pedidos");
  put("Loja/pedidos-grande.xlsx", new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer));
}
const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro"];
put(
  "Loja/precos.csv",
  `Produto;Preço;${months.map((m) => `Estoque em ${m}`).join(";")}\n${Array.from({ length: 300 }, (_, i) => `Produto de exemplo ${i + 1};${(i % 50) + 0.9};${months.map((_, m) => (i + m) % 13).join(";")}`).join("\n")}\n`,
);
put("Docs/proposta.docx", readFileSync(join(app, "test/fixtures/files/proposta.docx")));
put("Docs/relatorio.pdf", readFileSync(join(app, "test/fixtures/files/relatorio.pdf")));
put(
  "Docs/mapa.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e8f1e4"/>${Array.from(
    { length: 48 },
    (_, i) => `<rect x="${(i % 8) * 100 + 10}" y="${Math.floor(i / 8) * 100 + 10}" width="80" height="80" rx="8" fill="hsl(${i * 7},45%,60%)"/>`,
  ).join("")}</svg>`,
);
put("Docs/lista.txt", `${Array.from({ length: 400 }, (_, i) => `Linha ${i + 1} da lista`).join("\n")}\n`);
put("Docs/exemplo.ts", `${Array.from({ length: 300 }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`);
// A nota: linhas curtas (cada uma inteira na largura, para medir a altura dela) e depois parágrafos longos, que quebram
// de novo quando a coluna cresce.
const paragraph = (i: number) =>
  `Parágrafo ${i} de exemplo: a horta comunitária do bairro recebe voluntários aos sábados, e cada canteiro tem uma placa com o nome da planta, a data do plantio e quem cuida dele naquela semana.`;
put(
  "Leia-me.md",
  `# Leia-me\n\n${Array.from({ length: 60 }, (_, i) => `Linha ${i + 1} da nota de exemplo`).join("\n\n")}\n\n${Array.from({ length: 30 }, (_, i) => paragraph(i + 1)).join("\n\n")}\n`,
);
// O diagrama: 6 × 5 caixas, alto o bastante para que, com 2×, o papel passe da área e role.
put(
  "Docs/fluxo.drawio",
  `<mxfile><diagram id="d1" name="Página-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${Array.from(
    { length: 30 },
    (_, i) =>
      `<mxCell id="c${i}" value="Etapa ${i + 1}" style="rounded=1;whiteSpace=wrap;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="${(i % 6) * 150}" y="${Math.floor(i / 6) * 110}" width="120" height="80" as="geometry"/></mxCell>`,
  ).join("")}</root></mxGraphModel></diagram></mxfile>`,
);
// O vídeo: 1600 × 900, maior que a área, para começar ajustado. Um padrão de teste do ffmpeg, sem nada de ninguém.
{
  const file = join(vault, "Docs/painel.mp4");
  const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1600x900:rate=10:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
  assert.equal(ff.exitCode, 0, `ffmpeg: ${ff.stderr.toString()}`);
}

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

/** Uma pinça como o WebKit do app entrega: começo, a escala subindo até `to` em `steps` passos, e o fim. */
async function pinch(p: Page, area: string, at: { x: number; y: number }, to: number, steps = 8) {
  await p.locator(area).first().evaluate(
    async (el, [x, y, scale, n]) => {
      const fire = (type: string, s: number) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(e, { scale: { value: s }, clientX: { value: x }, clientY: { value: y } });
        el.dispatchEvent(e);
      };
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      fire("gesturestart", 1);
      for (let i = 1; i <= n!; i++) {
        fire("gesturechange", 1 + ((scale! - 1) * i) / n!);
        await frame();
      }
      fire("gestureend", scale!);
      await frame();
      await frame();
    },
    [at.x, at.y, to, steps],
  );
  await p.waitForTimeout(200);
}

/** A pinça fora do app (a rolagem com ctrl), no mesmo ponto. */
async function ctrlWheel(p: Page, area: string, at: { x: number; y: number }, deltaY: number) {
  await p.locator(area).first().evaluate(
    async (el, [x, y, d]) => {
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: d, clientX: x, clientY: y }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    },
    [at.x, at.y, deltaY],
  );
  await p.waitForTimeout(200);
}

/**
 * O que está embaixo do ponto: o elemento (achado de novo depois pelo `key`) e onde o ponto cai dentro dele, em fração
 * da largura e da altura.
 */
type Probe = { key: string; fx: number; fy: number; w: number; h: number };
async function probe(p: Page, at: { x: number; y: number }, keySel: string): Promise<Probe> {
  return p.evaluate(
    ([x, y, sel]) => {
      const el = document.elementFromPoint(x as number, y as number)?.closest(sel as string) as HTMLElement | null;
      if (!el) throw new Error(`nada de ${sel} em ${x},${y}`);
      const all = [...document.querySelectorAll(sel as string)];
      const key = el.dataset.r !== undefined ? `[data-r="${el.dataset.r}"][data-c="${el.dataset.c}"]` : `#${all.indexOf(el)}:${el.textContent?.slice(0, 40)}`;
      const r = el.getBoundingClientRect();
      return { key, fx: ((x as number) - r.left) / r.width, fy: ((y as number) - r.top) / r.height, w: r.width, h: r.height };
    },
    [at.x, at.y, keySel],
  );
}
/** O mesmo elemento de antes, de novo: o tamanho dele e onde o ponto cai agora. */
async function again(p: Page, at: { x: number; y: number }, keySel: string, before: Probe): Promise<Probe> {
  return p.evaluate(
    ([x, y, sel, key]) => {
      const k = key as string;
      let el: Element | null;
      if (k.startsWith("[")) el = document.querySelector(`${sel}${k}`);
      else {
        const text = k.slice(k.indexOf(":") + 1);
        el = [...document.querySelectorAll(sel as string)].find((e) => (e.textContent ?? "").slice(0, 40) === text) ?? null;
        if (!el) el = document.querySelectorAll(sel as string)[Number(k.slice(1, k.indexOf(":")))] ?? null;
      }
      if (!el) throw new Error(`sumiu: ${k}`);
      const r = el.getBoundingClientRect();
      return { key: k, fx: ((x as number) - r.left) / r.width, fy: ((y as number) - r.top) / r.height, w: r.width, h: r.height };
    },
    [at.x, at.y, keySel, before.key],
  );
}

/** Uma linha da nota: a que está em edição (`.cm-line`) ou um parágrafo mostrado pronto (`p`). */
const NOTE_LINE = ".kn-page .cm-content p, .kn-page .cm-line";

interface Case {
  file: string;
  /** O lugar que rola, onde a pinça cai. */
  area: string;
  /** O que fica embaixo dos dedos (com `data-r`/`data-c`, ou achado pelo texto). */
  under: string;
  /** Onde ficam os dedos, em fração da área. */
  at: [number, number];
  /** Só no eixo que cresce: o texto quebra na largura da nota, então a largura da linha não muda. */
  axis?: "both" | "y";
  /** Pronto para medir (dentro do arquivo aberto). */
  ready: string;
  /** Pronto para medir, quando não é um arquivo (a nota). */
  page?: string;
}

const CASES: Case[] = [
  { file: "Loja/pedidos-grande.xlsx", area: ".kn-grid", under: ".kn-grid-cell", at: [0.55, 0.6], ready: ".kn-grid .kn-grid-cell" },
  { file: "Loja/precos.csv", area: ".kn-grid", under: ".kn-grid-cell", at: [0.12, 0.5], ready: ".kn-grid .kn-grid-cell" },
  { file: "Docs/proposta.docx", area: ".kn-file-docx-scroll", under: ".docx-page", at: [0.5, 0.3], ready: ".docx-page" },
  { file: "Docs/relatorio.pdf", area: ".kn-file-pdf-scroll", under: ".kn-file-pdf-sheet", at: [0.5, 0.4], ready: ".kn-file-pdf-sheet canvas" },
  { file: "Docs/mapa.svg", area: ".kn-file-image-area", under: ".kn-file-image-img", at: [0.6, 0.55], ready: ".kn-file-image-img" },
  { file: "Docs/lista.txt", area: ".kn-file-text-editor .cm-scroller", under: ".cm-line", at: [0.3, 0.5], axis: "y", ready: ".cm-line" },
  { file: "Docs/exemplo.ts", area: ".kn-file-text-editor .cm-scroller", under: ".cm-line", at: [0.3, 0.5], axis: "y", ready: ".cm-line" },
  { file: "Leia-me.md", area: ".kn-center", under: NOTE_LINE, at: [0.3, 0.5], axis: "y", ready: "", page: ".kn-page .cm-content" },
  { file: "Docs/fluxo.drawio", area: ".kn-file-drawio-area", under: ".kn-file-drawio-graph", at: [0.55, 0.45], ready: ".kn-file-drawio-graph svg" },
  { file: "Docs/painel.mp4", area: ".kn-file-media", under: ".kn-file-media-player", at: [0.6, 0.55], ready: ".kn-file-media[data-loaded] .kn-file-media-player" },
];
const only = (name: string) => !process.env.ONLY || process.env.ONLY.split(",").some((o) => name.includes(o));

/** Quanto o ponto embaixo dos dedos pode andar, em px da tela: só o arredondamento. */
const DRIFT_PX = 3;
/** O vídeo do PR: a pinça devagar, para ver. */
const video = process.env.VIDEO ? join(out, "video") : undefined;

let failed = false;
const report: string[] = [];
await cli(["start", "--no-helper"]);
const browser = await webkit.launch({ headless: true });
try {
  // 1. A pinça, o ctrl+roda e o ⌘+/⌘−/⌘0 em cada tipo.
  for (const c of CASES.filter((x) => only(x.file))) {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1000, height: 680, motion: false, browser: "webkit", video, query: { note: c.file } });
    const p = w.page;
    try {
      await p.waitForSelector(c.page ?? `.kn-file[data-state='ready'] ${c.ready}`, { timeout: 30000 });
      await p.waitForTimeout(500);
      const a = (await p.locator(c.area).first().boundingBox())!;
      const at = { x: a.x + a.width * c.at[0], y: a.y + a.height * c.at[1] };
      const b0 = await probe(p, at, c.under);
      if (video) await p.waitForTimeout(700);
      await pinch(p, c.area, at, 2, video ? 45 : 8);
      if (video) await p.waitForTimeout(700);
      const b1 = await again(p, at, c.under, b0);
      const grow = c.axis === "y" ? b1.h / b0.h : b1.w / b0.w;
      assert.ok(grow > 1.6 && grow < 2.4, `${c.file}: a pinça para 2× cresceu ${grow.toFixed(2)}×`);
      // Centrada nos dedos: o ponto cai no mesmo elemento, quase no mesmo lugar dele.
      // Onde o ponto do elemento que estava embaixo dos dedos foi parar, em px da tela.
      const drift = Math.max(c.axis === "y" ? 0 : Math.abs(b1.fx - b0.fx) * b1.w, Math.abs(b1.fy - b0.fy) * b1.h);
      assert.ok(drift <= DRIFT_PX, `${c.file}: o ponto andou ${drift.toFixed(1)} px de baixo dos dedos (${JSON.stringify({ b0, b1 })})`);
      await p.screenshot({ path: join(out, `${c.file.split("/").at(-1)!.replace(/\W/g, "-")}-pinca.png`) });
      // Fechar os dedos volta (a pinça dos outros navegadores, pela roda com ctrl).
      await ctrlWheel(p, c.area, at, 100 * Math.log(2));
      const b2 = await again(p, at, c.under, b0);
      const back = c.axis === "y" ? b2.h / b0.h : b2.w / b0.w;
      assert.ok(Math.abs(back - 1) < 0.08, `${c.file}: ctrl+roda para fechar deu ${back.toFixed(2)}×`);
      // ⌘+ duas vezes, ⌘− uma, ⌘0 volta a 100% (ou ao ajuste).
      await p.locator(c.area).first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      await p.keyboard.press("Meta+Equal");
      await p.keyboard.press("Meta+Equal");
      await p.waitForTimeout(250);
      const k2 = await again(p, at, c.under, b0).catch(() => null);
      await p.keyboard.press("Meta+Minus");
      await p.waitForTimeout(250);
      await p.keyboard.press("Meta+Digit0");
      await p.waitForTimeout(300);
      const k0 = await again(p, at, c.under, b0).catch(() => null);
      const size = (x: Probe | null) => (x ? (c.axis === "y" ? x.h : x.w) : 0);
      assert.ok(size(k2) > size(b0) * 1.1, `${c.file}: ⌘+ não aumentou`);
      assert.ok(k0 && Math.abs(size(k0) / size(b0) - 1) < 0.08, `${c.file}: ⌘0 não voltou (${size(k0)} vs ${size(b0)})`);
      // A imagem começa no ajuste à janela, com sobra dos lados. Fechar a pinça abaixo do ajuste: ela volta ao meio da
      // área (como no Preview), e abrir de novo, já no canto, deixa o ponto embaixo dos dedos.
      if (c.file.endsWith(".svg")) {
        const center = async () => {
          const area = (await p.locator(c.area).first().boundingBox())!;
          const img = (await p.locator(c.under).first().boundingBox())!;
          return { dx: img.x + img.width / 2 - (area.x + area.width / 2), w: img.width, side: img.x - area.x };
        };
        const fit = await center();
        assert.ok(fit.side > 40, `${c.file}: no ajuste, a imagem tem sobra dos lados (${fit.side.toFixed(0)} px)`);
        await pinch(p, c.area, at, 0.6);
        const small = await center();
        assert.ok(small.w < fit.w * 0.7 && Math.abs(small.dx) <= DRIFT_PX, `${c.file}: abaixo do ajuste, a imagem no meio (${JSON.stringify(small)})`);
        await p.keyboard.press("Meta+Digit0");
        await p.waitForTimeout(300);
        const s0 = await probe(p, at, c.under);
        // 2×: com 1,7×, a imagem sobra pouco da área, e a rolagem acaba antes (o ponto não tem para onde ir, como no Preview).
        await pinch(p, c.area, at, 2);
        const s1 = await again(p, at, c.under, s0);
        const fromFit = Math.max(Math.abs(s1.fx - s0.fx) * s1.w, Math.abs(s1.fy - s0.fy) * s1.h);
        assert.ok(fromFit <= DRIFT_PX, `${c.file}: do ajuste (centrada) para o zoom, o ponto andou ${fromFit.toFixed(1)} px`);
        report.push(`ok     ${c.file}: do ajuste centrado, o ponto andou ${fromFit.toFixed(1)} px; abaixo do ajuste, a imagem volta ao meio`);
      }
      report.push(`ok     ${c.file}: pinça 2× (${grow.toFixed(2)}×, o ponto andou ${drift.toFixed(1)} px), ctrl+roda volta, ⌘+ ⌘− ⌘0`);
    } catch (e) {
      failed = true;
      report.push(`FALHOU ${c.file}: ${(e as Error).message}`);
    } finally {
      await w.close();
    }
  }

  // 2. A planilha grande na diagonal, com a roda do trackpad, medindo cada quadro; e para o lado até passar da borda.
  if (only("pedidos-grande")) {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "dark", width: 1000, height: 680, motion: false, browser: "webkit", query: { note: "Loja/pedidos-grande.xlsx" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-file[data-state='ready'] .kn-grid .kn-grid-cell", { timeout: 60000 });
      assert.match((await p.locator(".kn-file-table-foot").textContent()) ?? "", /^50\.000 linhas, 300 colunas/);
      const g = (await p.locator(".kn-grid").boundingBox())!;
      // Um amostrador em cada quadro: 12 pontos da área das células (fora da linha das letras e da coluna dos números).
      await p.evaluate(() => {
        const grid = document.querySelector<HTMLElement>(".kn-grid")!;
        const s = { frames: 0, holes: 0, worst: "" , on: true };
        (window as unknown as { __holes: typeof s }).__holes = s;
        const tick = () => {
          if (!s.on) return;
          const r = grid.getBoundingClientRect();
          const n = grid.querySelector(".kn-grid-corner")!.getBoundingClientRect();
          s.frames++;
          let miss = 0;
          for (const fx of [0.15, 0.45, 0.75, 0.97]) for (const fy of [0.2, 0.55, 0.95]) {
            const x = n.right + (r.right - 2 - n.right) * fx;
            const y = n.bottom + (r.bottom - 2 - n.bottom) * fy;
            if (!document.elementFromPoint(x, y)?.closest(".kn-grid-cell, .kn-grid-n")) miss++;
          }
          if (miss) {
            s.holes++;
            s.worst ||= `${grid.scrollLeft},${grid.scrollTop}: ${miss}`;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      // A inércia do trackpad: passos grandes que vão diminuindo, na diagonal, várias vezes.
      for (let round = 0; round < 6; round++) for (let v = 120; v > 2; v *= 0.85) await p.mouse.wheel(v * 1.3, v);
      await p.waitForTimeout(300);
      const pos = await p.locator(".kn-grid").evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
      const s = await p.evaluate(() => {
        const h = (window as unknown as { __holes: { frames: number; holes: number; worst: string; on: boolean } }).__holes;
        h.on = false;
        return h;
      });
      assert.ok(pos.left > 2000 && pos.top > 1500, `a diagonal rolou ${JSON.stringify(pos)}`);
      assert.equal(s.holes, 0, `quadros com área em branco: ${s.holes} de ${s.frames} (${s.worst})`);
      report.push(`ok     pedidos-grande.xlsx: diagonal até ${Math.round(pos.left)},${Math.round(pos.top)} px, ${s.frames} quadros medidos, 0 com área em branco`);
      await p.screenshot({ path: join(out, "pedidos-grande-diagonal-dark.png") });

      // Para o lado, até muito além das duas bordas: o arquivo segue o mesmo, e nada de navegação.
      const title = await p.locator(".kn-file-title").textContent();
      const url = p.url();
      const steps = await p.evaluate(() => window.history.length);
      for (let i = 0; i < 60; i++) await p.mouse.wheel(4000, 0);
      await p.waitForTimeout(200);
      const right = await p.locator(".kn-grid").evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft);
      for (let i = 0; i < 120; i++) await p.mouse.wheel(-4000, 0);
      await p.waitForTimeout(300);
      const left = await p.locator(".kn-grid").evaluate((el) => el.scrollLeft);
      assert.ok(right <= 1, `não chegou à borda direita (${right} px)`);
      assert.equal(left, 0, "não voltou à borda esquerda");
      assert.equal(await p.locator(".kn-file-title").textContent(), title, "o arquivo continua o mesmo");
      assert.equal(p.url(), url, "nada de navegação");
      assert.equal(await p.evaluate(() => window.history.length), steps, "nada no histórico");
      report.push("ok     pedidos-grande.xlsx: para o lado além das duas bordas, o arquivo e o histórico não mudam");
    } catch (e) {
      failed = true;
      report.push(`FALHOU pedidos-grande.xlsx: ${(e as Error).message}`);
    } finally {
      await w.close();
    }
  }

  // 3. A nota com parágrafos longos: a coluna cresce até a janela e o texto quebra de novo. A letra embaixo dos dedos
  // fica parada, e, com zoom, o clique põe o cursor na letra certa.
  if (only("Leia-me")) {
    const w = await openWindow(browser, ctx, { window: "notes", scale: 2, theme: "light", width: 1000, height: 680, motion: false, browser: "webkit", query: { note: "Leia-me.md" } });
    const p = w.page;
    try {
      await p.waitForSelector(".kn-page .cm-content", { timeout: 30000 });
      await p.waitForTimeout(500);
      /** O parágrafo pelo começo do texto (o editor só desenha o que está perto da tela). */
      const para = `(start) => [...document.querySelectorAll(${JSON.stringify(NOTE_LINE)})].find((l) => l.textContent?.startsWith(start))`;
      // O parágrafo 12 no meio da área: desce até o editor desenhar ele.
      for (let i = 0; i < 40; i++) {
        const found = await p.evaluate(`(${para})("Parágrafo 12 ") ? true : (document.querySelector(".kn-center").scrollTop += 300, false)`);
        if (found) break;
        await p.waitForTimeout(100);
      }
      await p.evaluate(`(${para})("Parágrafo 12 ").scrollIntoView({ block: "center" })`);
      await p.waitForTimeout(300);
      type Letter = { x: number; y: number; text: string; index: number; top: number; left: number; h: number };
      /** A letra embaixo do ponto: o texto da linha, onde ela está nele, e a caixa dela. */
      const letterAt = (x: number, y: number) =>
        p.evaluate(
          ([px, py]) => {
            const r = document.caretRangeFromPoint(px!, py!)!;
            const line = (r.startContainer.parentElement as HTMLElement).closest(".cm-content p, .cm-line")!;
            const before = document.createRange();
            before.setStart(line, 0);
            before.setEnd(r.startContainer, r.startOffset);
            const one = document.createRange();
            one.setStart(r.startContainer, r.startOffset);
            one.setEnd(r.startContainer, r.startOffset + 1);
            const b = one.getBoundingClientRect();
            return { x: px!, y: py!, text: line.textContent!, index: before.toString().length, top: b.top, left: b.left, h: b.height };
          },
          [x, y],
        );
      const mid = (await p.evaluate(`(() => { const r = (${para})("Parágrafo 12 ").getBoundingClientRect(); return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.5 }; })()`)) as { x: number; y: number };
      const l0: Letter = await letterAt(mid.x, mid.y);
      const lines0 = Math.round(((await p.evaluate(`(${para})("Parágrafo 12 ").getBoundingClientRect().height`)) as number) / l0.h);
      await pinch(p, ".kn-center", mid, 2);
      // A mesma letra, achada pelo parágrafo e pela posição nele: na altura dos dedos (o ponto, o dobro do que estava
      // abaixo do alto dela). Para o lado ela anda: o texto quebra de novo na coluna mais larga, e não há o que rolar.
      const l1 = (await p.evaluate(
        `(() => { const line = (${para})(${JSON.stringify(l0.text.slice(0, 14))}); const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let left = ${l0.index};
          for (let n = w.nextNode(); n; n = w.nextNode()) { const k = n.textContent.length; if (left < k) { const r = document.createRange(); r.setStart(n, left); r.setEnd(n, left + 1); const b = r.getBoundingClientRect(); return { top: b.top, h: b.height }; } left -= k; }
          return null; })()`,
      )) as { top: number; h: number } | null;
      assert.ok(l1, "nota: a letra sumiu do parágrafo");
      const drift = Math.abs(l1.top + (mid.y - l0.top) * 2 - mid.y);
      assert.ok(drift <= DRIFT_PX, `nota: a letra andou ${drift.toFixed(1)} px de baixo dos dedos`);
      assert.ok(Math.abs(l1.h / l0.h - 2) < 0.15, `nota: a letra cresceu ${(l1.h / l0.h).toFixed(2)}×`);
      // A coluna não passa da janela: nada de rolar para o lado.
      const side = await p.locator(".kn-center").evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(side <= 1, `nota: com zoom, a coluna passou da janela (${side} px)`);
      await p.screenshot({ path: join(out, "nota-pinca.png") });
      // O clique com zoom: o cursor antes da letra clicada (um marcador digitado cai bem ali).
      const target = await letterAt(mid.x + 60, mid.y);
      await p.mouse.click(target.left + 1, target.top + target.h / 2);
      await p.keyboard.type("§");
      await p.waitForTimeout(200);
      const typed = (await p.evaluate(`(${para})(${JSON.stringify(target.text.slice(0, 14))}).textContent`)) as string;
      assert.equal(typed, `${target.text.slice(0, target.index)}§${target.text.slice(target.index)}`, "nota: com zoom, o clique pôs o cursor em outra letra");
      report.push(`ok     Leia-me.md: parágrafo de ${lines0} linhas quebra de novo com 2×, a letra andou ${drift.toFixed(1)} px, sem rolar para o lado; o clique com zoom cai na letra certa`);
    } catch (e) {
      failed = true;
      report.push(`FALHOU Leia-me.md (parágrafos): ${(e as Error).message}`);
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
}
for (const line of report) console.log(line);
console.log(failed ? "FALHOU" : `ok: ${out}`);
process.exit(failed ? 1 : 0);
