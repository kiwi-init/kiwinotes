// O registro do agente (spec #8356): o que cada pedido leu e mudou, a cópia de antes de cada mudança, os 30 dias e as
// permissões, numa pasta tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ACTIVITY_KEEP_MS, ACTIVITY_REQUEST_CHARS, AgentActivity } from "./activity.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function make(now?: () => number) {
  const base = tempDir("kiwi-activity-");
  dirs.push(base);
  const dir = path.join(base, "agent", "activity");
  return { dir, a: new AgentActivity({ dir, ...(now ? { now } : {}) }) };
}

const change = { kind: "appended" as const, path: "Ideias.md", before: 13, after: 31, version: "abc" };

describe("o registro do agente", () => {
  test("o que cada pedido leu e mudou, do mais novo para o mais velho, com o começo do pedido", async () => {
    let t = Date.parse("2026-11-13T10:00:00.000Z");
    const { a } = make(() => t);
    await a.begin("p1", "Resuma o projeto Kiwi");
    await a.read("p1", { tool: "notes_read", target: "Projetos/Kiwi.md" });
    const copy = await a.keep("p1", "ideias soltas");
    await a.change("p1", { ...change, copy });
    t += 60_000;
    await a.begin("p2", "x".repeat(ACTIVITY_REQUEST_CHARS + 50));
    await a.read("p2", { tool: "notes_search", target: '"prazo"' });
    const list = await a.list();
    expect(list.map((r) => r.id)).toEqual(["p2", "p1"]);
    expect(list[1]).toEqual({
      id: "p1",
      at: "2026-11-13T10:00:00.000Z",
      request: "Resuma o projeto Kiwi",
      reads: [{ at: "2026-11-13T10:00:00.000Z", tool: "notes_read", target: "Projetos/Kiwi.md" }],
      changes: [{ at: "2026-11-13T10:00:00.000Z", ...change, copy }],
    });
    expect(list[0]!.request).toHaveLength(ACTIVITY_REQUEST_CHARS);
    expect(await a.list(1)).toHaveLength(1);
  });

  test("a cópia de antes: guardada, lida de volta, e tirada quando a escrita não acontece", async () => {
    const { a } = make();
    await a.begin("p1", "oi");
    const c1 = await a.keep("p1", "texto 1");
    const c2 = await a.keep("p1", "texto 2");
    expect(c1).toBe("p1/copy-1.md");
    expect(c2).toBe("p1/copy-2.md");
    expect(await a.copy(c1)).toBe("texto 1");
    await a.drop(c2);
    await expect(a.copy(c2)).rejects.toThrow();
    // Uma marca estranha não sai da pasta do registro.
    await expect(a.copy("../../etc/passwd")).rejects.toThrow();
    await expect(a.copy("p1/../request.json")).rejects.toThrow();
  });

  test("fica só nos dados do app, com pastas 0700 e arquivos 0600", async () => {
    const { dir, a } = make();
    await a.begin("p1", "oi");
    await a.keep("p1", "segredo da nota");
    const [folder] = readdirSync(dir);
    expect(folder).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_p1$/);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, folder!)).mode & 0o777).toBe(0o700);
    for (const f of readdirSync(path.join(dir, folder!))) expect(statSync(path.join(dir, folder!, f)).mode & 0o777).toBe(0o600);
  });

  test("um pedido com mais de 30 dias sai com as cópias quando chega um novo", async () => {
    let t = Date.parse("2026-10-01T10:00:00.000Z");
    const { dir, a } = make(() => t);
    await a.begin("velho", "antigo");
    const copy = await a.keep("velho", "texto velho");
    t += ACTIVITY_KEEP_MS - 1000;
    await a.begin("quase", "ainda vale");
    expect((await a.list()).map((r) => r.id)).toEqual(["quase", "velho"]);
    t += 2000;
    await a.begin("novo", "hoje");
    expect((await a.list()).map((r) => r.id)).toEqual(["novo", "quase"]);
    await expect(a.copy(copy)).rejects.toThrow();
    expect(readdirSync(dir).some((n) => n.endsWith("_velho"))).toBe(false);
  });

  test("depois de o app reabrir, o mesmo pedido continua na mesma pasta, sem pisar nas cópias", async () => {
    const { dir, a } = make();
    await a.begin("p1", "oi");
    await a.keep("p1", "um");
    const b = new AgentActivity({ dir });
    const c = await b.keep("p1", "dois");
    expect(c).toBe("p1/copy-2.md");
    await b.read("p1", { tool: "notes_read", target: "A.md" });
    expect(readdirSync(dir)).toHaveLength(1);
    expect((await b.list())[0]).toMatchObject({ id: "p1", request: "oi", reads: [{ tool: "notes_read", target: "A.md" }] });
    expect(await b.copy("p1/copy-1.md")).toBe("um");
  });

  test("o número de uma cópia nunca se repete, nem depois de uma cópia sair e o app reabrir (spec #9353)", async () => {
    const { dir, a } = make();
    await a.begin("p1", "oi");
    const c1 = await a.keep("p1", "um");
    const c2 = await a.keep("p1", "dois");
    await a.change("p1", { ...change, copy: c2 });
    await a.drop(c1); // a 1ª escrita não aconteceu
    // Antes, o app reaberto contava os arquivos (1) e a próxima cópia voltava a ser a 2, por cima da que a mudança usa.
    const b = new AgentActivity({ dir });
    const c3 = await b.keep("p1", "três");
    expect(c3).toBe("p1/copy-3.md");
    expect(await b.copy(c2)).toBe("dois");
    // A mais nova sai, e o app reabre: o número dela também não volta.
    await b.drop(c3);
    const c = new AgentActivity({ dir });
    expect(await c.keep("p1", "quatro")).toBe("p1/copy-4.md");
    // O último número fica no request.json, mas não sai no registro.
    expect(Object.keys((await c.list())[0]!)).toEqual(["id", "at", "request", "reads", "changes"]);
  });

  test("um registro de antes do spec #9353, sem o último número, continua do maior que aparece", async () => {
    const { dir, a } = make();
    await a.begin("p1", "oi");
    const c1 = await a.keep("p1", "um");
    const c2 = await a.keep("p1", "dois");
    await a.change("p1", { ...change, copy: c2 });
    await a.drop(c1);
    const file = path.join(dir, readdirSync(dir)[0]!, "request.json");
    const { copies: _, ...old } = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify(old));
    expect(await new AgentActivity({ dir }).keep("p1", "três")).toBe("p1/copy-3.md");
  });

  test("o desfazer anota a hora em cada mudança desfeita, e uma já desfeita fica com a hora de antes", async () => {
    let t = Date.parse("2026-11-13T10:00:00.000Z");
    const { dir, a } = make(() => t);
    await a.begin("p1", "oi");
    await a.change("p1", change);
    await a.change("p1", { ...change, path: "B.md" });
    t += 60_000;
    await a.markUndone("p1", [0]);
    t += 60_000;
    await a.markUndone("p1", [0, 1]);
    const b = new AgentActivity({ dir });
    expect((await b.get("p1"))!.changes.map((c) => c.undone)).toEqual(["2026-11-13T10:01:00.000Z", "2026-11-13T10:02:00.000Z"]);
    expect((await b.list())[0]!.changes[0]!.undone).toBe("2026-11-13T10:01:00.000Z");
    expect(await b.get("p2")).toBeNull();
    await expect(b.markUndone("p2", [0])).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    // O `get` não cria pedido.
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test("muitas ferramentas ao mesmo tempo não perdem nada do registro", async () => {
    const { a } = make();
    await a.begin("p1", "oi");
    await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a.read("p1", { tool: "notes_read", target: `N${i}.md` }) : a.change("p1", { ...change, path: `N${i}.md` }))));
    const [r] = await a.list();
    expect(r!.reads).toHaveLength(20);
    expect(r!.changes).toHaveLength(20);
  });

  test("um id de pedido estranho não vira caminho", async () => {
    const { dir, a } = make();
    await expect(a.begin("../fora", "x")).rejects.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  test("avisa quem escuta (spec #9480): o pedido que começa, a leitura, a mudança e o desfazer; a cópia, não", async () => {
    const { a } = make();
    const seen: string[] = [];
    const off = a.onChanged((id) => seen.push(id));
    a.onChanged(() => {
      throw new Error("quem escuta errou");
    });
    await a.begin("p1", "um pedido");
    await a.read("p1", { tool: "notes_read", target: "Ideias.md" });
    const copy = await a.keep("p1", "antes");
    await a.change("p1", { ...change, copy });
    await a.markUndone("p1", [0]);
    expect(seen).toEqual(["p1", "p1", "p1", "p1"]);
    off();
    await a.begin("p2", "outro");
    expect(seen).toHaveLength(4);
  });

  test("a lista só mostra os últimos 30 dias, mesmo antes de um pedido novo apagar os velhos (spec #9480)", async () => {
    let t = Date.parse("2026-10-01T10:00:00.000Z");
    const { a } = make(() => t);
    await a.begin("velho", "antigo");
    t += 1000;
    await a.begin("novo", "recente");
    t += ACTIVITY_KEEP_MS - 500;
    expect((await a.list()).map((r) => r.id)).toEqual(["novo"]);
  });
});
