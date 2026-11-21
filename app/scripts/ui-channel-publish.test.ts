import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateSigningKey, readUipack, verifyManifest } from "../.hutch/devkit/api/sdks/main/appengine/format.ts";
import {
  channelUiVersion,
  contractError,
  keyError,
  manifestAssetName,
  publishChannel,
  staleError,
} from "./ui-channel-publish.ts";

const BASE = "https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel";
// 2026-11-21 12:00:00 UTC e uma hora depois.
const T1 = Date.UTC(2026, 10, 21, 12, 0, 0) / 1000;
const T2 = T1 + 3600;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(path.join(tmpdir(), "kiwinotes-ui-channel-test-"));
  dirs.push(d);
  return d;
}

/** Um dist/ de mentira, como o ui-build.ts deixa: o index.html e o ui.json de fábrica. */
function fakeDist(windows: string[], text = "<p>exemplo</p>") {
  const dist = tmp();
  for (const w of windows) {
    mkdirSync(path.join(dist, w), { recursive: true });
    writeFileSync(path.join(dist, w, "index.html"), `<!doctype html><main id="${w}">${text}</main>`);
    writeFileSync(path.join(dist, w, "ui.json"), JSON.stringify({ uiVersion: "2026.11.9", requiresContract: "^1.0.0", dataSchema: 1, seq: 1 }));
  }
  return dist;
}

function keyed() {
  const k = generateSigningKey();
  return { pem: k.privateKeyPem, trusted: { [k.keyId]: k.publicKey } };
}

describe("o contrato da UI contra o do app publicado (spec #25011)", () => {
  test("igual ou mais velho passa; mais novo ou de outra major só com release", () => {
    expect(contractError("1.95.0", "1.95.0")).toBeNull();
    expect(contractError("1.94.3", "1.95.0")).toBeNull();
    expect(contractError("1.96.0", "1.95.0")).toContain("only ships with a release");
    expect(contractError("1.95.1", "1.95.0")).toContain("only ships with a release");
    expect(contractError("2.0.0", "1.95.0")).toContain("major");
    expect(() => contractError("1.95", "1.95.0")).toThrow();
  });
});

describe("a UI do canal anda só para a frente", () => {
  test("o uiVersion leva a hora do commit, e um commit igual ou mais velho é recusado", () => {
    const a = channelUiVersion("2026.11.9", T1);
    const b = channelUiVersion("2026.11.9", T2);
    expect(a).toBe("2026.11.9-ui.20261121120000");
    expect(staleError(b, a)).toBeNull();
    expect(staleError(a, a)).toContain("isn't newer");
    expect(staleError(a, b)).toContain("isn't newer");
    // A primeira publicação, e um canal que só tinha uma UI de outro formato.
    expect(staleError(a, null)).toBeNull();
    expect(staleError(a, "0.1.0-local.2")).toBeNull();
  });
});

describe("a chave", () => {
  test("só uma chave de ui-keys.ts assina, e o erro não mostra a chave", () => {
    const { pem, trusted } = keyed();
    expect(keyError(pem, trusted)).toBeNull();
    const other = generateSigningKey();
    const problem = keyError(other.privateKeyPem, trusted);
    expect(problem).toContain(`the signing key ${other.keyId} isn't in`);
    expect(problem).not.toContain("PRIVATE");
    expect(keyError("não é pem", trusted)).toContain("isn't an Ed25519");
  });
});

describe("publishChannel", () => {
  test("cada janela sai assinada, num nível só, com o bundleUrl absoluto e o contrato do commit", async () => {
    const { pem, trusted } = keyed();
    const out = tmp();
    const published = await publishChannel({
      distDir: fakeDist(["settings", "hub"]),
      outDir: out,
      privateKeyPem: pem,
      trusted,
      windows: ["settings", "hub"],
      uiContract: "1.95.0",
      appContract: "1.95.0",
      appVersion: "2026.11.9",
      sourceTimeSec: T1,
      baseUrl: BASE,
    });
    expect(published.map((p) => p.window)).toEqual(["settings", "hub"]);
    const files = readdirSync(out).sort();
    expect(files.filter((f) => f.endsWith(".manifest.json"))).toEqual(["hub.manifest.json", "settings.manifest.json"]);
    expect(files.filter((f) => f.endsWith(".uipack"))).toHaveLength(2);
    for (const w of ["settings", "hub"] as const) {
      const raw = JSON.parse(readFileSync(path.join(out, manifestAssetName(w)), "utf8"));
      const v = verifyManifest(raw, trusted);
      expect(v.ok).toBe(true);
      if (!v.ok) continue;
      expect(v.value.uiVersion).toBe("2026.11.9-ui.20261121120000");
      expect(v.value.requiresContract).toBe("^1.95.0");
      expect(v.value.bundleUrl.startsWith(`${BASE}/`)).toBe(true);
      const bundle = path.join(out, path.basename(v.value.bundleUrl));
      const pack = readUipack(new Uint8Array(readFileSync(bundle)), { sha256: v.value.sha256, uiVersion: v.value.uiVersion });
      expect(pack.ok).toBe(true);
    }
  });

  test("a segunda publicação sobe o seq; a de um commit velho não sai, nem em parte", async () => {
    const { pem, trusted } = keyed();
    const channel = tmp();
    const common = {
      privateKeyPem: pem,
      trusted,
      windows: ["settings", "hub"] as const,
      uiContract: "1.95.0",
      appContract: "1.95.0",
      appVersion: "2026.11.9",
      baseUrl: BASE,
      previousBase: channel,
    };
    const first = await publishChannel({ ...common, distDir: fakeDist(["settings", "hub"]), outDir: channel, sourceTimeSec: T1 });
    const second = await publishChannel({ ...common, distDir: fakeDist(["settings", "hub"], "<p>nova</p>"), outDir: channel, sourceTimeSec: T2 });
    expect(second[0]!.seq).toBeGreaterThan(first[0]!.seq);

    const before = readdirSync(channel).sort();
    const stale = tmp();
    await expect(
      publishChannel({ ...common, distDir: fakeDist(["settings", "hub"], "<p>velha</p>"), outDir: stale, sourceTimeSec: T1 }),
    ).rejects.toThrow("isn't newer");
    expect(readdirSync(stale)).toEqual([]);
    expect(readdirSync(channel).sort()).toEqual(before);
  });

  test("contrato mais novo que o do app, ou chave de fora: nada é escrito", async () => {
    const { pem, trusted } = keyed();
    const base = {
      distDir: fakeDist(["settings"]),
      privateKeyPem: pem,
      trusted,
      windows: ["settings"] as const,
      appVersion: "2026.11.9",
      sourceTimeSec: T1,
      baseUrl: BASE,
    };
    const a = tmp();
    await expect(publishChannel({ ...base, outDir: a, uiContract: "1.96.0", appContract: "1.95.0" })).rejects.toThrow("only ships with a release");
    expect(readdirSync(a)).toEqual([]);
    const b = tmp();
    const other = generateSigningKey();
    await expect(
      publishChannel({ ...base, outDir: b, uiContract: "1.95.0", appContract: "1.95.0", privateKeyPem: other.privateKeyPem }),
    ).rejects.toThrow("isn't in src/bun/ui-keys.ts");
    expect(readdirSync(b)).toEqual([]);
  });
});
