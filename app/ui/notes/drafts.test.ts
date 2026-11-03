import { describe, expect, test } from "bun:test";

import { type DraftStorage, Drafts, forgetDraftOnDelete } from "./drafts.ts";

function memory(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe("rascunho do que não foi gravado", () => {
  const t0 = Date.parse("2026-11-03T20:00:00Z");

  test("guarda, lê e tira por nota", () => {
    const d = new Drafts(memory(), () => t0);
    d.set({ path: "Ana.md", body: "texto meu", baseVersion: "3" });
    expect(d.get("Ana.md")).toEqual({ path: "Ana.md", body: "texto meu", baseVersion: "3", at: "2026-11-03T20:00:00.000Z" });
    expect(d.get("Outra.md")).toBeNull();
    d.remove("Ana.md");
    expect(d.get("Ana.md")).toBeNull();
  });

  test("mais de 30 dias não volta, e o prune tira os velhos e os estragados", () => {
    const mem = memory();
    let now = t0;
    const d = new Drafts(mem, () => now);
    d.set({ path: "Velha.md", body: "x", baseVersion: "1" });
    now = t0 + 31 * 24 * 3600 * 1000;
    d.set({ path: "Nova.md", body: "y", baseVersion: "1" });
    mem.setItem("kiwi.notes.draft.v1:Estragada.md", "{não é json");
    mem.setItem("outra.chave", "fica");
    expect(d.get("Velha.md")).toBeNull();
    d.prune();
    expect([...mem.map.keys()].sort()).toEqual(["kiwi.notes.draft.v1:Nova.md", "outra.chave"]);
  });

  test("sem storage (bloqueado) ou com a cota cheia, nada quebra", () => {
    const none = new Drafts(null);
    none.set({ path: "A.md", body: "x", baseVersion: "1" });
    expect(none.get("A.md")).toBeNull();
    none.prune();
    const full = new Drafts({ ...memory(), setItem: () => { throw new Error("QuotaExceededError"); } });
    expect(() => full.set({ path: "A.md", body: "x", baseVersion: "1" })).not.toThrow();
  });

  test("all() lista os válidos, do mais velho ao mais novo", () => {
    let now = t0;
    const d = new Drafts(memory(), () => now);
    d.set({ path: "B.md", body: "b", baseVersion: "1" });
    now += 1000;
    d.set({ path: "A.md", body: "a", baseVersion: "1" });
    expect(d.all().map((x) => x.path)).toEqual(["B.md", "A.md"]);
  });

  test("o notes.delete pela janela apaga o rascunho da nota; se o delete falha, o rascunho fica", async () => {
    const d = new Drafts(memory(), () => t0);
    d.set({ path: "A.md", body: "a", baseVersion: "1" });
    d.set({ path: "B.md", body: "b", baseVersion: "1" });
    const api = forgetDraftOnDelete(
      {
        other: () => "ok",
        delete: async (p: string): Promise<true> => {
          if (p === "B.md") throw new Error("E_NOT_FOUND");
          return true;
        },
      },
      d,
    );
    expect(await api.delete("A.md")).toBe(true);
    expect(d.get("A.md")).toBeNull();
    await expect(api.delete("B.md")).rejects.toThrow();
    expect(d.get("B.md")).not.toBeNull();
    expect(api.other()).toBe("ok");
  });
});
