// Um AppEngine por janela, no modo host (T1192, ADR 0006). Esta parte não abre janela nenhuma: monta o engine com o
// contrato, o canal e a UI de fábrica, e é o que os testes usam. A janela de verdade fica em windows.ts.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { AppEngine, readFolder, type HostUi, type TrustedKeys, type UiFiles } from "electrobun/bun/appengine";

import { UI_CONTRACT_VERSION, type UiWindow } from "../shared/ui-contract.ts";
import { ENGINE_CONTRACT_GLOBAL } from "./appengine-devkit.ts";

/** A UI que vem dentro do .app: a de fábrica, e o fallback quando nenhuma instalada funciona. */
export interface BuiltIn {
  uiVersion: string;
  seq: number;
  files(): UiFiles;
}

/** O ui.json que o `scripts/ui-build.ts` escreve ao lado de cada UI. */
interface UiJson {
  uiVersion: string;
  seq: number;
}

/** A UI de fábrica de uma janela, lida da pasta do bundle (views/ui/<janela>). */
export function builtInFrom(dir: string): BuiltIn {
  const json = JSON.parse(readFileSync(path.join(dir, "ui.json"), "utf8")) as Partial<UiJson>;
  if (typeof json.uiVersion !== "string" || !Number.isSafeInteger(json.seq)) throw new Error(`${dir}/ui.json: no uiVersion or seq`);
  return { uiVersion: json.uiVersion, seq: json.seq!, files: () => readFolder(dir) };
}

/**
 * O canal de UI. Desligado por padrão: o app não consulta a rede para buscar UI (AGENTS.md, privacidade), e ligar um
 * canal remoto é decisão do harry. Em dev, `KIWI_UI_CHANNEL` aponta um canal **local** (só 127.0.0.1 ou localhost):
 * `http://127.0.0.1:5179` serve `<janela>/manifest.json`. O bundle do AppEngine tem que vir por http(s), por isso não
 * é `file://`.
 */
export function channelUrl(base: string | undefined, name: UiWindow): string | null {
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`KIWI_UI_CHANNEL isn't a URL: ${base}`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`KIWI_UI_CHANNEL must be a local http URL (127.0.0.1 or localhost), not ${base}`);
  }
  return new URL(`${name}/manifest.json`, url.href.endsWith("/") ? url.href : `${url.href}/`).href;
}

/** O fetch do canal desligado: nada sai, e o canal só fica "offline". */
const channelOff = (async () => {
  throw new Error("the UI channel is off");
}) as unknown as typeof fetch;

export interface UiEngineOptions {
  name: UiWindow;
  /** <dados>/appengine/<janela>: o estado do engine e do canal, os packs e a pasta servida. */
  dir: string;
  builtIn: BuiltIn;
  trustedKeys: TrustedKeys;
  capabilities: Record<string, (args: unknown) => unknown>;
  /** Mostra a UI na janela (loadHTML do index). */
  show(ui: HostUi): void;
  /** O manifest do canal local, ou null com o canal desligado. */
  manifestUrl: string | null;
  readyTimeoutMs?: number;
  probationMs?: number;
}

/** A pasta que a janela serve como views:// (o `viewsRoot`). Fora do .app, para não mexer na assinatura. */
export const servedDir = (dir: string) => path.join(dir, "served");

export function createUiEngine(o: UiEngineOptions): AppEngine {
  return new AppEngine({
    contractVersion: UI_CONTRACT_VERSION,
    capabilities: o.capabilities,
    stateFile: path.join(o.dir, "engine.json"),
    readyTimeoutMs: o.readyTimeoutMs,
    probationMs: o.probationMs,
    channel: {
      manifestUrl: o.manifestUrl ?? "http://127.0.0.1/kiwinotes-ui-channel-off/manifest.json",
      ...(o.manifestUrl ? {} : { fetch: channelOff, pollIntervalMs: 24 * 60 * 60_000 }),
      trustedKeys: o.trustedKeys,
      root: path.join(o.dir, "packs"),
      stateFile: path.join(o.dir, "channel.json"),
    },
    host: {
      viewsRoot: servedDir(o.dir),
      prefix: "internal",
      builtIn: o.builtIn,
      show: o.show,
    },
  });
}

/** O preload da janela: o contrato, e depois o `window.engine` (o mesmo script que o engine injeta no modo padrão). */
export function enginePreload(capabilities: readonly string[], pageScript: string): string {
  const contract = { version: UI_CONTRACT_VERSION, capabilities: [...capabilities, "engine.info", "session.takeHandoff"].sort() };
  return `globalThis.${ENGINE_CONTRACT_GLOBAL} = ${JSON.stringify(contract)};\n${pageScript}`;
}

/** Só no canal `dev` do Electrobun o app carrega a UI do Vite (HMR). No stable, nunca: só o que o engine verificou. */
export function devServerAllowed(channel: string): boolean {
  return channel === "dev";
}

export const hasBuiltIn = (dir: string) => existsSync(path.join(dir, "ui.json"));

/**
 * No dev com o Vite (HMR) não há boot nem rollback, mas a UI fala com o mesmo contrato: só os nomes da lista, com os
 * mesmos erros que o AppEngine dá (`E_NO_CAPABILITY`, o código do handler, ou `E_FAILED`).
 */
export async function directInvoke(
  handlers: Record<string, (args: unknown) => unknown>,
  cap: string,
  args: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
  const handler = Object.hasOwn(handlers, cap) ? handlers[cap] : undefined;
  if (!handler) return { ok: false, code: "E_NO_CAPABILITY", message: `contract ${UI_CONTRACT_VERSION} has no capability ${JSON.stringify(cap)}` };
  try {
    return { ok: true, value: await handler(args) };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return {
      ok: false,
      code: typeof code === "string" && /^E_[A-Z_]+$/.test(code) ? code : "E_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Uma abertura por vez por chave, e nunca rejeita (revisão #1277): um 2º pedido enquanto o 1º roda recebe a mesma
 * promessa, e um erro vai para `onError` em vez de virar uma rejeição sem tratamento, que no Bun sai com exit 1.
 */
export function oneAtATime<K>(pending: Map<K, Promise<void>>, key: K, run: () => Promise<void>, onError: (e: unknown) => void): Promise<void> {
  const current = pending.get(key);
  if (current) return current;
  const started = run()
    .catch(onError)
    .finally(() => pending.delete(key));
  pending.set(key, started);
  return started;
}
