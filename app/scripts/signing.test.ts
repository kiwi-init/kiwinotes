// T762: o app que vai no .tar.zst sai com o selo quebrado quando um recurso muda depois da assinatura (o Electrobun
// escreve o version.json depois do postBuild). Um .app de mentira, sem rodar nada: só codesign, tar e zstd.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { spawnSync } from "node:child_process";

import {
  designatedRequirement,
  detach,
  expectedRequirement,
  findIdentity,
  IDENTITY_NAME,
  keychainUnlocked,
  machOsIn,
  pack,
  parseIdentities,
  resealBundles,
  sign,
  signAdHoc,
  type SigningIdentity,
  unpack,
  verifyApp,
  verifyBundle,
  verifyRequirement,
  withDmg,
} from "./signing.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-signing-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Um "Fake.app" assinado ad hoc, com um version.json em Resources, como o do Electrobun. */
function fakeApp(root: string): string {
  const app = path.join(root, "Fake.app");
  mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
  writeFileSync(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>fake</string>
<key>CFBundleIdentifier</key><string>app.kiwinotes.test</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`);
  copyFileSync("/usr/bin/true", path.join(app, "Contents", "MacOS", "fake"));
  writeFileSync(path.join(app, "Contents", "Resources", "version.json"), `{"hash":""}`);
  signAdHoc(app);
  return app;
}

/** O que o Electrobun faz depois do postBuild: muda o version.json e compacta o app. */
function brokenBundle(): string {
  const stage = path.join(dir, "stage");
  mkdirSync(stage);
  const app = fakeApp(stage);
  writeFileSync(path.join(app, "Contents", "Resources", "version.json"), `{"hash":"3qa20nnl17ix6"}`);
  const tar = path.join(dir, "Fake.app.tar.zst");
  pack(stage, ["Fake.app"], tar);
  return tar;
}

describe("signing (T762)", () => {
  test("verifyBundle catches a resource changed after the signature", () => {
    expect(() => verifyBundle(brokenBundle())).toThrow(/version\.json/);
  });

  test("resealBundles re-signs the app inside and keeps the copies equal", () => {
    const tar = brokenBundle();
    const copy = path.join(dir, "copy.tar.zst");
    copyFileSync(tar, copy);

    expect(resealBundles([tar, copy]).sort()).toEqual([copy, tar].sort());
    expect(verifyBundle(tar)).toEqual(["Fake.app"]);
    expect(readFileSync(copy).equals(readFileSync(tar))).toBe(true);

    // The change Electrobun made is kept; only the seal is new.
    const out = path.join(dir, "out");
    mkdirSync(out);
    unpack(tar, out);
    expect(readFileSync(path.join(out, "Fake.app", "Contents", "Resources", "version.json"), "utf8")).toBe(`{"hash":"3qa20nnl17ix6"}`);
    verifyApp(path.join(out, "Fake.app"));
  });

  test("resealBundles leaves a bundle that already verifies alone", () => {
    const stage = path.join(dir, "stage");
    mkdirSync(stage);
    fakeApp(stage);
    const tar = path.join(dir, "Fake.app.tar.zst");
    pack(stage, ["Fake.app"], tar);
    const before = readFileSync(tar);

    expect(resealBundles([tar])).toEqual([]);
    expect(readFileSync(tar).equals(before)).toBe(true);
  });

  test("pack writes a plain ustar with no macOS metadata", () => {
    const tar = brokenBundle();
    const raw = Bun.zstdDecompressSync(readFileSync(tar));
    expect(new TextDecoder().decode(raw.subarray(257, 262))).toBe("ustar");
    const listed = Bun.spawnSync(["tar", "-tf", "-"], { stdin: raw }).stdout.toString().split("\n").filter(Boolean);
    expect(listed.some((n) => path.basename(n).startsWith("._"))).toBe(false);
    expect(listed).toContain("Fake.app/Contents/Resources/version.json");
  });
});

// T914: o `hdiutil detach` falhou no fim de um build bom (volume ocupado). Sem hdiutil de verdade: um `exec` falso.
describe("detach", () => {
  const busy = (failures: number) => {
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === "detach" && calls.filter((c) => c[1] === "detach").length <= failures) throw new Error("hdiutil: couldn't unmount: Resource busy");
    };
    return { calls, exec };
  };

  test("a busy volume is tried again and then detached", () => {
    const { calls, exec } = busy(2);
    const waits: number[] = [];
    expect(detach("/tmp/mnt", { exec, sleep: (ms) => waits.push(ms), warn: () => {} })).toBe(true);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);
  });

  test("a volume that never lets go warns instead of failing the build", () => {
    const { exec } = busy(99);
    const warnings: string[] = [];
    expect(detach("/tmp/mnt", { exec, tries: 3, sleep: () => {}, warn: (m) => warnings.push(m) })).toBe(false);
    expect(warnings[0]).toContain("eject it by hand");
  });

  test("withDmg returns what the check found even when the detach never works", () => {
    const { calls, exec } = busy(99);
    const result = withDmg("/tmp/fake.dmg", () => 7, { exec, tries: 2, sleep: () => {}, warn: () => {} });
    expect(result).toBe(7);
    expect(calls[0]!.slice(0, 2)).toEqual(["hdiutil", "attach"]);
  });

  test("a failing check still fails, and the volume is detached", () => {
    const { calls, exec } = busy(0);
    expect(() =>
      withDmg("/tmp/fake.dmg", () => {
        throw new Error("codesign failed");
      }, { exec, sleep: () => {}, warn: () => {} }),
    ).toThrow("codesign failed");
    expect(calls.map((c) => c[1])).toEqual(["attach", "detach"]);
  });
});

// T1074: a identidade local fixa o designated requirement, e o TCC mantém as permissões de um build para o outro.
const FIND_IDENTITY = `
Policy: Code Signing
  Matching identities
  1) 3185DA549CF30862C355F48B28B779F0DA938708 "Kiwi Notes Local Signing" (CSSMERR_TP_NOT_TRUSTED)
  2) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Fulano (X1Y2Z3)"
     2 identities found

  Valid identities only
  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Fulano (X1Y2Z3)"
     1 valid identities found
`;

describe("signing identity (T1074)", () => {
  const LOGIN = "/Users/x/Library/Keychains/login.keychain-db";
  const list = (output: string, seen: (string | undefined)[] = []) => ({
    list: (keychain?: string) => {
      seen.push(keychain);
      return output;
    },
    keychainOf: () => LOGIN,
    unlocked: () => true,
    warn: () => {},
  });

  test("parseIdentities keeps the untrusted self-signed one and lists each identity once", () => {
    expect(parseIdentities(FIND_IDENTITY)).toEqual([
      { hash: "3185DA549CF30862C355F48B28B779F0DA938708", name: IDENTITY_NAME },
      { hash: "0123456789ABCDEF0123456789ABCDEF01234567", name: "Apple Development: Fulano (X1Y2Z3)" },
    ]);
    expect(parseIdentities("\n     0 identities found\n")).toEqual([]);
  });

  test("the local identity is used when it exists, and the build is ad hoc when it doesn't", () => {
    expect(findIdentity({}, list(FIND_IDENTITY))).toEqual({ hash: "3185DA549CF30862C355F48B28B779F0DA938708", name: IDENTITY_NAME });
    expect(findIdentity({}, list("     0 identities found\n"))).toBeUndefined();
  });

  test("KIWI_SIGN_IDENTITY=- forces ad hoc, and another identity can be picked by name or SHA-1", () => {
    expect(findIdentity({ KIWI_SIGN_IDENTITY: "-" }, list(FIND_IDENTITY))).toBeUndefined();
    expect(findIdentity({ KIWI_SIGN_IDENTITY: "Apple Development: Fulano (X1Y2Z3)" }, list(FIND_IDENTITY))?.hash)
      .toBe("0123456789ABCDEF0123456789ABCDEF01234567");
    expect(findIdentity({ KIWI_SIGN_IDENTITY: "3185da549cf30862c355f48b28b779f0da938708" }, list(FIND_IDENTITY))?.name)
      .toBe(IDENTITY_NAME);
  });

  test("an identity asked for by name that isn't there fails the build instead of going ad hoc", () => {
    expect(() => findIdentity({ KIWI_SIGN_IDENTITY: "Outra" }, list(FIND_IDENTITY))).toThrow(/no code signing identity "Outra"/);
  });

  test("KIWI_SIGN_KEYCHAIN looks in that keychain and signs from it", () => {
    const seen: (string | undefined)[] = [];
    const found = findIdentity({ KIWI_SIGN_KEYCHAIN: "/tmp/k.keychain-db" }, list(FIND_IDENTITY, seen));
    expect(seen).toEqual(["/tmp/k.keychain-db"]);
    expect(found?.keychain).toBe("/tmp/k.keychain-db");
  });

  test("a locked keychain never reaches codesign: the found identity falls back to ad hoc with a warning", () => {
    const warnings: string[] = [];
    const checked: string[] = [];
    const lookup = { ...list(FIND_IDENTITY), unlocked: (k: string) => (checked.push(k), false), warn: (m: string) => warnings.push(m) };
    expect(findIdentity({}, lookup)).toBeUndefined();
    expect(checked).toEqual([LOGIN]);
    expect(warnings[0]).toContain("is locked, signing ad hoc");
  });

  test("an identity asked for by name in a locked keychain fails the build instead", () => {
    const lookup = { ...list(FIND_IDENTITY), unlocked: () => false };
    expect(() => findIdentity({ KIWI_SIGN_IDENTITY: IDENTITY_NAME }, lookup)).toThrow(/is locked; unlock it/);
  });

  test("with KIWI_SIGN_KEYCHAIN, that keychain is the one checked for the lock", () => {
    const checked: string[] = [];
    const lookup = { ...list(FIND_IDENTITY), keychainOf: () => undefined, unlocked: (k: string) => (checked.push(k), true) };
    expect(findIdentity({ KIWI_SIGN_KEYCHAIN: "/tmp/k.keychain-db" }, lookup)).toBeDefined();
    expect(checked).toEqual(["/tmp/k.keychain-db"]);
  });

  test("keychainUnlocked answers without asking: a missing keychain is just locked", () => {
    expect(keychainUnlocked(path.join(dir, "nao-existe.keychain-db"))).toBe(false);
  });

  test("the expected requirement is tied to the certificate, not to the build", () => {
    expect(expectedRequirement("app.kiwinotes.desktop", { hash: "3185DA549CF30862C355F48B28B779F0DA938708", name: IDENTITY_NAME }))
      .toBe('identifier "app.kiwinotes.desktop" and certificate leaf = H"3185da549cf30862c355f48b28b779f0da938708"');
  });

  test("an ad hoc app fails the requirement check", () => {
    const app = fakeApp(dir);
    expect(designatedRequirement(app)).toStartWith("cdhash H");
    expect(() => verifyRequirement(app, { hash: "3185DA549CF30862C355F48B28B779F0DA938708", name: IDENTITY_NAME }))
      .toThrow(/designated requirement is/);
  });
});

// Com um keychain de verdade (temporário, fora da lista de busca, sem diálogo): só com KIWI_SIGN_KEYCHAIN_TEST=1,
// para nenhum `bun test` criar keychain na máquina de alguém sem pedir.
describe.if(process.env.KIWI_SIGN_KEYCHAIN_TEST === "1")("signing with a real local identity (T1074)", () => {
  let identity: SigningIdentity;
  let keychain: string;

  beforeEach(() => {
    keychain = path.join(dir, "test.keychain-db");
    const password = "kiwinotes-test";
    const sh = (cmd: string, args: string[], env: Record<string, string> = {}) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
      if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    sh("security", ["create-keychain", "-p", password, keychain]);
    sh("security", ["set-keychain-settings", keychain]);
    sh("security", ["unlock-keychain", "-p", password, keychain]);
    sh(path.join(import.meta.dir, "make-signing-identity.sh"), [keychain], { KIWI_KEYCHAIN_PASSWORD: password });
    identity = findIdentity({ KIWI_SIGN_KEYCHAIN: keychain })!;
  });
  afterEach(() => {
    spawnSync("security", ["delete-keychain", keychain]);
  });

  test("a locked keychain is seen as locked, and the identity in it isn't used", () => {
    spawnSync("security", ["lock-keychain", keychain]);
    const warnings: string[] = [];
    expect(findIdentity({ KIWI_SIGN_KEYCHAIN: keychain }, { warn: (m) => warnings.push(m) })).toBeUndefined();
    expect(warnings[0]).toContain("is locked");
  });

  test("two builds in a row keep the same designated requirement, while the code changes", () => {
    const build = (name: string) => {
      mkdirSync(path.join(dir, name));
      return fakeApp(path.join(dir, name));
    };
    const first = build("b1");
    const second = build("b2");
    writeFileSync(path.join(second, "Contents", "Resources", "version.json"), `{"hash":"outro build"}`);
    sign(first, identity);
    sign(second, identity);
    expect(designatedRequirement(first)).toBe(expectedRequirement("app.kiwinotes.test", identity));
    expect(designatedRequirement(second)).toBe(designatedRequirement(first));
    const cdhash = (app: string) => spawnSync("codesign", ["-dvvv", app], { encoding: "utf8" }).stderr.match(/CDHash=(\w+)/)?.[1];
    expect(cdhash(second)).not.toBe(cdhash(first));
  });

  test("a helper binary in Contents/Resources gets the identity too, not the linker's ad hoc signature", () => {
    const app = fakeApp(dir);
    const bin = path.join(app, "Contents", "Resources", "app", "bin");
    mkdirSync(bin, { recursive: true });
    copyFileSync("/usr/bin/true", path.join(bin, "kiwi-helper"));
    writeFileSync(path.join(bin, "notes.txt"), "não é código");
    expect(machOsIn(path.join(app, "Contents", "Resources"))).toEqual([path.join(bin, "kiwi-helper")]);
    sign(app, identity);
    expect(designatedRequirement(path.join(bin, "kiwi-helper")))
      .toBe(`identifier "kiwi-helper" and certificate leaf = H"${identity.hash.toLowerCase()}"`);
    verifyApp(app);
  });

  test("resealBundles signs the app inside the tar with the identity", () => {
    const tar = brokenBundle();
    resealBundles([tar], identity);
    expect(verifyBundle(tar, identity)).toEqual(["Fake.app"]);
  });
});
