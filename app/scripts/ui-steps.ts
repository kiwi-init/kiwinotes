// Os passos do `cli ui <janela> --script passos.json` (T1742): a generalização do notes-ui-check.ts para qualquer
// janela. Um passo é um objeto com uma ação só; os seletores são os do Playwright (CSS, `text=…`, `:has-text()`).
//
//   { "click": "SEL", "modifiers"?: ["Meta"] }      clica
//   { "fill": "SEL", "text": "…" }                    troca o valor de um input
//   { "type": "…" }                                   digita no foco
//   { "press": "Meta+k" }                             uma tecla ou combinação (⌘K é "Meta+k")
//   { "hover": "SEL" }
//   { "waitFor": "SEL", "state"?: "visible|hidden|attached|detached" }
//   { "wait": 300 }                                   ms (até 10 s)
//   { "expectText": "SEL", "text": "…" }              o texto do elemento contém `text`
//   { "expectCount": "SEL", "count": 3 }
//   { "screenshot": "nome.png", "selector"?: "SEL" }  print da janela (ou só do elemento)
//   { "drop": "SEL", "file": "caminho" }           arrasta um arquivo (imagem, PDF) e solta no meio do elemento (T2594)
//   { "pasteFile": "SEL", "file": "caminho" }      cola um arquivo no elemento, como um ⌘V com uma imagem (T2594).
//                                                     Só um evento na página: nunca o clipboard de verdade.
//   { "invoke": "notes.save", "args": {…} }          uma capacidade direto no engine, "de fora" da janela (como uma
//                                                     edição no Obsidian): a janela vê pelos eventos. Nunca clipboard.
//                                                     No notes.save, `"baseVersion": "current"` usa a versão de agora.
//
// Todo passo aceita `timeout` (ms, padrão 5000) e `name` (o rótulo no relatório). O arquivo é
// `{"steps":[…]}` (com `window`, `scale`, `theme`, `size`, `browser` e `query` opcionais, que as flags sobrepõem)
// ou só a lista de passos.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { Page } from "playwright-core";

import { settle } from "./ui-page.ts";

export type Step =
  | { click: string; modifiers?: Modifier[] }
  | { fill: string; text: string }
  | { type: string }
  | { press: string }
  | { hover: string }
  | { waitFor: string; state?: "visible" | "hidden" | "attached" | "detached" }
  | { wait: number }
  | { expectText: string; text: string }
  | { expectCount: string; count: number }
  | { screenshot: string; selector?: string }
  | { invoke: string; args?: Record<string, unknown> }
  | { drop: string; file: string }
  | { pasteFile: string; file: string };

type Modifier = "Alt" | "Control" | "Meta" | "Shift";
export type StepWithMeta = Step & { timeout?: number; name?: string };

export interface ScriptFile {
  window?: string;
  scale?: number;
  theme?: string;
  size?: string;
  browser?: string;
  query?: Record<string, string>;
  steps: StepWithMeta[];
}

const ACTIONS = ["click", "fill", "type", "press", "hover", "waitFor", "wait", "expectText", "expectCount", "screenshot", "invoke", "drop", "pasteFile"] as const;

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
    switch (action) {
      case "wait":
        if (!Number.isInteger(s.wait) || (s.wait as number) < 0 || (s.wait as number) > 10_000) throw new Error(`${at}: wait em ms, de 0 a 10000`);
        break;
      case "fill":
      case "expectText":
        str(s[action], `${at}.${action}`);
        if (typeof s.text !== "string") throw new Error(`${at}: ${action} precisa de text`);
        break;
      case "expectCount":
        str(s.expectCount, `${at}.expectCount`);
        if (!Number.isInteger(s.count) || (s.count as number) < 0) throw new Error(`${at}: expectCount precisa de count (inteiro ≥ 0)`);
        break;
      case "click":
        str(s.click, `${at}.click`);
        if (s.modifiers !== undefined && !(Array.isArray(s.modifiers) && s.modifiers.every((m) => MODIFIERS.has(m as string)))) {
          throw new Error(`${at}: modifiers entre Alt, Control, Meta, Shift`);
        }
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
  if ("click" in s) await page.click(s.click, { timeout, modifiers: s.modifiers });
  else if ("fill" in s) await page.fill(s.fill, s.text, { timeout });
  else if ("type" in s) await page.keyboard.type(s.type);
  else if ("press" in s) await page.keyboard.press(s.press);
  else if ("hover" in s) await page.hover(s.hover, { timeout });
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
