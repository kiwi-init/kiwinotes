import { describe, expect, test } from "bun:test";

import { feedUrl, updateManifest } from "./update-feed.ts";

describe("update-feed (T1969)", () => {
  test("o feed vem do tag: final no latest, rc no updates-rc, ensaio sem feed", () => {
    expect(feedUrl("v0.2.0", "kiwi-init/kiwinotes")).toBe("https://github.com/kiwi-init/kiwinotes/releases/latest/download");
    expect(feedUrl("v0.1.0-rc2", "kiwi-init/kiwinotes")).toBe("https://github.com/kiwi-init/kiwinotes/releases/download/updates-rc");
    expect(feedUrl("main", "kiwi-init/kiwinotes")).toBe("");
    expect(feedUrl("", "kiwi-init/kiwinotes")).toBe("");
    expect(feedUrl("updates-rc", "kiwi-init/kiwinotes")).toBe("");
    expect(() => feedUrl("v1.0.0", "kiwi-init/kiwinotes/../x")).toThrow("isn't owner/repo");
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
