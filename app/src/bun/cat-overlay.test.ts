// O gato no overlay (spec #9810): quando o app manda o helper mostrar, mudar e esconder o gato, com os tempos do
// roteiro. Um relógio falso e um helper falso que grava os comandos; nada abre na tela.
import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent } from "../shared/ui-contract.ts";
import { CatOverlay, type CatOverlayCommand, OVERLAY_TIMES } from "./cat-overlay.ts";

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
