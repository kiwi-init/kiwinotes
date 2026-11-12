// Os passos do `cli ui <janela> --script passos.json` (T1742): a generalização do notes-ui-check.ts para qualquer
// janela. Um passo é um objeto com uma ação só; os seletores são os do Playwright (CSS, `text=…`, `:has-text()`).
//
//   { "click": "SEL", "modifiers"?: ["Meta"] }      clica
//   { "fill": "SEL", "text": "…" }                    troca o valor de um input
//   { "select": "SEL", "value": "…" }                 escolhe a opção de um <select> pelo value (T3230)
//   { "type": "…" }                                   digita no foco
//   { "press": "Meta+k" }                             uma tecla ou combinação (⌘K é "Meta+k")
//   { "hover": "SEL" }
//   { "clickText": "…", "within"?: "SEL" }          clica no meio de um texto, onde ele estiver: dentro de um parágrafo
//                                                     desenhado (o `.cm-rendered` do editor) ou numa linha (T7843)
//   { "scroll": "SEL", "y": 400, "x"?: 0 }            o mouse no elemento e a roda: rola de verdade (T4505)
//   { "expectScroll": "SEL", "min"?: 100, "max"?: 900 }  o scrollTop do elemento fica entre min e max (T4505)
//   { "waitFor": "SEL", "state"?: "visible|hidden|attached|detached" }
//   { "wait": 300 }                                   ms (até 10 s)
//   { "expectText": "SEL", "text": "…" }              o texto do elemento contém `text`
//   { "expectCount": "SEL", "count": 3 }
//   { "expectSame": "SEL", "as": "SEL", "property"?: "color", "tolerance"?: 1 }  o retângulo de SEL é o de `as` (até
//                                                     `tolerance` px, padrão 1); com `property`, as duas propriedades
//                                                     computadas têm o mesmo valor (T4671)
//   { "screenshot": "nome.png", "selector"?: "SEL" }  print da janela (ou só do elemento)
//   { "expectNoHScroll": "SEL", "allow"?: "SEL" }    nada rola de lado: nem a página, nem um elemento rolável dentro de
//                                                     SEL, fora os que casam com `allow` (o bloco de código, a tabela
//                                                     larga). Na falha, diz quem passa da borda (T5299, issue #212)
//   { "drag": "SEL", "x": 200, "y"?: 0 }              aperta no meio do elemento, arrasta x/y px e solta (T5299)
//   { "expectWidth": "SEL", "min"?: 400, "max"?: 900 } a largura do elemento na tela fica entre min e max (T5299)
//   { "drop": "SEL", "file": "caminho" }           arrasta um arquivo (imagem, PDF) e solta no meio do elemento (T2594)
//   { "pasteFile": "SEL", "file": "caminho" }      cola um arquivo no elemento, como um ⌘V com uma imagem (T2594).
//   { "pasteHtml": "SEL", "html": "…", "text"?: "…", "shift"?: true }  cola HTML (e o texto puro) no elemento, como um
//                                                     ⌘V de um site ou e-mail (T6379); `shift`, como o ⇧⌘V.
//                                                     Só um evento na página: nunca o clipboard de verdade.
//   { "invoke": "notes.save", "args": {…} }          uma capacidade direto no engine, "de fora" da janela (como uma
//                                                     edição no Obsidian): a janela vê pelos eventos. Nunca clipboard.
//                                                     No notes.save, `"baseVersion": "current"` usa a versão de agora.
//
// Todo passo aceita `timeout` (ms, padrão 5000), `name` (o rótulo no relatório) e `maxMs` (o passo falha se levar mais
// que isso, para medir uma trava; T7390). O arquivo é
// `{"steps":[…]}` (com `window`, `scale`, `theme`, `size`, `browser` e `query` opcionais, que as flags sobrepõem)
// ou só a lista de passos.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { Page } from "playwright-core";

import { settle } from "./ui-page.ts";

export type Step =
  | { click: string; modifiers?: Modifier[]; button?: "left" | "right"; position?: { x: number; y: number } }
  | { fill: string; text: string }
  /** Escolhe a opção de um `<select>` pelo `value` (T3230). */
  | { select: string; value: string }
  | { type: string }
  | { press: string }
  | { hover: string }
  /** Clica com o mouse no meio de um texto (um `Range` sobre o nó), dentro de `within` (T7843). */
  | { clickText: string; within?: string }
  /** O mouse no meio do elemento e a roda (`y` px para baixo, `x` para a direita), como um scroll de verdade (T4505). */
  | { scroll: string; y?: number; x?: number }
  /** O `scrollTop` do primeiro elemento fica entre `min` e `max` (px), esperando até o timeout (T4505). */
  | { expectScroll: string; min?: number; max?: number }
  | { waitFor: string; state?: "visible" | "hidden" | "attached" | "detached" }
  | { wait: number }
  | { expectText: string; text: string }
  | { expectCount: string; count: number }
  /** O retângulo de um elemento é o de outro, ou (com `property`) as duas propriedades computadas são iguais. */
  | { expectSame: string; as: string; property?: string; tolerance?: number }
  | { screenshot: string; selector?: string }
  /** Sem scroll horizontal na página nem dentro de SEL, fora os elementos que casam com `allow` (T5299). */
  | { expectNoHScroll: string; allow?: string }
  /** Aperta no meio do elemento, arrasta `x`/`y` px em passos, como o mouse de verdade, e solta (T5299). */
  | { drag: string; x: number; y?: number }
  /** A largura do elemento na tela (px) fica entre `min` e `max`, esperando até o timeout (T5299). */
  | { expectWidth: string; min?: number; max?: number }
  | { invoke: string; args?: Record<string, unknown> }
  | { drop: string; file: string }
  | { pasteFile: string; file: string }
  | { pasteHtml: string; html: string; text?: string; shift?: boolean };

type Modifier = "Alt" | "Control" | "Meta" | "Shift";
export type StepWithMeta = Step & { timeout?: number; name?: string; maxMs?: number };

export interface ScriptFile {
  window?: string;
  scale?: number;
  theme?: string;
  size?: string;
  browser?: string;
  query?: Record<string, string>;
  steps: StepWithMeta[];
}

const ACTIONS = ["click", "clickText", "fill", "select", "type", "press", "hover", "scroll", "expectScroll", "waitFor", "wait", "expectText", "expectCount", "expectSame", "expectNoHScroll", "drag", "expectWidth", "screenshot", "invoke", "drop", "pasteFile", "pasteHtml"] as const;

/** O tipo do arquivo de um `drop`/`pasteFile`, pela extensão. */
const FILE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", txt: "text/plain" };
const MODIFIERS = new Set(["Alt", "Control", "Meta", "Shift"]);
const STATES = new Set(["visible", "hidden", "attached", "detached"]);
const MAX_STEPS = 500;

/** Valida o arquivo de passos e devolve a forma normalizada; um erro diz o passo e o campo. */
export function parseScript(json: unknown): ScriptFile {
  const file = (Array.isArray(json) ? { steps: json } : json) as Record<string, unknown> | null;
  if (!file || typeof file !== "object") throw new Error("o script é um objeto {steps:[…]} ou uma lista de passos");
  const steps = file.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("o script não tem passos (steps)");
  if (steps.length > MAX_STEPS) throw new Error(`mais de ${MAX_STEPS} passos`);
  const str = (v: unknown, where: string) => {
    if (typeof v !== "string" || v === "") throw new Error(`${where}: precisa de um texto`);
    return v;
  };
  for (const key of ["window", "theme", "size", "browser"] as const) if (file[key] !== undefined) str(file[key], key);
  if (file.scale !== undefined && file.scale !== 1 && file.scale !== 2) throw new Error("scale: 1 ou 2");
  if (file.query !== undefined) {
    if (!file.query || typeof file.query !== "object" || Array.isArray(file.query)) throw new Error("query: um objeto de textos");
    for (const [k, v] of Object.entries(file.query)) str(v, `query.${k}`);
  }
  steps.forEach((raw, i) => {
    const at = `passo ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at}: precisa ser um objeto`);
    const s = raw as Record<string, unknown>;
    const actions = ACTIONS.filter((a) => a in s);
    if (actions.length !== 1) throw new Error(`${at}: uma ação só, entre ${ACTIONS.join(", ")} (veio ${actions.join(", ") || "nenhuma"})`);
    const action = actions[0]!;
    if (s.timeout !== undefined && !(Number.isInteger(s.timeout) && (s.timeout as number) > 0 && (s.timeout as number) <= 60_000)) {
      throw new Error(`${at}: timeout em ms, de 1 a 60000`);
    }
    if (s.name !== undefined) str(s.name, `${at}.name`);
    if (s.maxMs !== undefined && !(Number.isInteger(s.maxMs) && (s.maxMs as number) > 0 && (s.maxMs as number) <= 60_000)) {
      throw new Error(`${at}: maxMs em ms, de 1 a 60000`);
    }
    switch (action) {
      case "wait":
        if (!Number.isInteger(s.wait) || (s.wait as number) < 0 || (s.wait as number) > 10_000) throw new Error(`${at}: wait em ms, de 0 a 10000`);
        break;
      case "fill":
      case "expectText":
        str(s[action], `${at}.${action}`);
        if (typeof s.text !== "string") throw new Error(`${at}: ${action} precisa de text`);
        break;
      case "select":
        str(s.select, `${at}.select`);
        if (typeof s.value !== "string") throw new Error(`${at}: select precisa de value (o value da opção)`);
        break;
      case "expectCount":
        str(s.expectCount, `${at}.expectCount`);
        if (!Number.isInteger(s.count) || (s.count as number) < 0) throw new Error(`${at}: expectCount precisa de count (inteiro ≥ 0)`);
        break;
      case "expectSame":
        str(s.expectSame, `${at}.expectSame`);
        str(s.as, `${at}.as`);
        if (s.property !== undefined) str(s.property, `${at}.property`);
        if (s.tolerance !== undefined && !(typeof s.tolerance === "number" && Number.isFinite(s.tolerance) && s.tolerance >= 0 && s.tolerance <= 64)) {
          throw new Error(`${at}: tolerance em px, de 0 a 64`);
        }
        break;
      case "click":
        str(s.click, `${at}.click`);
        if (s.position !== undefined) {
          const p = s.position as Record<string, unknown>;
          if (!p || typeof p !== "object" || ![p.x, p.y].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 4000)) throw new Error(`${at}.position: x e y entre 0 e 4000`);
        }
        if (s.button !== undefined && s.button !== "left" && s.button !== "right") throw new Error(`${at}.button: left ou right`);
        if (s.modifiers !== undefined && !(Array.isArray(s.modifiers) && s.modifiers.every((m) => MODIFIERS.has(m as string)))) {
          throw new Error(`${at}: modifiers entre Alt, Control, Meta, Shift`);
        }
        break;
      case "clickText":
        str(s.clickText, `${at}.clickText`);
        if (s.within !== undefined) str(s.within, `${at}.within`);
        break;
      case "scroll":
        str(s.scroll, `${at}.scroll`);
        for (const k of ["x", "y"] as const) {
          if (s[k] !== undefined && !(typeof s[k] === "number" && Number.isFinite(s[k]) && Math.abs(s[k] as number) <= 100_000)) {
            throw new Error(`${at}: scroll.${k} em px, até 100000`);
          }
        }
        if (s.x === undefined && s.y === undefined) throw new Error(`${at}: scroll precisa de y ou x (px)`);
        break;
      case "expectScroll":
        str(s.expectScroll, `${at}.expectScroll`);
        for (const k of ["min", "max"] as const) {
          if (s[k] !== undefined && !(typeof s[k] === "number" && Number.isFinite(s[k]))) throw new Error(`${at}: expectScroll.${k} em px`);
        }
        if (s.min === undefined && s.max === undefined) throw new Error(`${at}: expectScroll precisa de min ou max (px)`);
        break;
      case "drag":
        str(s.drag, `${at}.drag`);
        for (const k of ["x", "y"] as const) {
          if (s[k] !== undefined && !(typeof s[k] === "number" && Number.isFinite(s[k]) && Math.abs(s[k] as number) <= 10_000)) {
            throw new Error(`${at}: drag.${k} em px, até 10000`);
          }
        }
        if (s.x === undefined) throw new Error(`${at}: drag precisa de x (px)`);
        break;
      case "expectWidth":
        str(s.expectWidth, `${at}.expectWidth`);
        for (const k of ["min", "max"] as const) {
          if (s[k] !== undefined && !(typeof s[k] === "number" && Number.isFinite(s[k]))) throw new Error(`${at}: expectWidth.${k} em px`);
        }
        if (s.min === undefined && s.max === undefined) throw new Error(`${at}: expectWidth precisa de min ou max (px)`);
        break;
      case "expectNoHScroll":
        str(s.expectNoHScroll, `${at}.expectNoHScroll`);
        if (s.allow !== undefined) str(s.allow, `${at}.allow`);
        break;
      case "waitFor":
        str(s.waitFor, `${at}.waitFor`);
        if (s.state !== undefined && !STATES.has(s.state as string)) throw new Error(`${at}: state entre ${[...STATES].join(", ")}`);
        break;
      case "screenshot": {
        const name = str(s.screenshot, `${at}.screenshot`);
        // Só um nome: o print vai para a pasta de saída, nunca para outro lugar.
        if (basename(name) !== name || !name.endsWith(".png")) throw new Error(`${at}: screenshot é um nome de arquivo .png, sem pasta`);
        if (s.selector !== undefined) str(s.selector, `${at}.selector`);
        break;
      }
      case "invoke":
        str(s.invoke, `${at}.invoke`);
        if (s.invoke === "clipboard.write") throw new Error(`${at}: clipboard.write não (AGENTS.md: agente não escreve no clipboard)`);
        if (s.args !== undefined && (!s.args || typeof s.args !== "object" || Array.isArray(s.args))) throw new Error(`${at}: args é um objeto`);
        break;
      case "type":
        if (typeof s.type !== "string") throw new Error(`${at}: type precisa de um texto`);
        break;
      case "pasteHtml":
        str(s.pasteHtml, `${at}.pasteHtml`);
        if (typeof s.html !== "string" || !s.html) throw new Error(`${at}: pasteHtml precisa de html`);
        if (s.text !== undefined && typeof s.text !== "string") throw new Error(`${at}: text é um texto`);
        break;
      case "drop":
      case "pasteFile":
        str(s[action], `${at}.${action}`);
        if (typeof s.file !== "string" || !s.file) throw new Error(`${at}: ${action} precisa de file (o caminho do arquivo)`);
        break;
      default:
        str(s[action], `${at}.${action}`);
    }
  });
  return file as unknown as ScriptFile;
}

export const actionOf = (s: StepWithMeta) => ACTIONS.find((a) => a in s)!;

/** Um rótulo curto para o relatório: `click .kn-title`, `press Meta+k`. */
export function describeStep(s: StepWithMeta): string {
  if (s.name) return s.name;
  const a = actionOf(s);
  const v = (s as Record<string, unknown>)[a];
  return `${a} ${typeof v === "string" ? v : JSON.stringify(v)}`;
}

/** O que um passo devolve ao relatório: o caminho do print, ou o `value` de um `invoke`. */
export interface StepResult {
  shot?: string;
  value?: unknown;
}

/** Roda um passo. `out` é a pasta dos prints; `send` leva um `invoke` ao engine (o `ctx.send` da CLI). */
export async function runStep(page: Page, s: StepWithMeta, out: string, send: (msg: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<StepResult> {
  const timeout = s.timeout ?? 5000;
  if ("invoke" in s) {
    if (s.invoke === "clipboard.write") throw new Error("clipboard.write não");
    const args = { ...s.args };
    // `"baseVersion": "current"`: a versão de agora, lida antes pelo `notes.get`, para um roteiro editar "de fora"
    // sem escrever a versão à mão (#1835).
    if (s.invoke === "notes.save" && args.baseVersion === "current") {
      const g = await send({ cmd: "invoke", cap: "notes.get", args: { path: args.path } });
      if (g.ok !== true) throw new Error(`notes.get ${String(args.path)} (para o baseVersion): ${String(g.code ?? "E_FAILED")} ${String(g.message ?? "")}`.trim());
      args.baseVersion = (g.value as { version: string }).version;
    }
    const r = await send({ cmd: "invoke", cap: s.invoke, args });
    if (r.ok !== true) throw new Error(`${s.invoke}: ${String(r.code ?? "E_FAILED")} ${String(r.message ?? "")}`.trim());
    // Com a versão velha, o save não escreve e responde ok: no roteiro, isso é falha, não sucesso calado.
    if (s.invoke === "notes.save" && (r.value as { saved?: boolean } | null)?.saved === false) {
      throw new Error(`notes.save ${String(args.path)}: não gravou, o baseVersion está velho (use "current")`);
    }
    return { value: r.value };
  }
  if ("pasteHtml" in s) {
    const el = page.locator(s.pasteHtml).first();
    await el.waitFor({ timeout });
    await el.evaluate(
      (target, { html, text, shift }) => {
        (target as HTMLElement).focus();
        // O ⇧⌘V: o editor olha o ⇧ no keydown do V. Um evento de mentira, sem a ação do navegador: uma tecla de verdade
        // poderia colar o clipboard real do Mac na página (AGENTS.md).
        if (shift) target.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", shiftKey: true, metaKey: true, bubbles: true, cancelable: true }));
        const dt = new DataTransfer();
        dt.setData("text/html", html);
        dt.setData("text/plain", text);
        target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      },
      { html: s.html, text: s.text ?? "", shift: !!s.shift },
    );
    return {};
  }
  if ("drop" in s || "pasteFile" in s) {
    const sel = "drop" in s ? s.drop : s.pasteFile;
    const name = basename(s.file);
    const bytes = [...readFileSync(s.file)];
    const type = FILE_TYPES[name.split(".").at(-1)!.toLowerCase()] ?? "application/octet-stream";
    const el = page.locator(sel).first();
    await el.waitFor({ timeout });
    const box = (await el.boundingBox())!;
    await page.evaluate(
      ({ sel, bytes, name, type, x, y, drop }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
        const target = (drop ? document.elementFromPoint(x, y) : null) ?? document.querySelector(sel)!;
        if (drop) {
          for (const t of ["dragenter", "dragover", "drop"]) {
            target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
          }
        } else {
          (target as HTMLElement).focus();
          target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
        }
      },
      { sel, bytes, name, type, x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 20), drop: "drop" in s },
    );
    return {};
  }
  if ("clickText" in s) {
    // O texto pode estar num parágrafo desenhado (o editor fora do cursor junta as linhas num `<p>` só), onde não há um
    // elemento por linha para o `click`: o meio do próprio texto, pelo retângulo de um `Range`, vale nos dois casos.
    const until = Date.now() + timeout;
    for (;;) {
      const at = await page.evaluate(
        ({ text, within }) => {
          const root = within ? document.querySelector(within) : document.body;
          if (!root) return null;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const i = node.nodeValue?.indexOf(text) ?? -1;
            if (i < 0) continue;
            (node.parentElement as HTMLElement | null)?.scrollIntoView({ block: "center" });
            // O caractere do meio do texto: um texto que quebra de linha tem dois retângulos, e o meio do primeiro
            // podia cair no fim da linha de cima.
            const mid = i + Math.floor(text.length / 2);
            const range = document.createRange();
            range.setStart(node, mid);
            range.setEnd(node, mid + 1);
            const r = range.getBoundingClientRect();
            if (!r.width && !r.height) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
          return null;
        },
        { text: s.clickText, within: s.within ?? null },
      );
      if (at) {
        await page.mouse.click(at.x, at.y);
        break;
      }
      if (Date.now() > until) throw new Error(`clickText: "${s.clickText}" não apareceu${s.within ? ` em ${s.within}` : ""}`);
      await page.waitForTimeout(100);
    }
  } else if ("click" in s) await page.click(s.click, { timeout, modifiers: s.modifiers, button: s.button, position: s.position });
  else if ("fill" in s) await page.fill(s.fill, s.text, { timeout });
  else if ("select" in s) await page.selectOption(s.select, s.value, { timeout });
  else if ("type" in s) await page.keyboard.type(s.type);
  else if ("press" in s) await page.keyboard.press(s.press);
  else if ("hover" in s) await page.hover(s.hover, { timeout });
  else if ("scroll" in s) {
    await page.hover(s.scroll, { timeout });
    await page.mouse.wheel(s.x ?? 0, s.y ?? 0);
  } else if ("expectScroll" in s) {
    const min = s.min ?? -Infinity;
    const max = s.max ?? Infinity;
    await page.waitForSelector(s.expectScroll, { timeout, state: "attached" });
    const deadline = Date.now() + timeout;
    let top = NaN;
    while (true) {
      top = await page.locator(s.expectScroll).first().evaluate((e) => e.scrollTop, undefined, { timeout: 500 }).catch(() => NaN);
      if ((top >= min && top <= max) || Date.now() > deadline) break;
      await page.waitForTimeout(50);
    }
    if (!(top >= min && top <= max)) throw new Error(`esperava o scrollTop de ${s.expectScroll} entre ${min} e ${max}, veio ${top}`);
  }
  else if ("drag" in s) {
    const box = await page.locator(s.drag).first().boundingBox({ timeout });
    if (!box) throw new Error(`${s.drag} não está na tela`);
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 200);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + s.x, y + (s.y ?? 0), { steps: 12 });
    await page.mouse.up();
  } else if ("expectWidth" in s) {
    const min = s.min ?? -Infinity;
    const max = s.max ?? Infinity;
    const deadline = Date.now() + timeout;
    let w = NaN;
    while (true) {
      w = (await page.locator(s.expectWidth).first().boundingBox({ timeout: 500 }).catch(() => null))?.width ?? NaN;
      if ((w >= min && w <= max) || Date.now() > deadline) break;
      await page.waitForTimeout(50);
    }
    if (!(w >= min && w <= max)) throw new Error(`esperava a largura de ${s.expectWidth} entre ${min} e ${max}, veio ${w}`);
  }
  else if ("expectNoHScroll" in s) {
    await page.waitForSelector(s.expectNoHScroll, { timeout, state: "attached" });
    const found = await page.evaluate(({ sel, allow }) => {
      const label = (e: Element) => {
        const cls = typeof e.className === "string" && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
        const text = (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        return `${e.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ""}`;
      };
      const page = document.scrollingElement ?? document.documentElement;
      const scrollers = [page, ...document.querySelectorAll(sel), ...[...document.querySelectorAll(sel)].flatMap((r) => [...r.querySelectorAll("*")])];
      const out: string[] = [];
      for (const el of new Set(scrollers)) {
        if (el !== page) {
          const x = getComputedStyle(el).overflowX;
          if (x !== "auto" && x !== "scroll") continue;
          if (allow && el.matches(allow)) continue;
        }
        const extra = el.scrollWidth - el.clientWidth;
        if (extra <= 1) continue;
        // Quem passa da borda direita: os mais fundos, que são a causa, e não os pais que só os carregam.
        const edge = el === page ? window.innerWidth : el.getBoundingClientRect().left + el.clientWidth;
        const wide = [...el.querySelectorAll("*")].filter((c) => c.getBoundingClientRect().right > edge + 1 && !(allow && c.closest(allow)));
        const leaves = wide.filter((c) => !wide.some((d) => d !== c && c.contains(d))).slice(0, 4);
        out.push(`${el === page ? "a página" : label(el)} rola ${extra}px de lado${leaves.length ? `; passam da borda: ${leaves.map(label).join("; ")}` : ""}`);
      }
      return out;
    }, { sel: s.expectNoHScroll, allow: s.allow ?? "" });
    if (found.length) throw new Error(`scroll horizontal: ${found.join(" | ")}`);
  }
  else if ("waitFor" in s) await page.waitForSelector(s.waitFor, { timeout, state: s.state ?? "visible" });
  else if ("wait" in s) await page.waitForTimeout(s.wait);
  else if ("expectText" in s) {
    const want = s.text;
    await page.waitForSelector(s.expectText, { timeout, state: "attached" });
    const deadline = Date.now() + timeout;
    let got = "";
    // O seletor é resolvido de novo a cada volta: o React troca o elemento (o `aria-current` muda de item).
    while (true) {
      const el = page.locator(s.expectText).first();
      got = await el
        .evaluate((e) => (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : (e.textContent ?? "")), undefined, { timeout: 500 })
        .catch(() => "");
      if (got.includes(want) || Date.now() > deadline) break;
      await page.waitForTimeout(50);
    }
    if (!got.includes(want)) throw new Error(`esperava ${JSON.stringify(want)} em ${s.expectText}, veio ${JSON.stringify(got.slice(0, 200))}`);
  } else if ("expectCount" in s) {
    const deadline = Date.now() + timeout;
    let n = 0;
    while (true) {
      n = await page.locator(s.expectCount).count();
      if (n === s.count || Date.now() > deadline) break;
      await page.waitForTimeout(50);
    }
    if (n !== s.count) throw new Error(`esperava ${s.count} de ${s.expectCount}, veio ${n}`);
  } else if ("expectSame" in s) {
    // Duas leituras do mesmo momento: o retângulo de um elemento e o de outro (a pílula na aba escolhida), ou a
    // propriedade computada dos dois (o texto da aba sob o mouse na cor da ativa). Espera até bater, para a animação
    // terminar; se não bater, a mensagem mostra o que veio de cada lado (T4671).
    const tol = s.tolerance ?? 1;
    type Same = { style: [string, string] | null; rect: number[][] | null } | null;
    // Os seletores são os do Playwright (`:has-text(…)` vale), e as duas leituras são do mesmo instante: os
    // elementos viram handles e um `evaluate` só lê os dois.
    const one = page.locator(s.expectSame).first();
    const other = page.locator(s.as).first();
    await one.waitFor({ timeout, state: "attached" });
    await other.waitFor({ timeout, state: "attached" });
    const read = async (): Promise<Same> => {
      const round = (r: { x: number; y: number; width: number; height: number }) =>
        [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
      if (s.property) {
        const prop = s.property;
        const [a, b] = await Promise.all([
          one.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop),
          other.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop),
        ]);
        return { style: [a, b], rect: null };
      }
      const [ra, rb] = await Promise.all([one.boundingBox({ timeout: 1_000 }), other.boundingBox({ timeout: 1_000 })]);
      if (!ra || !rb) return null;
      return { style: null, rect: [round(ra), round(rb)] };
    };
    const same = (v: Same) => {
      if (!v) return false;
      if (v.style) return v.style[0] === v.style[1];
      const [a, b] = v.rect ?? [];
      return !!a && !!b && a.every((n, i) => Math.abs(n - (b[i] ?? Infinity)) <= tol);
    };
    const deadline = Date.now() + timeout;
    let got: Same = null;
    while (true) {
      got = await read();
      if (same(got) || Date.now() > deadline) break;
      await page.waitForTimeout(50);
    }
    if (!same(got)) {
      const what = s.property ? `${s.property} igual` : `o retângulo (até ${tol} px)`;
      throw new Error(`esperava ${what} em ${s.expectSame} e ${s.as}, veio ${JSON.stringify(got)}`);
    }
  } else if ("screenshot" in s) {
    const path = join(out, s.screenshot);
    await settle(page);
    if (s.selector) {
      const el = page.locator(s.selector).first();
      await el.waitFor({ timeout }).catch(() => {
        throw new Error(`o seletor ${s.selector} não apareceu em ${timeout} ms`);
      });
      await el.screenshot({ path, timeout });
    }
    else await page.screenshot({ path });
    return { shot: path };
  }
  return {};
}
