// Assinatura ad hoc do Kiwi Notes.app e a conferência dela, usadas pelos hooks do build (T658, T762).
//
// Por que existe o `resealBundle` (T762): no build stable, o Electrobun escreve o `Resources/version.json` (com o hash
// do bundle) **depois** do postBuild e logo compacta o app em `KiwiNotes.app.tar.zst`. Não há hook entre as duas
// coisas. O app assinado no postBuild vai então para o tar com o selo quebrado
// (`file modified: Contents/Resources/version.json`), e o wrapper extrai esse app na máquina de quem instala.
// No postWrap, o tar já existe (em build/ e dentro do wrapper) e o .dmg e o artifacts/ ainda não: é ali que o app de
// dentro é reassinado e o tar refeito.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Ad hoc, o bundle inteiro (o código dentro dele também), e confere do jeito estrito. */
export function signAdHoc(app: string): void {
  run("codesign", ["--force", "--deep", "--sign", "-", app]);
  verifyApp(app);
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
export function verifyBundle(tarZst: string): string[] {
  return withTemp((dir) => {
    unpack(tarZst, dir);
    const apps = appsIn(dir, 1);
    if (!apps.length) throw new Error(`${tarZst}: no .app inside`);
    for (const app of apps) {
      try {
        verifyApp(app);
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
export function resealBundles(tarZsts: string[]): string[] {
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
      for (const app of broken) signAdHoc(app);
      const out = path.join(dir, ".bundle.tar.zst");
      pack(dir, entries, out);
      for (const file of files) cpSync(out, file);
      resealed.push(...files);
    });
  }
  return resealed;
}

/** O app montado de um .dmg, só leitura e sem abrir janela no Finder. */
export function withDmg<T>(dmg: string, fn: (mount: string) => T): T {
  return withTemp((dir) => {
    const mount = path.join(dir, "mnt");
    run("hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-noautoopen", "-noverify", "-mountpoint", mount]);
    try {
      return fn(mount);
    } finally {
      run("hdiutil", ["detach", mount, "-force"]);
    }
  });
}
