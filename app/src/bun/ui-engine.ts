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
 * O canal local de dev: `KIWI_UI_CHANNEL` aponta um canal **local** (só 127.0.0.1 ou localhost), e
 * `http://127.0.0.1:5179` serve `<janela>/manifest.json`. O bundle do AppEngine tem que vir por http(s), por isso não
 * é `file://`. O canal da internet é o `UI_CHANNEL_REMOTE` (spec #25011).
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

/**
 * O `channelUrl` para abrir a janela: um `KIWI_UI_CHANNEL` errado não pode deixar o app sem janela (T1378). Fica no
 * canal desligado (a UI de fábrica), com um aviso no log.
 */
export function channelUrlOrOff(base: string | undefined, name: UiWindow, warn: (message: string) => void): string | null {
  try {
    return channelUrl(base, name);
  } catch (e) {
    warn(`${e instanceof Error ? e.message : String(e)}; the UI channel stays off`);
    return null;
  }
}

/** O fetch do canal desligado: nada sai, e o canal só fica "offline". */
const channelOff = (async () => {
  throw new Error("the UI channel is off");
}) as unknown as typeof fetch;

/**
 * O canal remoto (spec #25011): o release fixo `ui-channel` do GitHub, e mais nada. Cada janela tem um
 * `<janela>.manifest.json` lá, e o pack fica no mesmo release (formato do T25030, #25039).
 */
export const UI_CHANNEL_REMOTE = "https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/";

/** O GET do manifesto: ao abrir a janela (o `start` do engine) e, com ela aberta, a cada 6 h. */
export const UI_CHANNEL_POLL_MS = 6 * 60 * 60_000;

export const remoteManifestUrl = (name: UiWindow) => `${UI_CHANNEL_REMOTE}${name}.manifest.json`;

/** De onde a janela busca UI: de nenhum lugar, do canal local de dev, ou do release `ui-channel`. */
export type UiChannelChoice =
  | { kind: "off"; reason: string }
  | { kind: "local"; manifestUrl: string }
  | { kind: "remote"; manifestUrl: string };

/**
 * O canal de uma janela. O `KIWI_UI_CHANNEL` (dev) vem primeiro: um local válido liga o local, e um errado deixa o
 * canal desligado, com um aviso no log, sem deixar o app sem janela (T1378). Sem ele, o canal remoto segue o Updater
 * (ADR 0008): desligado ali (`updatesOff`, com o motivo), desligado aqui, e nada vai à rede.
 */
export function uiChannelFor(
  name: UiWindow,
  o: { env: string | undefined; updatesOff: string | null; warn: (message: string) => void },
): UiChannelChoice {
  if (o.env) {
    const local = channelUrlOrOff(o.env, name, o.warn);
    return local ? { kind: "local", manifestUrl: local } : { kind: "off", reason: "KIWI_UI_CHANNEL isn't a local URL" };
  }
  if (o.updatesOff) return { kind: "off", reason: `updates off (${o.updatesOff})` };
  return { kind: "remote", manifestUrl: remoteManifestUrl(name) };
}

/**
 * O `channel` do AppEngine para a escolha. Desligado, o fetch recusa tudo. O remoto só vai à rede pelo `remoteFetch`,
 * o fetch guardado do canal (T25029: só o release, redirect só para o storage do GitHub, GET limpo); sem ele, fica
 * desligado.
 */
export function channelSource(choice: UiChannelChoice, remoteFetch: typeof fetch | undefined): { manifestUrl: string; fetch?: typeof fetch; pollIntervalMs?: number } {
  // O local de dev fica no intervalo do AppEngine (5 min), como antes.
  if (choice.kind === "local") return { manifestUrl: choice.manifestUrl };
  if (choice.kind === "remote" && remoteFetch) return { manifestUrl: choice.manifestUrl, fetch: remoteFetch, pollIntervalMs: UI_CHANNEL_POLL_MS };
  return { manifestUrl: "http://127.0.0.1/kiwinotes-ui-channel-off/manifest.json", fetch: channelOff, pollIntervalMs: 24 * 60 * 60_000 };
}

/**
 * O fetch do canal com o "Buscar atualizações" (T25110): lê o ajuste a cada pedido (o manifesto ao abrir e a cada 6 h,
 * e o pack) e, desligado, recusa sem ir à rede. Ligar de novo vale no próximo pedido, sem reiniciar.
 */
export function gateFetch(inner: typeof fetch, allowed: () => boolean | Promise<boolean>): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (!(await allowed())) throw new Error("the UI channel is off (Buscar atualizações is off)");
    return inner(input, init);
  }) as unknown as typeof fetch;
}

/** O `channelSource` com o `gateFetch`: o canal desligado já não vai à rede e fica como está. */
function gatedSource(src: ReturnType<typeof channelSource>, choice: UiChannelChoice, checkUpdates: UiEngineOptions["checkUpdates"]) {
  if (!checkUpdates || choice.kind === "off") return src;
  return { ...src, fetch: gateFetch(src.fetch ?? fetch, checkUpdates) };
}

export interface UiEngineOptions {
  name: UiWindow;
  /** <dados>/appengine/<janela>: o estado do engine e do canal, os packs e a pasta servida. */
  dir: string;
  builtIn: BuiltIn;
  trustedKeys: TrustedKeys;
  capabilities: Record<string, (args: unknown) => unknown>;
  /** Mostra a UI na janela (loadHTML do index). */
  show(ui: HostUi): void;
  /** De onde a janela busca UI (`uiChannelFor`). */
  channel: UiChannelChoice;
  /** O fetch guardado do canal remoto. Sem ele, o canal remoto fica desligado. */
  remoteFetch?: typeof fetch;
  readyTimeoutMs?: number;
  probationMs?: number;
  /** "Buscar atualizações" em Ajustes (T25110), lido a cada GET do canal. Sem ele, ligado. */
  checkUpdates?: () => boolean | Promise<boolean>;
  /**
   * Se a UI nova pode trocar a da tela agora (spec #25011). Com `false`, ela espera o `applyUpdate()` (o Recarregar da
   * faixa "Nova aparência pronta") ou a próxima abertura da janela.
   */
  canSwap?: () => boolean;
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
      ...gatedSource(channelSource(o.channel, o.remoteFetch), o.channel, o.checkUpdates),
      trustedKeys: o.trustedKeys,
      root: path.join(o.dir, "packs"),
      stateFile: path.join(o.dir, "channel.json"),
    },
    host: {
      viewsRoot: servedDir(o.dir),
      prefix: "internal",
      builtIn: o.builtIn,
      show: o.show,
      ...(o.canSwap ? { canSwap: o.canSwap } : {}),
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
  if (!handler) return { ok: false, code: "E_NO_CAPABILITY", message: `contract ${UI_CONTRACT_VERSION} has no capability ${JSON.stringify(cap)}` }; // i18n-ok: a resposta do agent control, não aparece
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
