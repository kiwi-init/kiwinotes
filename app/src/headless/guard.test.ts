// T1827: o headless recusa os dados reais. O `home` é falso (um tmp): o teste nunca encosta nas pastas de verdade.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assertNotRealData, realDataRoots, resolveReal } from "./guard.ts";

const home = realpathSync(mkdtempSync(path.join(tmpdir(), "kn-guard-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const support = path.join(home, "Library", "Application Support");
const refused = (data: string) => expect(() => assertNotRealData(data, home)).toThrow(expect.objectContaining({ code: "E_REAL_DATA" }));
const allowed = (data: string) => expect(() => assertNotRealData(data, home)).not.toThrow();

describe("guard do --data (T1827)", () => {
  test("as pastas reais e qualquer coisa dentro delas, existindo ou não", () => {
    expect(realDataRoots(home)).toEqual([path.join(support, "KiwiNotes"), path.join(support, "app.kiwinotes.desktop"), path.join(home, "KiwiNotes")]);
    refused(path.join(support, "KiwiNotes"));
    refused(path.join(support, "KiwiNotes", "headless"));
    refused(path.join(support, "app.kiwinotes.desktop", "stable"));
    refused(path.join(home, "KiwiNotes"));
    refused(path.join(home, "KiwiNotes", "sub", "pasta"));
    refused(`${path.join(home, "KiwiNotes")}/`);
    refused(path.join(home, "x", "..", "KiwiNotes")); // .. não escapa
    refused(path.join(home, "kiwinotes")); // o APFS ignora maiúsculas: é a mesma pasta
  });

  test("um symlink para os dados reais cai, seja a pasta ou o vault dentro dela", () => {
    mkdirSync(path.join(home, "KiwiNotes"), { recursive: true });
    symlinkSync(path.join(home, "KiwiNotes"), path.join(home, "atalho"));
    refused(path.join(home, "atalho"));
    refused(path.join(home, "atalho", "dentro"));
    mkdirSync(path.join(home, "scratch"));
    symlinkSync(path.join(home, "KiwiNotes"), path.join(home, "scratch", "vault"));
    refused(path.join(home, "scratch")); // o <data>/vault seria o ~/KiwiNotes
  });

  test("pastas de teste passam, mesmo com nomes parecidos", () => {
    allowed(path.join(home, "tmp", "kiwinotes-headless"));
    allowed(path.join(home, "KiwiNotes-teste"));
    allowed(path.join(support, "KiwiNotesHeadless"));
    allowed(path.join(tmpdir(), "kn-test"));
  });

  test("resolveReal resolve o pedaço que existe e junta o resto", () => {
    expect(resolveReal(path.join(home, "atalho", "nao", "existe"))).toBe(path.join(home, "KiwiNotes", "nao", "existe"));
  });
});

test("a CLI: `start` nos dados reais sai com E_REAL_DATA, exit 1, sem criar nada nem subir o headless", async () => {
  const data = path.join(home, "KiwiNotes", "headless-errado");
  // HOME falso: se a trava falhasse, o estrago ficaria no tmp, nunca no ~/KiwiNotes de verdade.
  const p = Bun.spawn([process.execPath, path.join(import.meta.dirname, "..", "..", "scripts", "cli.ts"), "start", "--no-helper", "--data", data], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home, KIWI_HEADLESS_DATA: "" },
  });
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(1);
  expect(JSON.parse(out)).toMatchObject({ ok: false, code: "E_REAL_DATA" });
  expect(await Bun.file(path.join(data, "control.sock")).exists()).toBe(false);
  expect(await Bun.file(path.join(data, "headless.out")).exists()).toBe(false);
}, 30_000);
