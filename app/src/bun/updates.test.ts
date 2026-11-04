import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AppUpdates,
  preparedTar,
  requirement,
  updateMenuLabel,
  updatesOff,
  verifyUpdateTar,
  type LocalInfo,
  type UpdateCheck,
  type UpdaterApi,
} from "./updates.ts";

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

/** Um Updater de mentira: o que o check acha, se o download dá certo, e o registro do Electrobun no disco. */
function fakeUpdater(opts: { found?: Partial<UpdateCheck>; downloadOk?: boolean; appData: string; applyExits?: boolean }) {
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
      const tar = path.join(dir, `${info.hash}.tar`);
      writeFileSync(tar, "tar");
      writeFileSync(path.join(dir, ".electrobun-prepared-update.json"), JSON.stringify({ hash: info.hash, retained_tar_path: tar }));
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
  const dir = mkdtempSync(path.join(tmpdir(), "kn-updates-"));
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
      expect(states).toEqual(["checking", "ready"]);
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

describe("preparedTar e updateMenuLabel", () => {
  test("o tar só vale se o registro é do mesmo hash", () =>
    withDir(async (dir) => {
      expect(preparedTar(dir, "bbbb")).toBeNull();
      mkdirSync(path.join(dir, "self-extraction"));
      writeFileSync(path.join(dir, "self-extraction", ".electrobun-prepared-update.json"), JSON.stringify({ hash: "bbbb", retained_tar_path: "/x/bbbb.tar" }));
      expect(preparedTar(dir, "bbbb")).toBe("/x/bbbb.tar");
      expect(preparedTar(dir, "cccc")).toBeNull();
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
