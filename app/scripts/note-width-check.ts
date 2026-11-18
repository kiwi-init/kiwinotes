// A largura da nota pelas duas bordas (spec #13383, T13855): numa nota .md e num .txt, o mouse na borda do texto (onde a
// linha quebra) já mostra o cursor de arrastar e a alça; arrastar qualquer lado muda a largura, que fica salva; o
// duplo clique volta ao padrão. As Notas de verdade, com o AppEngine headless e o cofre num tmp, num WebKit headless.
// Nada na tela de ninguém.
//
//   bun scripts/note-width-check.ts [pasta]
//
// Sai na pasta: `medidas.json` e os prints. Na nota .md, `largura-md-esquerda.png` e `largura-md-direita.png` (o mouse
// em cada borda), e `largura-md-antes.png` e `largura-md-depois.png` (o arrasto). No .txt, `largura-txt.png` e
// `largura-txt-escuro.png`. O WebKit headless não desenha o cursor do sistema: nos prints, uma seta ↔ desenhada no
// lugar do mouse mostra o cursor que o CSS pôs ali (o script confere o `col-resize` de verdade).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { NOTE_WIDTH } from "../src/shared/note-width";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13855-largura"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-largura-"));
const vault = join(data, "vault");
mkdirSync(vault, { recursive: true });
const PARA = "Um parágrafo comprido que quebra a linha no limite da coluna da nota, para ver onde fica a borda do texto. ".repeat(10);
writeFileSync(join(vault, "Nota.md"), `# Nota\n\n${PARA}\n`);
writeFileSync(join(vault, "anotacoes.txt"), `Anotações\n\n${PARA}\n`);

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (l) => { if (!("id" in l)) onMsg(l); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
/** Espera a conta bater (até 5 s): a largura salva e a coluna redesenhada não vêm no mesmo instante do soltar. */
async function settle<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let v = await read();
  for (let i = 0; i < 50 && !ok(v); i++) {
    await Bun.sleep(100);
    v = await read();
  }
  return v;
}
const saved = async () => {
  const r = (await ctx.send({ cmd: "invoke", cap: "settings.get", args: {} } as never)) as { value?: { noteWidth?: number } };
  return r.value?.noteWidth;
};

/** As bordas do texto (a linha do parágrafo, a mais comprida) e da coluna que leva a largura. */
async function edges(p: Page, line: string, column: string) {
  return p.evaluate(([line, column]) => {
    const l = [...document.querySelectorAll(line!)].sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)[0]!.getBoundingClientRect();
    const c = document.querySelector(column!)!.getBoundingClientRect();
    return { left: l.left, right: l.right, y: l.top + l.height / 2, column: c.width };
  }, [line, column]);
}

/** O mouse logo do lado de fora de onde a linha quebra: o que está ali, o cursor e se a alça já aparece, sem esperar. */
async function hoverAt(p: Page, x: number, y: number) {
  await p.mouse.move(x, y);
  return p.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x!, y!) as HTMLElement | null;
    // A barrinha à mostra: o `::after` com opacidade, pelo `:hover` (no mesmo quadro do mouse, sem esperar o React).
    const bar = el ? Number(getComputedStyle(el, "::after").opacity) : 0;
    // O que ficou por cima (a classe), para saber o que tapa a alça quando ela não está ali.
    const over = document.elementsFromPoint(x!, y!).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} z=${getComputedStyle(e).zIndex} pos=${getComputedStyle(e).position}`).join(" > ");
    return { handle: el?.classList.contains("kn-width-handle") ? el.dataset.side : null, cursor: el ? getComputedStyle(el).cursor : "", shown: bar > 0, over };
  }, [x, y]);
}

/** A seta ↔ no lugar do mouse, só para o print (o headless não desenha o cursor). Some com `null`. */
async function fakeCursor(p: Page, at: { x: number; y: number } | null) {
  await p.evaluate((at) => {
    document.getElementById("kn-print-cursor")?.remove();
    if (!at) return;
    const c = document.createElement("div");
    c.id = "kn-print-cursor";
    c.style.cssText = `position:fixed;left:${at.x - 11}px;top:${at.y - 8}px;z-index:99999;pointer-events:none;width:22px;height:16px`;
    c.innerHTML = '<svg width="22" height="16" viewBox="0 0 22 16"><path d="M1 8l5-5v3h3V1h4v5h3V3l5 5-5 5v-3h-3v5H9v-5H6v3z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    document.body.append(c);
  }, at);
}

/**
 * Arrasta a alça de um lado `dx` px. Começa no meio da própria alça, medida na hora (a coluna pode ainda estar se
 * ajustando do arrasto anterior), com um quadro entre chegar e apertar.
 */
async function drag(p: Page, column: string, side: "left" | "right", dx: number) {
  const box = (await p.locator(`${column} .kn-width-handle[data-side="${side}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 300);
  await p.mouse.move(x, y);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.mouse.down();
  await p.mouse.move(x + dx, y, { steps: 6 });
  await p.mouse.up();
}

const browser = await webkit.launch({ headless: true });
const result: Record<string, unknown> = {};
let ok = true;
const check = (name: string, cond: boolean) => {
  result[name] = cond;
  if (!cond) ok = false;
};
try {
  await cli(["start", "--no-helper"]);
  const cases = [
    { name: "md", note: "Nota.md", ready: ".kn-note-editor .cm-content", line: ".kn-note-editor .cm-line", column: ".kn-page", theme: "light" as const },
    { name: "txt", note: "anotacoes.txt", ready: ".kn-file-text-area", line: ".kn-file-text-area .cm-line", column: ".kn-width-frame", theme: "light" as const },
    { name: "txt-escuro", note: "anotacoes.txt", ready: ".kn-file-text-area", line: ".kn-file-text-area .cm-line", column: ".kn-width-frame", theme: "dark" as const },
  ];
  for (const c of cases) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: c.theme, width: 1300, height: 720, motion: false, browser: "webkit", query: { section: "notes", note: c.note } });
    const p = w.page;
    await p.locator(c.ready).waitFor({ timeout: 20000 });
    await Bun.sleep(400);
    // Sem a coluna (no .txt da main, não há alça nenhuma): o caso falha e o resto segue.
    if (!(await p.locator(c.column).count())) {
      check(`${c.name}: há alças`, false);
      await w.close();
      continue;
    }
    const e0 = await edges(p, c.line, c.column);
    // As duas bordas: 8 px para fora de onde a linha quebra, e bem em cima dela.
    const atLeft = await hoverAt(p, e0.left - 8, e0.y);
    const atRight = await hoverAt(p, e0.right + 8, e0.y);
    const onRight = await hoverAt(p, e0.right, e0.y);
    result[`${c.name}.bordas`] = { atLeft, atRight, onRight };
    result[`${c.name}.geo`] = await p.evaluate(([column]) => {
      const col = document.querySelector(column!)!.getBoundingClientRect();
      const r = (s: string) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? [Math.round(b.left - col.left), Math.round(b.right - col.left)] : null; };
      return { colW: Math.round(col.width), handleL: r(`${column} .kn-width-handle[data-side="left"]`), handleR: r(`${column} .kn-width-handle[data-side="right"]`), gutters: r(".cm-gutters"), content: r(".cm-content"), line: r(".cm-line") };
    }, [c.column]);
    check(`${c.name}: a alça esquerda na borda do texto, com o cursor na hora`, atLeft.handle === "left" && atLeft.cursor === "col-resize" && atLeft.shown);
    check(`${c.name}: a alça direita na borda do texto, com o cursor na hora`, atRight.handle === "right" && atRight.cursor === "col-resize" && atRight.shown && onRight.handle === "right");
    // A barrinha a mesma folga dos dois lados, de 20 a 28 px fora do texto (lead, #13915). O texto é o recuo da coluna:
    // onde o título e o .txt começam, e onde as linhas quebram.
    const gaps = await p.evaluate((column) => {
      const col = document.querySelector(column)!.getBoundingClientRect();
      const bar = (side: string) => {
        const h = document.querySelector(`${column} .kn-width-handle[data-side="${side}"]`)!;
        const r = h.getBoundingClientRect();
        const a = getComputedStyle(h, "::after");
        return side === "left" ? r.left + parseFloat(a.left) + 1 : r.right - parseFloat(a.right) - 1;
      };
      return { left: Math.round(col.left + 40 - bar("left")), right: Math.round(bar("right") - (col.right - 40)) };
    }, c.column);
    result[`${c.name}.folga`] = gaps;
    check(`${c.name}: a barrinha a mesma folga dos dois lados, de 20 a 28 px`, gaps.left === gaps.right && gaps.left >= 20 && gaps.left <= 28);
    if (c.name === "txt-escuro") {
      await hoverAt(p, e0.left - 8, e0.y);
      await fakeCursor(p, { x: e0.left - 8, y: e0.y });
      await p.screenshot({ path: join(out, `largura-${c.name}.png`) });
      await w.close();
      continue;
    }
    if (c.name === "md") {
      // Os prints do harry (#13886): o mouse em cada borda, com a alça e o cursor à mostra, e o antes do arrasto.
      for (const [side, x] of [["esquerda", e0.left - 8], ["direita", e0.right + 8]] as const) {
        await hoverAt(p, x, e0.y);
        await fakeCursor(p, { x, y: e0.y });
        await p.screenshot({ path: join(out, `largura-md-${side}.png`) });
      }
      await p.mouse.move(5, 400);
      await fakeCursor(p, null);
      await p.screenshot({ path: join(out, "largura-md-antes.png") });
    }
    // A direita alarga 100 px para fora (a coluna, centralizada, cresce 200); a esquerda, 60 px para dentro, estreita 120.
    await drag(p, c.column, "right", 100);
    // A coluna e o texto: o CodeMirror redesenha as linhas um quadro depois da coluna.
    const e1 = await settle(() => edges(p, c.line, c.column), (e) => Math.abs(e.column - (e0.column + 200)) <= 2 && Math.abs(e.left - e0.left + 100) <= 3);
    if (c.name === "md") {
      // Depois: a coluna mais larga e no meio (as duas margens iguais).
      await p.mouse.move(5, 400);
      await p.screenshot({ path: join(out, "largura-md-depois.png") });
      const margins = await p.evaluate(() => {
        const r = document.querySelector(".kn-page")!.getBoundingClientRect();
        const w = document.querySelector(".kn-center")!.getBoundingClientRect();
        return [r.left - w.left, w.right - r.right];
      });
      check("md: a coluna mais larga continua no meio", Math.abs(margins[0]! - margins[1]!) <= 2);
    }
    check(`${c.name}: arrastar a direita alarga dos dois lados`, Math.abs(e1.column - (e0.column + 200)) <= 2 && Math.abs((e1.left - e0.left) + 100) <= 3);
    check(`${c.name}: a largura fica salva`, (await settle(saved, (v) => v === Math.round(e1.column))) === Math.round(e1.column));
    await drag(p, c.column, "left", 60);
    const e2 = await settle(() => edges(p, c.line, c.column), (e) => Math.abs(e.column - (e1.column - 120)) <= 2);
    check(`${c.name}: arrastar a esquerda estreita`, Math.abs(e2.column - (e1.column - 120)) <= 2);
    check(`${c.name}: a nova largura fica salva`, (await settle(saved, (v) => v === Math.round(e2.column))) === Math.round(e2.column));
    result[`${c.name}.larguras`] = [e0.column, e1.column, e2.column].map(Math.round);
    // Soltar no mesmo instante do último movimento, antes de o React desenhar ele (revisão do T13855): grava a largura do
    // arrasto, e não a do último render. O botão desce de verdade (a captura do ponteiro precisa dele); o movimento e o
    // soltar vão juntos, na mesma tarefa.
    {
      const box = (await p.locator(`${c.column} .kn-width-handle[data-side="right"]`).boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + Math.min(box.height / 2, 300);
      await p.mouse.move(x, y);
      await p.mouse.down();
      await p.evaluate(([column, x, y]) => {
        const h = document.querySelector(`${column} .kn-width-handle[data-side="right"]`)!;
        const at = (dx: number) => ({ bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: (x as number) + dx, clientY: y as number, button: 0, buttons: 1 });
        h.dispatchEvent(new PointerEvent("pointermove", at(10)));
        h.dispatchEvent(new PointerEvent("pointermove", at(30)));
        h.dispatchEvent(new PointerEvent("pointerup", { ...at(30), buttons: 0 }));
      }, [c.column, x, y] as const);
      await p.mouse.up();
      const want = Math.round(e2.column) + 60;
      const got = await settle(saved, (v) => v === want);
      result[`${c.name}.soltarNaHora`] = { esperado: want, salvo: got };
      check(`${c.name}: soltar logo depois de mover grava a largura do arrasto`, got === want);
      await settle(() => edges(p, c.line, c.column), (e) => Math.round(e.column) === want);
      // Volta à largura de antes, para o resto do caso.
      await drag(p, c.column, "right", -30);
      await settle(saved, (v) => v === Math.round(e2.column));
    }
    if (c.name !== "md") {
      await hoverAt(p, e2.left - 8, e2.y);
      await fakeCursor(p, { x: e2.left - 8, y: e2.y });
      await p.screenshot({ path: join(out, `largura-${c.name}.png`) });
      await fakeCursor(p, null);
    }
    // O duplo clique volta ao padrão.
    await p.mouse.dblclick(e2.right + 8, e2.y);
    await Bun.sleep(400);
    const back = await settle(saved, (v) => v === NOTE_WIDTH.default);
    const e3 = await settle(() => edges(p, c.line, c.column), (e) => Math.round(e.column) === NOTE_WIDTH.default);
    check(`${c.name}: o duplo clique volta ao padrão`, back === NOTE_WIDTH.default && Math.round(e3.column) === NOTE_WIDTH.default);
    await w.close();
  }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
result.ok = ok;
writeFileSync(join(out, "medidas.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
