// T5454 (issue #170): o `notes.save` com a base junta a edição da pessoa com o que mudou fora (o Obsidian, um agente).

import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { MeetingNotes } from "./meetings.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
async function rig() {
  const root = tempDir("kiwi-merge-save-");
  roots.push(root);
  const vault = new Vault({ root, watch: false });
  return { vault, notes: new MeetingNotes(vault, {}) };
}
const base = "# Projeto\n\nIntro.\n\n## Tarefas\n- uma\n- duas\n";

test("a nota mudou fora num trecho, eu em outro: grava o juntado e devolve o texto", async () => {
  const { vault, notes } = await rig();
  const n = await vault.create("", "Projeto", base);
  await vault.save(n.path, base.replace("- duas\n", "- duas\n- três (Obsidian)\n"), n.version);
  const mine = base.replace("Intro.", "Intro escrita no Kiwi.");
  const r = await notes.saveEdit(n.path, mine, n.version, base);
  expect(r.saved).toBe(true);
  const want = "# Projeto\n\nIntro escrita no Kiwi.\n\n## Tarefas\n- uma\n- duas\n- três (Obsidian)\n";
  expect(r.saved && r.content).toBe(want);
  expect((await vault.get(n.path)).content).toBe(want);
});

test("os dois mudaram o mesmo trecho: não grava, devolve a de agora, e o disco fica como estava", async () => {
  const { vault, notes } = await rig();
  const n = await vault.create("", "Projeto", base);
  const external = base.replace("Intro.", "Intro do Obsidian.");
  await vault.save(n.path, external, n.version);
  const r = await notes.saveEdit(n.path, base.replace("Intro.", "Intro do Kiwi."), n.version, base);
  expect(r.saved).toBe(false);
  expect(!r.saved && r.current.content).toBe(external);
  expect((await vault.get(n.path)).content).toBe(external);
});

test("sem a base (um cliente antigo), a versão velha continua só recusando", async () => {
  const { vault, notes } = await rig();
  const n = await vault.create("", "Projeto", base);
  await vault.save(n.path, base.replace("- duas\n", "- duas\n- três\n"), n.version);
  const r = await notes.saveEdit(n.path, base.replace("Intro.", "Outra."), n.version);
  expect(r.saved).toBe(false);
});
