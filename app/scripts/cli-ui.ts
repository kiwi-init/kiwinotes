// Os subcomandos `screenshot` e `ui` da CLI de teste (T1742; o gancho em scripts/cli.ts é do T1739, #1769). Veem as
// janelas de verdade fora da tela: o build da janela com a CSP das views num navegador headless, falando com o engine
// headless pelo mesmo contrato da UI (scripts/ui-page.ts).
//
//   bun run cli screenshot <notes|history|settings> [--scale 1|2|1,2] [--theme light|dark|light,dark]
//       [--size WxH] [--browser webkit|chromium] [--note PATH] [--query k=v]… [--motion] [--dist DIR] [--out x.png|DIR]
//   bun run cli ui [<janela>] --script passos.json [as mesmas flags, um valor só] [--out DIR]
//
// Saída: JSON. Exit codes: 0 ok; 1 a página teve problema (erro, CSP, rede bloqueada, sem ready()) ou um passo
// falhou (o PNG sai assim mesmo); 2 uso errado; 3 o headless não está rodando.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { UiWindow } from "../src/shared/ui-contract.ts";
import {
  type BrowserName,
  defaultSize,
  isWindow,
  launch,
  openWindow,
  type PageOptions,
  type PageReport,
  type Theme,
  UiError,
  type UiContext,
} from "./ui-page.ts";
import { describeStep, parseScript, runStep, type ScriptFile } from "./ui-steps.ts";

export type { UiContext };

const EXIT = { ok: 0, failed: 1, usage: 2, notRunning: 3 } as const;

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

class UsageError extends Error {}

export interface ParsedArgs {
  window?: UiWindow;
  scales: (1 | 2)[];
  themes: Theme[];
  size?: { width: number; height: number };
  browser: BrowserName;
  query: Record<string, string>;
  motion: boolean;
  dist?: string;
  out?: string;
  script?: string;
}

function list<T extends string>(v: string, allowed: readonly T[], flag: string): T[] {
  const items = v.split(",").map((s) => s.trim());
  for (const i of items) if (!(allowed as readonly string[]).includes(i)) throw new UsageError(`${flag}: ${i} não é um de ${allowed.join(", ")}`);
  return [...new Set(items)] as T[];
}

export function parseSize(v: string): { width: number; height: number } {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(v);
  if (!m) throw new UsageError(`--size: LARGURAxALTURA, como 1180x760 (veio ${v})`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 200 || height < 200 || width > 4000 || height > 4000) throw new UsageError("--size: de 200 a 4000 em cada lado");
  return { width, height };
}

/** As flags dos dois subcomandos. `--data` é da CLI (já usado por ela) e fica de fora. */
export function parseArgs(argv: string[]): ParsedArgs {
  const a: ParsedArgs = { scales: [], themes: [], browser: "webkit", query: {}, motion: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${arg} precisa de um valor`);
      return v;
    };
    switch (arg) {
      case "--data":
        value();
        break;
      case "--scale":
        a.scales = list(value(), ["1", "2"] as const, arg).map(Number) as (1 | 2)[];
        break;
      case "--theme":
        a.themes = list(value(), ["light", "dark"] as const, arg);
        break;
      case "--size":
        a.size = parseSize(value());
        break;
      case "--browser":
        a.browser = list(value(), ["webkit", "chromium"] as const, arg)[0]!;
        break;
      case "--note":
        a.query.note = value();
        break;
      case "--query": {
        const v = value();
        const eq = v.indexOf("=");
        if (eq <= 0) throw new UsageError(`--query: chave=valor (veio ${v})`);
        a.query[v.slice(0, eq)] = v.slice(eq + 1);
        break;
      }
      case "--motion":
        a.motion = true;
        break;
      case "--dist":
        a.dist = resolve(value());
        break;
      case "--out":
        a.out = resolve(value());
        break;
      case "--script":
        a.script = resolve(value());
        break;
      default:
        if (arg.startsWith("--")) throw new UsageError(`flag desconhecida: ${arg}`);
        rest.push(arg);
    }
  }
  if (rest.length > 1) throw new UsageError(`sobrou: ${rest.slice(1).join(" ")}`);
  if (rest[0] !== undefined) {
    if (!isWindow(rest[0])) throw new UsageError(`${rest[0]} não é uma janela (hub, notes, history, settings)`);
    a.window = rest[0];
  }
  return a;
}

/** O headless está de pé? Sem ele, o JSON de "não está rodando" e o exit 3, como o resto da CLI. */
async function needEngine(ctx: UiContext): Promise<boolean> {
  try {
    const r = await ctx.send({ cmd: "status" });
    return r.ok === true;
  } catch (e) {
    if ((e as { code?: string }).code !== "E_NOT_RUNNING") throw e;
    print({ ok: false, code: "E_NOT_RUNNING", message: `o headless não está rodando em ${ctx.data}: rode \`bun run cli start --data ${ctx.data}\`` });
    return false;
  }
}

const isOk = (r: PageReport) => r.ready && r.problems.length === 0 && r.blocked.length === 0;

function fail(e: unknown): number {
  if (e instanceof UsageError) {
    print({ ok: false, code: "E_USAGE", message: e.message });
    return EXIT.usage;
  }
  if (e instanceof UiError) {
    print({ ok: false, code: e.code, message: e.message });
    return EXIT.failed;
  }
  print({ ok: false, code: "E_FAILED", message: String(e instanceof Error ? e.message : e) });
  return EXIT.failed;
}

function pageOptions(window: UiWindow, a: ParsedArgs, scale: 1 | 2, theme: Theme): PageOptions {
  const size = a.size ?? defaultSize(window);
  return { window, scale, theme, ...size, browser: a.browser, motion: a.motion, query: a.query, dist: a.dist };
}

// ---------------------------------------------------------------- screenshot

/** `screenshot`: um PNG por combinação de escala e tema. Com uma só, `--out` é o arquivo; com mais, a pasta. */
export async function runScreenshot(argv: string[], ctx: UiContext): Promise<number> {
  let a: ParsedArgs;
  try {
    a = parseArgs(argv);
    if (!a.window) throw new UsageError("screenshot <notes|history|settings> [--scale 1|2] [--theme light|dark] [--size WxH] [--out x.png]");
    if (a.script) throw new UsageError("--script é do `ui`, não do `screenshot`");
  } catch (e) {
    return fail(e);
  }
  if (!(await needEngine(ctx))) return EXIT.notRunning;
  const window = a.window!;
  const scales = a.scales.length ? a.scales : [2 as const];
  const themes = a.themes.length ? a.themes : ["light" as const];
  const many = scales.length * themes.length > 1;
  if (!many && a.out && !a.out.endsWith(".png")) a.out = join(a.out, `${window}-${scales[0]}x-${themes[0]}.png`);
  const dir = many ? (a.out ?? join(ctx.data, "shots")) : dirname(a.out ?? join(ctx.data, "shots", "x"));

  try {
    mkdirSync(dir, { recursive: true });
    const browser = await launch(a.browser);
    const shots: Record<string, unknown>[] = [];
    try {
      for (const scale of scales) {
        for (const theme of themes) {
          const opts = pageOptions(window, a, scale, theme);
          const path = many || !a.out ? join(dir, `${window}-${scale}x-${theme}.png`) : a.out;
          const w = await openWindow(browser, ctx, opts);
          try {
            await w.page.screenshot({ path });
          } finally {
            await w.close();
          }
          shots.push({ path, scale, theme, width: opts.width, height: opts.height, ok: isOk(w.report), ...w.report });
        }
      }
    } finally {
      await browser.close();
    }
    const ok = shots.every((s) => s.ok);
    print({ ok, window, browser: a.browser, shots });
    return ok ? EXIT.ok : EXIT.failed;
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- ui --script

/** `ui --script`: roda os passos em ordem e para no primeiro que falha, com um print da tela nesse momento. */
export async function runUi(argv: string[], ctx: UiContext): Promise<number> {
  let a: ParsedArgs;
  let script: ScriptFile;
  try {
    a = parseArgs(argv);
    if (!a.script) throw new UsageError("ui [<janela>] --script passos.json [--scale 1|2] [--theme light|dark] [--out DIR]");
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(a.script, "utf8"));
    } catch (e) {
      throw new UsageError(`--script: não deu para ler ${a.script}: ${e instanceof Error ? e.message : e}`);
    }
    try {
      script = parseScript(json);
    } catch (e) {
      throw new UsageError(`--script: ${e instanceof Error ? e.message : e}`);
    }
    // As flags sobrepõem o que o script diz.
    const fromFile = parseArgs([
      ...(script.window ? [script.window] : []),
      ...(script.scale ? ["--scale", String(script.scale)] : []),
      ...(script.theme ? ["--theme", script.theme] : []),
      ...(script.size ? ["--size", script.size] : []),
      ...(script.browser ? ["--browser", script.browser] : []),
    ]);
    a.window ??= fromFile.window;
    if (!a.window) throw new UsageError("qual janela? diga na linha de comando ou em \"window\" no script");
    if (!a.scales.length) a.scales = fromFile.scales;
    if (!a.themes.length) a.themes = fromFile.themes;
    a.size ??= fromFile.size;
    if (!argv.includes("--browser")) a.browser = fromFile.browser;
    a.query = { ...script.query, ...a.query };
    if (a.scales.length > 1 || a.themes.length > 1) throw new UsageError("no `ui`, uma escala e um tema só");
  } catch (e) {
    return fail(e);
  }
  if (!(await needEngine(ctx))) return EXIT.notRunning;
  const window = a.window!;
  const out = a.out ?? join(ctx.data, "shots", `${window}-${Date.now()}`);

  try {
    mkdirSync(out, { recursive: true });
    const browser = await launch(a.browser);
    try {
      const w = await openWindow(browser, ctx, pageOptions(window, a, a.scales[0] ?? 2, a.themes[0] ?? "light"));
      const steps: Record<string, unknown>[] = [];
      let failedAt: number | null = null;
      try {
        for (const [i, s] of script.steps.entries()) {
          const t0 = performance.now();
          const step: Record<string, unknown> = { n: i + 1, step: describeStep(s) };
          try {
            const r = await runStep(w.page, s, out, ctx.send);
            Object.assign(step, { ok: true, ms: Math.round(performance.now() - t0) }, r);
          } catch (e) {
            const shot = join(out, `falhou-passo-${i + 1}.png`);
            await w.page.screenshot({ path: shot }).catch(() => {});
            Object.assign(step, { ok: false, ms: Math.round(performance.now() - t0), error: String(e instanceof Error ? e.message : e).split("\n")[0], shot });
            failedAt = i + 1;
          }
          steps.push(step);
          if (failedAt) break;
        }
      } finally {
        await w.close();
      }
      const ok = failedAt === null && isOk(w.report);
      print({
        ok,
        window,
        browser: a.browser,
        out,
        ...(failedAt ? { failedAt, skipped: script.steps.length - failedAt } : {}),
        steps,
        ...w.report,
      });
      return ok ? EXIT.ok : EXIT.failed;
    } finally {
      await browser.close();
    }
  } catch (e) {
    return fail(e);
  }
}
