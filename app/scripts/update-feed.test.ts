import { describe, expect, test } from "bun:test";

import { feedUrl, isReleaseTag, nextTag, releaseName, tagVersion, updateManifest } from "./update-feed.ts";

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
