// O gato no overlay (spec #9810): quando o app manda o helper mostrar, mudar e esconder o gato, com os tempos do
// roteiro. Um relógio falso e um helper falso que grava os comandos; nada abre na tela.
import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent, BubbleLink } from "../shared/ui-contract.ts";
import type { Command } from "../shared/ipc.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import type { AgentStatus, AppSettings } from "../shared/ui-contract.ts";
import { limitBubble } from "../../ui/settings/usageText.ts";
import { readingMs } from "../../ui/hub/bubble-state.ts";
import { mainLocale } from "./locale.ts";
import { ASK_LINE, attachCatOverlay, CatOverlay, type CatOverlayCommand, OVERLAY_TIMES, plainBubbleText, shiftLinks, voiceErrorLine } from "./cat-overlay.ts";

function rig() {
  const sent: CatOverlayCommand[] = [];
  const where: boolean[] = [];
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const clock = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const cancels: number[] = [];
  const cat = new CatOverlay({ send: (c) => sent.push(c), where: (w) => where.push(w), cancel: () => cancels.push(now) }, clock);
  /** Os testes da resposta não olham o andamento (T33177), que tem os testes dele. */
  const opts = { progress: true };
  const isProgress = (c: CatOverlayCommand) => c.type === "catOverlay.bubble" && c.progress === true;
  const take = () => sent.splice(0).filter((c) => opts.progress || !isProgress(c));
  return { cat, sent, where, advance, take, cancels, opts };
}

const started = (id = "r1"): AgentTurnEvent => ({ type: "started", id }) as AgentTurnEvent;
const status = (s: "thinking" | "running" | "opening", id = "r1"): AgentTurnEvent =>
  (s === "running" ? { type: "status", id, status: s, tool: "notes_read" } : { type: "status", id, status: s }) as AgentTurnEvent;
const done = (stopReason = "end_turn", id = "r1"): AgentTurnEvent => ({ type: "done", id, stopReason, text: "" }) as AgentTurnEvent;
const error = (id = "r1"): AgentTurnEvent => ({ type: "error", id, code: "E_X", message: "x" }) as AgentTurnEvent;

describe("o gato no overlay", () => {
  test("ligado, o helper carrega a página; desligado, solta", () => {
    const { cat, take } = rig();
    cat.configure(true);
    expect(take()).toEqual([{ type: "catOverlay.place", posicao: "center", escala: 1 }, { type: "catOverlay.load" }]);
    cat.configure(true);
    expect(take()).toEqual([]);
    cat.configure(false);
    expect(take()).toEqual([{ type: "catOverlay.unload" }]);
  });

  test("com o interruptor desligado, nada é carregado nem mostrado", () => {
    const { cat, sent, where } = rig();
    cat.turn(started());
    cat.turn(status("thinking"));
    cat.turn(done());
    expect(sent).toEqual([]);
    expect(where).toEqual([]);
  });

  test("um pedido com o Kiwi fora da frente: entra no acordou em 180 ms, passa pelos estados, e o pronto sai depois de 1100 ms em 160 ms", () => {
    const { cat, take, where, advance } = rig();
    cat.configure(true);
    take();
    cat.turn(started());
    expect(take()).toEqual([{ type: "catOverlay.show", estado: "acordou", fadeMs: OVERLAY_TIMES.enter }]);
    expect(where).toEqual([true]);
    cat.turn(status("thinking"));
    cat.turn(status("running"));
    cat.turn(status("thinking"));
    expect(take()).toEqual([
      { type: "catOverlay.state", estado: "thinking" },
      { type: "catOverlay.state", estado: "agindo" },
      { type: "catOverlay.state", estado: "thinking" },
    ]);
    cat.turn(done());
    expect(take()).toEqual([{ type: "catOverlay.state", estado: "pronto" }]);
    advance(OVERLAY_TIMES.pronto - 1);
    expect(take()).toEqual([]);
    advance(1);
    expect(take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.prontoExit }]);
    expect(where).toEqual([true, false]);
    expect(cat.visible).toBe(false);
  });

  test("o erro fica 2200 ms e sai em 180 ms", () => {
    const { cat, take, advance } = rig();
    cat.configure(true);
    cat.turn(started());
    take();
    cat.turn(error());
    expect(take()).toEqual([{ type: "catOverlay.state", estado: "erro" }]);
    advance(OVERLAY_TIMES.erro - 1);
    expect(take()).toEqual([]);
    advance(1);
    expect(take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.erroExit }]);
  });

  test("o cancelamento sai em 120 ms, sem pronto", () => {
    const { cat, take } = rig();
    cat.configure(true);
    cat.turn(started());
    cat.turn(status("thinking"));
    take();
    cat.turn(done("cancelled"));
    expect(take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.cancelExit }]);
  });

  test("um pedido novo durante a saída volta do ponto em que estava, sem esconder antes", () => {
    const { cat, take, advance, where } = rig();
    cat.configure(true);
    cat.turn(started("r1"));
    cat.turn(done("end_turn", "r1"));
    take();
    advance(500);
    cat.turn(started("r2"));
    // Nada de hide entre os dois: o helper anima a partir da opacidade de agora.
    expect(take()).toEqual([{ type: "catOverlay.show", estado: "acordou", fadeMs: OVERLAY_TIMES.enter }]);
    advance(5000);
    expect(take()).toEqual([]);
    expect(where.at(-1)).toBe(true);
  });

  test("com o Kiwi na frente, o overlay não aparece: o gato é o do canto", () => {
    const { cat, take, where } = rig();
    cat.configure(true);
    take();
    cat.setHubInView(true);
    cat.turn(started());
    cat.turn(status("thinking"));
    cat.turn(done());
    expect(take()).toEqual([]);
    expect(where).toEqual([]);
  });

  test("a troca entre o canto e o overlay no meio do pedido não repete a entrada", () => {
    const { cat, take, where } = rig();
    cat.configure(true);
    take();
    cat.setHubInView(true);
    cat.turn(started());
    cat.turn(status("running"));
    // A pessoa sai do Kiwi: o gato aparece já agindo, sem fade e sem o acordou.
    cat.setHubInView(false);
    expect(take()).toEqual([{ type: "catOverlay.show", estado: "agindo", fadeMs: 0 }]);
    // E volta: o overlay some na hora, e o hub mostra o do canto.
    cat.setHubInView(true);
    expect(take()).toEqual([{ type: "catOverlay.hide", fadeMs: 0 }]);
    expect(where).toEqual([true, false]);
  });

  test("sem pedido, nada aparece, nem trocando de app", () => {
    const { cat, take } = rig();
    cat.configure(true);
    take();
    cat.setHubInView(true);
    cat.setHubInView(false);
    expect(take()).toEqual([]);
  });

  test("desligar no meio do pedido esconde e solta a página", () => {
    const { cat, take, where } = rig();
    cat.configure(true);
    cat.turn(started());
    take();
    cat.configure(false);
    expect(take()).toEqual([{ type: "catOverlay.hide", fadeMs: 0 }, { type: "catOverlay.unload" }]);
    expect(where).toEqual([true, false]);
  });
});

describe("o gato no overlay ligado ao app", () => {
  function wired(o: { enabled?: boolean; overlay?: boolean } = {}) {
    const sent: Command[] = [];
    const where: boolean[] = [];
    const statusFns = new Set<(s: AgentStatus) => void>();
    const turnFns = new Set<(e: AgentTurnEvent) => void>();
    const readyFns = new Set<() => void>();
    const status = (enabled: boolean) => ({ enabled }) as AgentStatus;
    const settings = (overlay: boolean, cor: AppSettings["kiwicat"]["cor"] = "prisma-original", posicao: AppSettings["kiwicat"]["posicao"] = "center", tamanho = 1): AppSettings =>
      ({ ...DEFAULT_SETTINGS, kiwicat: { show: true, overlay, cor, posicao, tamanho, voz: "en-a" as const } });
    const attached = attachCatOverlay({
      agent: {
        status: async () => status(o.enabled ?? true),
        onStatus: (fn) => (statusFns.add(fn), () => void statusFns.delete(fn)),
        onTurn: (fn) => (turnFns.add(fn), () => void turnFns.delete(fn)),
      },
      settings: { load: async () => settings(o.overlay ?? true) },
      helper: {
        send: async (c) => (sent.push(c), { ok: true }),
        onReady: (fn) => (readyFns.add(fn), () => void readyFns.delete(fn)),
      },
      pageDir: "/app/views/ui/catoverlay",
      where: (w) => where.push(w),
    });
    const emit = {
      status: (enabled: boolean) => statusFns.forEach((fn) => fn(status(enabled))),
      turn: (e: AgentTurnEvent) => turnFns.forEach((fn) => fn(e)),
      ready: () => readyFns.forEach((fn) => fn()),
    };
    return { attached, sent, where, emit, settings, listeners: () => statusFns.size + turnFns.size + readyFns.size };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test("com o agente e o interruptor ligados, carrega a página da pasta do app", async () => {
    const { sent } = wired();
    await tick();
    expect(sent).toEqual([{ type: "catOverlay.color", cor: "prisma-original" }, { type: "catOverlay.place", posicao: "center", escala: 1 }, { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" }]);
  });

  test("com o agente desligado ou o interruptor desligado, nada carrega", async () => {
    for (const o of [{ enabled: false }, { overlay: false }]) {
      const { sent, emit } = wired(o);
      await tick();
      emit.turn(started());
      expect(sent).toEqual([]);
    }
  });

  test("desligar o interruptor nos Ajustes solta a página; ligar carrega de novo", async () => {
    const { attached, sent, settings } = wired();
    await tick();
    sent.splice(0);
    attached.settingsChanged(settings(false));
    attached.settingsChanged(settings(true));
    expect(sent.map((c) => c.type)).toEqual(["catOverlay.unload", "catOverlay.color", "catOverlay.place", "catOverlay.load"]);
  });

  test("o helper reiniciou com o gato na tela: carrega e volta no mesmo estado, sem a entrada", async () => {
    const { sent, emit } = wired();
    await tick();
    emit.turn(started());
    emit.turn(status("running"));
    sent.splice(0);
    emit.ready();
    expect(sent).toEqual([
      { type: "catOverlay.color", cor: "prisma-original" },
      { type: "catOverlay.place", posicao: "center", escala: 1 },
      { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" },
      { type: "catOverlay.show", estado: "agindo", fadeMs: 0 },
    ]);
  });

  test("a cor da paleta vai à página aberta na hora, também com o gato na tela, e só quando muda (spec #14963)", async () => {
    const { attached, sent, emit, settings } = wired();
    await tick();
    emit.turn(started());
    sent.splice(0);
    attached.settingsChanged(settings(true, "kiwi-neon"));
    attached.settingsChanged(settings(true, "kiwi-neon"));
    expect(sent).toEqual([{ type: "catOverlay.color", cor: "kiwi-neon" }]);
  });

  test("com o overlay desligado, a cor da paleta fica guardada e vai antes do próximo load (spec #14963)", async () => {
    const { attached, sent, settings } = wired({ overlay: false });
    await tick();
    attached.settingsChanged(settings(false, "ambar-solar"));
    expect(sent).toEqual([]);
    attached.settingsChanged(settings(true, "ambar-solar"));
    expect(sent).toEqual([{ type: "catOverlay.color", cor: "ambar-solar" }, { type: "catOverlay.place", posicao: "center", escala: 1 }, { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" }]);
  });

  test("a posição e o tamanho vão antes do load; mudar carrega de novo e o gato volta no lugar novo (spec #12949)", async () => {
    const { attached, sent, emit, settings } = wired();
    await tick();
    emit.turn(started());
    emit.turn(status("running"));
    sent.splice(0);
    attached.settingsChanged(settings(true, "prisma-original", "top-right", 1.4));
    attached.settingsChanged(settings(true, "prisma-original", "top-right", 1.4));
    expect(sent).toEqual([
      { type: "catOverlay.color", cor: "prisma-original" },
      { type: "catOverlay.place", posicao: "top-right", escala: 1.4 },
      { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" },
      { type: "catOverlay.show", estado: "agindo", fadeMs: 0 },
    ]);
  });

  test("com o hub na vista, o gato é o do canto; o stop solta tudo", async () => {
    const { attached, sent, where, emit, listeners } = wired();
    await tick();
    sent.splice(0);
    attached.setHubInView(true);
    emit.turn(started());
    expect(sent).toEqual([]);
    expect(where).toEqual([]);
    attached.stop();
    expect(sent.map((c) => c.type)).toEqual(["catOverlay.unload"]);
    expect(listeners()).toBe(0);
  });
});

describe("o gato no overlay e a fala pelo Control (spec #9876)", () => {
  test("a fala entra pelo acordou e fica no ouvindo; o pedido segue sem repetir a entrada", () => {
    const { cat, take } = rig();
    cat.configure(true);
    take();
    cat.voice({ phase: "listening", voz: 0 });
    expect(take()).toEqual([
      { type: "catOverlay.show", estado: "acordou", fadeMs: OVERLAY_TIMES.enter },
      { type: "catOverlay.state", estado: "ouvindo" },
    ]);
    cat.voice({ phase: "listening", voz: 0.5 });
    cat.voice({ phase: "processing" });
    expect(take()).toEqual([]);
    cat.voice({ phase: "asked", text: "oi", id: "r1" });
    cat.turn(started());
    expect(take()).toEqual([{ type: "catOverlay.state", estado: "thinking" }]);
  });

  test("cancelada ou vazia, o gato sai pela saída de cancelamento, sem pronto", () => {
    const { cat, take, advance } = rig();
    cat.configure(true);
    take();
    cat.voice({ phase: "listening", voz: 0 });
    take();
    cat.voice({ phase: "idle", cancelled: true });
    advance(5000);
    expect(take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.cancelExit }]);
    expect(cat.visible).toBe(false);
  });

  test("com o hub à vista, quem ouve é o gato do canto", () => {
    const { cat, take } = rig();
    cat.configure(true);
    cat.setHubInView(true);
    take();
    cat.voice({ phase: "listening", voz: 0 });
    cat.voice({ phase: "idle", cancelled: true });
    expect(take()).toEqual([]);
  });
});

// Spec #12938: na rc18, a fala pelo Control fazia o gato ouvir e pensar, e o overlay sumia sem resposta nenhuma. A
// resposta ia só para o balão do hub, que não estava à vista. Agora toda fala termina com um balão no overlay.
describe("a fala pelo Control termina com um balão no overlay (spec #12938)", () => {
  const text = (t: string, id = "r1"): AgentTurnEvent => ({ type: "text", id, text: t }) as AgentTurnEvent;
  const doneWith = (t: string, id = "r1"): AgentTurnEvent => ({ type: "done", id, stopReason: "end_turn", text: t }) as AgentTurnEvent;
  /** A fala até o pedido começar, com o `started` antes do `asked` (o `ask` devolve depois de o pedido começar). */
  function talk(r: ReturnType<typeof rig>, id = "r1") {
    r.cat.configure(true);
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.voice({ phase: "processing" });
    r.cat.turn(started(id));
    r.cat.voice({ phase: "asked", text: "como você está, tudo bem?", id });
    r.opts.progress = false;
    r.take();
  }
  const bubbles = (sent: CatOverlayCommand[]) => sent.filter((c) => c.type === "catOverlay.bubble");

  // Spec #13380: o gato saía no tempo de ler o balão, às vezes com a pessoa ainda lendo. Agora ele fica, pergunta se
  // precisa de mais alguma coisa e só então sai.
  test("uma pergunta de conversa: a resposta vai ao balão, o gato fica, pergunta depois de idleAsk e sai depois de askLeave", () => {
    const r = rig();
    talk(r);
    r.cat.turn(status("thinking"));
    r.cat.turn(text("Tudo ótimo por aqui! "));
    r.cat.turn(text("E você?"));
    r.cat.turn(doneWith("Tudo ótimo por aqui! E você?"));
    const answer = "Tudo ótimo por aqui! E você?";
    expect(r.take()).toEqual([
      { type: "catOverlay.state", estado: "pronto" },
      { type: "catOverlay.bubble", text: answer, error: false },
    ]);
    r.advance(OVERLAY_TIMES.idleAsk - 1);
    expect(r.take()).toEqual([]);
    expect(r.cat.visible).toBe(true);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: answer, error: false, ask: true }]);
    expect(ASK_LINE).toBe("Precisa de mais alguma coisa?");
    r.advance(OVERLAY_TIMES.askLeave - 1);
    expect(r.cat.visible).toBe(true);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.prontoExit }]);
    expect(r.cat.visible).toBe(false);
  });

  test("mudar o tamanho com o balão na tela traz o mesmo trecho de volta depois da recarga (revisão do #522)", () => {
    const r = rig();
    talk(r);
    r.cat.turn(text("Feito."));
    r.cat.turn(doneWith("Feito."));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Feito.", error: false }]);
    r.cat.setPlace("bottom-right", 0.8);
    expect(r.take().map((c) => c.type)).toEqual(["catOverlay.place", "catOverlay.load", "catOverlay.show", "catOverlay.bubble"]);
    r.cat.setPlace("bottom-right", 0.8);
    expect(r.take()).toEqual([]);
  });

  // Spec #27881 (T28010): o balão único, como no Hub. O aberto tem a resposta inteira; o resumo do fechado sai do texto
  // depois da última ferramenta.
  test("um pedido com ação: o resumo é o texto depois da última ferramenta, e o aberto tem tudo", () => {
    const r = rig();
    talk(r);
    r.cat.turn(text("Vou ler a nota."));
    r.cat.turn(status("running"));
    r.cat.turn(text("Mudei o prazo para abril."));
    r.cat.turn(doneWith("Vou ler a nota.Mudei o prazo para abril."));
    expect(bubbles(r.take())).toEqual([
      { type: "catOverlay.bubble", text: "Vou ler a nota.Mudei o prazo para abril.", error: false, summary: "Mudei o prazo para abril." },
    ]);
    expect(r.cat.visible).toBe(true);
  });

  test("a fala do cat_speak é o resumo do fechado, e o aberto tem a resposta inteira (spec #27881)", () => {
    const r = rig();
    talk(r);
    r.cat.turn({ type: "speech", id: "r1", text: " Achei a nota do roteiro. " } as AgentTurnEvent);
    // O balão nasce com a fala (T33053, Cena 1), no instante do 1º pedaço da voz; o resto do pedido não o troca.
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Achei a nota do roteiro.", error: false }]);
    r.cat.turn(text("Vou ler a nota."));
    r.cat.turn(status("running"));
    r.cat.turn(text("O roteiro tem três partes."));
    expect(bubbles(r.take())).toEqual([]);
    // O `done` traz a resposta inteira com a fala de resumo: a página mantém o texto de cima e põe o "Ver mais".
    r.cat.turn(doneWith("Vou ler a nota.O roteiro tem três partes."));
    expect(bubbles(r.take())).toEqual([
      { type: "catOverlay.bubble", text: "Vou ler a nota.O roteiro tem três partes.", error: false, summary: "Achei a nota do roteiro." },
    ]);
    // A fala é deste pedido: o próximo começa sem ela.
    talk(r, "r2");
    r.cat.turn(doneWith("Pronto, mudei.", "r2"));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Pronto, mudei.", error: false }]);
    // Só a fala, sem texto: ela vai inteira.
    talk(r, "r3");
    r.cat.turn({ type: "speech", id: "r3", text: "Feito, está na nota." } as AgentTurnEvent);
    r.cat.turn(status("running", "r3"));
    r.cat.turn(doneWith("", "r3"));
    // O mesmo balão duas vezes: na fala e no `done` (a página vê que é igual e não mexe).
    expect(bubbles(r.take())).toEqual([
      { type: "catOverlay.bubble", text: "Feito, está na nota.", error: false },
      { type: "catOverlay.bubble", text: "Feito, está na nota.", error: false },
    ]);
  });

  test("a fala de um pedido que não veio da voz não abre balão no overlay (T33053)", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started("r9"));
    r.take();
    expect(r.cat.visible).toBe(true);
    r.cat.turn({ type: "speech", id: "r9", text: "Anotei na nota." } as AgentTurnEvent);
    expect(bubbles(r.take())).toEqual([]);
  });

  test("um pedido com ação e sem texto no fim: o balão diz que fez", () => {
    const r = rig();
    talk(r);
    r.cat.turn(status("running"));
    r.cat.turn(doneWith(""));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Feito.", error: false }]);
  });

  test("com o app em English, a resposta sem texto sai em inglês (T29351)", () => {
    mainLocale.set("en");
    try {
      const r = rig();
      talk(r);
      r.cat.turn(status("running"));
      r.cat.turn(doneWith(""));
      expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Done.", error: false }]);
      const q = rig();
      talk(q);
      q.cat.turn(doneWith(""));
      expect(bubbles(q.take())).toEqual([{ type: "catOverlay.bubble", text: "All set.", error: false }]);
    } finally {
      mainLocale.set("pt");
    }
  });

  // Spec #13378: o balão trocava as frases sozinho, um trecho de 108 caracteres a cada tempo de leitura. Agora vai a
  // resposta inteira, de uma vez; a página mostra o começo e o "ver mais".
  test("uma resposta longa vai inteira ao balão, de uma vez, e nada troca sozinho", () => {
    const r = rig();
    talk(r);
    const long = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(" ");
    r.cat.turn(doneWith(long));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: long, error: false }]);
    // Até a pergunta, nenhum balão novo.
    r.advance(OVERLAY_TIMES.idleAsk - 1);
    expect(r.take()).toEqual([]);
    expect(r.cat.visible).toBe(true);
  });

  test("com a pessoa no balão (aberto ou com o mouse em cima), o gato espera; solto, a espera recomeça do zero", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Uma resposta."));
    r.take();
    r.advance(OVERLAY_TIMES.idleAsk - 1000);
    r.cat.hold(true);
    // Lendo com calma, rolando o texto: cinco minutos e o gato continua, sem pergunta.
    r.advance(300_000);
    expect(r.take()).toEqual([]);
    expect(r.cat.visible).toBe(true);
    r.cat.hold(false);
    r.advance(OVERLAY_TIMES.idleAsk - 1);
    expect(r.take()).toEqual([]);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Uma resposta.", error: false, ask: true }]);
    // Com a pergunta, a pessoa volta ao balão: a pergunta sai, e a espera para.
    r.cat.hold(true);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Uma resposta.", error: false }]);
    r.advance(OVERLAY_TIMES.askLeave * 4);
    expect(r.cat.visible).toBe(true);
    r.cat.hold(false);
    r.advance(OVERLAY_TIMES.idleAsk + OVERLAY_TIMES.askLeave);
    expect(r.take().at(-1)).toEqual({ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.prontoExit });
    // Um `hold` atrasado, com o gato fora, não faz nada.
    r.cat.hold(true);
    r.cat.hold(false);
    r.advance(100_000);
    expect(r.take()).toEqual([]);
  });

  test("clicar ou rolar no balão (touch) recomeça a espera e tira a pergunta", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Uma resposta."));
    r.take();
    r.advance(OVERLAY_TIMES.idleAsk - 1000);
    r.cat.touch();
    r.advance(OVERLAY_TIMES.idleAsk - 1);
    expect(r.take()).toEqual([]);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Uma resposta.", error: false, ask: true }]);
    r.advance(OVERLAY_TIMES.askLeave - 1000);
    r.cat.touch();
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Uma resposta.", error: false }]);
    r.advance(OVERLAY_TIMES.askLeave);
    expect(r.cat.visible).toBe(true);
  });

  test("o × do balão ou da cabeça (close) tira o gato na hora", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Uma resposta."));
    r.take();
    r.cat.close();
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.prontoExit }]);
    expect(r.cat.visible).toBe(false);
    r.advance(OVERLAY_TIMES.idleAsk + OVERLAY_TIMES.askLeave);
    expect(r.take()).toEqual([]);
    // Fechado, o próximo Control começa de novo, com a entrada.
    r.cat.voice({ phase: "listening", voz: 0 });
    expect(r.take()).toEqual([
      { type: "catOverlay.show", estado: "acordou", fadeMs: OVERLAY_TIMES.enter },
      { type: "catOverlay.state", estado: "ouvindo" },
    ]);
  });

  test("o Control com o gato na tela continua a conversa: sem a entrada, com o balão onde estava", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Primeira resposta."));
    r.take();
    r.advance(OVERLAY_TIMES.idleAsk);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Primeira resposta.", error: false, ask: true }]);
    // A pessoa aperta o Control com a pergunta na tela: ele volta a ouvir, sem show, e a pergunta sai.
    r.cat.voice({ phase: "listening", voz: 0 });
    expect(r.take()).toEqual([
      { type: "catOverlay.bubble", text: "Primeira resposta.", error: false },
      { type: "catOverlay.state", estado: "ouvindo" },
    ]);
    // Enquanto ouve e pensa, o gato não sai.
    r.advance(OVERLAY_TIMES.idleAsk + OVERLAY_TIMES.askLeave);
    expect(r.cat.visible).toBe(true);
    r.cat.voice({ phase: "processing" });
    r.cat.turn(started("r2"));
    r.cat.voice({ phase: "asked", text: "e amanhã?", id: "r2" });
    r.cat.turn(status("thinking", "r2"));
    r.cat.turn(doneWith("Segunda resposta.", "r2"));
    const sent = r.take();
    expect(sent.some((c) => c.type === "catOverlay.show")).toBe(false);
    expect(bubbles(sent).at(-1)).toEqual({ type: "catOverlay.bubble", text: "Segunda resposta.", error: false });
    expect(r.cat.visible).toBe(true);
  });

  test("a fala cancelada no meio da conversa: o balão de antes fica, e a espera recomeça", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Primeira resposta."));
    r.take();
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.voice({ phase: "idle", cancelled: true });
    const sent = r.take();
    expect(sent.some((c) => c.type === "catOverlay.hide")).toBe(false);
    expect(r.cat.visible).toBe(true);
    r.advance(OVERLAY_TIMES.idleAsk);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Primeira resposta.", error: false, ask: true }]);
  });

  test("o hold de um balão que já saiu não segura o balão do próximo pedido", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Primeira resposta."));
    r.take();
    r.cat.hold(true);
    r.cat.close();
    // Um pedido novo pela fala, com a entrada: o helper soltou o hold sem avisar.
    talk(r, "r2");
    r.cat.turn(doneWith("Segunda resposta.", "r2"));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Segunda resposta.", error: false }]);
    r.advance(OVERLAY_TIMES.idleAsk);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Segunda resposta.", error: false, ask: true }]);
  });

  test("o hold do helper chega ao controlador pelo attach", async () => {
    let holdFn: ((held: boolean) => void) | null = null;
    const a = attachCatOverlay({
      agent: { status: async () => ({ enabled: false }) as AgentStatus, onStatus: () => () => {}, onTurn: () => () => {} },
      settings: { load: () => new Promise(() => {}) },
      helper: { send: async () => ({ ok: true }), onReady: () => () => {}, onHold: (fn) => ((holdFn = fn), () => (holdFn = null)) },
      pageDir: "/x",
      where: () => {},
    });
    const seen: boolean[] = [];
    const original = a.overlay.hold.bind(a.overlay);
    a.overlay.hold = (h: boolean) => (seen.push(h), original(h));
    holdFn!(true);
    holdFn!(false);
    expect(seen).toEqual([true, false]);
    a.stop();
    expect(holdFn).toBeNull();
  });

  test("o clique num caminho só abre o que o balão de agora mostra (spec #17683)", () => {
    const r = rig();
    talk(r);
    expect(r.cat.shownPath("Plano.md")).toBe(false);
    r.cat.turn({ ...doneWith("Veja Plano.md."), links: [{ text: "Plano.md", from: 5, to: 13, path: "Plano.md", kind: "note" }] } as AgentTurnEvent);
    expect(r.cat.shownPath("Plano.md")).toBe(true);
    expect(r.cat.shownPath("Outra.md")).toBe(false);
    r.cat.close();
    expect(r.cat.shownPath("Plano.md")).toBe(false);
  });

  test("o openPath do helper chega ao notes.openPath pelo attach, só para o caminho do balão", async () => {
    let openFn: ((path: string) => void) | null = null;
    const opened: string[] = [];
    const logs: string[] = [];
    const a = attachCatOverlay({
      agent: { status: async () => ({ enabled: false }) as AgentStatus, onStatus: () => () => {}, onTurn: () => () => {} },
      settings: { load: () => new Promise(() => {}) },
      helper: { send: async () => ({ ok: true }), onReady: () => () => {}, onOpenPath: (fn) => ((openFn = fn), () => (openFn = null)) },
      openPath: async (p) => {
        opened.push(p);
        if (p === "Sumiu.md") throw Object.assign(new Error("no note"), { code: "E_NOT_FOUND" });
      },
      pageDir: "/x",
      where: () => {},
      log: (m) => logs.push(m),
    });
    const shown = new Set(["Plano.md", "Sumiu.md"]);
    a.overlay.shownPath = (p: string) => shown.has(p);
    let touched = 0;
    a.overlay.touch = () => void touched++;
    openFn!("Plano.md");
    openFn!("../fora.md");
    openFn!(42 as unknown as string);
    openFn!("Sumiu.md");
    await Bun.sleep(0);
    expect(opened).toEqual(["Plano.md", "Sumiu.md"]);
    expect(touched).toBe(2);
    expect(logs).toEqual(["[cat-overlay] openPath: fora do balão", "[cat-overlay] openPath: fora do balão", "[cat-overlay] openPath: E_NOT_FOUND"]);
    a.stop();
    expect(openFn).toBeNull();
  });

  test("com o app em English, o balão do erro sai em inglês (T29351)", () => {
    mainLocale.set("en");
    try {
      const r = rig();
      talk(r);
      r.cat.turn({ type: "error", id: "r1", code: "E_NETWORK", message: "offline." } as AgentTurnEvent);
      expect(r.take()).toEqual([
        { type: "catOverlay.state", estado: "erro" },
        { type: "catOverlay.bubble", text: "I couldn't reach the agent: offline.", error: true },
      ]);
    } finally {
      mainLocale.set("pt");
    }
  });

  test("um erro do agente: o balão diz o erro em palavras, e o gato fica como numa resposta", () => {
    const r = rig();
    talk(r);
    r.cat.turn({ type: "error", id: "r1", code: "E_NETWORK", message: "sem internet." } as AgentTurnEvent);
    const line = voiceErrorLine("sem internet.");
    expect(line).toBe("Não consegui falar com o agente: sem internet.");
    expect(voiceErrorLine("no internet.", "en")).toBe("I couldn't reach the agent: no internet.");
    expect(voiceErrorLine("  ", "en")).toBe("I couldn't reach the agent: unknown error");
    expect(voiceErrorLine("")).toBe("Não consegui falar com o agente: erro desconhecido");
    expect(r.take()).toEqual([
      { type: "catOverlay.state", estado: "erro" },
      { type: "catOverlay.bubble", text: line, error: true },
    ]);
    r.advance(OVERLAY_TIMES.idleAsk + OVERLAY_TIMES.askLeave - 1);
    expect(r.cat.visible).toBe(true);
    r.advance(1);
    expect(r.take().at(-1)).toEqual({ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.erroExit });
  });

  test("o pedido que nem saiu: o balão diz por quê, em vez de sumir calado", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.voice({ phase: "processing" });
    r.take();
    r.cat.voice({ phase: "idle", cancelled: true, error: "o agente está desligado." });
    expect(r.take()).toEqual([
      { type: "catOverlay.state", estado: "erro" },
      { type: "catOverlay.bubble", text: "Não consegui falar com o agente: o agente está desligado.", error: true },
    ]);
    expect(r.cat.visible).toBe(true);
  });

  test("o texto sem a marcação: títulos, negrito, código, links e citações", () => {
    expect(plainBubbleText("# Prazo\n\nO prazo do Kiwi é **abril**.")).toBe("Prazo. O prazo do Kiwi é abril.");
    expect(plainBubbleText("Veja [a nota](Kiwi/Prazo.md) e `kiwi status`.\n> citado\n- um\n- dois")).toBe("Veja a nota e kiwi status. citado • um • dois");
    expect(plainBubbleText("Veja a issue #12, ok.")).toBe("Veja a issue #12, ok.");
    expect(plainBubbleText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
    expect(plainBubbleText("## Feito:\n~~velho~~ novo ![img](a.png) <https://kiwi.app>")).toBe("Feito: velho novo img https://kiwi.app");
    const r = rig();
    talk(r);
  });

  test("o balão recebe o markdown, com a tabela e as quebras de linha (spec #17679): a página monta e limpa", () => {
    const md = "## Plano\n\n| Tarefa | Quem |\n| --- | --- |\n| Roteiro | Ana |\n\nO prazo é **abril**.";
    const r = rig();
    talk(r);
    r.cat.turn(doneWith(`\n${md}\n\n`));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: md, error: false }]);
    // Depois de uma ferramenta, o resumo sai só do markdown que veio depois dela; o aberto tem tudo.
    const t = rig();
    talk(t);
    t.cat.turn(text("Vou ler a nota."));
    t.cat.turn(status("running"));
    t.cat.turn(text(md));
    t.cat.turn(doneWith(`Vou ler a nota.${md}`));
    expect(bubbles(t.take())).toEqual([{ type: "catOverlay.bubble", text: `Vou ler a nota.${md}`, error: false, summary: md }]);
    // Só um bloco de código vazio depois da ferramenta: o que ele fez.
    const e = rig();
    talk(e);
    e.cat.turn(status("running"));
    e.cat.turn(doneWith("```\n```"));
    expect(bubbles(e.take())).toEqual([{ type: "catOverlay.bubble", text: "Feito.", error: false }]);
  });

  test("os links do done vão no balão, nas posições da resposta inteira do aberto (spec #17683, #27881)", () => {
    const full = "Vou ler a nota.\n\nVeja [[Plano]] e Anexos/capa.png.";
    const at = (t: string) => full.indexOf(t);
    const links: BubbleLink[] = [
      { text: "Vou", from: 0, to: 3, path: "Vou.md", kind: "note" }, // antes da ferramenta: o aberto também mostra
      { text: "[[Plano]]", from: at("[[Plano]]"), to: at("[[Plano]]") + 9, path: "Plano.md", kind: "note" },
      { text: "Anexos/capa.png", from: at("Anexos"), to: at("Anexos") + 15, path: "Anexos/capa.png", kind: "file" },
    ];
    const r = rig();
    talk(r);
    r.cat.turn(text("Vou ler a nota."));
    r.cat.turn(status("running"));
    r.cat.turn(text("\n\nVeja [[Plano]] e Anexos/capa.png."));
    r.cat.turn({ ...doneWith(full), links } as AgentTurnEvent);
    expect(bubbles(r.take())).toEqual([
      { type: "catOverlay.bubble", text: full, error: false, links, summary: "Veja [[Plano]] e Anexos/capa.png." },
    ]);
    // Com espaço no começo, as posições andam junto com o texto aparado.
    const w = rig();
    talk(w);
    w.cat.turn({ ...doneWith(`\n ${full}`), links: links.map((l) => ({ ...l, from: l.from + 2, to: l.to + 2 })) } as AgentTurnEvent);
    expect(bubbles(w.take())).toEqual([{ type: "catOverlay.bubble", text: full, error: false, links }]);
    // Sem links no done, o balão vai sem o campo.
    const p = rig();
    talk(p);
    p.cat.turn(doneWith("Veja [[Plano]]."));
    expect(bubbles(p.take())).toEqual([{ type: "catOverlay.bubble", text: "Veja [[Plano]].", error: false }]);
    expect(shiftLinks([{ text: "x", from: 0, to: 1, path: "x.md", kind: "note" }], 0, "y")).toEqual([]);
  });

  test("uma rotina que começa enquanto a pessoa segura o Control não vira a fala", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.turn(started("rotina"));
    r.cat.voice({ phase: "idle", cancelled: true });
    r.cat.turn(text("Resumo do dia pronto.", "rotina"));
    r.cat.turn(doneWith("Resumo do dia pronto.", "rotina"));
    expect(bubbles(r.take())).toEqual([]);
  });

  test("um pedido que não veio da fala (uma rotina) não mostra texto por cima dos apps", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started("rotina"));
    r.cat.turn(text("Resumo do dia pronto.", "rotina"));
    r.cat.turn(doneWith("Resumo do dia pronto.", "rotina"));
    expect(bubbles(r.take())).toEqual([]);
    r.advance(OVERLAY_TIMES.pronto);
    expect(r.cat.visible).toBe(false);
  });

  test("um pedido novo durante o balão tira o balão antes de o gato voltar", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Tudo bem."));
    r.take();
    r.cat.turn(started("r2"));
    expect(r.take()).toEqual([
      { type: "catOverlay.bubble", text: null },
      { type: "catOverlay.show", estado: "acordou", fadeMs: OVERLAY_TIMES.enter },
    ]);
  });

  test("a pessoa volta ao Kiwi durante o balão: o overlay sai, e a resposta fica com o balão do canto", () => {
    const r = rig();
    talk(r);
    r.cat.turn(doneWith("Tudo bem."));
    r.take();
    r.cat.setHubInView(true);
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: 0 }]);
    r.advance(10_000);
    expect(r.take()).toEqual([]);
  });
});

// T26829: a voz do gato. O nível vai à página (o `falando`, com a boca nele) e o `null` volta ao estado de antes; com
// a voz tocando, o gato não sai do overlay, e a espera da resposta recomeça quando ela para.
// T29063 (achado no #370, #29059): o aviso de limite de uso aparecia só no balão do hub. Com o gato no overlay, a
// pessoa não via que estava perto do limite, e o limite acabado chegava como "Não consegui falar com o agente: …".
describe("o aviso de limite de uso no overlay (T29063)", () => {
  const doneWith = (t: string, id = "r1"): AgentTurnEvent => ({ type: "done", id, stopReason: "end_turn", text: t }) as AgentTurnEvent;
  const limit = (status: "warning" | "out", extra: { percent?: number; resetsAt?: string } = {}, id = "r1"): AgentTurnEvent =>
    ({ type: "limit", id, status, ...extra }) as AgentTurnEvent;
  function talk(r: ReturnType<typeof rig>, id = "r1") {
    r.cat.configure(true);
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.voice({ phase: "processing" });
    r.cat.turn(started(id));
    r.cat.voice({ phase: "asked", text: "resume a nota de ontem", id });
    r.take();
  }
  const bubbles = (sent: CatOverlayCommand[]) => sent.filter((c) => c.type === "catOverlay.bubble");
  const WARN = limitBubble("warning", 85, undefined, Date.now());

  test("o aviso entra no balão enquanto o agente trabalha, como no hub", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("warning", { percent: 85 }));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: WARN, error: false }]);
    expect(WARN).toBe("Você já usou 85% do seu limite. Eu sigo, mas vale ir com calma.");
  });

  test("a resposta que chega logo depois espera o tempo de leitura do aviso (readingMs do #370)", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("warning", { percent: 85 }));
    r.take();
    r.advance(500);
    r.cat.turn(doneWith("Resumi a nota."));
    expect(bubbles(r.take())).toEqual([]);
    r.advance(readingMs(WARN) - 500 - 1);
    expect(bubbles(r.take())).toEqual([]);
    r.advance(1);
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Resumi a nota.", error: false }]);
    // E a espera da conversa (spec #13380) começa só daí.
    r.advance(OVERLAY_TIMES.idleAsk);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Resumi a nota.", error: false, ask: true }]);
  });

  test("a resposta que chega depois da leitura entra na hora", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("warning", { percent: 85 }));
    r.take();
    r.advance(readingMs(WARN) + 10);
    // Lido o aviso, o andamento volta (T33177), com o que a pessoa falou em cima.
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Pensando", error: false, progress: true, heard: "“resume a nota de ontem”" }]);
    r.cat.turn(doneWith("Resumi a nota."));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Resumi a nota.", error: false }]);
  });

  test("o erro não espera o aviso", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("warning"));
    r.take();
    r.cat.turn({ type: "error", id: "r1", code: "E_NETWORK", message: "sem internet." } as AgentTurnEvent);
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: voiceErrorLine("sem internet."), error: true }]);
    // Nem volta depois: a espera do aviso foi junto.
    r.advance(readingMs(WARN));
    expect(bubbles(r.take())).toEqual([]);
  });

  test("o limite acabado: o erro diz quando ele volta, no lugar da mensagem do agente", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("out"));
    expect(bubbles(r.take())).toEqual([]);
    r.cat.turn({ type: "error", id: "r1", code: "E_AGENT_LIMIT", message: "usage limit reached" } as AgentTurnEvent);
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: limitBubble("out", undefined, undefined, Date.now()), error: true }]);
  });

  test("um pedido que não veio da fala também mostra o aviso, e o gato fica até a leitura acabar", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started());
    r.take();
    r.cat.turn(limit("warning", { percent: 90 }));
    const line = limitBubble("warning", 90, undefined, Date.now());
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: line, error: false }]);
    r.cat.turn(doneWith("ok"));
    r.take();
    // O pronto sem balão de resposta (spec #12938) só começa a sair depois do tempo de leitura do aviso.
    r.advance(readingMs(line) + OVERLAY_TIMES.pronto - 1);
    expect(r.take().filter((c) => c.type === "catOverlay.hide")).toEqual([]);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.prontoExit }]);
  });

  test("um pedido que não veio da fala também diz quando o limite volta", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started());
    r.take();
    r.cat.turn(limit("out"));
    r.cat.turn({ type: "error", id: "r1", code: "E_AGENT_LIMIT", message: "usage limit reached" } as AgentTurnEvent);
    const line = limitBubble("out", undefined, undefined, Date.now());
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: line, error: true }]);
    // Sem a fala não há conversa: sem a pergunta, o gato sai depois do tempo de ler.
    r.advance(readingMs(line) - 1);
    expect(r.take()).toEqual([]);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.erroExit }]);
  });

  test("com o app em English, o aviso e o limite acabado saem em inglês", () => {
    mainLocale.set("en");
    try {
      const r = rig();
      talk(r);
      r.cat.turn(limit("warning", { percent: 85 }));
      expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "You've used 85% of your limit. I'll keep going, but take it easy.", error: false }]);
      const o = rig();
      talk(o);
      o.cat.turn(limit("out"));
      o.cat.turn({ type: "error", id: "r1", code: "E_AGENT_LIMIT", message: "usage limit reached" } as AgentTurnEvent);
      expect(bubbles(o.take())).toEqual([{ type: "catOverlay.bubble", text: limitBubble("out", undefined, undefined, Date.now(), "en"), error: true }]);
      expect(limitBubble("out", undefined, undefined, Date.now(), "en")).toBe("Your limit ran out.");
    } finally {
      mainLocale.set("pt");
    }
  });

  test("fechar no × durante a espera do aviso: a resposta não volta depois", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("warning", { percent: 85 }));
    r.advance(100);
    r.cat.turn(doneWith("Resumi a nota."));
    r.cat.close();
    r.take();
    r.advance(readingMs(WARN) + 50);
    expect(r.take()).toEqual([]);
  });

  test("a hora de volta de um pedido não vaza para o seguinte", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("out", { resetsAt: new Date(Date.now() + 3600_000).toISOString() }));
    r.cat.turn(doneWith("Resumi."));
    r.advance(60_000);
    r.take();
    talk(r, "r2");
    r.cat.turn({ type: "error", id: "r2", code: "E_AGENT_LIMIT", message: "limite do agente." } as AgentTurnEvent);
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: voiceErrorLine("limite do agente."), error: true }]);
  });

  test("com o hub à vista, o aviso fica no gato do canto", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.setHubInView(true);
    r.cat.turn(started());
    r.cat.turn(limit("warning", { percent: 90 }));
    expect(bubbles(r.take())).toEqual([]);
  });

  test("um aviso atrasado de outro pedido não entra", () => {
    const r = rig();
    talk(r, "r2");
    r.cat.turn(limit("warning", { percent: 90 }, "r1"));
    expect(bubbles(r.take())).toEqual([]);
  });

  test("um pedido novo tira o aviso do anterior e a resposta que esperava por ele", () => {
    const r = rig();
    talk(r);
    r.cat.turn(limit("warning"));
    r.cat.turn(doneWith("Resumi a nota."));
    r.take();
    talk(r, "r2");
    r.advance(readingMs(WARN));
    expect(bubbles(r.take())).toEqual([]);
  });
});

describe("a voz do gato no overlay (T26829)", () => {
  const doneWith = (t: string, id = "r1"): AgentTurnEvent => ({ type: "done", id, stopReason: "end_turn", text: t }) as AgentTurnEvent;
  const falas = (sent: CatOverlayCommand[]) => sent.filter((c) => c.type === "catOverlay.fala");
  function talk(r: ReturnType<typeof rig>, id = "r1") {
    r.cat.configure(true);
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.voice({ phase: "processing" });
    r.cat.turn(started(id));
    r.cat.voice({ phase: "asked", text: "um pedido", id });
    r.take();
  }

  test("o nível vai à página, limitado a 0–1, e o null volta ao estado de antes", () => {
    const r = rig();
    talk(r);
    r.cat.speech({ turnId: "r1", nivel: 0.4 });
    r.cat.speech({ turnId: "r1", nivel: 3 });
    r.cat.speech({ turnId: "r1", nivel: 0.123456 });
    r.cat.speech({ turnId: "r1", nivel: null });
    expect(r.take()).toEqual([
      { type: "catOverlay.fala", nivel: 0.4 },
      { type: "catOverlay.fala", nivel: 1 },
      { type: "catOverlay.fala", nivel: 0.123 },
      { type: "catOverlay.fala", nivel: null },
    ]);
    // Um null a mais (sem voz tocando) não manda nada.
    r.cat.speech({ turnId: "r1", nivel: null });
    expect(r.take()).toEqual([]);
  });

  test("com a voz tocando, o gato não sai; a espera recomeça inteira no fim da voz", () => {
    const r = rig();
    talk(r);
    r.cat.speech({ turnId: "r1", nivel: 0.5 });
    r.cat.turn(doneWith("Feito."));
    r.take();
    // Muito mais que a espera inteira: o gato segue na tela, falando.
    r.advance(OVERLAY_TIMES.idleAsk + OVERLAY_TIMES.askLeave + 1000);
    expect(r.cat.visible).toBe(true);
    expect(r.take()).toEqual([]);
    r.cat.speech({ turnId: "r1", nivel: null });
    expect(falas(r.take())).toEqual([{ type: "catOverlay.fala", nivel: null }]);
    r.advance(OVERLAY_TIMES.idleAsk - 1);
    expect(r.take()).toEqual([]);
    r.advance(1);
    expect(r.take()).toEqual([{ type: "catOverlay.bubble", text: "Feito.", error: false, ask: true }]);
    r.advance(OVERLAY_TIMES.askLeave);
    expect(r.cat.visible).toBe(false);
  });

  test("sem balão (o pronto de um pedido escrito), a voz tocando também segura o gato", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started("r1"));
    r.take();
    r.cat.speech({ turnId: "r1", nivel: 0.5 });
    r.cat.turn(doneWith("Feito."));
    r.take();
    r.advance(OVERLAY_TIMES.pronto + OVERLAY_TIMES.prontoExit + 1000);
    expect(r.cat.visible).toBe(true);
    expect(r.take().filter((c) => c.type === "catOverlay.hide")).toEqual([]);
    // A voz para: a espera do pronto recomeça inteira.
    r.cat.speech({ turnId: "r1", nivel: null });
    r.take();
    r.advance(OVERLAY_TIMES.pronto - 1);
    expect(r.cat.visible).toBe(true);
    r.advance(1);
    expect(r.take().some((c) => c.type === "catOverlay.hide")).toBe(true);
  });

  test("a voz que começa depois do pronto também segura o gato", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started("r1"));
    r.cat.turn(doneWith("Feito."));
    r.take();
    r.advance(OVERLAY_TIMES.pronto - 10);
    r.cat.speech({ turnId: "r1", nivel: 0.5 });
    r.advance(1000);
    expect(r.cat.visible).toBe(true);
    r.cat.speech({ turnId: "r1", nivel: null });
    r.advance(OVERLAY_TIMES.pronto);
    expect(r.take().some((c) => c.type === "catOverlay.hide")).toBe(true);
  });

  test("com o gato fora do overlay, ou o interruptor desligado, nada vai à página", () => {
    const r = rig();
    r.cat.speech({ turnId: "r1", nivel: 0.5 });
    expect(r.take()).toEqual([]);
    r.cat.configure(true);
    r.take();
    r.cat.speech({ turnId: "r1", nivel: 0.5 });
    r.cat.speech({ turnId: "r1", nivel: null });
    expect(falas(r.take())).toEqual([]);
  });
});

describe("o andamento e o [Parar] no overlay (spec #32534, Cena 2, T33177)", () => {
  const NOTA = "Clientes/Ana Souza - contrato.md";
  const run = (tool: string, target?: string, id = "r1"): AgentTurnEvent =>
    ({ type: "status", id, status: "running", tool, ...(target ? { target } : {}) }) as AgentTurnEvent;
  const say = (text: string, id = "r1"): AgentTurnEvent => ({ type: "text", id, text }) as AgentTurnEvent;
  const bubbles = (sent: CatOverlayCommand[]) => sent.filter((c) => c.type === "catOverlay.bubble");
  function talk(r: ReturnType<typeof rig>, heard: string | null = "resume as notas da Ana", id = "r1") {
    r.cat.configure(true);
    r.cat.voice({ phase: "listening", voz: 0 });
    r.cat.voice({ phase: "processing" });
    r.cat.turn(started(id));
    r.cat.voice({ phase: "asked", ...(heard ? { text: heard } : {}), id });
  }

  test("o passo troca a cada ferramenta, com o que a pessoa falou em cima, e nunca o nome nem o texto de uma nota", () => {
    const r = rig();
    talk(r);
    for (const e of [
      status("thinking"),
      run("notes_search"),
      run("notes_search", "Ana"),
      run("notes_read"),
      run("notes_read", NOTA),
      run("notes_read", "Clientes/Ana Souza - proposta.md"),
      run("notes_read", NOTA),
      say("O contrato da Ana vence em março."),
      run("web"),
      run("kiwi"),
    ]) r.cat.turn(e);
    const sent = bubbles(r.take());
    expect(sent.map((b) => (b as { text: string }).text)).toEqual([
      "Pensando", "Procurando nas suas notas", "Lendo uma nota", "Lendo 2 notas", "Escrevendo a resposta", "Pesquisando na web",
    ]);
    for (const b of sent) expect(b).toMatchObject({ error: false, progress: true, heard: "“resume as notas da Ana”" });
    // A fala da pessoa vai em cima; nada da nota nem do que o agente escreveu.
    expect(JSON.stringify(sent.map(({ heard: _, ...b }) => b))).not.toMatch(/Ana|contrato|Clientes|março|\.md/);
  });

  test("sem o \"Mostrar o que eu falei\", só o andamento; com o app em English, em inglês", () => {
    const r = rig();
    talk(r, null);
    r.cat.turn(run("notes_read", "a.md"));
    expect(bubbles(r.take())).toEqual([
      { type: "catOverlay.bubble", text: "Pensando", error: false, progress: true },
      { type: "catOverlay.bubble", text: "Lendo uma nota", error: false, progress: true },
    ]);
    mainLocale.set("en");
    try {
      const e = rig();
      talk(e, "summarize my notes");
      for (const t of ["a.md", "b.md"]) e.cat.turn(run("notes_read", t));
      expect(bubbles(e.take()).at(-1)).toEqual({ type: "catOverlay.bubble", text: "Reading 2 notes", error: false, progress: true, heard: "“summarize my notes”" });
    } finally {
      mainLocale.set("pt");
    }
  });

  test("a fala (Cena 1) e a resposta tomam o lugar do andamento, e ele não volta", () => {
    const r = rig();
    talk(r);
    r.cat.turn(run("cat_speak"));
    r.take();
    r.cat.turn({ type: "speech", id: "r1", text: "Achei duas notas." } as AgentTurnEvent);
    r.cat.turn(run("notes_read", NOTA));
    r.cat.turn(say("Achei duas notas."));
    expect(bubbles(r.take())).toEqual([{ type: "catOverlay.bubble", text: "Achei duas notas.", error: false }]);
    r.cat.turn({ type: "done", id: "r1", stopReason: "end_turn", text: "Achei duas notas." } as AgentTurnEvent);
    expect(bubbles(r.take()).every((b) => !(b as { progress?: boolean }).progress)).toBe(true);
  });

  test("um pedido que não veio da fala não mostra o andamento por cima dos apps", () => {
    const r = rig();
    r.cat.configure(true);
    r.cat.turn(started());
    r.cat.turn(status("thinking"));
    r.cat.turn(run("notes_read", NOTA));
    expect(bubbles(r.take())).toEqual([]);
  });

  test("o × (o [Parar]) durante o pedido cancela, e o done cancelado tira o gato pela saída de cancelamento", () => {
    const r = rig();
    talk(r);
    r.cat.turn(run("notes_search"));
    r.take();
    r.cat.close();
    expect(r.cancels).toHaveLength(1);
    // Nada sai antes do `done`: o gato fica até o agente parar.
    expect(r.take()).toEqual([]);
    expect(r.cat.visible).toBe(true);
    r.cat.turn(done("cancelled"));
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.cancelExit }]);
    r.cat.turn(run("web"));
    expect(r.take()).toEqual([]);
  });

  test("depois da resposta, o × volta a só fechar, sem cancelar nada", () => {
    const r = rig();
    talk(r);
    r.cat.turn({ type: "done", id: "r1", stopReason: "end_turn", text: "Pronto, resumi." } as AgentTurnEvent);
    r.take();
    r.cat.close();
    expect(r.cancels).toEqual([]);
    expect(r.take()).toEqual([{ type: "catOverlay.hide", fadeMs: OVERLAY_TIMES.prontoExit }]);
  });

  test("o attach liga o cancelamento ao agent.cancel", async () => {
    let cancelled = 0;
    let turn: (e: AgentTurnEvent) => void = () => {};
    const a = attachCatOverlay({
      agent: {
        status: async () => ({ enabled: true }) as AgentStatus,
        onStatus: () => () => {},
        onTurn: (fn) => ((turn = fn), () => {}),
        cancel: async () => void cancelled++,
      },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, kiwicat: { ...DEFAULT_SETTINGS.kiwicat, overlay: true } }) as AppSettings },
      helper: { send: async () => ({ ok: true }), onReady: () => () => {} },
      pageDir: "/exemplo",
      where: () => {},
    });
    await Bun.sleep(0);
    turn(started());
    a.overlay.close();
    expect(cancelled).toBe(1);
    a.stop();
  });
});
