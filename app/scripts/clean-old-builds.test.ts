// T2399: a limpeza dos builds velhos só escolhe `<worktree>/app/build`, e deixa de fora o que está rodando ou pedido.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { plan, worktrees } from "./clean-old-builds.ts";
import { tempDir } from "../test/tmp.ts";

const root = realpathSync(tempDir("kn-clean-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function wt(name: string, app?: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  if (app) mkdirSync(path.join(dir, "app", "build", "stable-macos-arm64", app, "Contents", "MacOS"), { recursive: true });
  return dir;
}

test("worktrees: os caminhos do porcelain", () => {
  expect(worktrees("worktree /a\nHEAD x\nbranch refs/heads/main\n\nworktree /b c\nHEAD y\ndetached\n")).toEqual(["/a", "/b c"]);
});

test("sai o build parado; ficam o rodando, o pedido e o worktree sem build", () => {
  const old = wt("main-teste4", "Kiwi Notes.app");
  const busy = wt("T2399", "Kiwi Notes.app");
  const kept = wt("hunt", "Kiwi Notes-dev.app");
  const clean = wt("T1974");
  const running = [path.join(busy, "app", "build", "stable-macos-arm64", "Kiwi Notes.app", "Contents", "MacOS", "launcher")];
  const p = plan({ worktrees: [old, busy, kept, clean], running, keep: ["hunt"] });
  expect(p.remove.map((b) => b.dir)).toEqual([path.join(old, "app", "build")]);
  expect(p.remove[0]!.apps).toEqual([path.join(old, "app", "build", "stable-macos-arm64", "Kiwi Notes.app")]);
  expect(p.keep.map((k) => [path.basename(k.build.worktree), k.why])).toEqual([
    ["T2399", "a process is running from it"],
    ["hunt", "--keep"],
  ]);
});

test("um app/build que é link para outro lugar não entra", () => {
  const target = path.join(root, "Applications-falso");
  mkdirSync(path.join(target, "Kiwi Notes.app"), { recursive: true });
  const linked = wt("linked");
  mkdirSync(path.join(linked, "app"), { recursive: true });
  symlinkSync(target, path.join(linked, "app", "build"));
  expect(plan({ worktrees: [linked], running: [], keep: [] })).toEqual({ remove: [], keep: [] });
});
