// O filtro do Calendário por tipo e por projeto (T32408, spec #32129).

import { describe, expect, test } from "bun:test";

import { FILTER_STORAGE_KEY, NO_FILTER, passes, readFilter, shownProjects, toggleAllProjects, toggleKind, toggleProject, writeFilter } from "./filter.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("passes", () => {
  test("sem filtro, tudo passa", () => {
    expect(passes(NO_FILTER, { kind: "meeting", project: "Projeto X" })).toBe(true);
    expect(passes(NO_FILTER, { kind: "task", project: null })).toBe(true);
  });

  test("o tipo escondido some em qualquer projeto, e também sem projeto", () => {
    const f = toggleKind(NO_FILTER, "reminder");
    expect(passes(f, { kind: "reminder", project: "Projeto X" })).toBe(false);
    expect(passes(f, { kind: "reminder", project: null })).toBe(false);
    expect(passes(f, { kind: "task", project: "Projeto X" })).toBe(true);
  });

  test("o projeto escondido some; o item sem projeto fica sempre à mostra", () => {
    const f = toggleProject(NO_FILTER, "Casa");
    expect(passes(f, { kind: "task", project: "Casa" })).toBe(false);
    expect(passes(f, { kind: "task", project: "Projeto X" })).toBe(true);
    expect(passes(f, { kind: "task", project: null })).toBe(true);
  });
});

describe("os botões", () => {
  test("o tipo e o projeto vão e voltam", () => {
    expect(toggleKind(toggleKind(NO_FILTER, "focus"), "focus")).toEqual(NO_FILTER);
    expect(toggleProject(toggleProject(NO_FILTER, "Casa"), "Casa")).toEqual(NO_FILTER);
  });

  test("o Todos: com algum escondido mostra todos, com todos à mostra esconde todos", () => {
    const all = ["Casa", "Projeto X", "Viagem"];
    const one = toggleProject(NO_FILTER, "Casa");
    expect(toggleAllProjects(one, all).projects).toEqual([]);
    expect(toggleAllProjects(NO_FILTER, all).projects).toEqual(all);
    expect(toggleAllProjects(toggleAllProjects(NO_FILTER, all), all).projects).toEqual([]);
  });

  test("a conta dos projetos à mostra ignora um escondido que sumiu das Notas", () => {
    const f = { kinds: [], projects: ["Casa", "Pasta apagada"] };
    expect(shownProjects(f, ["Casa", "Projeto X"])).toBe(1);
    expect(shownProjects(NO_FILTER, ["Casa", "Projeto X"])).toBe(2);
  });

  test("um projeto novo aparece sozinho (o filtro guarda os escondidos)", () => {
    const f = toggleProject(NO_FILTER, "Casa");
    expect(passes(f, { kind: "task", project: "Projeto novo" })).toBe(true);
  });
});

describe("o filtro guardado", () => {
  test("vai e volta pelo armazenamento", () => {
    const s = memory();
    const f = toggleProject(toggleKind(NO_FILTER, "note"), "Casa");
    writeFilter(s, f);
    expect(readFilter(s)).toEqual(f);
  });

  test("sem armazenamento ou com um valor estragado, volta ao sem filtro", () => {
    expect(readFilter(null)).toEqual(NO_FILTER);
    const s = memory();
    s.setItem(FILTER_STORAGE_KEY, "{não é json");
    expect(readFilter(s)).toEqual(NO_FILTER);
    s.setItem(FILTER_STORAGE_KEY, "[1,2]");
    expect(readFilter(s)).toEqual(NO_FILTER);
  });

  test("tira o tipo que não existe, o projeto que não é texto e os repetidos", () => {
    const s = memory();
    s.setItem(FILTER_STORAGE_KEY, JSON.stringify({ kinds: ["task", "inventado", "task"], projects: ["Casa", 3, "Casa"] }));
    expect(readFilter(s)).toEqual({ kinds: ["task"], projects: ["Casa"] });
  });

  test("um armazenamento que falha ao gravar não quebra a tela", () => {
    const bad = { getItem: () => null, setItem: () => { throw new Error("cheio"); } };
    expect(() => writeFilter(bad, NO_FILTER)).not.toThrow();
  });
});
