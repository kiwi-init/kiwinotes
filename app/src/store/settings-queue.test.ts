// T2639: as fixadas que seguem a nota leem e gravam na mesma fila das configurações. Antes, o `fixPinned` lia fora da
// fila e mandava a lista inteira: uma fixada nova da janela, gravada no meio, sumia.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { Vault } from "../notes/vault.ts";
import { SettingsStore } from "./settings.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "kn-2639-"));
  dirs.push(d);
  return d;
};

test("update: duas mudanças ao mesmo tempo, as duas ficam (cada uma vê a anterior)", async () => {
  const store = new SettingsStore(tmp());
  await Promise.all([
    store.update((s) => ({ pinned: [...s.pinned, "A.md"] })),
    store.update((s) => ({ pinned: [...s.pinned, "B.md"] })),
    store.save({ notesShortcut: null }),
  ]);
  expect(await store.load()).toMatchObject({ pinned: ["A.md", "B.md"], notesShortcut: null });
  // null: não grava.
  const before = await store.load();
  expect(await store.update(() => null)).toEqual(before);
});

/**
 * Um store cuja próxima leitura dentro da fila demora: a gravação da janela entra na fila, mas ainda não chegou ao disco.
 * O `fixPinned` antigo lia o disco por fora da fila nesse meio, via a lista velha e gravava por cima.
 */
class SlowOnceStore extends SettingsStore {
  slowOnce = false;
  override async load() {
    const v = await super.load();
    if (this.slowOnce) {
      this.slowOnce = false;
      await Bun.sleep(80);
    }
    return v;
  }
}

test("uma fixada nova da janela, ainda na fila, e uma nota renomeada logo depois: nenhuma se perde", async () => {
  const data = tmp();
  const root = path.join(data, "V");
  mkdirSync(root);
  writeFileSync(path.join(root, "A.md"), "");
  writeFileSync(path.join(root, "B.md"), "");
  const store = new SlowOnceStore(data);
  await store.save({ pinned: ["A.md"] });
  let changed = 0;
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: store,
    settingsChanged: () => void changed++,
    clipboardWrite: () => {},
    notes: new Vault({ root, trash: async () => {} }),
  });
  const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
  await call("notes.list", {});
  // A janela fixa B: a gravação entra na fila e demora. Logo depois, A é renomeada.
  store.slowOnce = true;
  const pin = call("settings.set", { pinned: ["A.md", "B.md"] });
  await Bun.sleep(5);
  const rename = call("notes.rename", { path: "A.md", newPath: "A2.md" });
  expect(await pin).toMatchObject({ ok: true });
  expect(await rename).toMatchObject({ ok: true });
  expect((await store.load()).pinned).toEqual(["A2.md", "B.md"]);
  expect(changed).toBeGreaterThan(0);
});
