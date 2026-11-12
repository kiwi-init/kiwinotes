// T7877: renomear ou mover lê do disco só as notas que podem citar a nota, e os links continuam todos certos.

import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Vault } from "./vault.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) {
    chmodSync(path.join(d, "KiwiNotes", "Solta 1.md"), 0o644);
    rmSync(d, { recursive: true, force: true });
  }
});

async function vault(files: Record<string, string>) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "kiwinotes-rename-")), "KiwiNotes");
  dirs.push(path.dirname(root));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

/** Conta as notas que o rename relê do disco para reescrever. */
function countRefactors(v: Vault) {
  const read: string[] = [];
  const self = v as unknown as { refactorNote: (p: string, ...rest: unknown[]) => Promise<unknown> };
  const original = self.refactorNote.bind(v);
  self.refactorNote = (p, ...rest) => {
    read.push(p);
    return original(p, ...rest);
  };
  return read;
}

const loose = { "Solta 1.md": "nada aqui [[Outra]]", ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Pasta/Solta ${i}.md`, `nada aqui ${i} [[Outra]]`])) };

test("o rename relê só quem cita a nota, e atualiza os [[links]], os sem acento, os de apelido e os [texto](caminho.md)", async () => {
  const { v, root } = await vault({
    ...loose,
    "Outra.md": "outra",
    "Pessoas/João Silva.md": "---\naliases: [JS]\n---\nsobre ele",
    "Cita.md": "veja [[João Silva]]",
    "SemAcento.md": "veja [[joao silva#Topo]]",
    "Apelido.md": "veja [[JS]]",
    "Markdown.md": "veja [ele](Pessoas/Jo%C3%A3o%20Silva.md) e [ref]\n\n[ref]: <Pessoas/JOÃO SILVA.md>",
  });
  // Uma nota que não cita e não se lê: antes, o rename a lia e a dava como "não atualizada".
  chmodSync(path.join(root, "Solta 1.md"), 0o000);
  const read = countRefactors(v);
  const r = await v.rename("Pessoas/João Silva.md", "Gente/João.md");

  expect(read.sort()).toEqual(["Apelido.md", "Cita.md", "Gente/João.md", "Markdown.md", "SemAcento.md"]);
  expect(r.skippedPaths).toEqual([]);
  expect(readFileSync(path.join(root, "Cita.md"), "utf8")).toBe("veja [[João]]");
  expect(readFileSync(path.join(root, "SemAcento.md"), "utf8")).toBe("veja [[João#Topo]]");
  expect(readFileSync(path.join(root, "Apelido.md"), "utf8")).toBe("veja [[JS]]");
  expect(readFileSync(path.join(root, "Markdown.md"), "utf8")).toBe("veja [ele](Gente/Jo%C3%A3o.md) e [ref]\n\n[ref]: <Gente/Jo%C3%A3o.md>");
  expect(r.updatedLinks).toBe(4);
});

test("mover para outra pasta sem ninguém citar relê só a própria nota (os [x](caminho) relativos dela)", async () => {
  const { v, root } = await vault({ ...loose, "Outra.md": "outra", "A/Nota.md": "veja [o outro](../Outra.md)" });
  const read = countRefactors(v);
  await v.rename("A/Nota.md", "B/C/Nota.md");
  expect(read).toEqual(["B/C/Nota.md"]);
  expect(readFileSync(path.join(root, "B/C/Nota.md"), "utf8")).toBe("veja [o outro](../../Outra.md)");
});

test("uma nota escrita por fora depois do scan(), que passou a citar a nota, também é atualizada (#7980)", async () => {
  const { v, root } = await vault({ ...loose, "Pessoas/João Silva.md": "sobre ele", "Tarde.md": "ainda nada" });
  // Entre o scan() do rename e o laço: o Obsidian (ou outro app) grava um link para a nota.
  const self = v as unknown as { scan: () => Promise<void> };
  const scan = self.scan.bind(v);
  self.scan = async () => {
    await scan();
    const abs = path.join(root, "Tarde.md");
    writeFileSync(abs, "agora [[João Silva]]");
    const t = statSync(abs).mtimeMs / 1000 + 5;
    utimesSync(abs, t, t);
  };
  const read = countRefactors(v);
  const r = await v.rename("Pessoas/João Silva.md", "Gente/João.md");
  expect(readFileSync(path.join(root, "Tarde.md"), "utf8")).toBe("agora [[João]]");
  expect(r.updatedLinks).toBe(1);
  // As outras descartadas não mudaram: não são relidas.
  expect(read.sort()).toEqual(["Gente/João.md", "Tarde.md"]);
});
