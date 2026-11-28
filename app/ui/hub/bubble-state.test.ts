// O balão do gato (spec #9495, T10832; um balão só desde o spec #27881): o resumo, a fala do `cat_speak`, a linha de
// estado, o erro, o [Ver mais] e o pedido novo, com o relógio na mão. A medida do balão aqui é por caracteres (a tela
// mede em pixels).

import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent, BubbleLink } from "../../src/shared/ui-contract";
import { ANSWER_HOLD_MS, BubbleFeed, bubblePlain, plainLinks, readingMs, summaryOf, webLine } from "./bubble-state";

const fits = (max: number) => (s: string) => [...s].length <= max;
const ev = (e: Record<string, unknown>) => ({ id: "p1", ...e }) as AgentTurnEvent;

/** Um pedido inteiro: os eventos na ordem, com o relógio parado em 0. */
function run(f: BubbleFeed, events: Record<string, unknown>[], id = "p1"): BubbleFeed {
  f.event({ id, type: "started" } as AgentTurnEvent, 0);
  for (const e of events) f.event({ id, ...e } as AgentTurnEvent, 0);
  return f;
}

const LONGA =
  "Achei três notas sobre o Projeto X. A mais nova é de ontem, com o prazo de sexta. As outras duas falam da reunião com a Ana e do orçamento, que ainda espera a resposta do Bruno.";

describe("o resumo (spec #27881)", () => {
  test("cabe inteiro: o texto todo; não cabe: as frases do começo que cabem", () => {
    expect(summaryOf("  Pronto.  ", fits(40))).toBe("Pronto.");
    expect(summaryOf(LONGA, fits(90))).toBe("Achei três notas sobre o Projeto X. A mais nova é de ontem, com o prazo de sexta.");
    expect(summaryOf(LONGA, fits(60))).toBe("Achei três notas sobre o Projeto X.");
    // A interrogação, a exclamação e as reticências também fecham a frase; a quebra de linha também (uma lista).
    expect(summaryOf("Quer que eu abra? Posso também resumir a nota inteira.", fits(30))).toBe("Quer que eu abra?");
    expect(summaryOf("Os prazos:\n- Ana, sexta\n- Bruno, segunda e terça", fits(24))).toBe("Os prazos:\n- Ana, sexta");
  });

  test("o título do começo não é o resumo: as frases do parágrafo (#28009)", () => {
    // Título + parágrafo longo: as frases dele que cabem, sem o título.
    expect(summaryOf(`A mudança\n${LONGA}`, fits(60))).toBe("Achei três notas sobre o Projeto X.");
    // Dois títulos seguidos (o `#` e o `##`): os dois ficam de fora.
    expect(summaryOf(bubblePlain(`# Projeto X\n\n## As notas\n\n${LONGA}`), fits(60))).toBe("Achei três notas sobre o Projeto X.");
    // Título + parágrafo curto, que não cabem juntos: o parágrafo inteiro.
    expect(summaryOf("Uma linha de título bem comprida aqui\nPronto, anotei.", fits(30))).toBe("Pronto, anotei.");
    // Nem a primeira frase do parágrafo cabe: as palavras dele, com "…", e não o título.
    expect(summaryOf(`A mudança\n${LONGA}`, fits(20))).toBe("Achei três notas…");
    // Só o título, ou tudo cabendo: o texto como está.
    expect(summaryOf("A mudança da Ana", fits(20))).toBe("A mudança da Ana");
    expect(summaryOf("A mudança\nPronto.", fits(40))).toBe("A mudança\nPronto.");
    // A linha que termina em pontuação não é título, e o item de lista também não.
    expect(summaryOf("Os prazos:\n- Ana, sexta\n- Bruno, segunda e terça", fits(24))).toBe("Os prazos:\n- Ana, sexta");
    expect(summaryOf("• Ana, sexta\n• Bruno, segunda e terça", fits(14))).toBe("• Ana, sexta");
  });

  test("o pulo do título para no título: as linhas curtas seguidas e a tabela ficam (#28077)", () => {
    const tabela = "| Dia | Leitura |\n| --- | --- |\n| Segunda | Capítulo 1 |\n| Terça | Capítulo 2 |\n| Quarta | Capítulo 3 |";
    // Título + tabela: o título sai, e o resumo é o começo da tabela, não a última linha.
    expect(summaryOf(bubblePlain(`## Notas da semana\n\n${tabela}`), fits(40))).toBe("Dia · Leitura\nSegunda · Capítulo 1");
    // A tabela sem título: o começo dela.
    expect(summaryOf(bubblePlain(tabela), fits(40))).toBe("Dia · Leitura\nSegunda · Capítulo 1");
    // Linhas curtas seguidas, sem parágrafo: nenhuma é título, o resumo é o começo.
    expect(summaryOf("Comando\nbun run exemplo start\nbun run exemplo stop", fits(32))).toBe("Comando\nbun run exemplo start");
    // Três linhas curtas antes do parágrafo já são conteúdo: o resumo começa nelas.
    expect(summaryOf(`Ana\nBruno\nCarla\n${LONGA}`, fits(20))).toBe("Ana\nBruno\nCarla");
    // Um título e um subtítulo, sem nada depois: os dois ficam.
    expect(summaryOf("Projeto X\nAs notas", fits(10))).toBe("Projeto X");
  });

  test("nem a primeira frase cabe: entre palavras, com \"…\"; uma palavra maior que o balão, pelas letras", () => {
    const s = summaryOf(LONGA, fits(20));
    expect(s).toBe("Achei três notas…");
    expect([...s].length).toBeLessThanOrEqual(20);
    // A vírgula do fim sai antes das reticências.
    expect(summaryOf("Abri a nota, li as seções e achei o prazo.", fits(14))).toBe("Abri a nota…");
    expect(summaryOf("https://exemplo.com/um/caminho/longo", fits(10))).toBe("https://e…");
    expect(summaryOf("   ", fits(10))).toBe("");
  });
});

describe("o balão único", () => {
  test("uma resposta longa mostra um balão só, com o resumo, que não muda com o relógio andando", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    // O texto chegando não vai ao balão: o andamento diz que ele escreve (T33177), num balão só.
    let step: number | undefined;
    for (const [i, w] of LONGA.split(/(?<= )/).entries()) {
      f.event(ev({ type: "text", text: w }), i * 10);
      expect(f.view(i * 10)).toMatchObject({ text: "Escrevendo a resposta", stop: true, more: false });
      step ??= f.view(i * 10)!.key;
      expect(f.view(i * 10)!.key).toBe(step);
    }
    f.event(ev({ type: "done", stopReason: "end_turn", text: LONGA }), 5000);
    const v = f.view(5000)!;
    expect(v).toEqual({ text: "Achei três notas sobre o Projeto X.", full: "Achei três notas sobre o Projeto X.", error: false, more: true, key: v.key });
    // Nada muda sozinho: nem a chave, nem o texto, por mais que o relógio ande.
    expect(f.nextWake(5000)).toBe(Infinity);
    for (const t of [5001, 8000, 60_000, 3_600_000]) expect(f.view(t)).toEqual(v);
    expect(f.all()).toBe(LONGA);
    // O leitor de tela: uma vez, com o texto inteiro.
    expect(f.takeAnnouncement()).toBe(LONGA);
    expect(f.takeAnnouncement()).toBeNull();
  });

  test("com o cat_speak, o resumo é a fala dele (sem Markdown); sem, o começo cortado em frase", () => {
    const com = run(new BubbleFeed(fits(80)), [
      { type: "status", status: "running", tool: "cat_speak" },
      { type: "speech", text: "Achei **três** notas. A mais nova é de ontem." },
      { type: "status", status: "thinking" },
      { type: "text", text: LONGA },
      { type: "done", stopReason: "end_turn", text: LONGA },
    ]);
    expect(com.view(0)).toMatchObject({ text: "Achei três notas. A mais nova é de ontem.", more: true });
    // A fala longa demais para o balão também é cortada, em frase.
    const longa = run(new BubbleFeed(fits(30)), [
      { type: "speech", text: "Achei três notas. A mais nova é de ontem, com o prazo." },
      { type: "done", stopReason: "end_turn", text: LONGA },
    ]);
    expect(longa.view(0)!.text).toBe("Achei três notas.");
    const sem = run(new BubbleFeed(fits(90)), [{ type: "done", stopReason: "end_turn", text: LONGA }]);
    expect(sem.view(0)!.text).toBe("Achei três notas sobre o Projeto X. A mais nova é de ontem, com o prazo de sexta.");
    const curto = run(new BubbleFeed(fits(20)), [{ type: "done", stopReason: "end_turn", text: LONGA }]);
    expect(curto.view(0)!.text).toBe("Achei três notas…");
  });

  test("o texto entre as ferramentas não aparece no balão e está no [Ver mais]", () => {
    const antes = "Vou procurar nas suas notas.";
    const depois = "Achei a nota do Projeto X.";
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: antes }), 0);
    // Só o passo (T33177), nunca o texto do agente.
    expect(f.view(0)!.full).toBe("Escrevendo a resposta");
    f.event(ev({ type: "status", status: "running", tool: "kiwi" }), 10);
    f.event(ev({ type: "status", status: "running", tool: "notes_search" }), 15);
    expect(f.view(15)!.full).toBe("Procurando nas suas notas");
    f.event(ev({ type: "status", status: "thinking" }), 20);
    f.event(ev({ type: "text", text: `\n\n${depois}` }), 30);
    expect(f.view(30)!.full).toBe("Escrevendo a resposta");
    f.event(ev({ type: "done", stopReason: "end_turn", text: `${antes}\n\n${depois}` }), 40);
    // O resumo é a resposta final, a de depois da última ferramenta; o [Ver mais] tem as duas.
    expect(f.view(40)).toMatchObject({ text: depois, more: true });
    expect(f.all()).toBe(`${antes}\n\n${depois}`);
    // Sem nada depois da última ferramenta, o resumo sai do pedido inteiro.
    const g = run(new BubbleFeed(fits(60)), [
      { type: "text", text: antes },
      { type: "status", status: "running", tool: "kiwi" },
      { type: "done", stopReason: "end_turn", text: antes },
    ]);
    expect(g.view(0)).toMatchObject({ text: antes, more: false });
  });

  test("o done que traz um texto que não chegou em pedaços entra inteiro", () => {
    const f = run(new BubbleFeed(fits(60)), [{ type: "done", stopReason: "end_turn", text: "Tudo de uma vez." }]);
    expect(f.view(0)).toMatchObject({ text: "Tudo de uma vez.", more: false });
  });

  test("o [Ver mais] só quando a resposta inteira é maior que o resumo", () => {
    const igual = run(new BubbleFeed(fits(60)), [{ type: "done", stopReason: "end_turn", text: "Anotei na **nota**." }]);
    expect(igual.view(0)).toMatchObject({ text: "Anotei na nota.", more: false });
    // A fala igual à resposta: nada a mais para ver.
    const fala = run(new BubbleFeed(fits(60)), [
      { type: "speech", text: "Anotei na nota." },
      { type: "done", stopReason: "end_turn", text: "Anotei na nota." },
    ]);
    expect(fala.view(0)!.more).toBe(false);
    const maior = run(new BubbleFeed(fits(60)), [
      { type: "speech", text: "Anotei na nota." },
      { type: "done", stopReason: "end_turn", text: "Anotei na nota. Ela ficou na pasta Projeto X." },
    ]);
    expect(maior.view(0)!.more).toBe(true);
  });
});

describe("o balão junto com a voz (T33053, Cena 1)", () => {
  test("nasce no `speech`, com a fala; o `done` só lhe dá o [Ver mais], com o mesmo key e o mesmo texto", () => {
    const f = new BubbleFeed(fits(80));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "status", status: "running", tool: "cat_speak" }), 10);
    // Antes da fala, o andamento (T33177).
    expect(f.view(10)).toMatchObject({ text: "Escrevendo a resposta", stop: true });
    f.event(ev({ type: "speech", text: "Achei **três** notas. A mais nova é de ontem." }), 20);
    const cedo = f.view(20)!;
    expect(cedo).toMatchObject({ text: "Achei três notas. A mais nova é de ontem.", more: false });
    // O agente segue: o texto e outra ferramenta não trocam o balão da fala.
    f.event(ev({ type: "status", status: "thinking" }), 30);
    f.event(ev({ type: "text", text: LONGA }), 40);
    f.event(ev({ type: "status", status: "running", tool: "web" }), 50);
    expect(f.view(50)).toEqual(cedo);
    f.event(ev({ type: "done", stopReason: "end_turn", text: LONGA }), 60);
    expect(f.view(60)).toEqual({ ...cedo, more: true });
  });

  test("sem voz também (o evento é o mesmo); a fala igual à resposta segue sem [Ver mais]", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "speech", text: "Anotei na nota." }), 10);
    const cedo = f.view(10)!;
    expect(cedo).toMatchObject({ text: "Anotei na nota.", more: false });
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Anotei na nota." }), 20);
    expect(f.view(20)).toEqual(cedo);
  });

  test("um pedido sem fala nasce no `done`, como antes", () => {
    const f = new BubbleFeed(fits(90));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: LONGA }), 10);
    // Até lá, só o andamento (T33177).
    expect(f.view(10)).toMatchObject({ text: "Escrevendo a resposta", stop: true });
    f.event(ev({ type: "done", stopReason: "end_turn", text: LONGA }), 20);
    expect(f.view(20)).toMatchObject({ text: "Achei três notas sobre o Projeto X. A mais nova é de ontem, com o prazo de sexta.", more: true });
    expect(f.view(20)!.stop).toBeUndefined();
  });

  test("dois pedidos falados seguidos: o 2º balão nasce com a 2ª fala, não com a do 1º (o `reset()` solta a fala)", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "speech", text: "Anotei na nota." }), 10);
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Anotei na nota." }), 20);
    const primeiro = f.view(20)!;
    expect(primeiro.text).toBe("Anotei na nota.");
    f.event(ev({ id: "p2", type: "started" }), 30);
    f.event(ev({ id: "p2", type: "speech", text: "Marquei para sexta." }), 40);
    const segundo = f.view(40)!;
    expect(segundo).toMatchObject({ text: "Marquei para sexta.", more: false });
    expect(segundo.key).not.toBe(primeiro.key);
    f.event(ev({ id: "p2", type: "done", stopReason: "end_turn", text: "Marquei para sexta." }), 50);
    expect(f.view(50)).toEqual(segundo);
  });

  test("cancelado depois da fala: o balão sai; fechado pelo ×: o `done` não o traz de volta", () => {
    const cancelado = run(new BubbleFeed(fits(60)), [{ type: "speech", text: "Anotei na nota." }, { type: "done", stopReason: "cancelled" }]);
    expect(cancelado.view(0)).toBeNull();
    const f = run(new BubbleFeed(fits(60)), [{ type: "speech", text: "Anotei na nota." }]);
    f.close();
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Anotei na nota. E mais." }), 0);
    expect(f.view(0)).toBeNull();
  });

  test("com o aviso de limite na tela, a fala espera o tempo de leitura dele", () => {
    const f = new BubbleFeed(fits(80));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "limit", status: "warning", percent: 90 }), 0);
    const aviso = f.view(0)!.text;
    f.event(ev({ type: "speech", text: "Anotei na nota." }), 100);
    expect(f.view(100)!.text).toBe(aviso);
    expect(f.view(readingMs(aviso))).toMatchObject({ text: "Anotei na nota.", more: false });
  });
});

describe("o que fica como antes", () => {
  test("no erro, a mensagem em uma linha, que fica até o ×", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Começando" }), 0);
    f.event(ev({ type: "error", code: "E_AGENT_EXITED", message: "O agente parou.\ndetalhe técnico" }), 100);
    const v = f.view(100);
    expect(v).toMatchObject({ text: "O agente parou.", full: "O agente parou.", error: true, more: false });
    expect(f.view(60_000)).toEqual(v);
    f.close();
    expect(f.view(60_000)).toBeNull();
  });

  test("um pedido novo fecha o balão do anterior, e o atrasado do anterior é ignorado", () => {
    const f = run(new BubbleFeed(fits(60)), [{ type: "done", stopReason: "end_turn", text: "Resposta velha." }]);
    f.event({ id: "p2", type: "started" }, 100);
    // A resposta velha fica no canto até o primeiro balão do novo, ou o ANSWER_HOLD_MS (T15377, mais abaixo).
    expect(f.view(100)!.full).toBe("Resposta velha.");
    expect(f.view(100 + ANSWER_HOLD_MS)).toBeNull();
    f.event(ev({ type: "text", text: " atrasada" }), 110);
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Resposta velha. atrasada" }), 110);
    expect(f.view(5000)).toBeNull();
    f.event({ id: "p2", type: "done", stopReason: "end_turn", text: "Nova." }, 200);
    expect(f.view(5000)!.full).toBe("Nova.");
  });

  test("cancelado, o balão fecha; o × fecha e o resto do pedido não volta", () => {
    const c = new BubbleFeed(fits(60));
    c.event(ev({ type: "started" }), 0);
    c.event(ev({ type: "status", status: "running", tool: "web" }), 0);
    c.event(ev({ type: "text", text: "meio" }), 0);
    c.event(ev({ type: "done", stopReason: "cancelled", text: "" }), 10);
    expect(c.view(10)).toBeNull();
    const k = new BubbleFeed(fits(60));
    k.event(ev({ type: "started" }), 0);
    k.event(ev({ type: "status", status: "running", tool: "web" }), 0);
    expect(k.view(0)!.text).toBe(webLine());
    k.close();
    k.event(ev({ type: "text", text: "um texto" }), 5);
    k.event(ev({ type: "status", status: "running", tool: "web" }), 8);
    k.event(ev({ type: "text", text: " e mais" }), 10);
    k.event(ev({ type: "done", stopReason: "end_turn", text: "um texto e mais" }), 20);
    expect(k.view(30)).toBeNull();
    expect(k.all()).toBe("um texto e mais");
    // Fechado o balão, o leitor de tela ainda ouve a resposta inteira, uma vez (#10936). O cancelado, nada.
    expect(k.takeAnnouncement()).toBe("um texto e mais");
    expect(k.takeAnnouncement()).toBeNull();
    expect(c.takeAnnouncement()).toBeNull();
    // O × na resposta: fecha, e o relógio não a traz de volta.
    const r = run(new BubbleFeed(fits(60)), [{ type: "done", stopReason: "end_turn", text: LONGA }]);
    r.close();
    expect(r.view(60_000)).toBeNull();
  });

  test("o limite (spec #11084): o aviso do agente é a linha de estado até a resposta, e fica o tempo de leitura (T28584); o limite acabado mostra a hora de volta", () => {
    const f = new BubbleFeed(fits(80));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "text", text: "Começando." }), 0);
    f.event(ev({ type: "limit", status: "warning", percent: 82 }), 10);
    const aviso = "Você já usou 82% do seu limite. Eu sigo, mas vale ir com calma.";
    expect(f.view(10)).toMatchObject({ text: aviso, more: false });
    f.event(ev({ type: "text", text: " E terminando." }), 20);
    // A resposta rápida espera o aviso ser lido (T28584): antes, ela o tirava da tela 20 ms depois.
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Começando. E terminando." }), 30);
    const lido = 10 + readingMs(aviso);
    expect(f.view(30)).toMatchObject({ text: aviso });
    expect(f.nextWake(30)).toBe(lido);
    expect(f.view(lido - 1)).toMatchObject({ text: aviso });
    expect(f.view(lido)).toMatchObject({ text: "Começando. E terminando.", more: false });
    expect(f.nextWake(lido)).toBe(Infinity);
    // Uma ferramenta que começa também espera; o × fecha tudo, e o que esperava não volta.
    const g = new BubbleFeed(fits(80));
    g.event(ev({ type: "started" }), 0);
    g.event(ev({ type: "limit", status: "warning", percent: 82 }), 0);
    g.event(ev({ type: "status", status: "running", tool: "web" }), 5);
    expect(g.view(5)).toMatchObject({ text: aviso });
    g.close();
    expect(g.view(readingMs(aviso))).toBeNull();
    // O erro não espera o aviso.
    const h = new BubbleFeed(fits(80));
    h.event(ev({ type: "started" }), 0);
    h.event(ev({ type: "limit", status: "warning", percent: 82 }), 0);
    h.event(ev({ type: "error", code: "E_X", message: "Deu errado." }), 5);
    expect(h.view(5)).toMatchObject({ text: "Deu errado.", error: true });
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

  test("com o app em English, o aviso e o limite acabado saem em inglês (T29063)", () => {
    const wall = () => new Date(2026, 10, 13, 14, 0).getTime();
    const f = new BubbleFeed(fits(80), false, wall, () => "en");
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "limit", status: "warning", percent: 82 }), 10);
    expect(f.view(10)!.text).toBe("You've used 82% of your limit. I'll keep going, but take it easy.");
    const out = new BubbleFeed(fits(80), false, wall, () => "en");
    out.event(ev({ type: "started" }), 0);
    out.event(ev({ type: "limit", status: "out", resetsAt: new Date(2026, 10, 13, 18, 40).toISOString() }), 0);
    out.event(ev({ type: "error", code: "E_AGENT_LIMIT", message: "usage limit reached" }), 0);
    expect(out.view(0)!.text).toBe("Your limit ran out. It comes back at 6:40 PM.");
  });

  test("a web (spec #11908): o balão diz que o agente está pesquisando, até a próxima ferramenta ou a resposta", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "status", status: "running", tool: "web" }), 10);
    expect(f.view(10)).toMatchObject({ text: webLine(), more: false, stop: true });
    // O texto que o agente diz depois da web não entra no balão: o passo vira o de escrever (T33177).
    f.event(ev({ type: "text", text: "Achei duas páginas." }), 20);
    expect(f.view(20)!.text).toBe("Escrevendo a resposta");
    // A ferramenta única, sem a ação de dentro, não troca o passo; a ação que chega em seguida troca.
    f.event(ev({ type: "status", status: "running", tool: "kiwi" }), 30);
    expect(f.view(30)!.text).toBe("Escrevendo a resposta");
    // Outra ferramenta não diz a web.
    const g = new BubbleFeed(fits(60));
    g.event(ev({ type: "started" }), 0);
    g.event(ev({ type: "status", status: "running", tool: "notes_read" }), 10);
    expect(g.view(1000)!.text).toBe("Lendo uma nota");
  });

  test("a fala entendida (spec #9876, #32534) fica em cima do andamento até a resposta", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.heard("p1", "resume a nota", 0);
    expect(f.view(0)).toMatchObject({ text: "Pensando", heard: "“resume a nota”", stop: true, more: false });
    f.event(ev({ type: "text", text: "Lendo." }), 10);
    expect(f.view(10)).toMatchObject({ text: "Escrevendo a resposta", heard: "“resume a nota”" });
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Resumi a nota." }), 20);
    expect(f.view(20)!.full).toBe("Resumi a nota.");
    expect(f.view(20)!.heard).toBeUndefined();
  });

  test("a chave muda a cada balão novo (spec #11652): a web, depois a resposta", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "status", status: "running", tool: "web" }), 0);
    const web = f.view(0)!.key;
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Achei." }), 10);
    expect(f.view(10)!.key).not.toBe(web);
  });
});

describe("a resposta de antes espera a nova entrar (T15377)", () => {
  // O `started` de um pedido novo zerava o balão, e a resposta nova só entrava no primeiro balão dela: entre os dois, o
  // canto ficava vazio, e a troca resposta → resposta virava "some e depois aparece" (o check da troca, #16046).
  const twoRequests = () => {
    const f = run(new BubbleFeed(fits(60)), [{ type: "done", stopReason: "end_turn", text: "Resposta velha." }]);
    const old = f.view(10)!;
    f.event({ id: "p2", type: "started" }, 100);
    return { f, old };
  };

  test("fica no canto, igual, até o primeiro balão do pedido novo, e o novo entra com outra chave", () => {
    const { f, old } = twoRequests();
    expect(f.view(100)).toEqual({ ...old, more: false });
    expect(f.view(900)!.key).toBe(old.key);
    // O primeiro passo do pedido novo (T33177) toma o lugar, com outra chave; os passos seguintes ficam nela.
    f.event({ id: "p2", type: "status", status: "thinking" }, 900);
    const v = f.view(900)!;
    expect(v.full).toBe("Pensando");
    expect(v.key).not.toBe(old.key);
    f.event({ id: "p2", type: "status", status: "running", tool: "web" }, 950);
    expect(f.view(950)).toMatchObject({ full: webLine(), key: v.key });
  });

  test("no máximo ANSWER_HOLD_MS, e o relógio do balão acorda nessa hora", () => {
    const { f, old } = twoRequests();
    expect(f.nextWake(100)).toBe(100 + ANSWER_HOLD_MS);
    expect(f.view(100 + ANSWER_HOLD_MS - 1)!.key).toBe(old.key);
    expect(f.view(100 + ANSWER_HOLD_MS)).toBeNull();
    expect(f.nextWake(100 + ANSWER_HOLD_MS)).toBe(Infinity);
  });

  test("o erro do pedido novo toma o lugar dela no mesmo quadro", () => {
    const { f } = twoRequests();
    f.event({ id: "p2", type: "error", code: "E_AGENT_EXITED", message: "O agente parou." }, 300);
    expect(f.view(300)).toMatchObject({ full: "O agente parou.", error: true });
  });

  test("o pedido novo cancelado, ou que acaba sem texto, solta o canto", () => {
    const a = twoRequests().f;
    a.event({ id: "p2", type: "done", stopReason: "cancelled" } as AgentTurnEvent, 300);
    expect(a.view(300)).toBeNull();
    const b = twoRequests().f;
    b.event({ id: "p2", type: "done", stopReason: "end_turn" } as AgentTurnEvent, 300);
    expect(b.view(300)).toBeNull();
  });

  test("o × (ou o Esc) fecha", () => {
    const { f } = twoRequests();
    f.close();
    expect(f.view(200)).toBeNull();
  });

  test("dois pedidos seguidos não esticam o prazo; sem balão antes, nada fica", () => {
    const { f, old } = twoRequests();
    f.event({ id: "p3", type: "started" }, 1000);
    expect(f.view(1000)!.key).toBe(old.key);
    expect(f.view(100 + ANSWER_HOLD_MS)).toBeNull();
    const empty = new BubbleFeed(fits(60));
    empty.event(ev({ type: "started" }), 0);
    expect(empty.view(0)).toBeNull();
    expect(empty.nextWake(0)).toBe(Infinity);
  });

  test("a pergunta mandada pelo campo fecha a resposta antes do started (o drop do CatBubble): nada fica para esperar", () => {
    const f = run(new BubbleFeed(fits(60)), [{ type: "done", stopReason: "end_turn", text: "Resposta velha." }]);
    f.close();
    f.event({ id: "p2", type: "started" }, 100);
    expect(f.view(100)).toBeNull();
    f.event({ id: "p2", type: "done", stopReason: "end_turn", text: "Nova." }, 300);
    expect(f.view(300)!.full).toBe("Nova.");
  });

  test("a fala entendida do pedido novo também toma o lugar", () => {
    const { f } = twoRequests();
    f.heard("p2", "abre a nota", 200);
    expect(f.view(200)).toMatchObject({ full: "Pensando", heard: "“abre a nota”" });
  });
});

describe("o markdown no balão pequeno (spec #17679)", () => {
  const RESPOSTA = [
    "Resumo: o **prazo final do Projeto X fica para sexta-feira** e a Ana confirma.",
    "",
    "## Quem faz o quê",
    "",
    "| Nome | Prazo | Status |",
    "|---|---|---|",
    "| Ana | sexta | ok |",
    "| Bruno | segunda | `revisar` |",
  ].join("\n");

  test("o resumo sai do texto corrido: sem |, **, # nem `, em qualquer tamanho de balão", () => {
    for (const max of [12, 40, 80, 120]) {
      const f = run(new BubbleFeed(fits(max)), [{ type: "done", stopReason: "end_turn", text: RESPOSTA }]);
      const v = f.view(0)!;
      expect({ max, text: v.text, symbols: /[|*#`]/.test(v.text) }).toEqual({ max, text: v.text, symbols: false });
      expect([...v.text].length).toBeLessThanOrEqual(max);
      expect(v.more).toBe(true);
    }
    // Cabe inteiro: o balão é a resposta toda, sem o [Ver mais].
    const all = run(new BubbleFeed(fits(400)), [{ type: "done", stopReason: "end_turn", text: RESPOSTA }]);
    expect(all.view(0)!.more).toBe(false);
    const f = run(new BubbleFeed(fits(80)), [{ type: "done", stopReason: "end_turn", text: RESPOSTA }]);
    expect(f.view(0)!.text).toBe("Resumo: o prazo final do Projeto X fica para sexta-feira e a Ana confirma.");
  });

  test("o corrido mostra o nome da nota, sem os colchetes (#18271)", () => {
    expect(bubblePlain("Veja [[Plano]], [[Plano|o plano]], [[Plano#Seção]] e ![[img.png]].")).toBe("Veja Plano, o plano, Plano e img.png.");
  });
});

describe("as notas e os arquivos no balão pequeno (spec #17683)", () => {
  // Um "Plano" solto antes da menção: o link vai na menção, não na primeira palavra igual.
  const TEXTO = "O Plano de hoje: criei [[Plano|o plano]] na pasta e salvei `Projeto X/relatorio.pdf` com os números da Ana.";
  const at = (text: string, path: string, kind: BubbleLink["kind"]): BubbleLink => {
    const from = TEXTO.indexOf(text);
    return { text, from, to: from + text.length, path, kind };
  };
  const LINKS = [at("[[Plano|o plano]]", "Plano.md", "note"), at("`Projeto X/relatorio.pdf`", "Projeto X/relatorio.pdf", "file")];
  const labels = (f: BubbleFeed) => {
    const v = f.view(0)!;
    return (v.links ?? []).map((l) => [v.full.slice(l.from, l.to), l.path]);
  };

  test("plainLinks acha o rótulo na menção, na ordem", () => {
    const plain = bubblePlain(TEXTO);
    const got = plainLinks(TEXTO, LINKS).map((l) => [plain.slice(l.from, l.to), l.path]);
    expect(got).toEqual([["o plano", "Plano.md"], ["Projeto X/relatorio.pdf", "Projeto X/relatorio.pdf"]]);
    expect(plainLinks(TEXTO, LINKS)[0]!.from).toBe(plain.indexOf("o plano"));
  });

  test("o resumo leva os links do que aparece dele; um rótulo cortado, só o pedaço que aparece", () => {
    const inteiro = run(new BubbleFeed(fits(200)), [{ type: "done", stopReason: "end_turn", text: TEXTO, links: LINKS }]);
    expect(labels(inteiro)).toEqual([["o plano", "Plano.md"], ["Projeto X/relatorio.pdf", "Projeto X/relatorio.pdf"]]);
    // Cortado antes do pdf: só o plano.
    const curto = run(new BubbleFeed(fits(50)), [{ type: "done", stopReason: "end_turn", text: TEXTO, links: LINKS }]);
    expect(curto.view(0)!.full).toEndWith("…");
    expect(labels(curto)).toEqual([["o plano", "Plano.md"]]);
    // O pdf cortado no meio: o pedaço dele que aparece, sem as reticências.
    const meio = run(new BubbleFeed(fits(70)), [{ type: "done", stopReason: "end_turn", text: TEXTO, links: LINKS }]);
    const [, pdf] = labels(meio);
    expect(pdf![1]).toBe("Projeto X/relatorio.pdf");
    expect("Projeto X/relatorio.pdf".startsWith(pdf![0]!)).toBe(true);
    expect(pdf![0]).not.toContain("…");
    // A resposta final depois de uma ferramenta: os links contam do começo do `done`.
    const antes = "Vou procurar.\n\n";
    const depois = run(new BubbleFeed(fits(200)), [
      { type: "text", text: antes },
      { type: "status", status: "running", tool: "kiwi" },
      { type: "text", text: TEXTO },
      { type: "done", stopReason: "end_turn", text: antes + TEXTO, links: LINKS.map((l) => ({ ...l, from: l.from + antes.length, to: l.to + antes.length })) },
    ]);
    expect(depois.view(0)!.full).toBe(bubblePlain(TEXTO));
    expect(labels(depois)).toEqual([["o plano", "Plano.md"], ["Projeto X/relatorio.pdf", "Projeto X/relatorio.pdf"]]);
    // Com um título antes, que fica fora do resumo: os links contam de onde o resumo começa.
    const titulo = "## Os arquivos\n\n";
    const comTitulo = run(new BubbleFeed(fits(110)), [
      { type: "done", stopReason: "end_turn", text: titulo + TEXTO + "\n\nMais um parágrafo para não caber inteiro." + " Outra frase.".repeat(20), links: LINKS.map((l) => ({ ...l, from: l.from + titulo.length, to: l.to + titulo.length })) },
    ]);
    expect(comTitulo.view(0)!.full).toBe(bubblePlain(TEXTO));
    expect(labels(comTitulo)).toEqual([["o plano", "Plano.md"], ["Projeto X/relatorio.pdf", "Projeto X/relatorio.pdf"]]);
    // A fala do cat_speak não tem a posição no texto do `done`: sem links.
    const fala = run(new BubbleFeed(fits(200)), [
      { type: "speech", text: "Criei o plano e salvei o relatório." },
      { type: "done", stopReason: "end_turn", text: TEXTO, links: LINKS },
    ]);
    expect(fala.view(0)!.links).toBeUndefined();
    expect(fala.links()).toEqual(LINKS);
  });
});

describe("o tempo de leitura antes de dar lugar a um balão com ação (T28350)", () => {
  test("1,5 s mais 60 ms por caractere, entre 2 e 8 s", () => {
    expect(readingMs("")).toBe(2000);
    expect(readingMs("Pronto.")).toBe(2000);
    expect(readingMs("x".repeat(50))).toBe(4500);
    expect(readingMs("x".repeat(500))).toBe(8000);
    // Caractere, não unidade do UTF-16.
    expect(readingMs("🐱".repeat(50))).toBe(4500);
  });
});

describe("o andamento enquanto o agente trabalha (spec #32534, Cena 2, T33177)", () => {
  const NOTA = "Clientes/Ana Souza - contrato.md";
  const TRECHO = "o contrato da Ana vence em março";

  test("o × e o Esc cancelam só com o pedido correndo (decisão #33542): o `working()` do balão", () => {
    const f = new BubbleFeed(fits(60));
    expect(f.working()).toBe(false);
    f.event(ev({ type: "started" }), 0);
    f.event(ev({ type: "status", status: "thinking" }), 0);
    // O andamento e a fala antes do `done`: o pedido corre, o × cancela.
    expect(f.working()).toBe(true);
    f.event(ev({ type: "speech", text: "Anotei na nota." }), 10);
    expect(f.working()).toBe(true);
    // Acabou: a resposta na tela, o × só fecha.
    f.event(ev({ type: "done", stopReason: "end_turn", text: "Anotei na nota." }), 20);
    expect(f.working()).toBe(false);
    // Um pedido novo corre de novo; fechado, o × não cancela mais nada.
    f.event(ev({ id: "p2", type: "started" }), 30);
    expect(f.working()).toBe(true);
    f.close();
    expect(f.working()).toBe(false);
    // Cancelado, também acabou.
    f.event(ev({ id: "p3", type: "started" }), 40);
    f.event(ev({ id: "p3", type: "done", stopReason: "cancelled", text: "" }), 50);
    expect(f.working()).toBe(false);
  });

  test("o passo troca a cada ferramenta, num balão só, com o [Parar], e nunca o nome nem o texto de uma nota", () => {
    const f = new BubbleFeed(fits(60));
    f.event(ev({ type: "started" }), 0);
    const passos: string[] = [];
    const ver = (at: number) => {
      const v = f.view(at)!;
      expect(v.stop).toBe(true);
      expect(JSON.stringify(v)).not.toMatch(/Ana|contrato|Clientes|\.md/);
      if (passos.at(-1) !== v.text) passos.push(v.text);
      return v.key;
    };
    f.event(ev({ type: "status", status: "thinking" }), 0);
    const key = ver(0);
    // A ferramenta do Kiwi sai duas vezes: no começo, sem o alvo, e no fim, com ele. A nota conta uma vez.
    for (const [i, e] of [
      { type: "status", status: "running", tool: "notes_search" },
      { type: "status", status: "running", tool: "notes_search", target: "Ana" },
      { type: "status", status: "thinking" },
      { type: "status", status: "running", tool: "notes_read" },
      { type: "status", status: "running", tool: "notes_read", target: NOTA },
      { type: "status", status: "running", tool: "notes_read" },
      { type: "status", status: "running", tool: "notes_read", target: "Clientes/Ana Souza - proposta.md" },
      { type: "status", status: "running", tool: "notes_read", target: NOTA },
      { type: "status", status: "running", tool: "notes_outline", target: "Clientes/Bruno.md" },
      { type: "status", status: "thinking" },
      { type: "text", text: `Li ${TRECHO}.` },
      { type: "status", status: "running", tool: "web" },
      { type: "text", text: "Confirmei." },
    ].entries()) {
      f.event(ev(e), 10 + i);
      expect(ver(10 + i)).toBe(key);
    }
    expect(passos).toEqual(["Pensando", "Procurando nas suas notas", "Lendo uma nota", "Lendo 2 notas", "Lendo 3 notas", "Escrevendo a resposta", "Pesquisando na web", "Escrevendo a resposta"]);
  });

  test("as reuniões e as mudanças nas notas têm o próprio passo; uma ferramenta desconhecida não troca o passo", () => {
    const f = run(new BubbleFeed(fits(60)), [{ type: "status", status: "running", tool: "meetings_get", target: "Reunião com a Ana" }]);
    expect(f.view(0)!.text).toBe("Vendo as suas reuniões");
    f.event(ev({ type: "status", status: "running", tool: "notes_edit", target: NOTA }), 1);
    expect(f.view(1)!.text).toBe("Mexendo nas suas notas");
    f.event(ev({ type: "status", status: "running", tool: "Bash" }), 2);
    expect(f.view(2)!.text).toBe("Mexendo nas suas notas");
  });

  test("em inglês, o passo e a conta das notas", () => {
    const f = new BubbleFeed(fits(60), false, Date.now, () => "en");
    f.event(ev({ type: "started" }), 0);
    f.heard("p1", "summarize my notes", 0);
    expect(f.view(0)).toMatchObject({ text: "Thinking", heard: "“summarize my notes”", stop: true });
    for (const target of ["a.md", "b.md"]) f.event(ev({ type: "status", status: "running", tool: "notes_read", target }), 1);
    expect(f.view(1)!.text).toBe("Reading 2 notes");
  });

  test("cancelado (o [Parar]), o andamento sai e nada volta; o clique fecha e o andamento não volta", () => {
    const f = run(new BubbleFeed(fits(60)), [{ type: "status", status: "running", tool: "notes_search" }]);
    expect(f.view(0)!.stop).toBe(true);
    f.event(ev({ type: "done", stopReason: "cancelled", text: "" }), 10);
    expect(f.view(10)).toBeNull();
    f.event(ev({ type: "status", status: "running", tool: "web" }), 20);
    expect(f.view(20)).toBeNull();
    const g = run(new BubbleFeed(fits(60)), [{ type: "status", status: "thinking" }]);
    g.close();
    g.event(ev({ type: "status", status: "running", tool: "web" }), 10);
    expect(g.view(10)).toBeNull();
  });

  test("o aviso do limite fica o tempo de leitura, com a fala em cima, e o passo de agora entra depois dele", () => {
    const f = new BubbleFeed(fits(80));
    f.event(ev({ type: "started" }), 0);
    f.heard("p1", "resume a nota", 0);
    f.event(ev({ type: "limit", status: "warning", percent: 90 }), 0);
    const aviso = f.view(0)!;
    expect(aviso.heard).toBe("“resume a nota”");
    expect(aviso.stop).toBeUndefined();
    f.event(ev({ type: "status", status: "running", tool: "web" }), 10);
    f.event(ev({ type: "status", status: "running", tool: "notes_read" }), 20);
    expect(f.view(20)!.full).toBe(aviso.full);
    const fim = f.nextWake(20);
    expect(f.view(fim)).toMatchObject({ text: "Lendo uma nota", stop: true, heard: "“resume a nota”" });
  });
});

describe("a última resposta de volta (spec #32534, Cena 3)", () => {
  const answered = () => run(new BubbleFeed(fits(200)), [{ type: "text", text: "Achei duas notas sobre o Projeto X." }, { type: "done", stopReason: "end_turn", text: "Achei duas notas sobre o Projeto X." }]);

  test("depois que o balão saiu, o recall traz a mesma resposta, como um balão novo", () => {
    const f = answered();
    const before = f.view(0)!;
    expect(f.settled(0)).toBe(true);
    f.close();
    expect(f.view(0)).toBeNull();
    expect(f.recall()).toBe(true);
    const back = f.view(0)!;
    expect(back.text).toBe(before.text);
    expect(back.key).not.toBe(before.key);
    expect(f.settled(0)).toBe(true);
    // Não anuncia de novo: o leitor de tela ouviu uma vez, no fim.
    f.takeAnnouncement();
    f.close();
    expect(f.recall()).toBe(true);
    expect(f.takeAnnouncement()).toBeNull();
  });

  test("com o balão na tela, o recall não faz nada", () => {
    const f = answered();
    const key = f.view(0)!.key;
    expect(f.recall()).toBe(false);
    expect(f.view(0)!.key).toBe(key);
    // A resposta que já voltou também não volta de novo por cima dela mesma (o balão piscaria).
    f.close();
    expect(f.recall()).toBe(true);
    const back = f.view(0)!.key;
    expect(f.recall()).toBe(false);
    expect(f.view(0)!.key).toBe(back);
  });

  test("o erro também volta", () => {
    const f = run(new BubbleFeed(fits(200)), [{ type: "error", code: "E_X", message: "Algo deu errado." }]);
    expect(f.settled(0)).toBe(true);
    f.close();
    expect(f.recall()).toBe(true);
    expect(f.view(0)!.error).toBe(true);
  });

  test("até o próximo pedido: o started esquece a resposta de antes", () => {
    const f = answered();
    f.close();
    f.event(ev({ id: "p2", type: "started" }), 0);
    expect(f.recall()).toBe(false);
  });

  test("o pedido mandado pelo campo (`close(false)`) esquece a resposta na hora", () => {
    const f = answered();
    f.close(false);
    expect(f.recall()).toBe(false);
  });

  test("enquanto o agente trabalha não há relógio nem nada para voltar", () => {
    const f = run(new BubbleFeed(fits(200)), [{ type: "status", status: "running", tool: "web" }]);
    expect(f.view(0)).not.toBeNull();
    expect(f.settled(0)).toBe(false);
    f.close();
    expect(f.recall()).toBe(false);
  });

  test("cancelado (sem resposta), nada para voltar", () => {
    const f = run(new BubbleFeed(fits(200)), [{ type: "text", text: "Vou ver" }, { type: "done", stopReason: "cancelled", text: "Vou ver" }]);
    expect(f.view(0)).toBeNull();
    f.close();
    expect(f.recall()).toBe(false);
  });
});
