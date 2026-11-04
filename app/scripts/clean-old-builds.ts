// Tira os builds velhos do Kiwi Notes dos worktrees (T2399, #2408). Cada `app/build/` de worktree tem um .app com o
// mesmo bundle id (`app.kiwinotes.desktop`) do app de verdade em /Applications. Com 9 cópias, o LaunchServices, o
// Spotlight e o Raycast escolhem a errada, e um build de teste que rodou deixou o registro de instalação do Electrobun
// apontando para ele (a rc3 que não trocou).
//
//   bun scripts/clean-old-builds.ts             # ensaio: lista o que sairia e o que fica (e por quê)
//   bun scripts/clean-old-builds.ts --apply     # tira do LaunchServices (`lsregister -u`) e apaga cada app/build/
//   … --keep T2399 --keep hunt                  # worktrees que ficam de fora (quem está trabalhando neles)
//
// Só mexe em `<worktree>/app/build/` dos worktrees deste repo (`git worktree list`). Nunca em /Applications, nunca no
// worktree em si (o código e os commits ficam), e nunca num build com processo rodando de dentro dele.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export interface Build {
  worktree: string;
  dir: string;
  apps: string[];
}

export interface Plan {
  remove: Build[];
  keep: { build: Build; why: string }[];
}

/** Os worktrees do repo, pelo `git worktree list --porcelain`. */
export function worktrees(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

/** Os .app dentro de um `app/build/` (um nível de pasta por plataforma: `stable-macos-arm64/Kiwi Notes.app`). */
function appsIn(dir: string): string[] {
  const out: string[] = [];
  for (const sub of readdirSync(dir)) {
    const p = path.join(dir, sub);
    if (!statSync(p).isDirectory()) continue;
    if (sub.endsWith(".app")) out.push(p);
    else for (const name of readdirSync(p)) if (name.endsWith(".app")) out.push(path.join(p, name));
  }
  return out;
}

/**
 * O que sai e o que fica. `running` são os executáveis rodando agora; `keep`, os nomes de worktree pedidos para ficar.
 * Um caminho que não é `<worktree>/app/build` nunca entra (a trava contra apagar outra coisa).
 */
export function plan(o: { worktrees: string[]; running: string[]; keep: string[] }): Plan {
  const out: Plan = { remove: [], keep: [] };
  for (const wt of o.worktrees) {
    const dir = path.join(wt, "app", "build");
    if (!existsSync(dir)) continue;
    const real = realpathSync(dir);
    if (path.basename(real) !== "build" || path.basename(path.dirname(real)) !== "app" || real.startsWith("/Applications")) continue;
    const build: Build = { worktree: wt, dir: real, apps: appsIn(real) };
    if (o.keep.includes(path.basename(wt))) out.keep.push({ build, why: "--keep" });
    else if (o.running.some((exe) => exe.startsWith(real + path.sep))) out.keep.push({ build, why: "a process is running from it" });
    else out.remove.push(build);
  }
  return out;
}

/** Os executáveis rodando agora (`ps`), para não apagar o build de um app aberto. */
function runningExecutables(): string[] {
  const r = spawnSync("ps", ["-axo", "comm="], { encoding: "utf8" });
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const keep = argv.flatMap((a, i) => (a === "--keep" && argv[i + 1] ? [argv[i + 1]!] : []));
  const repo = path.resolve(import.meta.dirname, "..", "..");
  const list = spawnSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (list.status !== 0) throw new Error(`clean-old-builds: git worktree list failed: ${list.stderr}`);
  const p = plan({ worktrees: worktrees(list.stdout), running: runningExecutables(), keep });
  for (const { build, why } of p.keep) console.log(`keep    ${build.dir}  (${why})`);
  for (const b of p.remove) console.log(`${apply ? "remove " : "would remove"}  ${b.dir}  (${b.apps.map((a) => path.basename(a)).join(", ") || "no .app"})`);
  if (!apply) {
    console.log(`\n${p.remove.length} build(s) would go. Nothing was touched: run again with --apply.`);
    process.exit(0);
  }
  for (const b of p.remove) {
    for (const app of b.apps) {
      const r = spawnSync(LSREGISTER, ["-u", app], { encoding: "utf8" });
      if (r.status !== 0) console.warn(`clean-old-builds: lsregister -u ${app}: ${r.stderr.trim()}`);
    }
    rmSync(b.dir, { recursive: true, force: true });
  }
  console.log(`\n${p.remove.length} build(s) removed and unregistered from LaunchServices.`);
}
