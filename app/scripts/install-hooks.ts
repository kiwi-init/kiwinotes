// O hook da guarda de privacidade (spec #14415, T14423): o `bun install` aponta o git para `.githooks/`, onde está o
// `pre-push`. O `core.hooksPath` vai no `.git/config` do repo, que vale para todas as worktrees. Fora de um repo git
// (um tarball, o CI de outro projeto), não faz nada.
import { spawnSync } from "node:child_process";

const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
if (inRepo.status === 0 && inRepo.stdout.trim() === "true") {
  const now = spawnSync("git", ["config", "--get", "core.hooksPath"], { encoding: "utf8" }).stdout.trim();
  if (now !== ".githooks") {
    const r = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`install-hooks: não deu para ligar o hook de privacidade: ${r.stderr.trim()}`);
      process.exit(1);
    }
    console.log("install-hooks: o pre-push da guarda de privacidade está ligado (core.hooksPath = .githooks)");
  }
}
