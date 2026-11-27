import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { headlessOutTail, notRunMessage } from "./dictation-failure.ts";

// #454 (spec #33093, T33239): a bateria apontava para o headless.out que ela mesma apagava.
describe("test:dictation: o motivo do headless antes de apagar a pasta", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(path.join(tmpdir(), "kn-dict-exemplo-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("a dica do headless.out vai na mensagem", () => {
    const data = tmp();
    writeFileSync(path.join(data, "headless.out"), "subindo\nno kiwi-helper: run swift build in native/, or start with --no-helper\n");
    const msg = notRunMessage("o headless não subiu", [data, path.join(data, "p")], false);
    expect(msg).toContain("a bateria não rodou: o headless não subiu");
    expect(msg).toContain("no kiwi-helper: run swift build in native/");
    expect(msg).toContain("--keep a guarda");
  });

  test("só as últimas linhas, das duas sessões", () => {
    const data = tmp();
    const precise = path.join(data, "p");
    mkdirSync(precise);
    writeFileSync(path.join(data, "headless.out"), Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n"));
    writeFileSync(path.join(precise, "headless.out"), "o modelo não abriu\n");
    const tail = headlessOutTail([data, precise], 5);
    expect(tail).toContain("linha 39");
    expect(tail).toContain("linha 35");
    expect(tail).not.toContain("linha 34");
    expect(tail).toContain("o modelo não abriu");
  });

  test("sem headless.out, só o erro; com --keep, diz onde a pasta ficou", () => {
    const data = tmp();
    expect(notRunMessage("faltou algo", [data], false)).toBe("a bateria não rodou: faltou algo");
    expect(notRunMessage("faltou algo", [data], true)).toBe(`a bateria não rodou: faltou algo\n(a pasta fica em ${data})`);
  });

  test("a bateria de verdade, com o helper que falta: a dica sai antes de a pasta sumir", () => {
    const fake = path.join(tmp(), "kiwi-helper-exemplo");
    const r = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "test-dictation.ts"), "--only", "text"], {
      cwd: path.join(import.meta.dir, ".."),
      env: { ...process.env, KIWI_HELPER: fake },
      stdout: "pipe",
      stderr: "pipe",
    });
    const err = r.stderr.toString();
    expect(r.exitCode).toBe(1);
    expect(err).toContain("a bateria não rodou");
    expect(err).toContain("no kiwi-helper");
    expect(err).toContain("--keep a guarda");
  }, 60_000);
});
