import { describe, expect, test } from "bun:test";

import { FOLDER_CHOICES_MAX, folderChoices } from "./folderChoices.ts";

describe("folderChoices (spec #12918)", () => {
  test("a short vault: the fixed ones first, then every folder, without hidden ones or repeats", () => {
    expect(folderChoices(["Rotinas", "Rotinas"], ["A", "A/B", ".obsidian", "C/.git", "Rotinas"])).toEqual(["Rotinas", "A", "A/B"]);
  });

  test("a big vault keeps the menu short: two levels, then only the first", () => {
    const top = Array.from({ length: 50 }, (_, i) => `P${i}`);
    const two = top.flatMap((p) => [`${p}/a`, `${p}/b`]);
    const three = two.map((p) => `${p}/fundo`);
    const all = [...top, ...two, ...three].sort();
    expect(folderChoices([], all)).toEqual(all);
    const mid = folderChoices([], all, 200);
    expect(mid.length).toBe(150);
    expect(mid.some((f) => f.endsWith("/fundo"))).toBe(false);
    const small = folderChoices([], all, 100);
    expect(small).toEqual([...top].sort());
  });

  test("the chosen folder stays, even deep, and the list never passes the limit", () => {
    const all = Array.from({ length: 5000 }, (_, i) => `P${i}`);
    const out = folderChoices(["Fundo/Mais/Ainda"], all);
    expect(out[0]).toBe("Fundo/Mais/Ainda");
    expect(out.length).toBe(FOLDER_CHOICES_MAX + 1);
  });
});
