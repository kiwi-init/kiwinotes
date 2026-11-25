import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AppUpdates,
  channelOf,
  checkErrorMessage,
  compareVersions,
  OFF_BY_SETTING,
  preparedUpdate,
  requirement,
  updateMenuLabel,
  offReasonText,
  swapFailedMessage,
  updateMessageText,
  updatesOff,
  updatesView,
  verifyPrepared,
  verifyUpdateTar,
  type LocalInfo,
  type UpdateCheck,
  type UpdaterApi,
} from "./updates.ts";
import { UPDATES_OFF_BY_SETTING } from "../shared/ui-contract.ts";
import { tempDir } from "../../test/tmp.ts";

const INFO: LocalInfo = {
  identifier: "app.kiwinotes.desktop",
  channel: "stable",
  version: "0.1.0",
  hash: "aaaa",
  baseUrl: "https://github.com/kiwi-init/kiwinotes/releases/latest/download",
};

describe("updatesOff (T1969)", () => {
  test("liga só num build stable ou canary, com baseUrl https, fora do KIWI_DEBUG", () => {
    expect(updatesOff(INFO, {})).toBeNull();
    expect(updatesOff({ ...INFO, channel: "canary" }, {})).toBeNull();
    expect(updatesOff(INFO, { KIWI_DEBUG: "1" })).toBe("KIWI_DEBUG=1");
    expect(updatesOff({ ...INFO, channel: "dev" }, {})).toBe("channel dev");
    expect(updatesOff({ ...INFO, channel: "" }, {})).toBe("channel unknown");
    expect(updatesOff({ ...INFO, baseUrl: "" }, {})).toBe("no release.baseUrl in this build");
    expect(updatesOff({ ...INFO, baseUrl: "http://example.com/x" }, {})).toContain("isn't https");
    expect(updatesOff({ ...INFO, baseUrl: "nada" }, {})).toContain("isn't a URL");
  });
});

/**
 * O registro 2 do Electrobun 2026.11.5, no formato que ele mesmo escreve: copiado do `PreparedUpdateV2` e da fixture do
 * `UpdaterStreaming.test.ts` dele (`staged`), com o `staging_path` em `<app>.prepared-<hash>` e a receita na
 * `self-extraction`. Sem `retained_tar_path`: é isso que a 2026.11.13 não sabia ler (#29720).
 */
function v2Record(appData: string, hash: string) {
  const appBundlePath = path.join(appData, "Kiwi Notes.app");
  return {
    schema_version: 2,
    identifier: "app.kiwinotes.desktop",
    channel: "stable",
    platform: "macos",
    arch: "arm64",
    version: "0.1.1",
    hash,
    staging_path: `${appBundlePath}.prepared-${hash}`,
    recipe_path: path.join(appData, "self-extraction", `${hash}.recipe.json`),
    recipe_sha256: "b".repeat(64),
    artifact_file: "stable-macos-arm64-KiwiNotes.app.tar.zst",
  };
}

/** Um Updater de mentira: o que o check acha, se o download dá certo, e o registro do Electrobun no disco. */
function fakeUpdater(opts: {
  found?: Partial<UpdateCheck>;
  downloadOk?: boolean;
  appData: string;
  applyExits?: boolean;
  /** O registro do Electrobun: o 1 (o .tar, até a 2026.10) ou o 2 (a pasta preparada, desde a 2026.11.5). */
  record?: 1 | 2;
  /** Monta o app de verdade na pasta preparada (o registro 2), para a conferência real rodar. */
  stage?: (dir: string) => void;
}) {
  const calls: string[] = [];
  let info: UpdateCheck = { version: "0.1.0", hash: "aaaa", updateAvailable: false, updateReady: false, error: "" };
  const updater: UpdaterApi = {
    getLocalInfo: async () => INFO,
    checkForUpdate: async () => {
      calls.push("check");
      info = { ...info, ...opts.found };
      return info;
    },
    downloadUpdate: async () => {
      calls.push("download");
      if (opts.downloadOk === false) {
        info = { ...info, updateReady: false, error: "Failed to download update: HTTP 404" };
        return;
      }
      const dir = path.join(opts.appData, "self-extraction");
      mkdirSync(dir, { recursive: true });
      if (opts.record === 2) {
        const staged = v2Record(opts.appData, info.hash);
        if (opts.stage) opts.stage(staged.staging_path);
        else mkdirSync(staged.staging_path, { recursive: true });
        writeFileSync(staged.recipe_path, "archive recipe");
        writeFileSync(path.join(dir, ".electrobun-prepared-update.json"), JSON.stringify(staged));
      } else {
        const tar = path.join(dir, `${info.hash}.tar`);
        writeFileSync(tar, "tar");
        writeFileSync(path.join(dir, ".electrobun-prepared-update.json"), JSON.stringify({ hash: info.hash, retained_tar_path: tar }));
      }
      info = { ...info, updateReady: true };
    },
    applyUpdate: async () => {
      calls.push("apply");
      info = { ...info, error: "Update restart was cancelled" };
    },
    updateInfo: () => info,
    appDataFolder: async () => opts.appData,
  };
  return { updater, calls };
}

function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = tempDir("kn-updates-");
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("AppUpdates (T1969)", () => {
  test("sem versão nova: checa, não baixa, fica parado", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData });
      const u = new AppUpdates({ updater, env: {}, log: () => {} });
      expect(await u.check()).toEqual({ kind: "idle" });
      expect(calls).toEqual(["check"]);
    }));

  test("com versão nova: baixa, confere o tar do registro e oferece", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true } });
      const seen: string[] = [];
      const u = new AppUpdates({
        updater,
        env: {},
        log: () => {},
        verify: (tar, expected) => {
          seen.push(`${path.basename(tar)} ${expected.hash}`);
          return null;
        },
      });
      const states: string[] = [];
      u.onChange((s) => states.push(s.kind));
      expect(await u.check()).toEqual({ kind: "ready", version: "0.1.1", hash: "bbbb" });
      expect(calls).toEqual(["check", "download"]);
      expect(seen).toEqual(["bbbb.tar bbbb"]);
      // O "baixando" entre os dois é para a seção Sobre mostrar o progresso (T2386).
      expect(states).toEqual(["checking", "downloading", "ready"]);
      // Pronto: não checa de novo até alguém aplicar.
      await u.check();
      expect(calls).toEqual(["check", "download"]);
    }));

  test("um tar que não confere não vira oferta, e é apagado", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true } });
      const logs: string[] = [];
      const u = new AppUpdates({ updater, env: {}, log: (m) => logs.push(m), verify: () => "the update isn't signed by the Kiwi Init Developer ID" });
      expect(await u.check()).toEqual({ kind: "idle" });
      expect(existsSync(path.join(appData, "self-extraction", "bbbb.tar"))).toBe(false);
      expect(logs.at(-1)).toContain("refused update 0.1.1 (bbbb)");
    }));

  test("o registro 2 (Electrobun 2026.11.5): confere a pasta preparada e oferece (#29720)", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData, record: 2, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true } });
      const seen: string[] = [];
      const u = new AppUpdates({
        updater,
        env: {},
        log: () => {},
        verify: (prepared, expected) => {
          seen.push(`${path.basename(prepared)} ${expected.hash}`);
          return null;
        },
      });
      expect(await u.check()).toEqual({ kind: "ready", version: "0.1.1", hash: "bbbb" });
      expect(seen).toEqual(["Kiwi Notes.app.prepared-bbbb bbbb"]);
    }));

  test("o registro 2 que não confere: não vira oferta, e a pasta preparada é apagada", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData, record: 2, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true } });
      const logs: string[] = [];
      const u = new AppUpdates({ updater, env: {}, log: (m) => logs.push(m), verify: () => "the update isn't signed by the Kiwi Init Developer ID" });
      expect(await u.check()).toEqual({ kind: "idle" });
      expect(existsSync(path.join(appData, "Kiwi Notes.app.prepared-bbbb"))).toBe(false);
      expect(logs.at(-1)).toContain("refused update 0.1.1 (bbbb): the update isn't signed");
    }));

  test("o registro 2 com a conferência de verdade: o motivo é a assinatura, nunca 'não achou' (#29720)", () =>
    withDir(async (appData) => {
      const app = makeApp(path.join(appData, "src"), { hash: "bbbb" }).replace(/bbbb\.tar$/, "stage/Kiwi Notes.app");
      const { updater } = fakeUpdater({
        appData,
        record: 2,
        found: { version: "0.1.1", hash: "bbbb", updateAvailable: true },
        stage: (dir) => spawnSync("ditto", [app, dir]),
      });
      const logs: string[] = [];
      const u = new AppUpdates({ updater, env: {}, log: (m) => logs.push(m) });
      expect(await u.check()).toEqual({ kind: "idle" });
      // Ad hoc: chega até o codesign e é barrado pelo Developer ID. Antes, parava em "the downloaded update wasn't found".
      expect(logs.at(-1)).toContain("isn't signed by the Kiwi Init Developer ID");
      expect(logs.at(-1)).not.toContain("wasn't found");
    }));

  test("o check ou o download que falha fica parado e loga, sem lançar", () =>
    withDir(async (appData) => {
      const logs: string[] = [];
      const broken = fakeUpdater({ appData, found: { error: "HTTP 404" } });
      expect(await new AppUpdates({ updater: broken.updater, env: {}, log: (m) => logs.push(m) }).check()).toEqual({ kind: "idle" });
      expect(logs).toEqual(["check failed: HTTP 404"]);

      const dl = fakeUpdater({ appData, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true }, downloadOk: false });
      expect(await new AppUpdates({ updater: dl.updater, env: {}, log: (m) => logs.push(m), verify: () => null }).check()).toEqual({ kind: "idle" });
      expect(logs.at(-1)).toContain("download failed: Failed to download update: HTTP 404");

      const throws = fakeUpdater({ appData });
      throws.updater.checkForUpdate = async () => {
        throw new Error("offline");
      };
      expect(await new AppUpdates({ updater: throws.updater, env: {}, log: (m) => logs.push(m) }).check()).toEqual({ kind: "idle" });
      expect(logs.at(-1)).toBe("check failed: offline");
    }));

  test("uma versão mais velha ou igual não vira oferta, nem baixa (downgrade, #2057)", () =>
    withDir(async (appData) => {
      for (const version of ["0.0.9", "0.1.0", "0.1.0-rc9", "torta"]) {
        const { updater, calls } = fakeUpdater({ appData, found: { version, hash: "bbbb", updateAvailable: true } });
        const logs: string[] = [];
        expect(await new AppUpdates({ updater, env: {}, log: (m) => logs.push(m), verify: () => null }).check()).toEqual({ kind: "idle" });
        expect(calls).toEqual(["check"]);
        expect(logs).toEqual([`skipped update ${version} (bbbb): not newer than 0.1.0`]);
      }
    }));

  test("compareVersions: o semver das tags, com rc antes da final e números como números", () => {
    expect(compareVersions("0.1.0-rc3", "0.1.0-rc2")).toBe(1);
    expect(compareVersions("0.1.0-rc10", "0.1.0-rc9")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0-rc10")).toBe(1);
    expect(compareVersions("0.1.0-rc3", "0.1.0")).toBe(-1);
    expect(compareVersions("0.2.1-rc1", "0.2.0")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("compareVersions: os releases ANO.MÊS.N (spec #13879), e quem tem a rc19 recebe a 2026.11.1", () => {
    expect(compareVersions("2026.11.1", "0.1.0-rc19")).toBe(1);
    expect(compareVersions("0.1.0-rc19", "2026.11.1")).toBe(-1);
    expect(compareVersions("2026.11.2", "2026.11.1")).toBe(1);
    expect(compareVersions("2026.11.10", "2026.11.9")).toBe(1);
    expect(compareVersions("2026.12.1", "2026.11.21")).toBe(1);
    expect(compareVersions("2027.1.1", "2026.12.9")).toBe(1);
    expect(compareVersions("2026.11.1", "2026.11.1")).toBe(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.11")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0", "1.0.0")).toBeNull();
    expect(compareVersions("", "1.0.0")).toBeNull();
  });

  test("duas checagens juntas viram uma", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData });
      const u = new AppUpdates({ updater, env: {}, log: () => {} });
      await Promise.all([u.check(), u.check()]);
      expect(calls).toEqual(["check"]);
    }));

  test("desligado (KIWI_DEBUG, dev, sem baseUrl): o start nem agenda checagem", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData });
      const u = new AppUpdates({ updater, env: { KIWI_DEBUG: "1" }, log: () => {} });
      await u.start(0, 0);
      await Bun.sleep(20);
      expect(u.status()).toEqual({ kind: "off", reason: "KIWI_DEBUG=1" });
      expect(calls).toEqual([]);
      expect(await u.check()).toEqual({ kind: "off", reason: "KIWI_DEBUG=1" });
    }));

  test("aplicar: só com a oferta pronta; se o Updater não sair, a oferta volta ao menu", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true } });
      const logs: string[] = [];
      const u = new AppUpdates({ updater, env: {}, log: (m) => logs.push(m), verify: () => null });
      await u.apply();
      expect(calls).toEqual([]);
      await u.check();
      const states: string[] = [];
      u.onChange((s) => states.push(s.kind));
      await u.apply();
      expect(calls).toEqual(["check", "download", "apply"]);
      expect(states).toEqual(["applying", "ready"]);
      expect(logs.at(-1)).toBe("update didn't restart the app: Update restart was cancelled");
    }));
});

describe("preparedUpdate e updateMenuLabel", () => {
  const record = (dir: string, rec: unknown) =>
    writeFileSync(path.join(dir, "self-extraction", ".electrobun-prepared-update.json"), JSON.stringify(rec));

  test("o registro 1: o tar só vale se o registro é do mesmo hash", () =>
    withDir(async (dir) => {
      expect(preparedUpdate(dir, "bbbb")).toBeNull();
      mkdirSync(path.join(dir, "self-extraction"));
      record(dir, { hash: "bbbb", retained_tar_path: "/x/bbbb.tar" });
      expect(preparedUpdate(dir, "bbbb")).toBe("/x/bbbb.tar");
      expect(preparedUpdate(dir, "cccc")).toBeNull();
      record(dir, { schema_version: 1, hash: "bbbb", retained_tar_path: "" });
      expect(preparedUpdate(dir, "bbbb")).toBeNull();
    }));

  test("o registro 2 (Electrobun 2026.11.5): a pasta preparada, do mesmo hash (#29720)", () =>
    withDir(async (dir) => {
      mkdirSync(path.join(dir, "self-extraction"));
      const v2 = v2Record(dir, "bbbb");
      record(dir, v2);
      expect(preparedUpdate(dir, "bbbb")).toBe(path.join(dir, "Kiwi Notes.app.prepared-bbbb"));
      expect(preparedUpdate(dir, "cccc")).toBeNull();
      // Uma pasta que não é a do hash, um caminho relativo ou sem o campo: nada.
      record(dir, { ...v2, staging_path: path.join(dir, "Kiwi Notes.app.prepared-cccc") });
      expect(preparedUpdate(dir, "bbbb")).toBeNull();
      record(dir, { ...v2, staging_path: "Kiwi Notes.app.prepared-bbbb" });
      expect(preparedUpdate(dir, "bbbb")).toBeNull();
      const { staging_path: _, ...semPasta } = v2;
      record(dir, semPasta);
      expect(preparedUpdate(dir, "bbbb")).toBeNull();
    }));

  test("o menu", () => {
    expect(updateMenuLabel({ kind: "idle" }, "0.1.0")).toBeNull();
    expect(updateMenuLabel({ kind: "off", reason: "x" }, "0.1.0")).toBeNull();
    expect(updateMenuLabel({ kind: "ready", version: "0.1.1", hash: "b" }, "0.1.0")).toBe("Atualizar e reiniciar (v0.1.1)");
    // As rc têm a mesma versão do package.json: o hash é que muda.
    expect(updateMenuLabel({ kind: "ready", version: "0.1.0", hash: "b" }, "0.1.0")).toBe("Atualizar e reiniciar");
    expect(updateMenuLabel({ kind: "applying" }, "0.1.0")).toBe("Atualizando…");
  });
});

/** Um .app de mentira de verdade: Info.plist, version.json e um executável, assinado ad hoc. */
function makeApp(root: string, opts: { id?: string; hash?: string } = {}): string {
  const app = path.join(root, "stage", "Kiwi Notes.app");
  mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
  const id = opts.id ?? "app.kiwinotes.desktop";
  writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleExecutable</key><string>launcher</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
  );
  writeFileSync(path.join(app, "Contents", "Resources", "version.json"), JSON.stringify({ identifier: id, hash: opts.hash ?? "bbbb" }));
  copyFileSync("/usr/bin/true", path.join(app, "Contents", "MacOS", "launcher"));
  const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", app], { encoding: "utf8" });
  if (sign.status !== 0) throw new Error(sign.stderr);
  const tar = path.join(root, "bbbb.tar");
  const t = spawnSync("tar", ["-cf", tar, "-C", path.join(root, "stage"), "Kiwi Notes.app"], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (t.status !== 0) throw new Error(t.stderr);
  return tar;
}

describe("verifyUpdateTar (T1969): só aplica o que a Kiwi Init assinou", () => {
  test("ad hoc não passa: o selo confere, mas não é o Developer ID", () =>
    withDir(async (dir) => {
      const tar = makeApp(dir);
      const why = verifyUpdateTar(tar, { hash: "bbbb" });
      expect(why).toContain("isn't signed by the Kiwi Init Developer ID");
      // Barrado pelo requisito, não por erro de sintaxe dele.
      expect(why).toContain("failed to satisfy specified code requirement");
      expect(why).not.toContain("syntax");
      // Nenhuma pasta temporária fica para trás.
      expect(readdirSync(tmpdir()).filter((n) => n.startsWith("kiwinotes-update-"))).toEqual([]);
    }));

  test("o hash do manifesto, o identificador e o tar em si", () =>
    withDir(async (dir) => {
      const tar = makeApp(dir);
      expect(verifyUpdateTar(tar, { hash: "cccc" })).toBe("the update's hash is bbbb, the manifest said cccc");
      expect(verifyUpdateTar(tar, { hash: "bbbb", identifier: "com.outro.app" })).toBe("the update is app.kiwinotes.desktop, not com.outro.app");
      writeFileSync(path.join(dir, "lixo.tar"), "não é tar");
      expect(verifyUpdateTar(path.join(dir, "lixo.tar"), { hash: "bbbb" })).toContain("doesn't open");
      expect(verifyUpdateTar(path.join(dir, "nada.tar"), { hash: "bbbb" })).toContain("no update archive");
    }));

  test("o requisito pede a Apple, o identificador e o time", () => {
    expect(requirement("app.kiwinotes.desktop", "57249C654W")).toBe(
      'anchor apple generic and identifier "app.kiwinotes.desktop" and certificate leaf[subject.OU] = "57249C654W"',
    );
  });

  test("com o requisito de um ad hoc (só o identificador), o mesmo app passa: o que barra é a assinatura", () =>
    withDir(async (dir) => {
      const tar = makeApp(dir);
      const run = (cmd: string, args: string[]) => {
        const swapped = args.map((a) => (a.startsWith("=anchor") ? '=identifier "app.kiwinotes.desktop"' : a));
        const r = spawnSync(cmd, swapped, { encoding: "utf8" });
        return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
      };
      expect(verifyUpdateTar(tar, { hash: "bbbb" }, run)).toBeNull();
    }));
});

describe("a última checagem, para a seção Sobre (T2386)", () => {
  const now = () => new Date("2026-11-04T12:00:00Z");
  const at = "2026-11-04T12:00:00.000Z";

  test("na última versão", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData });
      const u = new AppUpdates({ updater, now, log: () => {} });
      expect(u.lastCheck()).toBeNull();
      await u.check();
      expect(u.lastCheck()).toEqual({ at, result: "latest" });
      expect(updatesView(u.status(), u.lastCheck())).toEqual({ state: "idle", lastCheck: { at, result: "latest" } });
    }));

  test("com versão nova: passa por baixando, fica pronta e registra a versão", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData, found: { version: "0.2.0", hash: "bbbb", updateAvailable: true } });
      const u = new AppUpdates({ updater, now, log: () => {}, verify: () => null });
      const states: string[] = [];
      u.onChange((s) => states.push(s.kind));
      await u.check();
      expect(states).toEqual(["checking", "downloading", "ready"]);
      expect(u.lastCheck()).toEqual({ at, result: "available", version: "0.2.0" });
      expect(updatesView(u.status(), u.lastCheck())).toMatchObject({ state: "ready", version: "0.2.0" });
    }));

  test("os erros, ditos para a pessoa", () =>
    withDir(async (appData) => {
      const offline = new AppUpdates({ updater: fakeUpdater({ appData, found: { error: "Unable to connect. Is the computer able to access the url?" } }).updater, now, log: () => {} });
      await offline.check();
      expect(offline.lastCheck()).toEqual({ at, result: "error", message: "Sem internet: não deu para falar com o GitHub." });

      const refused = new AppUpdates({
        updater: fakeUpdater({ appData, found: { version: "0.2.0", hash: "cccc", updateAvailable: true } }).updater,
        now,
        log: () => {},
        verify: () => "not signed by the Kiwi Init Developer ID",
      });
      await refused.check();
      expect(refused.lastCheck()).toEqual({ at, result: "error", message: "A 0.2.0 foi recusada: a assinatura não confere." });
      expect(refused.status().kind).toBe("idle");

      const download = new AppUpdates({
        updater: fakeUpdater({ appData, downloadOk: false, found: { version: "0.2.0", hash: "dddd", updateAvailable: true } }).updater,
        now,
        log: () => {},
      });
      await download.check();
      expect(download.lastCheck()).toMatchObject({ result: "error", message: "O download da 0.2.0 falhou. Tente de novo." });
    }));

  test("uma exceção da rede também vira erro dito, e não trava", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData });
      updater.checkForUpdate = async () => {
        throw new Error("getaddrinfo ENOTFOUND github.com");
      };
      const u = new AppUpdates({ updater, now, log: () => {} });
      expect((await u.check()).kind).toBe("idle");
      expect(u.lastCheck()).toMatchObject({ result: "error", message: "Sem internet: não deu para falar com o GitHub." });
    }));

  test("T29006: o erro guardado sai na língua de quem lê, também depois da troca", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData });
      updater.checkForUpdate = async () => {
        throw new Error("getaddrinfo ENOTFOUND github.com");
      };
      const u = new AppUpdates({ updater, now, log: () => {} });
      await u.check();
      expect(u.lastCheck("en")).toMatchObject({ result: "error", message: "No internet: couldn't reach GitHub." });
      expect(u.lastCheck("pt")).toMatchObject({ result: "error", message: "Sem internet: não deu para falar com o GitHub." });
      expect(updateMessageText(swapFailedMessage("0.2.0"), "en")).toBe(
        "Version 0.2.0 was downloaded, but the app couldn't be replaced. Try again; if it keeps failing, install from the release .dmg.",
      );
      expect(updatesView({ kind: "off", reason: "channel dev" }, null, "en")).toMatchObject({ state: "off", reason: "development build" });
      // O desligado pelos Ajustes é o valor do contrato, que o Sobre compara: não traduz.
      expect(offReasonText(OFF_BY_SETTING, "en")).toBe(UPDATES_OFF_BY_SETTING);
    }));

  test("as mensagens de erro e o canal", () => {
    expect(updateMessageText(checkErrorMessage("HTTP 503"))).toBe("O servidor das atualizações não respondeu. Tente de novo mais tarde.");
    expect(updateMessageText(checkErrorMessage("request timed out"))).toBe("O servidor das atualizações não respondeu. Tente de novo mais tarde.");
    expect(updateMessageText(checkErrorMessage("algo estranho"))).toBe("Não deu para verificar agora. Tente de novo mais tarde.");
    expect(channelOf("stable")).toBe("stable");
    expect(channelOf("canary")).toBe("stable");
    expect(channelOf("dev")).toBe("dev");
  });

  test("desligado aparece com o motivo", () => {
    expect(updatesView({ kind: "off", reason: "KIWI_DEBUG=1" }, null)).toEqual({ state: "off", reason: "modo de teste dos agentes", lastCheck: null });
    expect(updatesView({ kind: "off", reason: "channel dev" }, null)).toMatchObject({ reason: "build de desenvolvimento" });
    expect(updatesView({ kind: "off", reason: "no release.baseUrl in this build" }, null)).toMatchObject({ reason: "build local, sem o endereço das atualizações" });
    expect(updatesView({ kind: "off", reason: "baseUrl isn't https: http://x" }, null)).toMatchObject({ reason: "o endereço das atualizações deste build não é válido" });
  });

  test("a troca que falha (o InvalidUpdateIdentity da rc3, #2402) aparece na seção Sobre, e a oferta fica", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData, found: { version: "0.2.0", hash: "eeee", updateAvailable: true } });
      const u = new AppUpdates({ updater, now, log: () => {}, verify: () => null });
      await u.check();
      await u.apply();
      expect(u.status()).toMatchObject({ kind: "ready", version: "0.2.0" });
      expect(u.lastCheck()).toMatchObject({ result: "error" });
      expect((u.lastCheck() as { message: string }).message).toContain("não deu para trocar o app");
    }));

  test("a troca que falhou antes de abrir (o extractor reabriu a versão velha, #2423) aparece na seção Sobre", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData });
      // O Updater depois de reconciliar o result.json da troca: o erro, a versão e a oferta sem estar pronta.
      const reconciled = { version: "0.2.0", hash: "ffff", updateAvailable: true, updateReady: false, error: "Update failed: InvalidUpdateIdentity" };
      updater.updateInfo = () => reconciled;
      let onStatus: ((e: { status: string }) => void) | null = null;
      updater.onStatusChange = (cb) => void (onStatus = cb);
      const u = new AppUpdates({ updater, env: {}, now, log: () => {} });
      const views: string[] = [];
      u.onChange(() => views.push(u.lastCheck()?.result ?? "none"));
      await u.start(60_000, 60_000);
      u.stop();
      expect(u.lastCheck()).toBeNull();
      onStatus!({ status: "error" });
      await Bun.sleep(5);
      expect(u.lastCheck()).toEqual({ at, result: "error", message: "A 0.2.0 foi baixada, mas não deu para trocar o app. Tente de novo; se continuar, instale pelo .dmg do release." });
      expect(views).toEqual(["error"]); // o hub aberto ficou sabendo
      onStatus!({ status: "error" }); // uma vez só
      await Bun.sleep(5);
      expect(views).toEqual(["error"]);
    }));

  test("sem callback, a 1ª checagem pega a troca que falhou; um erro de download deste processo não vira troca", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData });
      let info = { version: "0.2.0", hash: "ffff", updateAvailable: true, updateReady: false, error: "InvalidUpdateIdentity" };
      updater.updateInfo = () => info;
      updater.checkForUpdate = async () => {
        info = { ...info, error: "", updateAvailable: false };
        return info;
      };
      const u = new AppUpdates({ updater, now, log: () => {} });
      await u.noteFailedSwap();
      expect(u.lastCheck()).toMatchObject({ result: "error" });

      // Outro processo: uma checagem já rodou, e o erro que sobra no updateInfo é de um download dele.
      const v = new AppUpdates({ updater, now, log: () => {} });
      await v.check();
      info = { ...info, error: "Failed to download update: HTTP 404", updateAvailable: true };
      await v.noteFailedSwap();
      expect(v.lastCheck()).toEqual({ at, result: "latest" });
    }));

  test("uma versão que não é mais nova que esta não vira aviso de troca", () =>
    withDir(async (appData) => {
      const { updater } = fakeUpdater({ appData });
      updater.updateInfo = () => ({ version: "0.1.0", hash: "x", updateAvailable: true, updateReady: false, error: "InvalidUpdateIdentity" });
      const u = new AppUpdates({ updater, now, log: () => {} });
      await u.noteFailedSwap();
      expect(u.lastCheck()).toBeNull();
    }));
});


describe("o progresso do download, para a faixa do Sobre (T17097, spec #16837)", () => {
  type Status = { status: string; details?: { bytesDownloaded?: number; totalBytes?: number } };
  /** O Updater de mentira com o callback de status do Electrobun, que manda `download-progress` enquanto baixa. */
  function withProgress(appData: string, during: Status[]) {
    const { updater } = fakeUpdater({ appData, found: { version: "0.2.0", hash: "bbbb", updateAvailable: true } });
    let onStatus: ((e: Status) => void) | null = null;
    updater.onStatusChange = (cb) => void (onStatus = cb);
    const download = updater.downloadUpdate;
    const seen: unknown[] = [];
    updater.downloadUpdate = async () => {
      for (const e of during) {
        onStatus!(e);
        seen.push(updatesView(u.status(), null));
      }
      await download();
    };
    const u = new AppUpdates({ updater, env: {}, log: () => {}, verify: () => null });
    return { u, seen, status: (e: Status) => onStatus!(e) };
  }

  test("o downloading leva done e total em bytes, e a oferta pronta não leva", () =>
    withDir(async (appData) => {
      const { u, seen } = withProgress(appData, [
        { status: "downloading-full-bundle" },
        { status: "download-progress", details: { bytesDownloaded: 1_048_576, totalBytes: 41_943_040 } },
        { status: "download-progress", details: { bytesDownloaded: 20_971_520, totalBytes: 41_943_040 } },
        // O último aviso do Electrobun pode vir sem o total: fica o que já se sabia.
        { status: "download-progress", details: { bytesDownloaded: 41_943_040 } },
      ]);
      await u.start(60_000, 60_000);
      u.stop();
      await u.check();
      expect(seen).toEqual([
        { lastCheck: null, state: "downloading", version: "0.2.0" },
        { lastCheck: null, state: "downloading", version: "0.2.0", done: 1_048_576, total: 41_943_040 },
        { lastCheck: null, state: "downloading", version: "0.2.0", done: 20_971_520, total: 41_943_040 },
        { lastCheck: null, state: "downloading", version: "0.2.0", done: 41_943_040, total: 41_943_040 },
      ]);
      expect(updatesView(u.status(), null)).toEqual({ lastCheck: null, state: "ready", version: "0.2.0" });
    }));

  test("número inválido, ou progresso fora do download, não mexe no estado", () =>
    withDir(async (appData) => {
      const { u, seen, status } = withProgress(appData, [
        { status: "download-progress", details: { bytesDownloaded: Number.NaN, totalBytes: 100 } },
        { status: "download-progress", details: { bytesDownloaded: -1, totalBytes: 100 } },
        { status: "download-progress", details: {} },
        { status: "download-progress" },
        // Um total 0 não vale: a barra fica indeterminada.
        { status: "download-progress", details: { bytesDownloaded: 10, totalBytes: 0 } },
        // Mais baixado que o total: o total sobe junto, para a barra nunca passar de cheia.
        { status: "download-progress", details: { bytesDownloaded: 150, totalBytes: 100 } },
      ]);
      await u.start(60_000, 60_000);
      u.stop();
      status({ status: "download-progress", details: { bytesDownloaded: 5, totalBytes: 10 } }); // antes de baixar
      expect(u.status()).toEqual({ kind: "idle" });
      await u.check();
      const plain = { lastCheck: null, state: "downloading", version: "0.2.0" };
      expect(seen).toEqual([plain, plain, plain, plain, { ...plain, done: 10 }, { ...plain, done: 150, total: 150 }]);
      status({ status: "download-progress", details: { bytesDownloaded: 5, totalBytes: 10 } }); // depois de pronta
      expect(u.status()).toMatchObject({ kind: "ready", version: "0.2.0" });
    }));
});

describe("Buscar atualizações desligado em Ajustes (T25110)", () => {
  test("desligado, nenhuma checagem vai à rede, nem a do relógio; ligar vale na próxima, sem reiniciar", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData });
      let on = false;
      const u = new AppUpdates({ updater, env: {}, log: () => {}, enabled: async () => on });
      await u.start(0, 5);
      await Bun.sleep(60);
      expect(calls).toEqual([]);
      expect(u.status()).toEqual({ kind: "off", reason: OFF_BY_SETTING });
      // O "Verificar atualizações" também não sai.
      expect(await u.check()).toEqual({ kind: "off", reason: OFF_BY_SETTING });
      expect(calls).toEqual([]);
      on = true;
      await Bun.sleep(60);
      u.stop();
      expect(calls.length).toBeGreaterThan(0);
      expect(new Set(calls)).toEqual(new Set(["check"]));
      expect(u.status()).toEqual({ kind: "idle" });
    }));

  test("o interruptor muda a faixa na hora, sem checar; o desligado do build não volta por ele", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData });
      const u = new AppUpdates({ updater, env: {}, log: () => {} });
      u.settingChanged(false);
      expect(u.status()).toEqual({ kind: "off", reason: OFF_BY_SETTING });
      expect(updatesView(u.status(), null)).toEqual({ state: "off", reason: UPDATES_OFF_BY_SETTING, lastCheck: null });
      u.settingChanged(true);
      expect(u.status()).toEqual({ kind: "idle" });
      expect(calls).toEqual([]);

      const debug = new AppUpdates({ updater, env: { KIWI_DEBUG: "1" }, log: () => {} });
      await debug.start(0, 0);
      debug.settingChanged(true);
      expect(debug.status()).toEqual({ kind: "off", reason: "KIWI_DEBUG=1" });
      expect(calls).toEqual([]);
    }));

  test("uma versão já baixada e conferida segue no menu com ele desligado (o clique não busca nada)", () =>
    withDir(async (appData) => {
      const { updater, calls } = fakeUpdater({ appData, found: { version: "0.1.1", hash: "bbbb", updateAvailable: true } });
      let on = true;
      const u = new AppUpdates({ updater, env: {}, log: () => {}, verify: () => null, enabled: () => on });
      await u.check();
      on = false;
      u.settingChanged(false);
      expect(await u.check()).toEqual({ kind: "ready", version: "0.1.1", hash: "bbbb" });
      expect(calls).toEqual(["check", "download"]);
    }));
});

describe("verifyPrepared: a pasta preparada do Electrobun 2026.11.5 ou o tar (#29720)", () => {
  /** O codesign com o requisito de um ad hoc (só o identificador), como no teste do tar. */
  const adHoc = (cmd: string, args: string[]) => {
    const swapped = args.map((a) => (a.startsWith("=anchor") ? '=identifier "app.kiwinotes.desktop"' : a));
    const r = spawnSync(cmd, swapped, { encoding: "utf8" });
    return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  };
  /** O app de `makeApp` copiado para `<app>.prepared-bbbb`, como o Electrobun deixa. */
  const staged = (dir: string) => {
    makeApp(dir);
    const stage = path.join(dir, "Kiwi Notes.app.prepared-bbbb");
    spawnSync("ditto", [path.join(dir, "stage", "Kiwi Notes.app"), stage]);
    return stage;
  };

  test("a pasta preparada passa pelas mesmas conferências do app", () =>
    withDir(async (dir) => {
      const stage = staged(dir);
      expect(verifyPrepared(stage, { hash: "bbbb" }, adHoc)).toBeNull();
      // Sem trocar o requisito: o ad hoc é barrado pelo Developer ID, não por não achar o app.
      expect(verifyPrepared(stage, { hash: "bbbb" })).toContain("isn't signed by the Kiwi Init Developer ID");
      expect(verifyPrepared(stage, { hash: "cccc" }, adHoc)).toBe("the update's hash is bbbb, the manifest said cccc");
      expect(verifyPrepared(stage, { hash: "bbbb", identifier: "com.outro.app" }, adHoc)).toBe("the update is app.kiwinotes.desktop, not com.outro.app");
    }));

  test("o tar segue pelo caminho de antes, e o que não existe é dito", () =>
    withDir(async (dir) => {
      const tar = makeApp(dir);
      expect(verifyPrepared(tar, { hash: "bbbb" }, adHoc)).toBeNull();
      expect(verifyPrepared(path.join(dir, "nada.prepared-bbbb"), { hash: "bbbb" })).toContain("isn't at");
      mkdirSync(path.join(dir, "vazia.prepared-bbbb"));
      expect(verifyPrepared(path.join(dir, "vazia.prepared-bbbb"), { hash: "bbbb" })).toBe("the update has no readable version.json");
    }));
});
