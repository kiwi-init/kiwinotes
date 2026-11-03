import { describe, expect, test } from "bun:test";

import type { Command, Event, EventMessage, Permission, Permissions, ResultMessage } from "../shared/ipc.ts";
import { type AskedStore, missing, PermissionFlow, type PermissionsSidecar } from "./permissions.ts";

type Listener = (e: EventMessage) => void;

/** Um helper de mentira: só registra os `permissions.request` (nenhum diálogo de verdade abre, #533). */
function fake() {
  const asked: Permission[] = [];
  /** Os pedidos que vieram com `reset` (o `tccutil reset` do helper). */
  const resets: Permission[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const sidecar = {
    async send<C extends Command>(c: C): Promise<ResultMessage<C["type"]>> {
      if (c.type === "permissions.request") {
        asked.push(c.permission);
        if (c.reset) resets.push(c.permission);
      }
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
  return { sidecar: sidecar as unknown as PermissionsSidecar, asked, resets, emit };
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

  test("two updates before the store loads ask only once (review #543)", async () => {
    const { sidecar, asked, emit } = fake();
    const store: AskedStore = { load: async () => (await Bun.sleep(5), []), save: async () => {} };
    const flow = new PermissionFlow(sidecar, store, () => {});
    flow.attach();
    void emit(ready(perms({})));
    void emit(changed(perms({})));
    await Bun.sleep(50);
    expect(asked).toEqual(["inputMonitoring"]);
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

  test("with auto off (KIWI_DEBUG=1), nothing is asked on its own, only from the menu item (#551)", async () => {
    const { sidecar, asked, emit } = fake();
    const store = memoryStore();
    const flow = new PermissionFlow(sidecar, store, () => {}, false);
    flow.attach();
    await emit(ready(perms({})));
    await emit(changed(perms({ inputMonitoring: "granted" })));
    await emit({ type: "record.error", reason: "hotkey", error: "microphone_undetermined", microphone: "undetermined" });
    expect(asked).toEqual([]);
    expect(store.saved).toEqual([]);
    expect(flow.missing()).toEqual(["accessibility", "microphone"]);
    expect(await flow.askNext()).toBe("accessibility");
    expect(asked).toEqual(["accessibility"]);
  });

  test("the menu click asks with reset; the automatic asks never do (T658, #666)", async () => {
    const { sidecar, asked, resets, emit } = fake();
    const flow = new PermissionFlow(sidecar, memoryStore(), () => {});
    flow.attach();
    await emit(ready(perms({})));
    await emit(changed(perms({ inputMonitoring: "granted" })));
    await emit({ type: "record.error", reason: "hotkey", error: "microphone_undetermined", microphone: "undetermined" });
    expect(asked).toEqual(["inputMonitoring", "accessibility", "microphone"]);
    expect(resets).toEqual([]);
    // Accessibility is on in Settings but doesn't count: the person clicks "Permitir acesso… (Acessibilidade)".
    expect(await flow.askNext()).toBe("accessibility");
    expect(resets).toEqual(["accessibility"]);
  });

  test("a stale asked list (tccutil reset, new build) doesn't block the click (T825)", async () => {
    // harry's case (#819): permissions.json still has both from the old app, and the TCC entries were reset.
    for (const state of ["denied", "undetermined"] as const) {
      const { sidecar, asked, resets, emit } = fake();
      const flow = new PermissionFlow(sidecar, memoryStore(["inputMonitoring", "accessibility"]), () => {});
      flow.attach();
      await emit(ready(perms({ inputMonitoring: state, accessibility: state })));
      // Nothing on its own: they were asked before (no Settings opening at every launch).
      expect(asked).toEqual([]);
      // The click always reaches the helper as a click (reset), which ends in Settings (PermissionAsk, T825).
      expect(await flow.askNext()).toBe("inputMonitoring");
      expect(resets).toEqual(["inputMonitoring"]);
      await emit(changed(perms({ inputMonitoring: "granted", accessibility: state })));
      expect(await flow.askNext()).toBe("accessibility");
      expect(resets).toEqual(["inputMonitoring", "accessibility"]);
    }
  });

  test("with KIWI_DEBUG=1 the menu click never resets (#666)", async () => {
    const { sidecar, asked, resets, emit } = fake();
    const flow = new PermissionFlow(sidecar, memoryStore(), () => {}, false, false);
    flow.attach();
    await emit(ready(perms({ inputMonitoring: "granted" })));
    expect(await flow.askNext()).toBe("accessibility");
    expect(asked).toEqual(["accessibility"]);
    expect(resets).toEqual([]);
  });

  test("missing() lists what isn't granted, in the asking order", () => {
    expect(missing(perms({ accessibility: "granted" }))).toEqual(["inputMonitoring", "microphone"]);
    expect(missing(perms({ microphone: "granted", accessibility: "granted", inputMonitoring: "granted" }))).toEqual([]);
    expect(missing(undefined)).toEqual([]);
  });
});
