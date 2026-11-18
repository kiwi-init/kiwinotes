// O balão do Kiwi Cat no overlay (T13424, spec #13378): a página do overlay de verdade num WebKit headless, recebendo o
// que o helper manda (`set({visible, estado, sala, bubble})`), como o CatOverlay.swift. Nada nativo na tela, nenhum
// agente. A prova:
//
// - uma resposta longa chega inteira: fechado, o balão mostra o começo e o "Ver mais"; uma curta não tem o botão;
// - "Ver mais" abre o balão até o espaço da janela (`sala`), e o texto rola dentro dele com a roda do mouse; "Ver menos"
//   volta ao resumo;
// - a página manda ao helper (o `kiwiCat`) o retângulo do balão e se ele está aberto: é com isso que só o balão pega o
//   clique e o gato espera enquanto a pessoa lê;
// - nas 6 posições e nos 2 limites de tamanho, o balão aberto fica dentro da janela (o swift test prova que a janela
//   fica dentro da área útil, `CatOverlayModelTests`).
//
// Sai na pasta: `balao.webp` (a folha com os prints: fechado, aberto e rolando).
//
//   bun scripts/kiwicat-bubble-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { BUBBLE_H, OPEN_SHELL_W, openPlacement, overlayPlacement, SHELL_W } from "../ui/catoverlay/placement";
import { CAT_BODY } from "../ui/kiwicat-v2/bubbleTail";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13424-balao"));
mkdirSync(out, { recursive: true });

const page = join(app, "dist", "catoverlay");
const build = spawnSync("bun", ["x", "vite", "build"], { cwd: app, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
assert.ok(build.status === 0 && existsSync(join(page, "index.html")), "o build da página catoverlay");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(r) {
    const file = Bun.file(join(page, new URL(r.url).pathname.replace(/^\/$/, "/index.html")));
    return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
  },
});

const LONG =
  "Li as três notas da reunião de ontem. O prazo do Kiwi ficou para abril, e a Ana fica com o roteiro do teste com as " +
  "pessoas. Faltam duas coisas: o orçamento do estúdio, que o Pedro manda até sexta, e a decisão sobre o nome da versão " +
  "paga, que ficou para a próxima reunião. Deixei uma lista com as ações em aberto na nota Reuniões/Kiwi.md, com quem " +
  "cuida de cada uma e a data. Também marquei o lembrete da reunião de quinta às 10h. Se quiser, eu resumo as conversas " +
  "anteriores sobre o nome, para você chegar na reunião com as opções que já apareceram e o que cada pessoa achou delas. " +
  "Sobre o teste com as pessoas: a Ana sugeriu cinco sessões de meia hora, duas com quem já usa o app e três com quem " +
  "nunca viu, e pediu que alguém ficasse com as anotações. Eu posso preparar o roteiro com as tarefas e as perguntas, " +
  "a partir do que vocês combinaram, e deixar na mesma pasta para ela revisar antes de marcar as sessões.";
const SHORT = "Pronto: mudei o prazo para abril.";

const browser = await webkit.launch({ headless: true });
const report: { scope: string; checks: string[]; problems: string[] } = {
  scope: "WebKit headless, the real overlay page (dist/catoverlay), commands as the helper sends them; no native window",
  checks: [],
  problems: [],
};
const shots: { file: string; caption: string; w: number; h: number }[] = [];

type Posts = { bubble: { x: number; y: number; w: number; h: number } | null; open: boolean }[];
/** `largura` (spec #17673): a casca aberta que o helper daria; a janela já vem com o espaço a mais do lado do balão. */
async function openPage(query: string, theme: "light" | "dark", sala: number, largura = SHELL_W) {
  const q = new URLSearchParams(query);
  const place = overlayPlacement(q);
  const width = openPlacement(place, largura).winW;
  const height = place.catH + sala;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme });
  // O `kiwiCat` do helper: guarda o que a página manda.
  await ctx.addInitScript(() => {
    const posts: unknown[] = [];
    (window as any).__posts = posts;
    (window as any).webkit = { messageHandlers: { kiwiCat: { postMessage: (m: unknown) => posts.push(JSON.parse(JSON.stringify(m))) } } };
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => report.problems.push(`pageerror: ${e.message}`));
  await p.goto(`http://127.0.0.1:${server.port}/index.html?backend=none&${query}`);
  await p.waitForFunction(() => (window as any).kiwiCatReady === true, undefined, { timeout: 20_000 });
  return { ctx, p, width, height, place };
}
const stats = (p: Page) => p.evaluate(() => (window as any).kiwiOverlayStats);
const posts = (p: Page) => p.evaluate(() => (window as any).__posts as Posts);
const bubbleBox = (p: Page) => p.evaluate(() => {
  const r = document.getElementById("bubble")!.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
});
/** Dois quadros e o fim das transições do balão (140 ms). */
/** O corpo do gato na página (`CAT_BODY`): o balão aberto não pode passar por cima dele. */
const catBody = (p: Page) =>
  p.evaluate((b) => {
    const c = document.getElementById("cat")!.getBoundingClientRect();
    return { x: c.left + c.width * b.x0, y: c.top + c.height * b.y0, right: c.left + c.width * b.x1, bottom: c.top + c.height * b.y1 };
  }, CAT_BODY);
const settle = async (p: Page) => {
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await Bun.sleep(220);
};
async function shot(p: Page, file: string, caption: string, w: number, h: number) {
  await Bun.sleep(220); // a transição de 140 ms do balão
  await p.screenshot({ path: join(out, file), omitBackground: true });
  shots.push({ file, caption, w, h });
}

try {
  // 1. O canto de baixo à direita, 1×, numa tela grande: o espaço do balão é o máximo (360). No claro e no escuro.
  for (const theme of ["light", "dark"] as const) {
    const tema = theme === "light" ? "claro" : "escuro";
    const { ctx, p, width, height } = await openPage("escala=1.00&lado=right&balao=acima", theme, 360);
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, sala: 360, bubble: { text: t, error: false } }), LONG);
    await settle(p);
    let s = await stats(p);
    assert.equal(s.bubble.text, LONG, "a resposta inteira chega de uma vez");
    assert.equal(s.bubbleMore, true, "uma resposta longa mostra o Ver mais");
    assert.equal(s.bubbleOpen, false);
    const closed = await bubbleBox(p);
    assert.ok(closed.h < 112, `fechado, o balão é pequeno: ${closed.h}`);
    // O resumo cortado numa palavra: "…" no fim, menos depois de um ponto (revisão do #526).
    const summary = (await p.textContent("#bubble-text"))!;
    assert.ok(LONG.startsWith(summary.replace(/…$/, "")) && summary.length < LONG.length, `o resumo é o começo: ${summary}`);
    assert.ok(!/[.!?]…$/.test(summary) && /[.!?…]$/.test(summary), `o fim do resumo: ${summary.slice(-20)}`);
    await shot(p, `1-fechado-${theme}.png`, `Fechado (${tema}): o começo da resposta e o Ver mais`, width, height);
    let last = (await posts(p)).at(-1)!;
    assert.ok(last.bubble && !last.open, `o helper sabe onde o balão está: ${JSON.stringify(last)}`);
    // O helper usa isso para o clique: até 1,5 pt de arredondamento.
    const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
    assert.ok(near(last.bubble.x, closed.x) && near(last.bubble.y, closed.y) && near(last.bubble.w, closed.w) && near(last.bubble.h, closed.h), `o retângulo que o helper recebe: ${JSON.stringify(last.bubble)} × ${JSON.stringify(closed)}`);
    report.checks.push("a long answer arrives whole, once; closed, the bubble shows its start and 'Ver mais', and tells the helper where it is");

    // Nada troca sozinho: um tempo depois, o mesmo texto no balão.
    await Bun.sleep(1000);
    s = await stats(p);
    assert.equal(s.bubble.text, LONG);

    await p.click("#bubble-more");
    await settle(p);
    s = await stats(p);
    assert.equal(s.bubbleOpen, true);
    assert.equal(await p.textContent("#bubble-more"), "Ver menos");
    const open = await bubbleBox(p);
    assert.ok(open.h > closed.h * 2, `aberto, o balão cresce: ${closed.h} → ${open.h}`);
    assert.ok(open.y >= 0 && open.bottom <= height && open.x >= 0 && open.right <= width, `aberto, dentro da janela: ${JSON.stringify(open)}`);
    const scroll = await p.evaluate(() => { const t = document.getElementById("bubble-text")!; return { sh: t.scrollHeight, ch: t.clientHeight }; });
    assert.ok(scroll.sh > scroll.ch, `o texto passa do balão aberto e rola: ${JSON.stringify(scroll)}`);
    last = (await posts(p)).at(-1)!;
    assert.ok(last.bubble && last.open && last.bubble.h >= Math.floor(open.h) - 1, `o helper sabe que abriu e o novo tamanho: ${JSON.stringify(last)}`);
    const fade = () => p.evaluate(() => { const t = document.getElementById("bubble-text")!; return [t.style.getPropertyValue("--fade-top"), t.style.getPropertyValue("--fade-bottom")]; });
    assert.deepEqual(await fade(), ["0px", "16px"], "no começo, só o degradê de baixo");
    await shot(p, `2-aberto-${theme}.png`, `Ver mais (${tema}): o balão no tamanho máximo`, width, height);
    report.checks.push("'Ver mais' opens the bubble up to the window's room; the text scrolls inside; the helper gets open: true and the new rect");

    await p.mouse.move(open.x + open.w / 2, open.y + open.h / 2);
    await p.mouse.wheel(0, 40);
    await p.waitForFunction(() => document.getElementById("bubble-text")!.scrollTop > 0, undefined, { timeout: 5000 });
    const top = await p.evaluate(() => document.getElementById("bubble-text")!.scrollTop);
    await settle(p); // o evento de rolagem vem no quadro seguinte
    assert.deepEqual(await fade(), ["16px", "16px"], "no meio, os dois degradês");
    await shot(p, `3-rolando-${theme}.png`, `Rolando (${tema}): o degradê nas bordas`, width, height);
    await p.evaluate(() => { const t = document.getElementById("bubble-text")!; t.scrollTop = t.scrollHeight; });
    await settle(p);
    assert.deepEqual(await fade(), ["16px", "0px"], "no fim, só o degradê de cima");
    report.checks.push(`the mouse wheel scrolls the text inside the open bubble (scrollTop ${top})`);

    await p.click("#bubble-more");
    await settle(p);
    s = await stats(p);
    assert.equal(s.bubbleOpen, false);
    assert.equal(await p.evaluate(() => document.getElementById("bubble-text")!.scrollTop), 0);
    last = (await posts(p)).at(-1)!;
    assert.ok(last.bubble && !last.open);
    report.checks.push("'Ver menos' goes back to the summary, at the top");

    // O balão sai com o gato: o helper fica sabendo que não há balão (e para de acompanhar o mouse).
    await p.evaluate(() => (window as any).kiwiOverlay.set({ visible: false, bubble: null }));
    await settle(p);
    last = (await posts(p)).at(-1)!;
    assert.deepEqual(last, { bubble: null, open: false, close: null });
    // Uma resposta curta: sem Ver mais.
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ visible: true, bubble: { text: t, error: false } }), SHORT);
    await settle(p);
    s = await stats(p);
    assert.equal(s.bubbleMore, false);
    assert.equal(await p.isVisible("#bubble-more"), false);
    report.checks.push("a short answer has no 'Ver mais'; when the bubble goes, the helper gets bubble: null");
    await ctx.close();
  }

  // 2. A conversa contínua (spec #13380): a pergunta sem fechar o Ver mais, o toque, os dois × e o VoiceOver.
  for (const theme of ["light", "dark"] as const) {
    const tema = theme === "light" ? "claro" : "escuro";
    const { ctx, p, width, height } = await openPage("escala=1.00&lado=right&balao=acima", theme, 360);
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, sala: 360, bubble: { text: t, error: false } }), LONG);
    await settle(p);
    // A pergunta com o balão fechado, e o × da cabeça com o mouse sobre o gato.
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ bubble: { text: t, error: false, ask: true }, catHover: true }), LONG);
    await settle(p);
    let s = await stats(p);
    assert.equal(s.bubbleAsk, true);
    assert.equal(s.catHover, true);
    assert.equal(await p.isVisible("#bubble-ask"), true);
    assert.equal(await p.textContent("#bubble-ask"), "Precisa de mais alguma coisa?");
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("cat-close")!).opacity), "1");
    let last = (await posts(p)).at(-1)!;
    assert.ok((last as any).close, `o helper sabe onde está o × da cabeça: ${JSON.stringify(last)}`);
    const b = await bubbleBox(p);
    assert.ok(b.y >= 0 && b.bottom <= height, `com a pergunta, o balão fechado fica na janela: ${JSON.stringify(b)}`);
    await shot(p, `4-pergunta-${theme}.png`, `Sem interação (${tema}): a pergunta e, com o mouse no gato, o ×`, width, height);
    // O VoiceOver lê a resposta inteira e a pergunta, não o resumo cortado (revisão do #526).
    const sr = await p.textContent("#bubble-sr");
    assert.equal(sr, `${LONG} Precisa de mais alguma coisa?`);

    // Aberto e rolado, a pergunta entra e sai sem fechar o balão nem voltar o texto.
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ bubble: { text: t, error: false }, catHover: false }), LONG);
    await p.click("#bubble-more");
    await settle(p);
    const before = (await posts(p)).length;
    await p.mouse.move((await bubbleBox(p)).x + 100, (await bubbleBox(p)).y + 100);
    await p.mouse.wheel(0, 40);
    await settle(p);
    const scrolled = await p.evaluate(() => document.getElementById("bubble-text")!.scrollTop);
    assert.ok(scrolled > 0);
    assert.ok((await posts(p)).slice(before).some((m: any) => m.touch === true), "rolar conta como interação (touch)");
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ bubble: { text: t, error: false, ask: true } }), LONG);
    await settle(p);
    s = await stats(p);
    assert.equal(s.bubbleOpen, true, "a pergunta não fecha o Ver mais");
    assert.equal(await p.evaluate(() => document.getElementById("bubble-text")!.scrollTop), scrolled, "nem volta o texto");
    await shot(p, `5-aberto-pergunta-${theme}.png`, `Aberto (${tema}): a pergunta embaixo, e o × do balão`, width, height);
    // O × do balão: o helper recebe o fechar.
    await p.click("#bubble-close");
    last = (await posts(p)).at(-1)!;
    assert.deepEqual(last, { closed: true });
    report.checks.push(`(${theme}) the question appears under the answer without closing 'Ver mais' or moving the text; the head × shows on hover and reports its rect; scrolling sends touch; the bubble × sends closed; VoiceOver gets the whole answer and the question`);
    await ctx.close();
  }

  // 3. As 6 posições × os 2 limites de tamanho, com o espaço que o helper daria (o máximo e o mínimo) e a largura do
  //    aberto (spec #17673: 280 de hoje, 380 quando a borda da tela corta, 480 no máximo): o balão, fechado e aberto,
  //    fica dentro da janela e fora do corpo do gato; aberto com espaço, ele alarga para o lado e não passa da largura.
  const sides = [
    ["center", "acima"], ["center", "acima"], ["left", "abaixo"], ["right", "abaixo"], ["left", "acima"], ["right", "acima"],
  ] as const;
  const names = ["center", "bottom-center", "top-left", "top-right", "bottom-left", "bottom-right"];
  let checked = 0;
  for (let i = 0; i < sides.length; i++) {
    for (const escala of ["0.60", "1.60"]) {
      for (const sala of [BUBBLE_H, 360]) for (const largura of [SHELL_W, 380, OPEN_SHELL_W]) {
        const [lado, balao] = sides[i]!;
        const { ctx, p, width, height } = await openPage(`escala=${escala}&lado=${lado}&balao=${balao}`, "light", sala, largura);
        await p.evaluate(([t, s, l]) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, sala: s, largura: l, bubble: { text: t, error: false } }), [LONG, sala, largura] as const);
        await settle(p);
        let closedW = 0;
        for (const open of [false, true]) {
          if (open) {
            await p.click("#bubble-more");
            await settle(p);
          }
          const b = await bubbleBox(p);
          const body = await catBody(p);
          const what = `${names[i]} ${escala} sala ${sala} largura ${largura} ${open ? "aberto" : "fechado"}`;
          assert.ok(b.x >= 0 && b.y >= 0 && b.right <= width + 0.5 && b.bottom <= height + 0.5, `balão fora da janela: ${what} ${JSON.stringify(b)} em ${width}×${height}`);
          const covers = b.x < body.right - 0.5 && b.right > body.x + 0.5 && b.y < body.bottom - 0.5 && b.bottom > body.y + 0.5;
          assert.ok(!covers, `o balão cobre o gato: ${what} ${JSON.stringify(b)} × corpo ${JSON.stringify(body)}`);
          if (!open) closedW = b.w;
          else {
            assert.ok(b.w <= largura + 0.5, `o aberto passa da largura: ${what} ${b.w}`);
            // O texto longo pede mais que 280: com espaço, o aberto alarga (ver mais: para o lado primeiro).
            if (largura > SHELL_W) assert.ok(b.w > closedW + 50, `o aberto não alargou: ${what} ${closedW} → ${b.w}`);
          }
          checked++;
        }
        await ctx.close();
      }
    }
  }
  report.checks.push(`the bubble, closed and open, stays inside the window and off the cat body in the 6 positions × 0.6 and 1.6 × the smallest and largest room × open width 280, 380 and 480, and the open one widens when there is room (${checked} cases)`);

  // 4. O rabo (T14933, spec #14896; T16754, harry #16786): nas 6 posições, a 1×, 0,6× e 1,6×, o rabo sai da quina do
  //    balão do lado do gato e a ponta encosta na quina do corpo dele (`CAT_BODY`). A ponta do traço, no SVG de 34 × 24,
  //    está em (28,5; 19,5); virado, o SVG espelha em volta do meio. O `bubble-tail-check` passa pelo hub também.
  let tails = 0;
  for (let i = 0; i < sides.length; i++) {
    for (const escala of ["1.00", "0.60", "1.60"]) for (const aberto of [false, true]) {
      const [lado, balao] = sides[i]!;
      // Aberto (spec #17673): o balão largo de 480, com a resposta longa; o rabo continua no gato.
      const sala = aberto ? 360 : BUBBLE_H;
      const largura = aberto ? OPEN_SHELL_W : SHELL_W;
      const { ctx, p, width, height } = await openPage(`escala=${escala}&lado=${lado}&balao=${balao}`, "light", sala, largura);
      await p.evaluate(([t, s, l]) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, sala: s, largura: l, bubble: { text: t, error: false } }), [aberto ? LONG : SHORT, sala, largura] as const);
      await settle(p);
      if (aberto) {
        await p.click("#bubble-more");
        await settle(p);
      }
      const m = await p.evaluate(() => {
        const svg = document.querySelector("#bubble .kn-bubble-tail")!;
        const t = svg.getBoundingClientRect();
        const c = document.getElementById("cat")!.getBoundingClientRect();
        return { side: svg.getAttribute("data-side"), t: { x: t.left, y: t.top, w: t.width, h: t.height, bottom: t.bottom }, cat: { x: c.left, y: c.top, w: c.width, h: c.height } };
      });
      const what = `${names[i]} ${escala}${aberto ? " aberto 480" : ""}`;
      const up = balao === "abaixo";
      const right = lado !== "left";
      assert.equal(m.side, `${up ? "top" : "bottom"}-${right ? "right" : "left"}`, `o rabo na quina do lado do gato: ${what}`);
      assert.ok(Math.abs(m.t.w - 34) < 0.5 && Math.abs(m.t.h - 24) < 0.5, `o rabo do pacote, 34 × 24: ${what} ${JSON.stringify(m.t)}`);
      const tipX = m.t.x + (right ? 28.5 : 34 - 28.5);
      const tipY = m.t.y + (up ? 24 - 19.5 : 19.5);
      const bodyX = m.cat.x + m.cat.w * (right ? CAT_BODY.x0 : CAT_BODY.x1);
      const bodyY = m.cat.y + m.cat.h * (up ? CAT_BODY.y1 : CAT_BODY.y0);
      assert.ok(Math.hypot(tipX - bodyX, tipY - bodyY) <= 2, `a ponta encosta no corpo do gato: ${what} ponta ${tipX},${tipY} × corpo ${bodyX},${bodyY}`);
      assert.ok(m.t.x >= 0 && m.t.y >= 0 && m.t.bottom <= height && m.t.x + m.t.w <= width, `o rabo dentro da janela: ${what}`);
      if (escala === "1.00" && !aberto) await shot(p, `6-rabo-${names[i]}.png`, `O rabo: ${names[i]} (${m.side})`, width, height);
      if (escala === "1.00" && aberto) await shot(p, `7-largo-${names[i]}.png`, `Aberto, 480: ${names[i]} (${m.side})`, width, height);
      tails++;
      await ctx.close();
    }
  }
  report.checks.push(`the tail leaves the bubble corner next to the cat and its tip touches the cat body, in the 6 positions × 1, 0.6 and 1.6, closed and open at 480 (${tails} cases)`);

  // 5. O markdown (spec #17679, T17985): fechado, o resumo sai sem os símbolos; aberto, os elementos montados (título,
  //    lista, tabela, código e link), e um <script> ou <img onerror> do texto fica texto. O link não tem href e só manda
  //    o endereço ao helper com o clique. Texto inventado.
  {
    const MD = [
      "## Plano da semana",
      "",
      "Resumo das **três** tarefas do *Projeto X*:",
      "",
      "- [x] revisar o roteiro",
      "- [ ] marcar a reunião",
      "",
      "| Tarefa | Quem | Prazo |",
      "| --- | --- | --- |",
      "| Roteiro | Ana | sexta |",
      "| Orçamento | Pedro | segunda |",
      "",
      "Rode `bun test` antes. Mais em [exemplo](https://exemplo.com/plano).",
      "",
      "<script>window.__xss = 1</script> <img src=x onerror=\"window.__xss = 2\">",
    ].join("\n");
    const { ctx, p, width, height } = await openPage("escala=1.00&lado=right&balao=acima", "light", 360);
    await p.evaluate((t) => (window as any).kiwiOverlay.set({ estado: "pronto", visible: true, sala: 360, bubble: { text: t, error: false } }), MD);
    await settle(p);
    const closed = (await p.textContent("#bubble-text"))!;
    for (const sym of ["**", "##", "|", "`", "[x]"]) assert.ok(!closed.includes(sym), `o resumo fechado sem "${sym}": ${closed}`);
    assert.ok(closed.startsWith("Plano da semana"), `o resumo começa pelo título: ${closed}`);
    assert.equal(await p.locator("#bubble-text *").count(), 0, "fechado, só texto");
    await shot(p, "7-markdown-fechado.png", "Markdown, fechado: sem os símbolos", width, height);
    await p.click("#bubble-more");
    await settle(p);
    const open = await p.evaluate(() => {
      const t = document.getElementById("bubble-text")!;
      const q = (s: string) => t.querySelectorAll(s).length;
      return {
        h2: t.querySelector("h2")?.textContent, strong: q("strong"), em: q("em"), tasks: q(".kn-md-task"), table: q(".kn-md-scroll > table.kn-md-table"),
        th: [...t.querySelectorAll("th")].map((e) => e.textContent), rows: q("tbody tr"), code: t.querySelector("code")?.textContent,
        link: (() => { const a = t.querySelector("a.kn-md-link") as HTMLAnchorElement | null; return a && { text: a.textContent, href: a.getAttribute("href"), data: a.dataset.href }; })(),
        script: q("script"), img: q("img"), text: t.textContent, xss: (window as any).__xss ?? null, pipes: t.textContent!.includes("|"),
      };
    });
    assert.equal(open.h2, "Plano da semana");
    assert.ok(open.strong === 1 && open.em === 1 && open.tasks === 2, `negrito, itálico e as caixas: ${JSON.stringify(open)}`);
    assert.equal(open.table, 1, "a tabela, dentro do .kn-md-scroll");
    assert.deepEqual(open.th, ["Tarefa", "Quem", "Prazo"]);
    assert.equal(open.rows, 2);
    assert.equal(open.pipes, false, "aberto, a tabela sem pipes");
    assert.equal(open.code, "bun test");
    assert.deepEqual(open.link, { text: "exemplo", href: null, data: "https://exemplo.com/plano" });
    assert.ok(open.script === 0 && open.img === 0 && open.xss === null && open.text!.includes("<script>"), `o HTML do texto fica texto: ${JSON.stringify(open)}`);
    await shot(p, "7-markdown-aberto.png", "Markdown, aberto: título, caixas, tabela, código e link", width, height);
    await p.evaluate(() => ((window as any).__posts.length = 0));
    await p.click("#bubble-text a.kn-md-link");
    const sent = (await p.evaluate(() => (window as any).__posts)) as { link?: string }[];
    assert.deepEqual(sent.filter((m) => m.link), [{ link: "https://exemplo.com/plano" }], `o clique no link manda o endereço ao helper: ${JSON.stringify(sent)}`);
    assert.equal(p.url().startsWith(`http://127.0.0.1:${server.port}/`), true, "a página não navegou");
    assert.equal(await p.textContent("#bubble-more"), "Ver menos", "o clique no link não fecha o balão");
    await ctx.close();
  }
  report.checks.push("markdown: closed, the summary has no **, #, |, ` or [x]; open, the heading, bold, italics, tasks, the table (no pipes), code and link are elements; <script> and <img onerror> stay text; the link has no href and only a click sends it to the helper");

  // A folha em WebP: cada print sobre um fundo de mesa, como por cima de outro app.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1480, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 18px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:26px">O balão do Kiwi Cat: a conversa contínua (spec #13378, #13380)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start">` +
      shots.map((x) =>
        `<figure style="margin:0"><figcaption style="margin-bottom:8px;min-height:44px">${x.caption}</figcaption>` +
        `<div style="border-radius:10px;padding:16px;background:linear-gradient(160deg,#9fb4c9,#c9b9a6);box-shadow:0 1px 4px #0003">` +
        `<img src="${img(x.file)}" style="display:block;width:${x.w}px;height:${x.h}px;margin:0 auto"></div></figure>`).join("") +
      `</div></body>`,
  );
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30000 });
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "folha.png"), "-o", join(out, "balao.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  server.stop(true);
}
