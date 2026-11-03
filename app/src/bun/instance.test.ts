import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { appOf, claimInstance, decideInstance, instanceFile, isKiwiProcess, readRecord, releaseInstance } from "./instance.ts";

const NEW = { pid: 200, app: "/x/main-teste3/app/build/stable-macos-arm64/Kiwi Notes.app" };
const OLD = { pid: 100, app: "/x/main-teste2/app/build/stable-macos-arm64/Kiwi Notes.app" };

describe("decideInstance (T992)", () => {
  test("nobody running, or a record whose process is gone: start", () => {
    expect(decideInstance(undefined, NEW, () => true)).toEqual({ action: "start" });
    expect(decideInstance(OLD, NEW, () => false)).toEqual({ action: "start" });
    // Our own pid in the file (a crash left it, and the pid came back to us): start.
    expect(decideInstance({ ...NEW }, NEW, () => true)).toEqual({ action: "start" });
  });

  test("the same .app already running: this one leaves, without touching the socket", () => {
    expect(decideInstance({ pid: 150, app: NEW.app }, NEW, () => true)).toEqual({ action: "exit", reason: "already_running" });
  });

  test("an old build running (14:45, #989): the new one takes over", () => {
    expect(decideInstance(OLD, NEW, () => true)).toEqual({ action: "replace", pid: 100, app: OLD.app });
  });

  test("with KIWI_DEBUG=1 it never takes another one down", () => {
    expect(decideInstance(OLD, NEW, () => true, false)).toEqual({ action: "exit", reason: "already_running" });
  });
});

describe("claimInstance", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-instance-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const quiet = () => {};

  test("first one writes itself down; release removes only its own record", () => {
    expect(claimInstance({ dir, self: NEW, alive: () => true, log: quiet })).toEqual({ action: "start" });
    expect(readRecord(instanceFile(dir))).toEqual(NEW);
    releaseInstance(dir, 999);
    expect(existsSync(instanceFile(dir))).toBe(true);
    releaseInstance(dir, NEW.pid);
    expect(existsSync(instanceFile(dir))).toBe(false);
  });

  test("an old build gets SIGTERM, the new one waits for it to go, then writes itself down", () => {
    writeFileSync(instanceFile(dir), JSON.stringify(OLD));
    let running = true;
    const stopped: number[] = [];
    const decision = claimInstance({
      dir,
      self: NEW,
      alive: (r) => r.pid === OLD.pid && running,
      stop: (pid) => {
        stopped.push(pid);
        running = false;
      },
      log: quiet,
    });
    expect(decision).toEqual({ action: "replace", pid: OLD.pid, app: OLD.app });
    expect(stopped).toEqual([OLD.pid]);
    expect(readRecord(instanceFile(dir))).toEqual(NEW);
  });

  test("an old build that won't quit: the wait has an end", () => {
    writeFileSync(instanceFile(dir), JSON.stringify(OLD));
    const started = Date.now();
    claimInstance({ dir, self: NEW, alive: () => true, stop: () => {}, waitMs: 200, stepMs: 50, log: quiet });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(readRecord(instanceFile(dir))).toEqual(NEW);
  });

  test("the same .app running: exit, and the record stays the other one's", () => {
    const other = { pid: 150, app: NEW.app };
    writeFileSync(instanceFile(dir), JSON.stringify(other));
    const stopped: number[] = [];
    expect(claimInstance({ dir, self: NEW, alive: () => true, stop: (p) => stopped.push(p), log: quiet })).toEqual({
      action: "exit",
      reason: "already_running",
    });
    expect(stopped).toEqual([]);
    expect(readRecord(instanceFile(dir))).toEqual(other);
  });

  test("a broken record counts as nobody running", () => {
    writeFileSync(instanceFile(dir), "{not json");
    expect(claimInstance({ dir, self: NEW, alive: () => true, log: quiet })).toEqual({ action: "start" });
  });
});

describe("process checks", () => {
  test("appOf finds the .app around the executable", () => {
    expect(appOf("/a/Kiwi Notes.app/Contents/MacOS/bun")).toBe("/a/Kiwi Notes.app");
    expect(appOf("/usr/local/bin/bun")).toBe("/usr/local/bin/bun");
  });

  test("isKiwiProcess: alive and the same app, or nothing (a reused pid isn't killed)", async () => {
    // Started with the full path, as the launcher starts the app's bun ("…/Kiwi Notes.app/Contents/MacOS/bun …").
    const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"], { stdout: "ignore", stderr: "ignore" });
    try {
      expect(isKiwiProcess({ pid: child.pid, app: process.execPath })).toBe(true);
      expect(isKiwiProcess({ pid: child.pid, app: "/nowhere/Kiwi Notes.app" })).toBe(false);
    } finally {
      child.kill();
      await child.exited;
    }
    expect(isKiwiProcess({ pid: child.pid, app: process.execPath })).toBe(false);
  });
});
