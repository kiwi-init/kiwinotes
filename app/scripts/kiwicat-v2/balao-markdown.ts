// O markdown no balão do Hub (T17986, spec #17679): o `CatBubble` de verdade (a página `balao-app.tsx`, com o engine
// falso) num WebKit headless, com uma resposta inventada que tem título, lista, negrito, código, um link, uma tabela
// larga de 3 colunas e duas tags que o agente escreveu (`<script>`, `<img>`). A prova:
//
// - fechado, o balão pequeno mostra o texto corrido, sem `**`, `#`, `|` nem a crase;
// - aberto ([Ver mais]), a tabela é uma tabela de verdade (3 colunas, nenhum `|` no texto do balão);
// - a tabela larga rola de lado dentro da própria caixa, e o balão não: ele fica na largura dele (até 480 px, spec #17673);
// - `<script>` e `<img>` aparecem como texto, e não há nenhum elemento `script`, `img` ou `iframe` no balão;
// - o link não tem `href` (nada abre sozinho); um clique nele abre o endereço uma vez, e só ele.
//
// Sai na pasta: `fechado.png`, `fechado-tabela.png`, `aberto.png`, `rolado.png` e `medidas.json`. Exit 1 se uma prova falha.
//
//   bun scripts/kiwicat-v2/balao-markdown.ts [pasta]
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "./servir";

const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T17986-balao-markdown"));
mkdirSync(out, { recursive: true });

// Tudo inventado (AGENTS.md).
const LINK = "https://exemplo.com/feira";
const TEXTO = [
  "## Feira da semana",
  "",
  "Juntei o que a **Ana** anotou sobre o Projeto X. O resumo:",
  "",
  "| Fruta | Quantidade combinada | Banca e observação da semana |",
  "| --- | --- | --- |",
  "| Maçã verde | 2 kg | Banca do Zé, a de sempre, perto da entrada |",
  "| Pera madura | 1 kg | Só se estiver firme, senão troca por uva |",
  "| Uva roxa | 500 g | Sem semente, da banca do fundo |",
  "",
  "- comprar antes das 10h",
  "- levar a sacola `retornável`",
  "",
  `O mapa está em [a página da feira](${LINK}). Ela escreveu <script>alert(1)</script> e <img src=x> na nota.`,
].join("\n");

const VIEWPORT = { width: 520, height: 600 };
const TYPE_MS = 18;

const page$ = await serve(resolve(import.meta.dir, "balao-app.tsx"));
const browser = await webkit.launch();
const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FALHA"} ${what}`);
  if (!ok) fails.push(what);
};

type Measures = Record<string, unknown>;
const measures: Measures = {};

async function open(abrir: boolean) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.route("**/*", (r) => (new URL(r.request().url()).origin === page$.url ? r.continue() : r.abort()));
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  // O `window.open` do teste só anota: nada sai da página.
  await page.addInitScript(() => {
    (window as any).opened = [];
    window.open = ((url?: string | URL) => { (window as any).opened.push(String(url)); return null; }) as typeof window.open;
  });
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  const q = new URLSearchParams({ texto: TEXTO, rabo: "right", fundo: "escuro", ...(abrir ? { abrir: "1" } : {}) });
  await page.goto(`${page$.url}/?${q}`, { waitUntil: "load" });
  // A digitação anda no relógio parado; o fechado para no meio do primeiro trecho, com o balão cheio.
  await page.clock.runFor(abrir ? TYPE_MS * [...TEXTO].length + 1500 : 3000);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  return { context, page, problems };
}

try {
  // 1. Fechado: o texto corrido, sem os símbolos do markdown.
  {
    const { context, page, problems } = await open(false);
    const small = await page.evaluate(() => document.querySelector(".kn-bubble-ghost")?.textContent ?? "");
    measures.fechado = small;
    check(small.length > 0, "fechado: o balão pequeno aparece");
    check(!/\*\*|\||^#|`/m.test(small), `fechado: sem **, |, # nem crase (${JSON.stringify(small.slice(0, 60))}…)`);
    await page.screenshot({ path: join(out, "fechado.png"), clip: { x: 0, y: 0, width: 400, height: 200 } });

    // Todos os trechos, até o balão sumir (revisão do T17984): o corte é no texto corrido, e um trecho com a metade
    // da tabela ou de um negrito não sai com os símbolos. O print de um trecho da tabela fica em `fechado-tabela.png`.
    const trechos: string[] = [];
    let tabela = false;
    for (let t = 0; t < 180_000; t += 250) {
      const ghost = await page.evaluate(() => document.querySelector(".kn-bubble-ghost")?.textContent ?? null);
      if (ghost === null) break;
      if (trechos.at(-1) !== ghost) {
        trechos.push(ghost);
        if (!tabela && /Pera madura/.test(ghost)) {
          tabela = true;
          await page.clock.runFor(TYPE_MS * [...ghost].length + 100);
          await page.screenshot({ path: join(out, "fechado-tabela.png"), clip: { x: 0, y: 0, width: 400, height: 200 } });
        }
      }
      await page.clock.runFor(250);
    }
    measures.trechos = trechos;
    const sujos = trechos.filter((c) => /\*\*|\||^#|`/m.test(c));
    check(trechos.length > 2, `fechado: a resposta passa em ${trechos.length} trechos`);
    check(sujos.length === 0, `fechado: nenhum trecho com **, |, # nem crase (${JSON.stringify(sujos[0] ?? "")})`);
    check(tabela && trechos.some((c) => c.includes("Pera madura · 1 kg")), "fechado: a tabela aparece como texto corrido (Pera madura · 1 kg)");
    check(problems.length === 0, `fechado: sem erro na página ${problems.join("; ")}`);
    await context.close();
  }

  // 2. Aberto: a tabela, o rolar de lado, as tags como texto e o link.
  {
    const { context, page, problems } = await open(true);
    const m = await page.evaluate(() => {
      const big = document.querySelector<HTMLElement>(".kn-bubble-big");
      if (!big) return null;
      const wrap = big.querySelector<HTMLElement>(".kn-md-scroll");
      const table = big.querySelector("table");
      const a = big.querySelector("a.kn-md-link");
      return {
        bigWidth: big.getBoundingClientRect().width,
        bigScrollW: big.scrollWidth,
        bigClientW: big.clientWidth,
        th: [...(table?.querySelectorAll("th") ?? [])].map((t) => t.textContent),
        rows: table?.querySelectorAll("tbody tr").length ?? 0,
        wrapScrollW: wrap?.scrollWidth ?? 0,
        wrapClientW: wrap?.clientWidth ?? 0,
        pipes: (big.textContent ?? "").includes("|"),
        h2: big.querySelector("h2")?.textContent ?? null,
        strong: big.querySelector("strong")?.textContent ?? null,
        code: big.querySelector("code")?.textContent ?? null,
        li: big.querySelectorAll("li").length,
        perigosos: big.querySelectorAll("script, img, iframe, object, embed, style").length,
        tagsComoTexto: (big.textContent ?? "").includes("<script>alert(1)</script>") && (big.textContent ?? "").includes("<img src=x>"),
        linkHref: a ? a.getAttribute("href") : "sem link",
        linkData: a?.getAttribute("data-href") ?? null,
        linkText: a?.textContent ?? null,
      };
    });
    measures.aberto = m;
    check(m !== null, "aberto: o [Ver mais] abriu o balão grande");
    if (m) {
      check(m.th.length === 3 && m.rows === 3, `aberto: a tabela tem 3 colunas e 3 linhas (${m.th.join(" / ")})`);
      check(!m.pipes, "aberto: nenhum | no texto do balão");
      check(m.h2 === "Feira da semana" && m.strong === "Ana" && m.code === "retornável" && m.li === 2, "aberto: título, negrito, código e lista formatados");
      check(m.wrapScrollW > m.wrapClientW + 20, `aberto: a tabela larga rola de lado na caixa dela (${m.wrapScrollW} > ${m.wrapClientW})`);
      check(m.bigScrollW <= m.bigClientW + 1 && m.bigWidth <= 480.5, `aberto: o balão não rola de lado e fica em ${Math.round(m.bigWidth)} px (≤ 480)`);
      check(m.bigWidth >= 479, `aberto: a tabela larga leva o balão até os 480 px (${Math.round(m.bigWidth)}, spec #17673)`);
      check(m.perigosos === 0 && m.tagsComoTexto, "aberto: <script> e <img> ficam texto, sem elemento");
      check(m.linkHref === null && m.linkData === LINK, "aberto: o link vem sem href, com o endereço no data-href");
    }
    await page.screenshot({ path: join(out, "aberto.png") });

    // O link: nada abriu até aqui; um clique abre o endereço uma vez. Um clique no texto ao lado não abre nada.
    const before = await page.evaluate(() => (window as any).opened.length as number);
    await page.locator(".kn-bubble-big strong").click();
    await page.locator(".kn-bubble-big a.kn-md-link").click();
    const opened = await page.evaluate(() => (window as any).opened as string[]);
    measures.abertos = opened;
    check(before === 0 && opened.length === 1 && opened[0] === LINK, `link: só o clique abre, uma vez (${JSON.stringify(opened)})`);
    const stillOpen = await page.evaluate(() => !!document.querySelector(".kn-bubble-big"));
    check(stillOpen, "link: o clique dentro do balão não o fecha");

    // A tabela rolada até o fim: a última coluna aparece, o balão fica no lugar.
    const before2 = await page.evaluate(() => document.querySelector(".kn-bubble-big")!.getBoundingClientRect().toJSON());
    await page.locator(".kn-md-scroll").hover();
    await page.mouse.wheel(400, 0);
    await page.clock.runFor(500);
    const after = await page.evaluate(() => ({
      left: document.querySelector<HTMLElement>(".kn-md-scroll")!.scrollLeft,
      big: document.querySelector(".kn-bubble-big")!.getBoundingClientRect().toJSON(),
    }));
    measures.rolado = after;
    check(after.left > 0, `rolar: a roda de lado leva a tabela (${after.left} px)`);
    check(after.big.left === before2.left && after.big.width === before2.width, "rolar: o balão não sai do lugar");
    await page.screenshot({ path: join(out, "rolado.png") });
    check(problems.length === 0, `aberto: sem erro na página ${problems.join("; ")}`);
    await context.close();
  }
} finally {
  await browser.close();
  page$.close();
}

writeFileSync(join(out, "medidas.json"), JSON.stringify(measures, null, 2));
console.log(fails.length ? `\n${fails.length} prova(s) falharam` : `\ntodas as provas passaram; prints em ${out}`);
process.exit(fails.length ? 1 : 0);
