// Assinatura do Kiwi Notes.app e a conferência dela, usadas pelos hooks do build (T658, T762, T1074). Com a identidade
// local de `make-signing-identity.sh` no Keychain, o app sai assinado com ela, e o TCC mantém as permissões de um build
// para o outro. Sem ela, sai ad hoc, como antes.
//
// Por que existe o `resealBundle` (T762): no build stable, o Electrobun escreve o `Resources/version.json` (com o hash
// do bundle) **depois** do postBuild e logo compacta o app em `KiwiNotes.app.tar.zst`. Não há hook entre as duas
// coisas. O app assinado no postBuild vai então para o tar com o selo quebrado
// (`file modified: Contents/Resources/version.json`), e o wrapper extrai esse app na máquina de quem instala.
// No postWrap, o tar já existe (em build/ e dentro do wrapper) e o .dmg e o artifacts/ ainda não: é ali que o app de
// dentro é reassinado e o tar refeito.

import { spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function run(cmd: string, args: string[], env?: Record<string, string>): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: env ? { ...process.env, ...env } : process.env });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    throw new Error(`${cmd} ${args.join(" ")} failed${out ? `:\n${out}` : ""}`);
  }
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

/** Os .app em `dir` e abaixo dele (sem entrar num .app nem seguir link: o .dmg tem o atalho para /Applications). */
export function appsIn(dir: string, depth = 4): string[] {
  if (depth < 0 || !existsSync(dir) || !lstatSync(dir).isDirectory()) return [];
  if (dir.endsWith(".app")) return [dir];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(".")) out.push(...appsIn(path.join(dir, name), depth - 1));
  }
  return out;
}

/** `codesign --verify --deep --strict`; lança com a saída do codesign quando o selo não confere. */
export function verifyApp(app: string): void {
  // --verbose=2: na falha, o codesign diz qual arquivo quebrou o selo ("file modified: …/version.json").
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
}

/** O nome da identidade que `make-signing-identity.sh` cria no Keychain de login (T1074). */
export const IDENTITY_NAME = "Kiwi Notes Local Signing";

/** Uma identidade de assinatura de código: o SHA-1 do certificado e, fora da lista de busca, o keychain dela. */
export interface SigningIdentity {
  hash: string;
  name: string;
  keychain?: string;
}

/**
 * As identidades de `security find-identity -p codesigning`, com nome e hash. Conta também as não confiáveis
 * (`CSSMERR_TP_NOT_TRUSTED`): a autoassinada é assim, e o codesign e o TCC não precisam da confiança.
 */
export function parseIdentities(output: string): { hash: string; name: string }[] {
  const seen = new Set<string>();
  const out: { hash: string; name: string }[] = [];
  for (const m of output.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/gm)) {
    if (seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    out.push({ hash: m[1]!, name: m[2]! });
  }
  return out;
}

/**
 * Com que identidade assinar (T1074):
 * - `KIWI_SIGN_IDENTITY=-`: ad hoc, mesmo com a identidade no Keychain;
 * - `KIWI_SIGN_IDENTITY=<nome ou SHA-1>`: essa (e `KIWI_SIGN_KEYCHAIN`, se ela estiver num keychain fora da busca);
 * - senão, a "Kiwi Notes Local Signing", se existir;
 * - senão, `undefined`: ad hoc, como antes (o TCC pede a permissão de novo a cada build).
 * Lança se a identidade pedida não existe: um build que deveria manter as permissões não sai ad hoc calado.
 */
export function findIdentity(
  env: Record<string, string | undefined> = process.env,
  list: (keychain?: string) => string = (keychain) =>
    run("security", ["find-identity", "-p", "codesigning", ...(keychain ? [keychain] : [])]),
): SigningIdentity | undefined {
  const wanted = env.KIWI_SIGN_IDENTITY?.trim();
  if (wanted === "-") return undefined;
  const keychain = env.KIWI_SIGN_KEYCHAIN || undefined;
  const all = parseIdentities(list(keychain));
  const found = all.find((i) => (wanted ? i.name === wanted || i.hash === wanted.toUpperCase() : i.name === IDENTITY_NAME));
  if (!found && wanted) throw new Error(`signing: no code signing identity "${wanted}"${keychain ? ` in ${keychain}` : ""}`);
  return found && { ...found, ...(keychain ? { keychain } : {}) };
}

/** O designated requirement que o TCC guarda: preso ao certificado, e não ao cdhash do build. */
export function expectedRequirement(bundleId: string, identity: SigningIdentity): string {
  return `identifier "${bundleId}" and certificate leaf = H"${identity.hash.toLowerCase()}"`;
}

/**
 * O designated requirement de um .app, como o codesign mostra (`codesign -d -r-`). No ad hoc, ele vem implícito e
 * comentado (`# designated => cdhash H"…"`).
 */
export function designatedRequirement(app: string): string {
  const out = run("codesign", ["-d", "-r-", app]);
  const m = out.match(/^(?:# )?designated => (.+)$/m);
  if (!m) throw new Error(`${app}: no designated requirement`);
  return m[1]!.trim();
}

/** O CFBundleIdentifier do .app. */
export function bundleIdOf(app: string): string {
  return run("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(app, "Contents", "Info.plist")]).trim();
}

/**
 * Assina o bundle inteiro (o código dentro dele também) e confere do jeito estrito. Com uma identidade, confere
 * também que o requirement ficou preso a ela, igual de um build para o outro (T1074). Sem, ad hoc.
 */
export function sign(app: string, identity?: SigningIdentity): void {
  const keychain = identity?.keychain ? ["--keychain", identity.keychain] : [];
  // O `--deep` não entra em Contents/Resources: o kiwi-helper (em Resources/app/bin) ficaria com a assinatura ad hoc do
  // linker, presa ao cdhash. Com a identidade, ele é assinado antes, para ter o requirement estável também.
  if (identity) {
    for (const file of machOsIn(path.join(app, "Contents", "Resources"))) {
      run("codesign", ["--force", "--sign", identity.hash, ...keychain, file]);
    }
  }
  run("codesign", ["--force", "--deep", "--sign", identity?.hash ?? "-", ...keychain, app]);
  verifyApp(app);
  if (identity) verifyRequirement(app, identity);
}

const MACH_O_MAGIC = new Set([0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/** Os executáveis Mach-O em `dir` e abaixo (sem entrar em .app nem seguir link). */
export function machOsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) {
      if (!name.endsWith(".app")) out.push(...machOsIn(p));
    } else if (st.isFile() && st.size >= 4 && st.mode & 0o111) {
      const fd = openSync(p, "r");
      const head = Buffer.alloc(4);
      try {
        readSync(fd, head, 0, 4, 0);
      } finally {
        closeSync(fd);
      }
      if (MACH_O_MAGIC.has(head.readUInt32BE(0))) out.push(p);
    }
  }
  return out;
}

/** Lança se o requirement do .app não é o da identidade. */
export function verifyRequirement(app: string, identity: SigningIdentity): void {
  const expected = expectedRequirement(bundleIdOf(app), identity);
  const actual = designatedRequirement(app);
  if (actual !== expected) throw new Error(`${app}: designated requirement is\n  ${actual}\nexpected\n  ${expected}`);
}

/** Ad hoc, o bundle inteiro (o código dentro dele também), e confere do jeito estrito. */
export function signAdHoc(app: string): void {
  sign(app);
}

function withTemp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-sign-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Abre um .tar.zst em `dir`. */
export function unpack(tarZst: string, dir: string): void {
  const tar = path.join(dir, ".bundle.tar");
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(tarZst)));
  try {
    run("tar", ["-xf", tar, "-C", dir]);
  } finally {
    rmSync(tar, { force: true });
  }
}

/**
 * Faz o .tar.zst com as `entries` de `dir`, no formato do Electrobun: ustar, só arquivos e pastas, sem os `._` nem os
 * atributos estendidos do macOS. A compressão é a do Electrobun também (janela de 8 MiB, que o extractor lê).
 */
export function pack(dir: string, entries: string[], tarZst: string): void {
  const tar = path.join(dir, ".bundle.tar");
  try {
    run("tar", ["--format", "ustar", "--no-xattrs", "--no-mac-metadata", "--no-acls", "--no-fflags", "-cf", tar, "-C", dir, ...entries],
      { COPYFILE_DISABLE: "1" });
    writeFileSync(tarZst, Bun.zstdCompressSync(readFileSync(tar), { level: 19 }));
  } finally {
    rmSync(tar, { force: true });
  }
}

/** O .app que está num .tar.zst, conferido sem tocar no arquivo. Lança se não houver app ou se um selo falhar. */
export function verifyBundle(tarZst: string, identity?: SigningIdentity): string[] {
  return withTemp((dir) => {
    unpack(tarZst, dir);
    const apps = appsIn(dir, 1);
    if (!apps.length) throw new Error(`${tarZst}: no .app inside`);
    for (const app of apps) {
      try {
        verifyApp(app);
        if (identity) verifyRequirement(app, identity);
      } catch (e) {
        throw new Error(`${path.basename(app)} inside ${tarZst}: ${(e as Error).message}`);
      }
    }
    return apps.map((a) => path.basename(a));
  });
}

/**
 * Reassina o .app de dentro de cada .tar.zst e refaz o tar. Os arquivos iguais (o tar em build/ e a cópia dentro do
 * wrapper) recebem o mesmo tar novo. Não faz nada num tar cujo app já confere.
 */
export function resealBundles(tarZsts: string[], identity?: SigningIdentity): string[] {
  const groups = new Map<string, string[]>();
  for (const file of tarZsts) {
    const key = Bun.hash(readFileSync(file)).toString();
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const resealed: string[] = [];
  for (const files of groups.values()) {
    withTemp((dir) => {
      unpack(files[0], dir);
      const entries = readdirSync(dir).filter((n) => !n.startsWith("."));
      const apps = entries.filter((n) => n.endsWith(".app")).map((n) => path.join(dir, n));
      if (!apps.length) throw new Error(`${files[0]}: no .app inside`);
      const broken = apps.filter((app) => {
        try {
          verifyApp(app);
          return false;
        } catch {
          return true;
        }
      });
      if (!broken.length) return;
      for (const app of broken) sign(app, identity);
      const out = path.join(dir, ".bundle.tar.zst");
      pack(dir, entries, out);
      for (const file of files) cpSync(out, file);
      resealed.push(...files);
    });
  }
  return resealed;
}

export interface DetachOptions {
  tries?: number;
  waitMs?: number;
  exec?: (cmd: string, args: string[]) => unknown;
  sleep?: (ms: number) => void;
  warn?: (message: string) => void;
}

/**
 * `hdiutil detach`, com novas tentativas: logo depois de montar, o Spotlight ou outro `hdiutil` pode segurar o volume
 * (T914, `detach … -force failed` depois de todas as conferências ok). Se não sair, avisa e devolve `false` em vez de
 * derrubar o build: a conferência já passou, e o volume se ejeta à mão.
 */
export function detach(mount: string, options: DetachOptions = {}): boolean {
  const { tries = 5, waitMs = 1000, exec = run, sleep = Bun.sleepSync, warn = console.warn } = options;
  for (let i = 1; i <= tries; i++) {
    try {
      exec("hdiutil", ["detach", mount, "-force"]);
      return true;
    } catch (e) {
      if (i === tries) {
        warn(`verify-signature: couldn't detach ${mount} after ${tries} tries; eject it by hand (${String(e).split("\n")[0]})`);
        return false;
      }
      sleep(waitMs);
    }
  }
  return false;
}

/** O app montado de um .dmg, só leitura e sem abrir janela no Finder. */
export function withDmg<T>(dmg: string, fn: (mount: string) => T, options: DetachOptions = {}): T {
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-sign-"));
  const mount = path.join(dir, "mnt");
  let detached = true;
  try {
    (options.exec ?? run)("hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-noautoopen", "-noverify", "-mountpoint", mount]);
    try {
      return fn(mount);
    } finally {
      detached = detach(mount, options);
    }
  } finally {
    // Com o volume ainda montado, a pasta fica: apagar recursivamente entraria nele.
    if (detached) rmSync(dir, { recursive: true, force: true });
  }
}
