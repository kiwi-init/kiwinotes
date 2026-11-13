// Uma janela do Kiwi Notes num navegador headless, fora da tela de qualquer pessoa (T1742). É a base do
// `cli screenshot` e do `cli ui --script` (scripts/cli-ui.ts):
//
// - serve o build de verdade da janela (o `vite build` com KIWI_UI_WINDOW, como o `ui:build`) num Bun.serve em
//   127.0.0.1, com a CSP das views (`VIEWS_CSP`). O build fica em node_modules/.cache/kiwi-cli-ui/<janela> e é
//   refeito quando o ui/ ou o src/ mudam; o dist/ do app não é tocado;
// - põe na página um `window.engine` igual ao do preload do AppEngine (devkit api/browser/appengine/page.ts), que
//   leva cada `invoke` ao engine headless pelo `invoke` do protocolo (#1745) e entrega os eventos dele à página;
// - a página não sai para a rede: só o servidor do build responde, o resto é abortado. Um `window.open` não abre nada
//   e fica no relatório;
// - `clipboard.write` nunca chega ao engine (AGENTS.md: agente não escreve no clipboard real). Volta `true` e o texto
//   fica no relatório.
//
// Usa o WebKit do Playwright (o mais perto do WKWebView do app; é o único que respeita o -webkit-font-smoothing, #1765)
// ou o Chromium headless com `browser: "chromium"`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";
import { UI_CAPABILITIES, UI_CONTRACT_VERSION, UI_WINDOWS, type UiWindow } from "../src/shared/ui-contract.ts";
import { WINDOW_SPECS } from "../src/shared/window-specs.ts";

export const APP_DIR = resolve(import.meta.dir, "..");

/** A resposta do engine headless a um comando (#1745). */
export type Reply = { ok: true; value?: unknown } | { ok: false; code: string; message: string };

/** O que a CLI do T1739 (scripts/cli.ts) entrega aos subcomandos `screenshot` e `ui` (#1769, #1787). */
export interface UiContext {
  /** Um pedido ao headless e a resposta (o mesmo do dictate). Sem headless, lança com `code: "E_NOT_RUNNING"`. */
  send(msg: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Assina eventos ou logs (só o que chega depois); devolve como parar. */
  subscribe(topics: ("events" | "logs")[], onMsg: (line: Record<string, unknown>) => void): Promise<() => void>;
  /** A pasta do headless: o vault fica em <data>/vault e o socket em <data>/control.sock. */
  data: string;
}

export type BrowserName = "webkit" | "chromium";
export type Theme = "light" | "dark";

export interface PageOptions {
  window: UiWindow;
  scale: 1 | 2;
  theme: Theme;
  width: number;
  height: number;
  browser: BrowserName;
  /** Mantém as animações; o padrão é `prefers-reduced-motion: reduce`, que o base.css usa para cortar todas. */
  motion: boolean;
  /** Parâmetros da URL da janela, como `note=Pessoas/Ana.md` na janela Notas. */
  query: Record<string, string>;
  /** Uma pasta com um build pronto da janela (index.html na raiz) em vez do build da CLI. */
  dist?: string;
  /** Grava um vídeo da página nesta pasta (o Playwright salva o .webm quando a página fecha). */
  video?: string;
}

export interface PageReport {
  /** A UI chamou `engine.ready()`. */
  ready: boolean;
  /** Erros da página, `console.error` e violações de CSP, na ordem em que vieram. */
  problems: string[];
  /** O que a UI tentou pôr no clipboard (e não pôs). */
  clipboard: string[];
  /** URLs que a página tentou abrir ou buscar fora do build. */
  blocked: string[];
  /** Quantas vezes a UI chamou cada capacidade. */
  invokes: Record<string, number>;
  /** As chamadas que o engine recusou, com o código (`E_BAD_ARGS`, `E_NOT_FOUND`…). */
  invokeErrors: { cap: string; code: string; message: string }[];
}

export interface OpenedPage {
  page: Page;
  report: PageReport;
  url: string;
  close(): Promise<void>;
}

export class UiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function defaultSize(window: UiWindow): { width: number; height: number } {
  const { width, height } = WINDOW_SPECS[window];
  return { width, height };
}

export const isWindow = (w: string): w is UiWindow => (UI_WINDOWS as readonly string[]).includes(w);

// ---------------------------------------------------------------- o build da janela

/**
 * O carimbo do build: o hash da lista de arquivos (caminho, mtime e tamanho) sob os caminhos dados, sem node_modules,
 * pastas com ponto nem testes. Muda quando um arquivo muda, entra ou sai (uma troca de branch que só apaga arquivos,
 * #1835), e com o `bun.lock` na lista, quando uma dependência muda.
 */
export function buildStamp(paths: string[], root = APP_DIR): string {
  const lines: string[] = [];
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) if (e !== "node_modules" && !e.startsWith(".")) walk(join(p, e));
    } else if (!/\.test\.tsx?$/.test(p)) lines.push(`${relative(root, p)}\t${st.mtimeMs}\t${st.size}`);
  };
  for (const p of paths) walk(p);
  return new Bun.CryptoHasher("sha256").update(lines.sort().join("\n")).digest("hex");
}

/** O que entra no build de uma janela: as fontes, a config do Vite e as dependências. */
const BUILD_INPUTS = ["ui", "src", "vite.config.ts", "package.json", "bun.lock", "tsconfig.json", "hutch-pin.json"];

/**
 * O build da janela, refeito quando as fontes mudaram desde o último. Devolve a pasta com o index.html.
 * Um worktree novo sem o devkit (`.hutch/devkit`) faz o Vite mostrar só a tela de erro do tsconfig (#1765): aí falha
 * aqui, com o comando que resolve, em vez de tirar print da tela de erro.
 */
export function ensureBuild(window: UiWindow, log: (m: string) => void = () => {}): string {
  if (!existsSync(join(APP_DIR, ".hutch/devkit"))) {
    throw new UiError("E_NO_DEVKIT", "sem o devkit neste worktree: rode `bun run prepare:eb` em app/ antes");
  }
  const out = join(APP_DIR, "node_modules/.cache/kiwi-cli-ui", window);
  const stampFile = join(out, ".kiwi-stamp");
  const stamp = buildStamp(BUILD_INPUTS.map((p) => join(APP_DIR, p)));
  if (existsSync(join(out, "index.html")) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return out;
  log(`build da janela ${window}…`);
  mkdirSync(out, { recursive: true });
  const r = spawnSync("bun", ["x", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
    cwd: APP_DIR,
    env: { ...process.env, KIWI_UI_WINDOW: window },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new UiError("E_BUILD", `o vite build de ${window} falhou:\n${(r.stderr || r.stdout || "").trim()}`);
  writeFileSync(stampFile, stamp);
  return out;
}

// ---------------------------------------------------------------- o navegador

function chromiumPath(): string {
  if (process.env.KIWI_CHROMIUM) return process.env.KIWI_CHROMIUM;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const d of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse() : []) {
    for (const sub of readdirSync(join(cache, d))) {
      const exe = join(cache, d, sub, "chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  }
  throw new UiError("E_NO_BROWSER", "sem chrome-headless-shell: rode `bunx playwright-core install chromium-headless-shell` ou defina KIWI_CHROMIUM");
}

export async function launch(name: BrowserName): Promise<Browser> {
  try {
    return name === "chromium" ? await chromium.launch({ executablePath: chromiumPath(), headless: true }) : await webkit.launch({ headless: true });
  } catch (e) {
    if (e instanceof UiError) throw e;
    const msg = String(e instanceof Error ? e.message : e).split("\n")[0];
    if (name === "webkit" && /Executable doesn't exist|install/i.test(msg)) {
      throw new UiError("E_NO_BROWSER", "sem o WebKit do Playwright: rode `bunx playwright-core install webkit` (uma vez)");
    }
    throw new UiError("E_NO_BROWSER", `o ${name} headless não abriu: ${msg}`);
  }
}

/** O servidor do build: só arquivos de dentro da pasta, todos com a CSP das views. */
function serve(dir: string) {
  const root = resolve(dir);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      let rel: string;
      try {
        rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
      } catch {
        return new Response("not found", { status: 404 }); // um % malformado (#1816)
      }
      const full = resolve(root, rel);
      if (full !== root && !full.startsWith(`${root}/`)) return new Response("not found", { status: 404 });
      const file = Bun.file(full);
      if (await file.exists()) return new Response(file, { headers: { "Content-Security-Policy": VIEWS_CSP } });
      return new Response("not found", { status: 404 });
    },
  });
}

/**
 * O `window.engine` da página: a mesma forma do preload do AppEngine (congelado, `contract`, `has`, `invoke` que
 * lança Error com `code`, `ready`, `reportError`, `on`). Roda na página, antes da UI; o `invoke` vai ao binding
 * `__kiwiInvoke`, e os eventos chegam por `__kiwiEmit`.
 */
function engineShim(contract: { version: string; capabilities: string[] }) {
  const w = window as unknown as Record<string, any>;
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const invoke = w.__kiwiInvoke as (cap: string, args: unknown) => Promise<{ ok: boolean; value?: unknown; code?: string; message?: string }>;
  const report = w.__kiwiReport as (kind: string, message: string) => void;
  delete w.__kiwiInvoke;
  Object.defineProperty(w, "__kiwiEmit", {
    value: (name: string, payload: unknown) => {
      for (const l of listeners.get(name) ?? []) l(payload);
    },
  });
  const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  window.addEventListener("error", (e) => report("error", e.error ? describe(e.error) : e.message));
  window.addEventListener("unhandledrejection", (e) => report("error", `unhandled rejection: ${describe(e.reason)}`));
  document.addEventListener("securitypolicyviolation", (e) => report("csp", `CSP ${e.violatedDirective}: ${e.blockedURI || "inline"}`));
  window.open = ((url?: string | URL) => {
    report("open", String(url ?? ""));
    return null;
  }) as typeof window.open;
  const engine = Object.freeze({
    contract: Object.freeze({ version: contract.version, capabilities: Object.freeze([...contract.capabilities]) }),
    has: (cap: string) => contract.capabilities.includes(cap),
    invoke: async (cap: string, args: unknown = {}) => {
      const r = await invoke(cap, args);
      if (!r.ok) throw Object.assign(new Error(`${cap}: ${r.message}`), { code: r.code });
      return r.value;
    },
    ready: () => report("ready", ""),
    reportError: (e: unknown) => report("error", describe(e)),
    onBeforeSwap: () => {},
    on: (name: string, listener: (p: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)?.delete(listener);
    },
  });
  Object.defineProperty(window, "engine", { value: engine, writable: false, configurable: false, enumerable: true });
}

/** Os eventos do engine que vão à página (os `UiEvents` do contrato). */
const PAGE_EVENTS = new Set(["notes.folderChanged", "notes.changed", "files.changed", "history.added", "history.changed", "settings.changed", "meetings.live", "agent.status", "agent.turn", "agent.activityChanged", "projects.changed", "agent.questionChanged", "kiwicat.where"]);

/**
 * Abre a janela: build, servidor, contexto (escala, tema, tamanho, movimento), a ponte ao engine e a espera pelo
 * `ready()` (até `readyTimeoutMs`; sem ele, segue e o relatório diz `ready: false`).
 */
export async function openWindow(browser: Browser, ctx: UiContext, opts: PageOptions, readyTimeoutMs = 8000): Promise<OpenedPage> {
  const dir = opts.dist ? resolve(opts.dist) : ensureBuild(opts.window);
  if (!existsSync(join(dir, "index.html"))) throw new UiError("E_NO_BUILD", `${dir} não tem index.html`);
  const server = serve(dir);
  const origin = `http://127.0.0.1:${server.port}`;
  const report: PageReport = { ready: false, problems: [], clipboard: [], blocked: [], invokes: {}, invokeErrors: [] };

  let context: BrowserContext | undefined;
  let unsubscribe = () => {};
  const close = async () => {
    unsubscribe();
    await context?.close().catch(() => {});
    server.stop(true);
  };
  try {
    context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.scale,
      colorScheme: opts.theme,
      reducedMotion: opts.motion ? "no-preference" : "reduce",
      locale: "pt-BR",
      ...(opts.video ? { recordVideo: { dir: opts.video, size: { width: opts.width, height: opts.height } } } : {}),
    });
    // Nada de rede: só o build. (O WebSocket da ponte do app não existe aqui; a ponte é o binding.)
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`)) return route.continue();
      report.blocked.push(url);
      return route.abort("blockedbyclient");
    });

    await context.exposeBinding("__kiwiReport", (_src, kind: string, message: string) => {
      if (kind === "ready") report.ready = true;
      else if (kind === "open") report.blocked.push(message);
      else report.problems.push(message);
    });
    let fakeClipboard = "";
    await context.exposeBinding("__kiwiInvoke", async (_src, cap: string, args: unknown): Promise<Reply> => {
      report.invokes[cap] = (report.invokes[cap] ?? 0) + 1;
      if (cap === "clipboard.write") {
        const text = (args as { text?: unknown } | null)?.text;
        fakeClipboard = typeof text === "string" ? text : JSON.stringify(text);
        report.clipboard.push(fakeClipboard);
        return { ok: true, value: true };
      }
      if (cap === "clipboard.read") return { ok: true, value: fakeClipboard };
      let r: Reply;
      try {
        r = (await ctx.send({ cmd: "invoke", cap, args: args ?? {} })) as Reply;
      } catch (e) {
        r = { ok: false, code: "E_ENGINE", message: String(e instanceof Error ? e.message : e) };
      }
      if (!r.ok) report.invokeErrors.push({ cap, code: r.code, message: r.message });
      return r;
    });
    await context.addInitScript(engineShim, { version: UI_CONTRACT_VERSION, capabilities: [...UI_CAPABILITIES] });

    const p = await context.newPage();
    // Uma janela a mais (target=_blank que escapou do window.open) fecha na hora; o link fica no relatório.
    context.on("page", (other) => {
      report.blocked.push(other.url());
      void other.close();
    });
    p.on("console", (m) => {
      if (m.type() === "error" || /Content Security Policy|Refused to/i.test(m.text())) report.problems.push(m.text());
    });
    p.on("pageerror", (e) => report.problems.push(String(e)));

    unsubscribe = await ctx.subscribe(["events"], (msg) => {
      const name = msg.event;
      if (typeof name !== "string" || !PAGE_EVENTS.has(name)) return;
      void p.evaluate(([n, pl]) => (window as any).__kiwiEmit?.(n, pl), [name, msg.payload] as const).catch(() => {});
    });

    const qs = new URLSearchParams(opts.query).toString();
    const url = `${origin}/index.html${qs ? `?${qs}` : ""}`;
    await p.goto(url);
    const until = Date.now() + readyTimeoutMs;
    while (!report.ready && Date.now() < until) await p.waitForTimeout(50);
    if (!report.ready) report.problems.push(`a UI não chamou engine.ready() em ${readyTimeoutMs} ms`);
    // A janela Notas abre a nota pelo caminho exato da lista (`n.path === asked`); uma que não está lá, ou que só bate
    // ignorando maiúsculas (o APFS acha pelo notes.get), faz a janela cair em outra nota sem erro na página (#1835, #1864).
    if (opts.window === "notes" && opts.query.note) {
      const problem = noteProblem(opts.query.note, await ctx.send({ cmd: "invoke", cap: "notes.list", args: {} }).catch((e) => ({ ok: false, code: String(e?.code ?? "E_ENGINE") })));
      if (problem) report.problems.push(problem);
    }
    await settle(p);
    return { page: p, report, url, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/** O aviso de um `--note` que a janela não vai abrir, ou null quando o caminho está, exato, no `notes.list` (nota ou arquivo). */
export function noteProblem(asked: string, list: Record<string, unknown>): string | null {
  if (list.ok !== true) return `--note ${asked}: não deu para conferir (notes.list: ${String(list.code ?? "E_FAILED")})`;
  // As notas e os outros arquivos do cofre: um arquivo que não é nota abre no view de arquivo (T7103).
  const value = list.value as { notes?: { path: string }[]; files?: { path: string }[] } | undefined;
  const paths = [...(value?.notes ?? []), ...(value?.files ?? [])].map((n) => n.path);
  if (paths.includes(asked)) return null;
  const near = paths.find((p) => p.toLowerCase() === asked.toLowerCase());
  return near ? `--note ${asked}: a nota não abriu (existe como ${near}; o caminho é exato)` : `--note ${asked}: a nota não abriu (E_NOT_FOUND)`;
}

/** Espera as fontes e dois quadros: o print sai com o layout e o texto assentados. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
