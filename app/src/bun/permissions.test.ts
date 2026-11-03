import { describe, expect, test } from "bun:test";

import type { Command, Event, EventMessage, Permission, Permissions, ResultMessage } from "../shared/ipc.ts";
import { type AskedStore, missing, PermissionFlow, type PermissionsSidecar } from "./permissions.ts";

type Listener = (e: EventMessage) => void;

/** Um helper de mentira: só registra os `permissions.request` (nenhum diálogo de verdade abre, #533). */
function fake() {
  const asked: Permission[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const sidecar = {
    async send<C extends Command>(c: C): Promise<ResultMessage<C["type"]>> {
      if (c.type === "permissions.request") asked.push(c.permission);
      return { v: 1, type: "result", id: "x", ok: true, data: { permission: "x", state: "denied" } } as any;
    },
    on(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
      return () => listeners.get(type)!.delete(fn);
    },
  };
  const emit = async (e: Event) => {
    for (const fn of listeners.get(e.type) ?? []) fn({ ...e, v: 1 } as EventMessage);
    await Bun.sleep(1);
  };
  return { sidecar: sidecar as unknown as PermissionsSidecar, asked, emit };
}

function memoryStore(initial: Permission[] = []): AskedStore & { saved: Permission[] } {
  const s = {
    saved: initial,
    load: async () => s.saved,
    save: async (a: Permission[]) => void (s.saved = a),
  };
  return s;
}

const perms = (p: Partial<Permissions>): Permissions => ({
  microphone: "undetermined",
  accessibility: "denied",
  inputMonitoring: "denied",
  ...p,
});

const ready = (permissions: Permissions): Event => ({
  type: "ready",
  version: "t",
  pid: 1,
  hotkey: "fn",
  hotkeyActive: permissions.inputMonitoring === "granted",
  permissions,
});
const changed = (permissions: Permissions): Event => ({
  type: "permissions.changed",
  permissions,
  hotkeyActive: permissions.inputMonitoring === "granted",
});

describe("PermissionFlow", () => {
  test("first launch: Input Monitoring, then Accessibility once the first is granted, one window at a time", async () => {
    const { sidecar, asked, emit } = fake();
    const store = memoryStore();
    const flow = new PermissionFlow(sidecar, store, () => {});
    flow.attach();
    await emit(ready(perms({})));
    expect(asked).toEqual(["inputMonitoring"]);
    // Still not granted: nothing else pops up.
    await emit(changed(perms({})));
    expect(asked).toEqual(["inputMonitoring"]);
    await emit(changed(perms({ inputMonitoring: "granted" })));
    expect(asked).toEqual(["inputMonitoring", "accessibility"]);
    await emit(changed(perms({ inputMonitoring: "granted", accessibility: "granted" })));
    expect(asked).toEqual(["inputMonitoring", "accessibility"]);
    expect(store.saved).toEqual(["inputMonitoring", "accessibility"]);
  });

  test("the microphone isn't asked at launch, only on the first dictation that needs it", async () => {
    const { sidecar, asked, emit } = fake();
    const flow = new PermissionFlow(sidecar, memoryStore(), () => {});
    flow.attach();
    await emit(ready(perms({ inputMonitoring: "granted", accessibility: "granted" })));
    expect(asked).toEqual([]);
    await emit({ type: "record.error", reason: "hotkey", error: "microphone_undetermined", microphone: "undetermined" });
    expect(asked).toEqual(["microphone"]);
    // Denied (the person said no): the app doesn't insist; the menu item opens Settings.
    await emit({ type: "record.error", reason: "hotkey", error: "microphone_denied", microphone: "denied" });
    expect(asked).toEqual(["microphone"]);
  });

  test("what was asked before isn't asked again on the next launch", async () => {
    const { sidecar, asked, emit } = fake();
    const flow = new PermissionFlow(sidecar, memoryStore(["inputMonitoring", "accessibility"]), () => {});
    flow.attach();
    await emit(ready(perms({})));
    expect(asked).toEqual([]);
  });

  test("the menu item asks for the first missing one, in order", async () => {
    const { sidecar, asked, emit } = fake();
    const flow = new PermissionFlow(sidecar, memoryStore(["inputMonitoring", "accessibility"]), () => {});
    flow.attach();
    await emit(ready(perms({ inputMonitoring: "granted" })));
    expect(flow.missing()).toEqual(["accessibility", "microphone"]);
    expect(await flow.askNext()).toBe("accessibility");
    expect(asked).toEqual(["accessibility"]);
  });

  test("missing() lists what isn't granted, in the asking order", () => {
    expect(missing(perms({ accessibility: "granted" }))).toEqual(["inputMonitoring", "microphone"]);
    expect(missing(perms({ microphone: "granted", accessibility: "granted", inputMonitoring: "granted" }))).toEqual([]);
    expect(missing(undefined)).toEqual([]);
  });
});
