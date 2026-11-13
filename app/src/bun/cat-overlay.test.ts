// O gato no overlay (spec #9810): quando o app manda o helper mostrar, mudar e esconder o gato, com os tempos do
// roteiro. Um relógio falso e um helper falso que grava os comandos; nada abre na tela.
import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent } from "../shared/ui-contract.ts";
import type { Command } from "../shared/ipc.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import type { AgentStatus, AppSettings } from "../shared/ui-contract.ts";
import { attachCatOverlay, CatOverlay, type CatOverlayCommand, OVERLAY_TIMES } from "./cat-overlay.ts";

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
  const cat = new CatOverlay({ send: (c) => sent.push(c), where: (w) => where.push(w) }, clock);
  const take = () => sent.splice(0);
  return { cat, sent, where, advance, take };
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
    expect(take()).toEqual([{ type: "catOverlay.load" }]);
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
    const settings = (overlay: boolean, cor: AppSettings["kiwicat"]["cor"] = "agente"): AppSettings => ({ ...DEFAULT_SETTINGS, kiwicat: { show: true, overlay, cor } });
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
    expect(sent).toEqual([{ type: "catOverlay.color", cor: "#ff9b5e" }, { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" }]);
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
    expect(sent.map((c) => c.type)).toEqual(["catOverlay.unload", "catOverlay.color", "catOverlay.load"]);
  });

  test("o helper reiniciou com o gato na tela: carrega e volta no mesmo estado, sem a entrada", async () => {
    const { sent, emit } = wired();
    await tick();
    emit.turn(started());
    emit.turn(status("running"));
    sent.splice(0);
    emit.ready();
    expect(sent).toEqual([
      { type: "catOverlay.color", cor: "#ff9b5e" },
      { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" },
      { type: "catOverlay.show", estado: "agindo", fadeMs: 0 },
    ]);
  });

  test("a cor dos Ajustes vai à página aberta na hora, também com o gato na tela, e só quando muda (spec #9349)", async () => {
    const { attached, sent, emit, settings } = wired();
    await tick();
    emit.turn(started());
    sent.splice(0);
    attached.settingsChanged(settings(true, "azul"));
    attached.settingsChanged(settings(true, "azul"));
    expect(sent).toEqual([{ type: "catOverlay.color", cor: "#6ea8ff" }]);
  });

  test("com o overlay desligado, a cor fica guardada e vai antes do próximo load (spec #9349)", async () => {
    const { attached, sent, settings } = wired({ overlay: false });
    await tick();
    attached.settingsChanged(settings(false, "verde"));
    expect(sent).toEqual([]);
    attached.settingsChanged(settings(true, "verde"));
    expect(sent).toEqual([{ type: "catOverlay.color", cor: "#3cc47c" }, { type: "catOverlay.load", dir: "/app/views/ui/catoverlay" }]);
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
