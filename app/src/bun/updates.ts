// Atualização automática (T1969, decisão do harry em #1966): o app inteiro (UI, ditado, helper) se atualiza pelo
// Updater do Electrobun, a partir do GitHub Releases. É a única coisa que o app busca na rede, e só baixa (ADR 0008):
//
// 1. de tempos em tempos, o `checkForUpdate` lê o `<canal>-macos-arm64-update.json` do `baseUrl` do build;
// 2. com um hash novo, o `downloadUpdate` baixa o .tar.zst em segundo plano;
// 3. **antes de oferecer**, o app confere o que baixou: o Electrobun não confere assinatura nem conteúdo do download.
//    O .app de dentro tem que ter a assinatura da Kiwi Init (Developer ID, time 57249C654W), o identificador
//    `app.kiwinotes.desktop` e o hash do manifesto. Um tar que não passa é apagado e não vira oferta;
// 4. o menu ganha "Atualizar e reiniciar", e só esse clique chama o `applyUpdate`. Nada reinicia sozinho.
//
// Desligado no canal dev, sem `baseUrl` (build local ou ensaio), com KIWI_DEBUG=1 (agentes) e no headless, que nem
// importa este arquivo: testes nunca vão à rede.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppChannel, UpdatesLastCheck, UpdatesView } from "../shared/ui-contract.ts";

export const IDENTIFIER = "app.kiwinotes.desktop";
/** O time do Developer ID que assina o Kiwi Notes (Jonatas Walker, T1349). */
export const TEAM_ID = "57249C654W";
/** A primeira checagem espera o app assentar; depois, de 6 em 6 horas. */
export const FIRST_CHECK_MS = 60_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;

export interface LocalInfo {
  identifier: string;
  channel: string;
  version: string;
  hash: string;
  baseUrl: string;
}

export interface UpdateCheck {
  version: string;
  hash: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string;
}

/** O pedaço do `Updater` do Electrobun que o app usa (injetado nos testes). */
export interface UpdaterApi {
  getLocalInfo(): Promise<LocalInfo>;
  checkForUpdate(): Promise<UpdateCheck>;
  downloadUpdate(): Promise<void>;
  applyUpdate(): Promise<void>;
  updateInfo(): UpdateCheck;
  appDataFolder(): Promise<string>;
}

/**
 * Compara versões no formato do tag (`0.1.0`, `0.1.0-rc3`): -1, 0 ou 1. Como no semver, a pré-versão vem antes da
 * final (`0.2.0-rc3 < 0.2.0 < 0.2.1-rc1`); na pré-versão, os números contam como números (`rc3 < rc10`). Uma versão
 * fora do formato dá null: não dá para dizer se é mais nova.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(v);
    return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const chunks = (s: string) => s.match(/\d+|[^\d.]+/g) ?? [];
  const p = chunks(x.pre);
  const q = chunks(y.pre);
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const pn = /^\d+$/.test(p[i]!);
    const qn = /^\d+$/.test(q[i]!);
    if (pn && qn) return Number(p[i]) < Number(q[i]) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p[i]! < q[i]! ? -1 : 1;
  }
  return 0;
}

/** Por que a atualização está desligada neste app, ou null se está ligada. */
export function updatesOff(info: LocalInfo, env: Record<string, string | undefined>): string | null {
  if (env.KIWI_DEBUG === "1") return "KIWI_DEBUG=1";
  if (info.channel !== "stable" && info.channel !== "canary") return `channel ${info.channel || "unknown"}`;
  if (!info.baseUrl) return "no release.baseUrl in this build";
  let url: URL;
  try {
    url = new URL(info.baseUrl);
  } catch {
    return `baseUrl isn't a URL: ${info.baseUrl}`;
  }
  if (url.protocol !== "https:") return `baseUrl isn't https: ${info.baseUrl}`;
  return null;
}

export interface Expected {
  hash: string;
  identifier?: string;
  teamId?: string;
}

type Run = (cmd: string, args: string[]) => { code: number; out: string };

const runTool: Run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

/** O requisito de assinatura: Developer ID da Apple, o nosso identificador e o nosso time. */
export function requirement(identifier: string, teamId: string): string {
  return `anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${teamId}"`;
}

/**
 * Confere o .tar que o Updater baixou (o que ele vai pôr no lugar do app). Devolve null se pode aplicar, ou o motivo
 * de não poder. Abre numa pasta temporária, que sempre é apagada.
 */
export function verifyUpdateTar(tar: string, expected: Expected, run: Run = runTool): string | null {
  const identifier = expected.identifier ?? IDENTIFIER;
  const teamId = expected.teamId ?? TEAM_ID;
  if (!existsSync(tar)) return `no update archive at ${tar}`;
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-update-"));
  try {
    const x = run("/usr/bin/tar", ["-xf", tar, "-C", dir]);
    if (x.code !== 0) return `the update archive doesn't open: ${x.out}`;
    const apps = readdirSync(dir).filter((n) => n.endsWith(".app"));
    if (apps.length !== 1) return `the update archive has ${apps.length} apps, not 1`;
    const app = path.join(dir, apps[0]!);
    let version: { identifier?: unknown; hash?: unknown };
    try {
      version = JSON.parse(readFileSync(path.join(app, "Contents", "Resources", "version.json"), "utf8"));
    } catch {
      return "the update has no readable version.json";
    }
    if (version.identifier !== identifier) return `the update is ${String(version.identifier)}, not ${identifier}`;
    if (version.hash !== expected.hash) return `the update's hash is ${String(version.hash)}, the manifest said ${expected.hash}`;
    const id = run("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", path.join(app, "Contents", "Info.plist")]);
    if (id.code !== 0 || id.out !== identifier) return `the update's bundle id is ${id.out || "missing"}, not ${identifier}`;
    const sig = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", `=${requirement(identifier, teamId)}`, app]);
    if (sig.code !== 0) return `the update isn't signed by the Kiwi Init Developer ID: ${sig.out}`;
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Onde o Electrobun guardou o download pronto (o registro dele diz o caminho do .tar). */
export function preparedTar(appData: string, hash: string): string | null {
  try {
    const rec = JSON.parse(readFileSync(path.join(appData, "self-extraction", ".electrobun-prepared-update.json"), "utf8")) as {
      hash?: unknown;
      retained_tar_path?: unknown;
    };
    return rec.hash === hash && typeof rec.retained_tar_path === "string" ? rec.retained_tar_path : null;
  } catch {
    return null;
  }
}

export type UpdateState =
  | { kind: "off"; reason: string }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string; hash: string }
  | { kind: "applying" };

/**
 * A última checagem e o que ela achou (T2386): a seção Sobre mostra "Você está na última versão", a versão nova ou o
 * erro. O menu da barra só olha o `UpdateState`.
 */
export type LastCheck = UpdatesLastCheck;

/** O erro da checagem, dito para a pessoa: sem internet, o servidor que não respondeu ou outro. */
export function checkErrorMessage(error: string): string {
  if (/offline|network|internet|ENOTFOUND|ENETUNREACH|EAI_AGAIN|ECONNREFUSED|Unable to connect|could not resolve|getaddrinfo/i.test(error)) {
    return "Sem internet: não deu para falar com o GitHub.";
  }
  if (/timed? ?out|ETIMEDOUT|\b5\d\d\b|\b4\d\d\b|status/i.test(error)) return "O servidor das atualizações não respondeu. Tente de novo mais tarde.";
  return "Não deu para verificar agora. Tente de novo mais tarde.";
}

export interface UpdatesDeps {
  updater: UpdaterApi;
  env?: Record<string, string | undefined>;
  verify?: (tar: string, expected: Expected) => string | null;
  log?: (message: string) => void;
  /** Agora (os testes fixam a hora da última checagem). */
  now?: () => Date;
}

/** A atualização do app: checa, baixa, confere e oferece. Quem mostra a oferta é o menu (`onChange`). */
export class AppUpdates {
  private state: UpdateState = { kind: "idle" };
  private last: LastCheck | null = null;
  private listeners: ((s: UpdateState) => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<UpdateState> | undefined;
  private readonly env: Record<string, string | undefined>;
  private readonly verify: (tar: string, expected: Expected) => string | null;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: UpdatesDeps) {
    this.env = deps.env ?? process.env;
    this.verify = deps.verify ?? ((tar, expected) => verifyUpdateTar(tar, expected));
    this.log = deps.log ?? ((m) => console.log(`updates: ${m}`));
  }

  status(): UpdateState {
    return this.state;
  }

  /** A última checagem que terminou, ou null antes da 1ª. */
  lastCheck(): LastCheck | null {
    return this.last;
  }

  private finish(result: LastCheck["result"], extra: { version?: string; message?: string } = {}): UpdateState {
    const at = (this.deps.now?.() ?? new Date()).toISOString();
    this.last =
      result === "available"
        ? { at, result, version: extra.version ?? "" }
        : result === "error"
          ? { at, result, message: extra.message ?? "" }
          : { at, result };
    return this.state;
  }

  onChange(fn: (s: UpdateState) => void): void {
    this.listeners.push(fn);
  }

  private set(s: UpdateState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Liga as checagens: a primeira depois de `firstMs`, e então a cada `everyMs`. */
  async start(firstMs = FIRST_CHECK_MS, everyMs = CHECK_EVERY_MS): Promise<void> {
    const off = updatesOff(await this.deps.updater.getLocalInfo(), this.env);
    if (off) {
      this.log(`off (${off})`);
      this.set({ kind: "off", reason: off });
      return;
    }
    const tick = (ms: number) => {
      this.timer = setTimeout(() => {
        void this.check().finally(() => tick(everyMs));
      }, ms);
      (this.timer as { unref?: () => void }).unref?.();
    };
    tick(firstMs);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Uma rodada: checa, baixa e confere. Duas chamadas juntas viram uma. Nunca lança. */
  check(): Promise<UpdateState> {
    if (this.state.kind === "off" || this.state.kind === "ready" || this.state.kind === "applying") return Promise.resolve(this.state);
    // Uma checagem já em andamento (inclusive baixando) responde à 2ª chamada, em vez de começar outra.
    this.running ??= this.round().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async round(): Promise<UpdateState> {
    const u = this.deps.updater;
    this.set({ kind: "checking" });
    try {
      const found = await u.checkForUpdate();
      if (found.error) {
        this.log(`check failed: ${found.error}`);
        this.finish("error", { message: checkErrorMessage(found.error) });
        this.set({ kind: "idle" });
        return this.state;
      }
      if (!found.updateAvailable) {
        this.finish("latest");
        this.set({ kind: "idle" });
        return this.state;
      }
      // O Updater decide pelo hash, não pela versão: um feed sobrescrito por um release mais velho (um re-run de tag
      // antigo, uma correção numa linha velha) viraria um downgrade. Só sobe (revisão do T1969, #2057).
      const current = (await u.getLocalInfo()).version;
      if (compareVersions(found.version, current) !== 1) {
        this.log(`skipped update ${found.version} (${found.hash}): not newer than ${current}`);
        this.finish("latest");
        this.set({ kind: "idle" });
        return this.state;
      }
      this.log(`update ${found.version} (${found.hash}) found, downloading`);
      this.set({ kind: "downloading", version: found.version });
      await u.downloadUpdate();
      const after = u.updateInfo();
      if (!after.updateReady || after.error) {
        this.log(`download failed: ${after.error || "not ready"}`);
        this.finish("error", { message: `O download da ${found.version} falhou. Tente de novo.` });
        this.set({ kind: "idle" });
        return this.state;
      }
      const tar = preparedTar(await u.appDataFolder(), after.hash);
      const why = tar ? this.verify(tar, { hash: after.hash }) : "the downloaded update wasn't found";
      if (why) {
        // Não oferece e apaga: um tar que não é nosso não fica esperando um clique.
        this.log(`refused update ${after.version} (${after.hash}): ${why}`);
        if (tar) rmSync(tar, { force: true });
        this.finish("error", { message: `A ${after.version} foi recusada: a assinatura não confere.` });
        this.set({ kind: "idle" });
        return this.state;
      }
      this.log(`update ${after.version} (${after.hash}) verified and ready`);
      this.finish("available", { version: after.version });
      this.set({ kind: "ready", version: after.version, hash: after.hash });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log(`check failed: ${message}`);
      this.finish("error", { message: checkErrorMessage(message) });
      this.set({ kind: "idle" });
    }
    return this.state;
  }

  /**
   * O clique em "Atualizar e reiniciar". Quando dá certo, o Electrobun sai do processo, troca o app e reabre o novo, e
   * isto nunca volta. Voltar é porque não saiu (um before-quit cancelou, ou o helper do Electrobun não subiu): a oferta
   * continua no menu.
   */
  async apply(): Promise<void> {
    if (this.state.kind !== "ready") return;
    const ready = this.state;
    this.set({ kind: "applying" });
    try {
      await this.deps.updater.applyUpdate();
    } catch (e) {
      this.log(`apply failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const info = this.deps.updater.updateInfo();
    this.log(`update didn't restart the app${info.error ? `: ${info.error}` : ""}`);
    // A seção Sobre diz que a troca falhou (o InvalidUpdateIdentity da rc3, #2402), em vez de só voltar a "pronta".
    this.finish("error", { message: `A ${ready.version} foi baixada, mas não deu para trocar o app. Tente de novo; se continuar, instale pelo .dmg do release.` });
    this.set(ready);
  }
}

/** O canal do build, para a seção Sobre: o dev nunca checa; uma versão com `-rc` lê o feed das rc. */
export function channelOf(electrobunChannel: string, version: string): AppChannel {
  if (electrobunChannel === "dev") return "dev";
  return /-rc\d*$/i.test(version) ? "rc" : "stable";
}

/** A linha do menu para a atualização pronta, ou null. */
export function updateMenuLabel(s: UpdateState, currentVersion: string): string | null {
  if (s.kind === "applying") return "Atualizando…";
  if (s.kind !== "ready") return null;
  return s.version && s.version !== currentVersion ? `Atualizar e reiniciar (v${s.version})` : "Atualizar e reiniciar";
}

/** O motivo de estar desligado, para a pessoa (o do `updatesOff` é técnico e vai para o log). */
export function offReasonText(reason: string): string {
  if (reason.startsWith("KIWI_DEBUG")) return "modo de teste dos agentes";
  if (reason.startsWith("channel dev")) return "build de desenvolvimento";
  if (reason.startsWith("channel")) return "build fora dos canais de release";
  if (reason.startsWith("no release.baseUrl")) return "build local, sem o endereço das atualizações";
  return "o endereço das atualizações deste build não é válido";
}

/** O que a seção Sobre mostra das atualizações (o `UpdatesView` do contrato, T2386). */
export function updatesView(state: UpdateState, last: LastCheck | null): UpdatesView {
  const base = { lastCheck: last };
  switch (state.kind) {
    case "off":
      return { ...base, state: "off", reason: offReasonText(state.reason) };
    case "downloading":
      return { ...base, state: "downloading", version: state.version };
    case "ready":
      return { ...base, state: "ready", version: state.version };
    default:
      return { ...base, state: state.kind };
  }
}
