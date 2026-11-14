// O balão do gato (spec #9495, T10832): a fila, o corte entre palavras, o tempo de leitura, a ferramenta, o erro e o
// [Ver mais], com o relógio na mão. A medida do balão aqui é por caracteres (a tela mede em pixels).

import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent } from "../../src/shared/ui-contract";
import { BubbleFeed, readingMs, splitChunks, TYPE_MS, WEB_LINE } from "./bubble-state";

const fits = (max: number) => (s: string) => [...s].length <= max;
const ev = (e: Record<string, unknown>) => ({ id: "p1", ...e }) as AgentTurnEvent;

/** Anda o relógio até o balão mudar de verdade, e devolve os trechos completos que passaram por ele. */
function play(feed: BubbleFeed, from: number, until = from + 120_000): { chunks: string[]; end: number } {
  const chunks: string[] = [];
  let now = from;
  while (now < until) {
    const v = feed.view(now);
    if (!v) break;
    if (v.text === v.full && chunks.at(-1) !== v.full) chunks.push(v.full);
    const next = feed.nextWake(now);
    if (!Number.isFinite(next)) break;
    now = next;
  }
  return { chunks, end: now };
}

describe("o corte entre palavras", () => {
  test("nunca no meio de uma palavra, e a palavra maior que o balão é a única cortada", () => {
    expect(splitChunks("um dois três quatro cinco", fits(9)).map((c) => c.text)).toEqual(["um dois", "três", "quatro", "cinco"]);
    expect(splitChunks("ab https://exemplo.com/um/caminho cd", fits(10)).map((c) => c.text)).toEqual(["ab", "https://ex", "emplo.com/", "um/caminho", "cd"]);
    // As quebras de linha dentro do trecho ficam (a lista continua legível).
    expect(splitChunks("- um\n- dois\n- três", fits(11)).map((c) => c.text)).toEqual(["- um\n- dois", "- três"]);
    expect(splitChunks("   ", fits(5))).toEqual([]);
  });

  test("o tempo de leitura: 1,5 s mais 60 ms por caractere, entre 2 e 8 s", () => {
    expect(readingMs("oi")).toBe(2000);
    expect(readingMs("x".repeat(50))).toBe(4500);
    expect(readingMs("x".repeat(500))).toBe(8000);
  });
});

describe("o balão", () => {
  test("a resposta aparece digitada; depois do done fica o tempo de leitura e some", () => {
    const f = new BubbleFeed(fits(40));
    f.event(ev({ type: "started" }), 0);
    expect(f.view(0)).toBeNull();
    f.event(ev({ type: "text", text: "Olá, " }), 10);
    expect(f.view(10)).toMatchObject({ text: "", full: "Olá, ", more: false });
    expect(f.view(10 + 2 * TYPE_MS)!.text).toBe("Ol");
    f.event(ev({ type: "text", text: "tudo bem?" }), 50);
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Olá, tudo bem?" }), 60);
    const typedAt = 10 + "Olá, tudo bem?".length * TYPE_MS;
    expect(f.view(typedAt)).toMatchObject({ text: "Olá, tudo bem?", more: false });
    expect(f.view(typedAt + readingMs("Olá, tudo bem?") - 1)).not.toBeNull();
    expect(f.view(typedAt + readingMs("Olá, tudo bem?"))).toBeNull();
    // O leitor de tela: uma vez, com o texto inteiro.
    expect(f.takeAnnouncement()).toBe("Olá, tudo bem?");
    expect(f.takeAnnouncement()).toBeNull();
  });

  test("uma resposta longa vira uma fila de trechos, cada um pelo tempo de leitura, e o texto rápido espera a vez", () => {
    const f = new BubbleFeed(fits(20));
    const text = "Esta resposta é longa demais para um balão só, então ela vira vários trechos em fila.";
    f.event(ev({ type: "started" }), 0);
    // Tudo chega de uma vez: a fila guarda o resto.
    f.event(ev({ type: "text", text }), 0);
    f.event(ev({ type: "done", stopReason: "end_turn", text }), 0);
    expect(f.view(0)!.more).toBe(true);
    const { chunks, end } = play(f, 0);
    expect(chunks).toEqual(splitChunks(text, fits(20)).map((c) => c.text));
    expect(chunks.join(" ")).toBe(text);
    for (const c of chunks) expect([...c].length).toBeLessThanOrEqual(20);
    // Cada trecho ficou o tempo de digitar mais o de ler.
    const total = chunks.reduce((t, c) => t + [...c].length * TYPE_MS + readingMs(c), 0);
    expect(end).toBe(total);
  });

  test("o último trecho espera o resto enquanto o pedido roda", () => {
    const f = new BubbleFeed(fits(40));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Primeira parte." }), 0);
    expect(f.nextWake(10_000)).toBe(Infinity);
    expect(f.view(60_000)!.text).toBe("Primeira parte.");
  });

  test("o texto antes de uma ferramenta sai quando ela começa; a resposta final entra num balão novo; o Ver mais tem tudo", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Vou ler a nota." }), 0);
    expect(f.view(1000)!.text).toBe("Vou ler a nota.");
    f.event(ev({ type: "status", status: "running", tool: "notes_read" }), 1000);
    expect(f.view(1000)).toBeNull();
    f.event(ev({ type: "status", status: "thinking" }), 1500);
    f.event(ev({ type: "text", text: "O prazo é março." }), 2000);
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Vou ler a nota.O prazo é março." }), 2100);
    expect(f.view(2000 + 20 * TYPE_MS)).toMatchObject({ full: "O prazo é março.", more: true });
    expect(f.all()).toBe("Vou ler a nota.O prazo é março.");
  });

  test("o done que traz um texto que não chegou em pedaços entra inteiro", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Tudo de uma vez." }), 0);
    expect(f.view(0)).toMatchObject({ full: "Tudo de uma vez." });
  });

  test("no erro, a mensagem em uma linha, sem digitação", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Começando" }), 0);
    f.event(ev({ type: "error", code: "E_AGENT_EXITED", message: "O agente parou.\ndetalhe técnico" }), 100);
    expect(f.view(100)).toMatchObject({ text: "O agente parou.", full: "O agente parou.", error: true, more: false });
    expect(f.view(100 + readingMs("O agente parou."))).toBeNull();
  });

  test("um pedido novo fecha o balão do anterior, e o atrasado do anterior é ignorado", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Resposta velha" }), 0);
    f.event({ id: "p2", type: "started" }, 100);
    expect(f.view(100)).toBeNull();
    f.event(ev({ type: "text", text: " atrasada" }), 110);
    expect(f.view(5000)).toBeNull();
    f.event({ id: "p2", type: "text", text: "Nova" }, 200);
    expect(f.view(5000)!.full).toBe("Nova");
  });

  test("cancelado, o balão fecha; o clique fecha e o resto do pedido não volta", () => {
    const c = new BubbleFeed(fits(60));
    c.event(ev({ type: "started" }), 0);
    c.event(ev({ type: "text", text: "meio" }), 0);
    c.event(ev({ type: "done", stopReason: "cancelled", text: "" }), 10);
    expect(c.view(10)).toBeNull();
    const k = new BubbleFeed(fits(60));
    k.event(ev({ type: "started" }), 0);
    k.event(ev({ type: "text", text: "um texto" }), 0);
    k.close();
    k.event(ev({ type: "text", text: " e mais" }), 10);
    k.event(ev({ type: "done", stopReason: "end_turn", text: "um texto e mais" }), 20);
    expect(k.view(30)).toBeNull();
    expect(k.all()).toBe("um texto e mais");
    // Fechado o balão, o leitor de tela ainda ouve a resposta inteira, uma vez (#10936). O cancelado, nada.
    expect(k.takeAnnouncement()).toBe("um texto e mais");
    expect(k.takeAnnouncement()).toBeNull();
    expect(c.takeAnnouncement()).toBeNull();
  });

  test("com o Reduzir movimento, cada trecho aparece inteiro pelo mesmo tempo de leitura", () => {
    const f = new BubbleFeed(fits(60), true);
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Inteiro de uma vez." }), 0);
    expect(f.view(0)!.text).toBe("Inteiro de uma vez.");
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Inteiro de uma vez." }), 0);
    expect(f.view(readingMs("Inteiro de uma vez.") - 1)).not.toBeNull();
    expect(f.view(readingMs("Inteiro de uma vez."))).toBeNull();
  });

  test("palavras que chegam com o espaço no fim (como o agente manda) também fecham o trecho na tela", () => {
    const f = new BubbleFeed(fits(12));
    f.event(ev({ type: "started" }), 0);
    const words = "um dois três quatro cinco seis sete oito".split(/(?<=\s)/);
    let now = 0;
    for (const w of words) {
      f.event(ev({ type: "text", text: w }), now);
      now += 40;
    }
    f.event(ev({ type: "done", stopReason: "end_turn", text: words.join("") }), now);
    const { chunks, end } = play(f, now);
    expect(chunks).toEqual(["um dois três", "quatro cinco", "seis sete", "oito"]);
    expect(f.view(end)).toBeNull();
  });

  test("o texto chega aos poucos e os trechos completos entram na fila conforme chegam", () => {
    const f = new BubbleFeed(fits(12));
    f.event(ev({ type: "started" }), 0);
    let all = "";
    for (const w of "um dois três quatro cinco seis sete oito".split(" ")) {
      all += (all ? " " : "") + w;
      f.event(ev({ type: "text", text: (all === w ? "" : " ") + w }), 0);
    }
    f.event(ev({ type: "done", stopReason: "end_turn", text: all }), 0);
    const { chunks } = play(f, 0);
    expect(chunks).toEqual(["um dois três", "quatro cinco", "seis sete", "oito"]);
  });

  test("o limite (spec #11084): o aviso do agente entra como um trecho sem parar a resposta; o limite acabado mostra a hora de volta", () => {
    const f = new BubbleFeed(fits(80), true);
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Começando." }), 0);
    f.event(ev({ type: "limit", status: "warning", percent: 82 }), 10);
    f.event(ev({ type: "text", text: " E terminando." }), 20);
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Começando. E terminando." }), 30);
    const { chunks } = play(f, 30);
    expect(chunks).toContain("Você já usou 82% do seu limite. Eu sigo, mas vale ir com calma.");
    expect(chunks.join(" ")).toContain("E terminando.");
    // O limite acabado: o erro de limite vem com a hora que o agente informou.
    // O relógio do balão (aqui 0) não é o de parede: a hora de volta se lê no de parede.
    const out = new BubbleFeed(fits(80), false, () => new Date(2026, 10, 13, 14, 0).getTime());
    out.event(ev({ type: "started" }), 0);
    const resetsAt = new Date(2026, 10, 13, 18, 40).toISOString();
    out.event(ev({ type: "limit", status: "out", resetsAt }), 0);
    out.event(ev({ type: "error", code: "E_AGENT_LIMIT", message: "O Claude Code atingiu o limite de uso da sua conta." }), 0);
    expect(out.view(0)!.text).toBe("O seu limite acabou. Ele volta às 18h40.");
    // Sem a hora, o erro do agente fica como está.
    const plain = new BubbleFeed(fits(80));
    plain.event(ev({ type: "started" }), 0);
    plain.event(ev({ type: "error", code: "E_AGENT_LIMIT", message: "O Claude Code atingiu o limite de uso da sua conta." }), 0);
    expect(plain.view(0)!.text).toBe("O Claude Code atingiu o limite de uso da sua conta.");
  });
});

test("a web (spec #11908): o balão diz que o agente está pesquisando, e a resposta vem depois", () => {
  const f = new BubbleFeed(fits(60));
  f.event(ev({ type: "started" }), 0);
  f.event(ev({ type: "status", status: "running", tool: "web" }), 10);
  expect(f.view(10 + WEB_LINE.length * TYPE_MS)).toMatchObject({ text: WEB_LINE, more: false });
  // Outra ferramenta não diz isso.
  const g = new BubbleFeed(fits(60));
  g.event(ev({ type: "started" }), 0);
  g.event(ev({ type: "status", status: "running", tool: "notes_read" }), 10);
  expect(g.view(1000)).toBeNull();
});

describe("a chave de cada balão (spec #11652)", () => {
  test("muda a cada trecho novo, e não com o texto que chega no mesmo trecho", () => {
    const fits = (s: string) => s.length <= 40;
    const f = new BubbleFeed(fits, true);
    f.event({ type: "started", id: "r1" } as never, 0);
    f.event({ type: "text", id: "r1", text: "Olá, " } as never, 0);
    const first = f.view(10)!.key;
    f.event({ type: "text", id: "r1", text: "tudo bem?" } as never, 20);
    expect(f.view(30)!.key).toBe(first);
    // Um texto longo vira uma fila: cada trecho é um balão novo, com outra chave.
    f.event({ type: "text", id: "r1", text: " Este pedaço é bem mais longo e não cabe no mesmo balão que o primeiro." } as never, 40);
    f.event({ type: "done", id: "r1", stopReason: "end_turn", text: "" } as never, 50);
    const keys = new Set<number>();
    for (let t = 50; t < 60_000; t += 250) {
      const v = f.view(t);
      if (v) keys.add(v.key);
    }
    expect(keys.size).toBeGreaterThan(1);
    expect(keys.has(first)).toBe(true);
  });
});
