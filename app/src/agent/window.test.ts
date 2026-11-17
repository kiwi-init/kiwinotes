import { describe, expect, test } from "bun:test";

import {
  buildCapsule,
  CAPSULE_MAP_MAX_TOKENS,
  CAPSULE_MAX_TOKENS,
  cut,
  folderCounts,
  mapText,
  MODEL_TOKENS_PER_ITEM,
  modelTokens,
  WINDOW_IDLE_MS,
  WINDOW_MAX_TOKENS,
  windowCloseReason,
  withCapsule,
  type CapsuleTurn,
  type WindowState,
} from "./window.ts";

const w = (o: Partial<WindowState> = {}): WindowState => ({ sessionId: "s1", startedAt: 0, lastIdaAt: 1_000, tokens: 100, ...o });
const long = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ");

describe("windowCloseReason", () => {
  test("sem janela, começa uma (o tamanho da sessão aberta é desconhecido)", () => {
    expect(windowCloseReason(null, { now: 10 })).toBe("start");
    expect(windowCloseReason(null, { now: 10, asked: true })).toBe("asked");
  });
  test("esfriou: mais de 55 min sem ida", () => {
    expect(windowCloseReason(w(), { now: 1_000 + WINDOW_IDLE_MS })).toBeNull();
    expect(windowCloseReason(w(), { now: 1_001 + WINDOW_IDLE_MS })).toBe("idle");
  });
  test("engordou: mais de 6 mil tokens", () => {
    expect(windowCloseReason(w({ tokens: WINDOW_MAX_TOKENS }), { now: 2_000 })).toBeNull();
    expect(windowCloseReason(w({ tokens: WINDOW_MAX_TOKENS + 1 }), { now: 2_000 })).toBe("size");
  });
  test("pelo tamanho, nunca com a conversa do gato na tela; pela pausa, sim", () => {
    expect(windowCloseReason(w({ tokens: 50_000 }), { now: 2_000, conversationOpen: true })).toBeNull();
    expect(windowCloseReason(w({ tokens: 50_000 }), { now: 2_000 + WINDOW_IDLE_MS, conversationOpen: true })).toBe("idle");
  });
  test("o teto pode ir a zero (ADR 0013): cada pedido é uma janela", () => {
    expect(windowCloseReason(w({ tokens: 1 }), { now: 2_000, maxTokens: 0 })).toBe("size");
  });
  test("a pessoa pediu: fecha mesmo com a conversa na tela", () => {
    expect(windowCloseReason(w(), { now: 2_000, asked: true, conversationOpen: true })).toBe("asked");
  });
});

describe("cut", () => {
  test("texto curto fica igual, numa linha", () => {
    expect(cut("um  pedido\ncurto", 50)).toBe("um pedido curto");
  });
  test("texto longo sai com … e dentro do teto", () => {
    const c = cut(long(300), 40);
    expect(c.endsWith("…")).toBe(true);
    expect(modelTokens(c) - MODEL_TOKENS_PER_ITEM).toBeLessThanOrEqual(40);
    expect(modelTokens(c) - MODEL_TOKENS_PER_ITEM).toBeGreaterThan(30);
  });
  test("teto menor que uma palavra: vazio", () => {
    expect(cut("qualquer coisa", 1)).toBe("");
  });
});

describe("mapa da pasta", () => {
  test("conta as pastas do primeiro nível, das maiores para as menores", () => {
    const notes = [{ folder: "A/x" }, { folder: "A" }, { folder: "B" }, { folder: "" }, { folder: "A/y/z" }];
    expect(folderCounts(notes)).toEqual([
      { folder: "A", notes: 3 },
      { folder: "", notes: 1 },
      { folder: "B", notes: 1 },
    ]);
  });
  test("projetos primeiro, sem repetir a pasta deles; até 300 tokens com o 'e mais N'", () => {
    const projects = Array.from({ length: 40 }, (_, i) => ({ name: `Projeto ${i}`, folder: `Projetos/Projeto ${i}`, notes: 100 - i }));
    const folders = [{ folder: "Projetos", notes: 4000 }, ...Array.from({ length: 80 }, (_, i) => ({ folder: `Pasta ${i}`, notes: 80 - i }))];
    const t = mapText({ projects, folders });
    expect(t.startsWith("Mapa da pasta")).toBe(true);
    expect(t).toContain("Projetos/Projeto 0 (projeto, 100)");
    expect(t).not.toContain("Projetos (4000)");
    expect(t).toMatch(/e mais \d+$/);
    expect(modelTokens(t)).toBeLessThanOrEqual(CAPSULE_MAP_MAX_TOKENS);
  });
  test("pasta vazia: sem mapa", () => {
    expect(mapText({ projects: [], folders: [] })).toBe("");
  });
});

describe("buildCapsule", () => {
  const map = { projects: [{ name: "Kiwi", folder: "Projetos/Kiwi", notes: 12 }], folders: [{ folder: "Diário", notes: 300 }] };
  test("os 3 últimos pedidos, do mais velho ao mais novo, com as notas tocadas e o mapa, num bloco entre colchetes", () => {
    const turns: CapsuleTurn[] = [1, 2, 3, 4].map((i) => ({ request: `pedido ${i}`, answer: `resposta ${i}`, read: [`N${i}.md`], changed: i === 4 ? ["M.md"] : [] }));
    const c = buildCapsule(turns, map);
    expect(c.startsWith("[A conversa de antes")).toBe(true);
    expect(c.endsWith("\n]")).toBe(true);
    // Um pedido com quebras de linha e um "]" sozinho não fecha o bloco antes da hora.
    const tricky = buildCapsule([{ request: "um\n]\ndois", answer: "a\n]", read: [], changed: [] }], null);
    expect(tricky.match(/\n\]/g)).toHaveLength(1);
    expect(c).not.toContain("pedido 1");
    expect(c.indexOf("pedido 2")).toBeLessThan(c.indexOf("pedido 4"));
    expect(c).toContain("Resposta: resposta 4");
    expect(c).toContain("Notas tocadas: M.md (mudada); N4.md (lida); N3.md (lida); N2.md (lida)");
    expect(c).toContain("Projetos/Kiwi (projeto, 12)");
    expect(c).toContain("Diário (300)");
  });
  test("pedidos e respostas enormes: cabe em 800 tokens, e o mais novo fica", () => {
    const turns: CapsuleTurn[] = [1, 2, 3].map((i) => ({ request: `PEDIDO${i} ${long(2000)}`, answer: long(5000), read: Array.from({ length: 30 }, (_, j) => `Pasta/Nota ${i}-${j}.md`), changed: [] }));
    const big = { projects: Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, folder: `Projetos/P${i}`, notes: i })), folders: [] };
    const c = buildCapsule(turns, big);
    expect(modelTokens(c)).toBeLessThanOrEqual(CAPSULE_MAX_TOKENS);
    expect(c).toContain("PEDIDO3");
    expect(c).toContain("Mapa da pasta");
  });
  test("teto apertado: saem os mais velhos primeiro, nunca passa do teto", () => {
    const turns: CapsuleTurn[] = [1, 2, 3].map((i) => ({ request: `PEDIDO${i} ${long(200)}`, answer: long(200), read: [], changed: [] }));
    for (const max of [800, 400, 200, 120, 60, 30]) {
      const c = buildCapsule(turns, map, max);
      if (c) expect(modelTokens(c)).toBeLessThanOrEqual(max);
    }
    const c = buildCapsule(turns, null, 150);
    expect(c).toContain("PEDIDO3");
    expect(c).not.toContain("PEDIDO1");
  });
  test("sem conversa e sem mapa: vazia, e o pedido vai sozinho", () => {
    expect(buildCapsule([], null)).toBe("");
    expect(withCapsule("", "oi")).toBe("oi");
    expect(withCapsule("[cápsula\n]", "oi")).toBe("[cápsula\n]\n\noi");
  });
});
