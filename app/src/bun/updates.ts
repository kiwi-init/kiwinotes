// Atualização automática (T1969, decisão do harry em #1966): o app inteiro (UI, ditado, helper) se atualiza pelo
// Updater do Electrobun, a partir do GitHub Releases. É a única coisa que o app busca na rede, e só baixa (ADR 0008):
//
// 1. de tempos em tempos, o `checkForUpdate` lê o `<canal>-macos-arm64-update.json` do `baseUrl` do build;
// 2. com um hash novo, o `downloadUpdate` baixa o .tar.zst em segundo plano;
// 3. **antes de oferecer**, o app confere o que baixou: o Electrobun não confere assinatura nem conteúdo do download.
//    O .app de dentro tem que ter a assinatura da Kiwi Init (Developer ID, time 57249C654W), o identificador
//    `app.kiwinotes.desktop` e o hash do manifesto. O Electrobun 2026.11.5 já deixa o app aberto numa pasta
//    preparada; o de antes deixava o .tar (`preparedUpdate`). O que não passa é apagado e não vira oferta;
// 4. o menu ganha "Atualizar e reiniciar", e só esse clique chama o `applyUpdate`. Nada reinicia sozinho.
//
// Desligado no canal dev, sem `baseUrl` (build local ou ensaio), com KIWI_DEBUG=1 (agentes) e no headless, que nem
// importa este arquivo: testes nunca vão à rede.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type AppChannel, type UpdatesLastCheck, UPDATES_OFF_BY_SETTING, type UpdatesView } from "../shared/ui-contract.ts";
import { type Locale, type Params, type TextKey, translate } from "../shared/i18n/index.ts";

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

/** O que o Updater do Electrobun manda no `onStatusChange`: o nome do passo e, no `download-progress`, os bytes. */
export interface UpdaterStatus {
  status: string;
  details?: { bytesDownloaded?: number; totalBytes?: number };
}

/** O pedaço do `Updater` do Electrobun que o app usa (injetado nos testes). */
export interface UpdaterApi {
  getLocalInfo(): Promise<LocalInfo>;
  checkForUpdate(): Promise<UpdateCheck>;
  downloadUpdate(): Promise<void>;
  applyUpdate(): Promise<void>;
  updateInfo(): UpdateCheck;
  appDataFolder(): Promise<string>;
  /**
   * O status do Updater. Ao abrir, ele reconcilia uma vez o resultado da última troca, feita pelo extractor com o app
   * já fechado: se ela falhou, sai um `error`, e o `updateInfo()` fica com o erro (T2386, #2423).
   */
  onStatusChange?(callback: ((entry: UpdaterStatus) => void) | null): void;
}

/**
 * Compara versões no formato do tag: -1, 0 ou 1. Os releases são `ANO.MÊS.N` (spec #13879: `2026.11.1 < 2026.11.2 <
 * 2026.12.1`), e as rc antigas (`0.1.0-rc19`) seguem no semver, com a pré-versão antes da final e os números como
 * números (`rc3 < rc10`). Como o ano vem na frente, qualquer `ANO.MÊS.N` é mais nova que uma rc: quem tem a rc19 recebe
 * a `2026.11.1`. Uma versão fora do formato dá null: não dá para dizer se é mais nova.
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
 * Confere o app que o Updater preparou, já aberto (o que ele vai pôr no lugar do app). Devolve null se pode aplicar,
 * ou o motivo de não poder. `app` é a raiz do bundle: um `.app` ou a pasta preparada do Electrobun
 * (`<app>.prepared-<hash>`), que tem o mesmo `Contents/`.
 */
export function verifyUpdateApp(app: string, expected: Expected, run: Run = runTool): string | null {
  const identifier = expected.identifier ?? IDENTIFIER;
  const teamId = expected.teamId ?? TEAM_ID;
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
}

/**
 * Confere o .tar que o Updater baixou (o Electrobun até a 2026.10). Devolve null se pode aplicar, ou o motivo de não
 * poder. Abre numa pasta temporária, que sempre é apagada.
 */
export function verifyUpdateTar(tar: string, expected: Expected, run: Run = runTool): string | null {
  if (!existsSync(tar)) return `no update archive at ${tar}`;
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-update-"));
  try {
    const x = run("/usr/bin/tar", ["-xf", tar, "-C", dir]);
    if (x.code !== 0) return `the update archive doesn't open: ${x.out}`;
    const apps = readdirSync(dir).filter((n) => n.endsWith(".app"));
    if (apps.length !== 1) return `the update archive has ${apps.length} apps, not 1`;
    return verifyUpdateApp(path.join(dir, apps[0]!), expected, run);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Confere o que o `preparedUpdate` achou: a pasta preparada (o Electrobun 2026.11) ou o .tar (o de antes). */
export function verifyPrepared(prepared: string, expected: Expected, run: Run = runTool): string | null {
  if (!existsSync(prepared)) return `the prepared update isn't at ${prepared}`;
  return statSync(prepared).isDirectory() ? verifyUpdateApp(prepared, expected, run) : verifyUpdateTar(prepared, expected, run);
}

/**
 * Onde o Electrobun deixou o download pronto, pelo registro dele (`.electrobun-prepared-update.json`), só se é do
 * mesmo hash. Até a 2026.10, o registro é o `schema_version` 1, com o `.tar` em `retained_tar_path`. Desde a 2026.11.5
 * (a nossa desde a 2026.11.13), é o 2: sem tar, com o app já aberto em `staging_path` (`<app>.prepared-<hash>`).
 * Ler só o `retained_tar_path` fez toda atualização da 2026.11.13 em diante ser recusada como "a assinatura não
 * confere" (#29720).
 */
export function preparedUpdate(appData: string, hash: string): string | null {
  try {
    const rec = JSON.parse(readFileSync(path.join(appData, "self-extraction", ".electrobun-prepared-update.json"), "utf8")) as {
      schema_version?: unknown;
      hash?: unknown;
      retained_tar_path?: unknown;
      staging_path?: unknown;
    };
    if (rec.hash !== hash) return null;
    if (rec.schema_version === 2) {
      const stage = rec.staging_path;
      return typeof stage === "string" && path.isAbsolute(stage) && stage.endsWith(`.prepared-${hash}`) ? stage : null;
    }
    return typeof rec.retained_tar_path === "string" && rec.retained_tar_path ? rec.retained_tar_path : null;
  } catch {
    return null;
  }
}

export type UpdateState =
  | { kind: "off"; reason: string }
  | { kind: "idle" }
  | { kind: "checking" }
  /** `done` e `total` em bytes, do `download-progress` do Updater (T17097); sem eles, a faixa do Sobre fica indeterminada. */
  | { kind: "downloading"; version: string; done?: number; total?: number }
  | { kind: "ready"; version: string; hash: string }
  | { kind: "applying" };

/**
 * A última checagem e o que ela achou (T2386): a seção Sobre mostra "Você está na última versão", a versão nova ou o
 * erro. O menu da barra só olha o `UpdateState`.
 */
export type LastCheck = UpdatesLastCheck;

/**
 * Uma mensagem para a pessoa, guardada como chave do catálogo (T29006): o Sobre a lê na língua de agora, também
 * depois de uma troca de língua.
 */
export type UpdateMessage = { key: TextKey; params?: Params };

/** A troca que falhou (o "Atualizar e reiniciar" que voltou para a versão de antes), dita para a pessoa. */
export const swapFailedMessage = (version: string): UpdateMessage => ({ key: "update.swapFailed", params: { version } });

/** O erro da checagem, dito para a pessoa: sem internet, o servidor que não respondeu ou outro. */
export function checkErrorMessage(error: string): UpdateMessage {
  if (/offline|network|internet|ENOTFOUND|ENETUNREACH|EAI_AGAIN|ECONNREFUSED|Unable to connect|could not resolve|getaddrinfo/i.test(error)) {
    return { key: "update.offline" };
  }
  if (/timed? ?out|ETIMEDOUT|\b5\d\d\b|\b4\d\d\b|status/i.test(error)) return { key: "update.serverDown" };
  return { key: "update.checkFailed" };
}

/** O texto de uma `UpdateMessage` numa língua. */
export const updateMessageText = (m: UpdateMessage, locale: Locale = "pt"): string => translate(locale, m.key, m.params);

/** A última checagem por dentro: a mensagem do erro ainda como chave. */
type StoredCheck = Exclude<LastCheck, { result: "error" }> | { at: string; result: "error"; message: UpdateMessage };

export interface UpdatesDeps {
  updater: UpdaterApi;
  env?: Record<string, string | undefined>;
  /** Confere o update preparado: a pasta do app aberto ou o .tar (`preparedUpdate`). */
  verify?: (prepared: string, expected: Expected) => string | null;
  log?: (message: string) => void;
  /** Agora (os testes fixam a hora da última checagem). */
  now?: () => Date;
  /**
   * "Buscar atualizações" em Ajustes (T25110), lido a cada checagem: desligado, a rodada não chama o Updater e nada vai
   * à rede. Sem ele, ligado.
   */
  enabled?: () => boolean | Promise<boolean>;
}

/** O motivo do `off` quando é a pessoa que desligou em Ajustes (não o build): volta a ligar sem reiniciar. */
export const OFF_BY_SETTING = "turned off in Settings";

/** A atualização do app: checa, baixa, confere e oferece. Quem mostra a oferta é o menu (`onChange`). */
export class AppUpdates {
  private state: UpdateState = { kind: "idle" };
  private last: StoredCheck | null = null;
  /** A troca que falhou antes deste processo já foi registrada (vale uma vez: o Updater só reconcilia uma vez). */
  private swapNoted = false;
  /** Já houve uma checagem neste processo: daí em diante, um erro no `updateInfo()` é dela (um download), não da troca. */
  private checkedHere = false;
  private listeners: ((s: UpdateState) => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<UpdateState> | undefined;
  private readonly env: Record<string, string | undefined>;
  private readonly verify: (prepared: string, expected: Expected) => string | null;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: UpdatesDeps) {
    this.env = deps.env ?? process.env;
    this.verify = deps.verify ?? ((prepared, expected) => verifyPrepared(prepared, expected));
    this.log = deps.log ?? ((m) => console.log(`updates: ${m}`));
  }

  status(): UpdateState {
    return this.state;
  }

  /** A última checagem que terminou, ou null antes da 1ª, com a mensagem na língua pedida. */
  lastCheck(locale: Locale = "pt"): LastCheck | null {
    const l = this.last;
    return l?.result === "error" ? { ...l, message: updateMessageText(l.message, locale) } : l;
  }

  private finish(result: LastCheck["result"], extra: { version?: string; message?: UpdateMessage } = {}): UpdateState {
    const at = (this.deps.now?.() ?? new Date()).toISOString();
    this.last =
      result === "available"
        ? { at, result, version: extra.version ?? "" }
        : result === "error"
          ? { at, result, message: extra.message ?? { key: "update.checkFailed" } }
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
    // A troca de versão é feita pelo extractor com o app fechado; se ela falha, ele reabre a versão de antes, e o erro só
    // aparece aqui quando o Updater reconcilia o resultado, logo depois de abrir (#2423, o InvalidUpdateIdentity da rc3).
    this.deps.updater.onStatusChange?.((e) => {
      if (e.status === "error") void this.noteFailedSwap();
      else if (e.status === "download-progress") this.noteProgress(e.details);
    });
    const late = setTimeout(() => void this.noteFailedSwap(), 3000);
    (late as { unref?: () => void }).unref?.();
    const tick = (ms: number) => {
      this.timer = setTimeout(() => {
        void this.check().finally(() => tick(everyMs));
      }, ms);
      (this.timer as { unref?: () => void }).unref?.();
    };
    tick(firstMs);
  }

  /**
   * O progresso do download (T17097, spec #16837): os bytes que o Updater manda, só enquanto baixa. Um número que não
   * serve é ignorado; o último aviso pode vir sem o total, e fica o que já se sabia. O total nunca fica menor que o
   * baixado, para a barra não passar de cheia.
   */
  private noteProgress(d: UpdaterStatus["details"]): void {
    if (this.state.kind !== "downloading") return;
    const done = d?.bytesDownloaded;
    if (typeof done !== "number" || !Number.isFinite(done) || done < 0) return;
    const given = d?.totalBytes;
    const known = typeof given === "number" && Number.isFinite(given) && given > 0 ? given : this.state.total;
    const total = known === undefined ? undefined : Math.max(known, done);
    this.set({ kind: "downloading", version: this.state.version, done, ...(total === undefined ? {} : { total }) });
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Uma rodada: checa, baixa e confere. Duas chamadas juntas viram uma. Nunca lança. */
  check(): Promise<UpdateState> {
    const offByBuild = this.state.kind === "off" && this.state.reason !== OFF_BY_SETTING;
    if (offByBuild || this.state.kind === "ready" || this.state.kind === "applying") return Promise.resolve(this.state);
    // Uma checagem já em andamento (inclusive baixando) responde à 2ª chamada, em vez de começar outra.
    this.running ??= this.round().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /**
   * Se a última troca falhou (o Updater reconciliou com erro), registra na última checagem para a seção Sobre dizer, em
   * vez de "Ainda não verificado". Uma vez por processo, e só para uma versão mais nova que esta.
   */
  async noteFailedSwap(): Promise<void> {
    if (this.swapNoted || this.checkedHere) return;
    const info = this.deps.updater.updateInfo();
    if (!info.error || info.updateReady || !info.updateAvailable || !info.version) return;
    const current = (await this.deps.updater.getLocalInfo()).version;
    if (compareVersions(info.version, current) !== 1) return;
    this.swapNoted = true;
    this.log(`the swap to ${info.version} failed before this launch: ${info.error}`);
    this.finish("error", { message: swapFailedMessage(info.version) });
    this.set(this.state); // avisa o hub aberto (updates.status)
  }

  /**
   * "Buscar atualizações" mudou em Ajustes (T25110): a faixa do Sobre diz na hora, sem checar nada. Ligar de novo só
   * volta ao parado; a próxima checagem (a do relógio ou o botão) é quem vai à rede.
   */
  settingChanged(on: boolean): void {
    if (!on && (this.state.kind === "idle" || this.state.kind === "checking")) this.set({ kind: "off", reason: OFF_BY_SETTING });
    else if (on && this.state.kind === "off" && this.state.reason === OFF_BY_SETTING) this.set({ kind: "idle" });
  }

  private async round(): Promise<UpdateState> {
    // Desligado em Ajustes (T25110): nem o Updater é chamado, e nada vai à rede.
    if (!(await (this.deps.enabled?.() ?? true))) {
      if (this.state.kind !== "off") this.log("off (Buscar atualizações is off in Settings)");
      this.set({ kind: "off", reason: OFF_BY_SETTING });
      return this.state;
    }
    if (this.state.kind === "off") this.set({ kind: "idle" });
    const u = this.deps.updater;
    // Antes de checar de novo: se a última troca falhou e o callback não pegou, registra agora.
    await this.noteFailedSwap();
    this.checkedHere = true;
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
        this.finish("error", { message: { key: "update.downloadFailed", params: { version: found.version } } });
        this.set({ kind: "idle" });
        return this.state;
      }
      const prepared = preparedUpdate(await u.appDataFolder(), after.hash);
      const why = prepared ? this.verify(prepared, { hash: after.hash }) : "the downloaded update wasn't found";
      if (why) {
        // Não oferece e apaga: um update que não é nosso (o tar ou a pasta preparada) não fica esperando um clique.
        this.log(`refused update ${after.version} (${after.hash}): ${why}`);
        if (prepared) rmSync(prepared, { recursive: true, force: true });
        this.finish("error", { message: { key: "update.refused", params: { version: after.version } } });
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
    this.finish("error", { message: swapFailedMessage(ready.version) });
    this.set(ready);
  }
}

/** O canal do build, para a seção Sobre: o dev nunca checa; os releases (`ANO.MÊS.N`, spec #13879) são todos estáveis. */
export function channelOf(electrobunChannel: string): AppChannel {
  return electrobunChannel === "dev" ? "dev" : "stable";
}

/** A linha do menu para a atualização pronta, ou null. */
export function updateMenuLabel(s: UpdateState, currentVersion: string, locale: Locale = "pt"): string | null {
  if (s.kind === "applying") return translate(locale, "tray.updating");
  if (s.kind !== "ready") return null;
  return s.version && s.version !== currentVersion
    ? translate(locale, "tray.updateRestartVersion", { version: s.version })
    : translate(locale, "tray.updateRestart");
}

/** O motivo de estar desligado, para a pessoa (o do `updatesOff` é técnico e vai para o log). */
// O desligado pelos Ajustes segue o valor do contrato (`UPDATES_OFF_BY_SETTING`): o Sobre o compara, e ele não traduz.
export function offReasonText(reason: string, locale: Locale = "pt"): string {
  if (reason === OFF_BY_SETTING) return UPDATES_OFF_BY_SETTING;
  if (reason.startsWith("KIWI_DEBUG")) return translate(locale, "update.off.agents");
  if (reason.startsWith("channel dev")) return translate(locale, "update.off.dev");
  if (reason.startsWith("channel")) return translate(locale, "update.off.channel");
  if (reason.startsWith("no release.baseUrl")) return translate(locale, "update.off.noUrl");
  return translate(locale, "update.off.badUrl");
}

/** O que a seção Sobre mostra das atualizações (o `UpdatesView` do contrato, T2386). */
export function updatesView(state: UpdateState, last: LastCheck | null, locale: Locale = "pt"): UpdatesView {
  const base = { lastCheck: last };
  switch (state.kind) {
    case "off":
      return { ...base, state: "off", reason: offReasonText(state.reason, locale) };
    case "downloading":
      return {
        ...base,
        state: "downloading",
        version: state.version,
        ...(state.done === undefined ? {} : { done: state.done }),
        ...(state.total === undefined ? {} : { total: state.total }),
      };
    case "ready":
      return { ...base, state: "ready", version: state.version };
    default:
      return { ...base, state: state.kind };
  }
}
