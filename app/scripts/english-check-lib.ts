// O que os roteiros em inglês (spec #28171, caixa 6) têm em comum: sobem o próprio headless num tmp com o app em
// English, abrem a janela num WebKit headless (nada aparece na tela de ninguém) e conferem cada tela contra o
// português. Usado pelo `hub-english-check` (T28191) e pelos roteiros de cada área (T30632, T30636).
//
//   const s = await startEnglish({ seed: (data) => … });
//   const { page } = await s.open("hub", { section: "notes" });
//   await s.check(page, "1-notas");
//   …
//   await s.finish(); // o resumo em JSON, e sai 1 se alguma tela tinha português
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, type Page, webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type OpenedPage, type UiContext } from "./ui-page";
import type { UiWindow } from "../src/shared/ui-contract.ts";
import { en } from "../src/shared/i18n/en.ts";
import type { Entry } from "../src/shared/i18n/index.ts";
import { pt } from "../src/shared/i18n/pt.ts";

export const APP_DIR = resolve(import.meta.dir, "..");

const forms = (e: Entry | undefined) => (e === undefined ? [] : typeof e === "string" ? [e] : Object.values(e));

/**
 * Os pedaços em português que não podem aparecer: de cada frase do catálogo (todas as partes) que muda em inglês, o
 * maior trecho entre os `{params}`, com pelo menos 12 letras (os curtos, como "Ok" ou "Kiwi", são iguais nas duas
 * línguas ou comuns demais).
 */
export function ptPieces(): string[] {
  const EN = en as Record<string, Entry>;
  const pieces = new Set<string>();
  for (const [key, ptEntry] of Object.entries(pt) as [string, Entry][]) {
    const enForms = forms(EN[key]);
    for (const f of forms(ptEntry)) {
      if (enForms.includes(f)) continue;
      const longest = f.split(/\{\w+\}/).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0] ?? "";
      if (longest.length >= 12) pieces.add(longest);
    }
  }
  return [...pieces];
}

/**
 * As frases curtas do catálogo em português (de 3 letras para cima) que mudam em inglês, inteiras: "Ontem", "Fechar",
 * "Notas". Um texto de botão, de título ou de `aria-label` igual a uma delas é português, mesmo sem acento.
 */
export function ptExact(): Set<string> {
  const EN = en as Record<string, Entry>;
  const enAll = new Set(Object.values(EN).flatMap(forms));
  const exact = new Set<string>();
  for (const [key, ptEntry] of Object.entries(pt) as [string, Entry][]) {
    const enForms = forms(EN[key]);
    for (const f of forms(ptEntry)) {
      const t = f.trim();
      // Fica de fora o que é igual em inglês (nesta chave ou noutra, como "Kiwi" ou "Ok") e o que tem `{param}`.
      if (t.length < 3 || /\{\w+\}/.test(t) || enForms.includes(f) || enAll.has(t)) continue;
      exact.add(t);
    }
  }
  return exact;
}

/** Os textos inteiros da tela: cada nó de texto visível e os `aria-label`, `placeholder` e `title`. */
async function screenTexts(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element | null) => !!el && (el as HTMLElement).checkVisibility?.({ opacityProperty: false, visibilityProperty: true }) !== false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent?.trim();
      if (t && visible(n.parentElement)) out.push(t);
    }
    for (const el of document.querySelectorAll("[aria-label], [placeholder], [title]")) {
      if (!visible(el)) continue;
      for (const a of ["aria-label", "placeholder", "title"]) {
        const v = el.getAttribute(a)?.trim();
        if (v) out.push(v);
      }
    }
    return out;
  });
}

/**
 * O português que não está no catálogo (um texto escrito direto no código): as letras que o inglês não tem (ã, õ, ç)
 * e palavras que só o português usa. Os dados de exemplo dos roteiros são em inglês, então nada disso devia aparecer.
 */
const PT_WORD = /[ãõçÃÕÇ]|(?<![\p{L}-])(não|você|está|até|também|então|pelo|pela|uma|das|dos|nas|nos|com|sem|para|de|em)(?![\p{L}-])/u;

/** O trecho em volta de cada achado do `PT_WORD`, para o relatório dizer onde está. */
export function ptWords(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const m = PT_WORD.exec(line);
    if (m) found.push(line.trim().slice(0, 80));
  }
  return found;
}

export interface EnglishOptions {
  /** A pasta dos prints; o padrão é um tmp com este nome. */
  out?: string;
  name?: string;
  /** O que mais vai no `settings.json`; o padrão já é `language: "en"` e a primeira abertura feita. */
  settings?: Record<string, unknown>;
  env?: Record<string, string>;
  /**
   * O português que já tem dono (a task que o traduz): sai no resumo como `known`, sem reprovar. Cada item é um trecho
   * do achado e a task, como `["O login é dele", "T30631"]`. Some daqui no PR que o traduz.
   */
  known?: [string, string][];
  /** Escreve na pasta de dados antes de o headless subir (ditados, notas). */
  seed?(data: string): void;
}

export interface EnglishSession {
  data: string;
  out: string;
  ctx: UiContext;
  invoke(cap: string, args?: unknown): Promise<any>;
  open(window: UiWindow, query?: Record<string, string>, size?: { width: number; height: number }): Promise<OpenedPage>;
  /**
   * A tela inteira em inglês: nenhum pedaço do catálogo em português nem palavra só do português; e o print. `skip`:
   * trechos que ficam em português de propósito (o que a pessoa escreveu, como a Memória do agente), tirados do texto
   * antes da conferência.
   */
  check(p: Page, name: string, opts?: { skip?: (string | RegExp)[] }): Promise<void>;
  problems: string[];
  /** Fecha o navegador e o headless; não lança erro se o headless já caiu. Pode ir no `finally` de quem chama. */
  stop(): Promise<void>;
  /** Fecha o navegador e o headless, imprime o resumo e sai 1 se alguma tela tinha português. */
  finish(): Promise<never>;
  /** Fecha tudo depois de um erro, com o print de onde parou. */
  fail(e: unknown, page?: Page | null): Promise<never>;
}

export async function startEnglish(opts: EnglishOptions = {}): Promise<EnglishSession> {
  const out = resolve(process.argv[2] ?? opts.out ?? join(tmpdir(), `kiwi-${opts.name ?? "english"}`));
  mkdirSync(out, { recursive: true });
  const data = mkdtempSync(join(tmpdir(), "kiwi-english-"));
  writeFileSync(join(data, "settings.json"), JSON.stringify({ version: 1, firstRun: "done", language: "en", ...opts.settings }));
  opts.seed?.(data);
  const env = { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_SYSTEM_LANG: "en-US", KIWI_LANGUAGE_CHOICE: "1", ...opts.env };
  const cli = async (args: string[]) => {
    const p = Bun.spawn([process.execPath, join(APP_DIR, "scripts/cli.ts"), ...args, "--data", data], { cwd: APP_DIR, stdout: "pipe", stderr: "pipe", env });
    const text = await new Response(p.stdout).text();
    assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  };
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
  const invoke = async (cap: string, args: unknown = {}) => {
    const r = await ctx.send({ cmd: "invoke", cap, args });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value as any;
  };

  const browser: Browser = await webkit.launch({ headless: true });
  await cli(["start", "--no-helper"]);
  const pieces = ptPieces();
  const exact = ptExact();
  const problems: string[] = [];
  const known: string[] = [];
  const report = (finding: string) => {
    const k = opts.known?.find(([piece]) => finding.includes(piece));
    if (k) known.push(`${finding} (${k[1]})`);
    else problems.push(finding);
  };
  const shots: string[] = [];
  const opened: OpenedPage[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const o of opened) await o.close().catch(() => {});
    await browser.close().catch(() => {});
    await cli(["stop"]).catch(() => {});
  };
  const s: EnglishSession = {
    data,
    out,
    ctx,
    invoke,
    problems,
    async open(window, query = {}, size = { width: 1100, height: 760 }) {
      const o = await openWindow(browser, ctx, { window, scale: 2, theme: "dark", ...size, motion: false, browser: "webkit", query });
      opened.push(o);
      return o;
    },
    stop: close,
    async check(p, name, { skip = [] } = {}) {
      await Bun.sleep(500);
      let text = await p.evaluate(() => document.body.innerText);
      for (const k of skip) text = typeof k === "string" ? text.split(k).join("") : text.replace(new RegExp(k.source, k.flags.includes("g") ? k.flags : k.flags + "g"), "");
      for (const piece of pieces) if (text.includes(piece)) report(`${name}: "${piece}"`);
      for (const line of ptWords(text)) report(`${name}: «${line}»`);
      const strip = (t: string) => skip.reduce<string>((acc, k) => (typeof k === "string" ? acc.split(k).join("") : acc.replace(new RegExp(k.source, k.flags.includes("g") ? k.flags : k.flags + "g"), "")), t).trim();
      for (const t of new Set((await screenTexts(p)).map(strip))) if (exact.has(t)) report(`${name}: [${t}]`);
      const file = join(out, `${name}.png`);
      await p.screenshot({ path: file });
      shots.push(file);
    },
    async finish() {
      await close();
      console.log(JSON.stringify({ out, shots: shots.length, pieces: pieces.length, problems, known }, null, 2));
      process.exit(problems.length ? 1 : 0);
    },
    async fail(e, page) {
      await page?.screenshot({ path: join(out, "falhou.png") }).catch(() => {});
      await close();
      console.error(e);
      if (problems.length) console.error(JSON.stringify({ problems }, null, 2));
      process.exit(1);
    },
  };
  return s;
}
