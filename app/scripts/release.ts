// O release do Mac (T1074, decisão A do harry em #1303): pega o app do `bun run build` (o de dentro do .tar.zst, sem o
// wrapper que se desempacota), assina com o Developer ID da Kiwi Init, notariza, faz o staple, monta o .dmg e assina,
// notariza e faz o staple dele também. É o mesmo caminho do Channels (`kiwi-init/channels`, `eb-release.ts`).
//
//   bun scripts/release.ts artifacts/ out/
//
// Com Developer ID (o CI, `.github/workflows/release.yml`): `EB_SIGN_KEYCHAIN` (o keychain temporário com o .p12),
// `APPLE_API_KEY` (o caminho do .p8), `APPLE_API_KEY_ID` e `APPLE_API_ISSUER`, os mesmos nomes do Channels.
// Sem `EB_SIGN_KEYCHAIN` é um ensaio: assina ad hoc e não notariza. Assim um agente roda o script inteiro sem a chave.
// Nada aqui abre o app.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };
import { pack, unpack } from "./signing.ts";
import { updateManifest } from "./update-feed.ts";

const IDENTIFIER = "app.kiwinotes.desktop";
const appDir = path.resolve(import.meta.dirname, "..");
const ENTITLEMENTS_BUN = path.join(appDir, "build-config", "entitlements.bun.plist");
const ENTITLEMENTS_MIC = path.join(appDir, "build-config", "entitlements.mic.plist");
/** O que nenhum binário do Kiwi Notes pode levar: afrouxa o hardened runtime do processo inteiro. */
const FORBIDDEN = [
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.device.camera",
];
const MACH_O = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

const [artifactsArg, outArg] = process.argv.slice(2);
if (!artifactsArg || !outArg) throw new Error("usage: bun scripts/release.ts <artifacts dir> <out dir>");
const keychain = process.env.EB_SIGN_KEYCHAIN ?? "";
const notary = { key: process.env.APPLE_API_KEY ?? "", id: process.env.APPLE_API_KEY_ID ?? "", issuer: process.env.APPLE_API_ISSUER ?? "" };
const signed = keychain !== "";
if (signed && (!notary.key || !notary.id || !notary.issuer)) {
  throw new Error("release: signing without notarizing: set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER");
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function tool(cmd: string, args: string[]): Ran {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function must(cmd: string, args: string[], what: string): Ran {
  const r = tool(cmd, args);
  if (r.code !== 0) throw new Error(`release: ${what} failed:\n${r.stdout}${r.stderr}`);
  return r;
}

function isMachO(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && MACH_O.has(b.readUInt32BE(0));
  } finally {
    fs.closeSync(fd);
  }
}

/** Os Mach-O dentro do app, os mais fundos primeiro (assinar de dentro para fora). */
function machOs(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && isMachO(full)) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

function plist(app: string, key: string): string {
  return must("plutil", ["-extract", key, "raw", path.join(app, "Contents", "Info.plist")], `reading ${key}`).stdout.trim();
}

function sign(target: string, entitlements: string | null): void {
  const ents = entitlements ? ["--entitlements", entitlements] : [];
  if (signed) {
    must(
      "codesign",
      ["--force", "--options", "runtime", "--timestamp", "--keychain", keychain, "--sign", "Developer ID Application", ...ents, target],
      `signing ${path.basename(target)}`,
    );
  } else {
    must("codesign", ["--force", "--sign", "-", ...ents, target], `ad hoc signing ${path.basename(target)}`);
  }
}

function notarize(file: string): void {
  const auth = ["--key", notary.key, "--key-id", notary.id, "--issuer", notary.issuer];
  const r = must("xcrun", ["notarytool", "submit", file, ...auth, "--wait", "--output-format", "json"], `notarizing ${path.basename(file)}`);
  const res = JSON.parse(r.stdout) as { id?: unknown; status?: unknown };
  if (res.status === "Accepted") return;
  const log = typeof res.id === "string" ? tool("xcrun", ["notarytool", "log", res.id, ...auth]).stdout : "";
  throw new Error(`release: Apple didn't accept ${path.basename(file)} (${String(res.status)})\n${log}`);
}

const entitlementsOf = (file: string) => tool("codesign", ["-d", "--entitlements", "-", "--xml", file]).stdout;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kiwinotes-release-"));
try {
  // O app de verdade: o de dentro do tar do build (o mesmo que o wrapper desempacota e que o updater baixa).
  const artifacts = path.resolve(artifactsArg);
  const tar = fs.readdirSync(artifacts).find((f) => /^stable-.*\.app\.tar\.zst$/.test(f));
  if (!tar) throw new Error(`release: no stable-*.app.tar.zst in ${artifacts}: run bun run build first`);
  const stage = path.join(tmp, "app");
  fs.mkdirSync(stage);
  unpack(path.join(artifacts, tar), stage);
  const app = path.join(stage, "Kiwi Notes.app");
  if (!fs.existsSync(app)) throw new Error(`release: ${tar} has no Kiwi Notes.app`);
  const id = plist(app, "CFBundleIdentifier");
  if (id !== IDENTIFIER) throw new Error(`release: the app is ${id}, not ${IDENTIFIER}`);
  const built = (JSON.parse(fs.readFileSync(path.join(app, "Contents", "Resources", "version.json"), "utf8")) as { version?: unknown }).version;
  // A versão do tag (`0.1.0-rc3`, T1969) tem a base do package.json; fora do CI, é a do package.json.
  if (typeof built !== "string" || (built !== pkg.version && !built.startsWith(`${pkg.version}-`))) {
    throw new Error(`release: the app says ${String(built)}, package.json ${pkg.version}`);
  }

  const mainExe = path.join(app, "Contents", "MacOS", plist(app, "CFBundleExecutable"));
  const bun = path.join(app, "Contents", "MacOS", "bun");
  const helper = path.join(app, "Contents", "Resources", "app", "bin", "kiwi-helper");
  for (const need of [mainExe, bun, helper]) if (!fs.existsSync(need)) throw new Error(`release: ${path.relative(app, need)} is missing`);

  // De dentro para fora: cada Mach-O, depois o app (que assina o executável principal, o launcher, com o mic).
  for (const f of machOs(app).filter((f) => f !== mainExe)) {
    sign(f, f === bun ? ENTITLEMENTS_BUN : f === helper ? ENTITLEMENTS_MIC : null);
  }
  sign(app, ENTITLEMENTS_MIC);
  if (signed) {
    const forNotary = path.join(tmp, "notarize.zip");
    must("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, forNotary], "zipping for notarization");
    notarize(forNotary);
    must("xcrun", ["stapler", "staple", app], "stapling the app");
  }

  const out = path.resolve(outArg);
  fs.mkdirSync(out, { recursive: true });
  const dmg = path.join(out, `KiwiNotes-${built}-mac-arm64.dmg`);
  fs.rmSync(dmg, { force: true });
  const dmgStage = path.join(tmp, "dmg");
  fs.mkdirSync(dmgStage);
  must("ditto", [app, path.join(dmgStage, "Kiwi Notes.app")], "staging the dmg");
  fs.symlinkSync("/Applications", path.join(dmgStage, "Applications"));
  must("hdiutil", ["create", "-volname", "Kiwi Notes", "-srcfolder", dmgStage, "-ov", "-format", "UDZO", dmg], "making the dmg");
  if (signed) {
    must("codesign", ["--force", "--timestamp", "--keychain", keychain, "--sign", "Developer ID Application", dmg], "signing the dmg");
    notarize(dmg);
    must("xcrun", ["stapler", "staple", dmg], "stapling the dmg");
  }

  // As travas: nada afrouxa o runtime, o Bun tem JIT, o mic está onde o TCC cobra, e o selo confere.
  for (const f of machOs(app)) {
    const ents = entitlementsOf(f);
    for (const e of FORBIDDEN) if (ents.includes(e)) throw new Error(`release: ${path.relative(app, f)} carries ${e}`);
  }
  if (!entitlementsOf(bun).includes("com.apple.security.cs.allow-jit")) throw new Error("release: Bun lost allow-jit");
  for (const f of [mainExe, helper]) {
    if (!entitlementsOf(f).includes("com.apple.security.device.audio-input")) {
      throw new Error(`release: ${path.relative(app, f)} has no microphone entitlement: the mic would be silent (#1131)`);
    }
  }
  must("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], "verifying the app's signature");
  if (signed) {
    const req = must("codesign", ["-d", "-r-", app], "reading the designated requirement").stdout + tool("codesign", ["-d", "-r-", app]).stderr;
    if (!req.includes(`identifier "${IDENTIFIER}"`) || !req.includes("anchor apple generic")) {
      throw new Error("release: the designated requirement isn't a Developer ID one for app.kiwinotes.desktop");
    }
    must("xcrun", ["stapler", "validate", app], "validating the app's ticket");
    must("spctl", ["--assess", "--type", "execute", "--verbose=2", app], "Gatekeeper on the app");
    must("xcrun", ["stapler", "validate", dmg], "validating the dmg's ticket");
    must("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg], "Gatekeeper on the dmg");
  }
  // O que o Updater baixa (T1969): o mesmo app do .dmg (assinado, notarizado e com o ticket), num .tar.zst com o nome
  // que o manifesto do Electrobun dá, e o manifesto conferido contra o app.
  const builtManifest = fs.readdirSync(artifacts).find((f) => /^stable-.*-update\.json$/.test(f));
  if (!builtManifest) throw new Error(`release: no stable-*-update.json in ${artifacts}`);
  const appVersion = JSON.parse(fs.readFileSync(path.join(app, "Contents", "Resources", "version.json"), "utf8")) as Record<string, unknown>;
  const manifest = updateManifest(JSON.parse(fs.readFileSync(path.join(artifacts, builtManifest), "utf8")), appVersion);
  const updateTar = path.join(out, manifest.artifact.file);
  pack(stage, ["Kiwi Notes.app"], updateTar);
  fs.writeFileSync(path.join(out, builtManifest), `${JSON.stringify(manifest)}\n`);
  console.log(`release: ${path.relative(process.cwd(), updateTar)} (${(fs.statSync(updateTar).size / 1e6).toFixed(1)} MB) + ${builtManifest}`);
  console.log(`release: ${path.relative(process.cwd(), dmg)} (${(fs.statSync(dmg).size / 1e6).toFixed(1)} MB)`);
  console.log(signed ? "release: signed with the Developer ID, notarized and stapled" : "release: rehearsal: ad hoc, not notarized");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
