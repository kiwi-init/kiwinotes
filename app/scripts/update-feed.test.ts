import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { feedUrl, isReleaseTag, nextTag, releaseName, stampVersion, tagVersion, updateManifest } from "./update-feed.ts";

describe("update-feed (T1969)", () => {
  test("o tag de um release é vANO.MÊS.N (spec #13879); rc e semver não são mais", () => {
    for (const t of ["v2026.11.1", "v2026.11.21", "v2026.1.3", "v2027.12.10"]) expect(isReleaseTag(t)).toBe(true);
    for (const t of ["v0.1.0-rc19", "v0.2.0", "v2026.11.0", "v2026.13.1", "v2026.011.1", "v2026.11.01", "2026.11.1", "v2026.11.1-rc1", "updates-rc", "arte-v1", "main", ""]) {
      expect(isReleaseTag(t)).toBe(false);
    }
  });

  test("o feed vem do tag: um release lê o latest; um ensaio ou outro tag fica sem feed", () => {
    expect(feedUrl("v2026.11.1", "kiwi-init/kiwinotes")).toBe("https://github.com/kiwi-init/kiwinotes/releases/latest/download");
    expect(feedUrl("v0.1.0-rc2", "kiwi-init/kiwinotes")).toBe("");
    expect(feedUrl("main", "kiwi-init/kiwinotes")).toBe("");
    expect(feedUrl("", "kiwi-init/kiwinotes")).toBe("");
    expect(feedUrl("updates-rc", "kiwi-init/kiwinotes")).toBe("");
    expect(() => feedUrl("v2026.11.1", "kiwi-init/kiwinotes/../x")).toThrow("isn't owner/repo");
  });

  test("a versão do build e o nome do release vêm do tag", () => {
    expect(tagVersion("v2026.11.1")).toBe("2026.11.1");
    expect(tagVersion("v0.1.0-rc3")).toBe("");
    expect(tagVersion("main")).toBe("");
    expect(releaseName("v2026.11.1")).toBe("Kiwi Notes 2026.11.1");
    expect(() => releaseName("v0.1.0-rc19")).toThrow("isn't vANO.MÊS.N");
  });

  test("o próximo tag conta os releases do mês", () => {
    const tags = ["v0.1.0-rc18", "v0.1.0-rc19", "updates-rc", "arte-v1"];
    expect(nextTag("2026-11", tags)).toBe("v2026.11.1");
    expect(nextTag("2026-11", [...tags, "v2026.11.1", "v2026.11.2"])).toBe("v2026.11.3");
    expect(nextTag("2026-11", ["v2026.11.9", "v2026.11.10"])).toBe("v2026.11.11");
    expect(nextTag("2026-12", ["v2026.11.21"])).toBe("v2026.12.1");
    expect(nextTag("2027-01", ["v2026.12.4"])).toBe("v2027.1.1");
    expect(() => nextTag("2026-13", [])).toThrow("isn't AAAA-MM");
  });

  test("o build do tag escreve a versão dele no package.json (spec #29579): só o campo version muda", async () => {
    const pkg = '{\n  "name": "exemplo",\n  "version": "2026.11.3",\n  "scripts": { "version": "echo nao" }\n}\n';
    const out = stampVersion(pkg, "v2026.12.1");
    expect(JSON.parse(out).version).toBe("2026.12.1");
    expect(JSON.parse(out).scripts.version).toBe("echo nao");
    expect(out).toBe(pkg.replace('"version": "2026.11.3"', '"version": "2026.12.1"'));
    // O package.json de verdade do app: o carimbo pega, e a versão do tag passa a ser a do app.
    const real = await Bun.file(new URL("../package.json", import.meta.url)).text();
    expect(JSON.parse(stampVersion(real, "v2027.1.1")).version).toBe("2027.1.1");
    expect(() => stampVersion(pkg, "v0.1.0-rc19")).toThrow("isn't vANO.MÊS.N");
    expect(() => stampVersion('{ "name": "exemplo" }', "v2026.12.1")).toThrow('no "version"');
  });

  test("a CLI stamp grava o package.json", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "stamp-")), "package.json");
    await Bun.write(file, '{\n  "name": "exemplo",\n  "version": "2026.11.3"\n}\n');
    const r = Bun.spawnSync(["bun", new URL("./update-feed.ts", import.meta.url).pathname, "stamp", "v2026.11.4", file]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(await Bun.file(file).text()).version).toBe("2026.11.4");
  });

  const built = {
    schemaVersion: 1,
    identifier: "app.kiwinotes.desktop",
    channel: "stable",
    version: "0.1.0",
    hash: "bdgfyk01tjwx",
    platform: "macos",
    arch: "arm64",
    artifact: { file: "stable-macos-arm64-KiwiNotes.app.tar.zst" },
  };
  const app = { identifier: "app.kiwinotes.desktop", channel: "stable", version: "0.1.0", hash: "bdgfyk01tjwx", baseUrl: "https://github.com/x/y/releases/latest/download" };

  test("o manifesto confere com o app assinado", () => {
    expect(updateManifest(built, app)).toEqual(built as never);
    expect(() => updateManifest({ ...built, hash: "outro" }, app)).toThrow("hash outro, the signed app says bdgfyk01tjwx");
    expect(() => updateManifest({ ...built, identifier: "com.x" }, app)).toThrow("identifier com.x");
    expect(() => updateManifest({ ...built, channel: "canary" }, { ...app, channel: "canary" })).toThrow("channel canary, the release is stable");
    expect(() => updateManifest({ ...built, arch: "x64" }, app)).toThrow("macos/x64");
    expect(() => updateManifest({ ...built, artifact: { file: "../x.tar.zst" } }, app)).toThrow("isn't a stable-macos-arm64-*.tar.zst");
    expect(() => updateManifest({ ...built, schemaVersion: 2 }, app)).toThrow("schemaVersion 1");
  });
});
