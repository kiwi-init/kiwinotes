// T1739: o headless e a CLI de teste. Nada aqui abre janela nem toca no app de verdade: --no-helper e dados num tmp.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..", "..");

/** Todos os módulos que o headless carrega, seguindo os imports relativos (estáticos e dinâmicos). */
function importGraph(entry: string): { files: string[]; bare: Set<string> } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1]!;
      if (!spec.startsWith(".")) {
        bare.add(spec);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec);
      for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
        if (existsSync(candidate) && candidate.match(/\.tsx?$/)) {
          walk(candidate);
          break;
        }
      }
    }
  };
  walk(entry);
  return { files: [...seen], bare };
}

describe("headless (T1739)", () => {
  test("nada do headless importa o Electrobun: sem ele, não existe ícone, janela nem pílula", () => {
    for (const entry of ["src/headless/main.ts", "scripts/cli.ts"]) {
      const { files, bare } = importGraph(path.join(appDir, entry));
      expect(files.length).toBeGreaterThan(3);
      const electrobun = [...bare].filter((s) => s.startsWith("electrobun"));
      // A única exceção: o tipo do AppEngine que o ui-engine importa (só tipo some no build) e o próprio AppEngine,
      // que o headless não sobe (o directInvoke e o uiCapabilities não usam). Nenhum BrowserWindow, Tray ou Utils.
      expect(electrobun.filter((s) => s !== "electrobun/bun/appengine")).toEqual([]);
      expect(files.some((f) => f.endsWith("windows.ts") || f.endsWith("bun/index.ts"))).toBe(false);
    }
  });

  const data = mkdtempSync(path.join(tmpdir(), "kn-hl-"));
  afterAll(async () => {
    await cli(["stop"]);
    rmSync(data, { recursive: true, force: true });
  });

  async function cli(args: string[]): Promise<{ code: number; out: string; json: Record<string, unknown> | null }> {
    const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, KIWI_HEADLESS_DATA: "" },
    });
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(out);
    } catch {
      json = null;
    }
    return { code, out, json };
  }

  test(
    "a CLI de ponta a ponta: start, invoke, os códigos de erro, os eventos, stop e os exit codes",
    async () => {
      const started = await cli(["start", "--no-helper"]);
      expect(started.code).toBe(0);
      const status = started.json!.value as Record<string, unknown>;
      expect(status).toMatchObject({ helper: "off", data });
      // Dados isolados: o vault fica dentro do --data, nunca no ~/KiwiNotes.
      expect(String(status.vault)).toBe(path.join(data, "vault"));
      expect(status.capabilities as string[]).toContain("notes.create");

      const created = await cli(["invoke", "notes.create", JSON.stringify({ title: "Pela CLI", content: "oi" })]);
      expect(created.code).toBe(0);
      expect(created.json).toMatchObject({ ok: true, value: { path: "Pela CLI.md" } });
      expect(readFileSync(path.join(data, "vault", "Pela CLI.md"), "utf8")).toBe("oi");

      const list = await cli(["invoke", "notes.list"]);
      expect(list.json).toMatchObject({ ok: true, value: { notes: [{ path: "Pela CLI.md" }] } });

      // O mesmo caminho validado da UI: nome fora da lista, argumento ruim, fora do vault.
      expect(await cli(["invoke", "shell.run", "{}"])).toMatchObject({ code: 1, json: { ok: false, code: "E_NO_CAPABILITY" } });
      expect(await cli(["invoke", "history.search", '{"limit":0}'])).toMatchObject({ code: 1, json: { code: "E_BAD_ARGS" } });
      expect(await cli(["invoke", "notes.get", '{"path":"../fora.md"}'])).toMatchObject({ code: 1, json: { code: "E_OUTSIDE_VAULT" } });
      // O clipboard da pessoa nunca é tocado.
      expect(await cli(["invoke", "clipboard.write", '{"text":"segredo"}'])).toMatchObject({ code: 0 });
      // Uso errado: exit 2.
      expect((await cli(["invoke"])).code).toBe(2);
      expect((await cli(["invoke", "notes.list", "{nao é json"])).code).toBe(2);
      // Sem helper, o dictate responde que não dá.
      expect((await cli(["dictate", "--text", "oi"])).code).toBe(1);

      const events = await cli(["events"]);
      expect(events.out).toContain('"notes.changed"');
      expect(events.out).toContain("Pela CLI.md");
      const logs = await cli(["logs"]);
      expect(logs.out).toContain("clipboard.write (not written)");
      expect(logs.out).not.toContain("segredo");

      expect((await cli(["stop"])).code).toBe(0);
      await Bun.sleep(300);
      expect((await cli(["status"])).code).toBe(3);
      expect(existsSync(path.join(data, "control.sock"))).toBe(false);
    },
    60_000,
  );
});
