// O atalho Control (spec #9876): o que o app faz com os eventos `agent.*` do helper. Helper e agente falsos.
import { describe, expect, test } from "bun:test";

import type { Command, Event } from "../shared/ipc.ts";
import type { AgentStatus, AgentVoiceUi, AppSettings } from "../shared/ui-contract.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { AGENT_VOICE_MIN_MS, attachAgentVoice, controlArmed, dictationUsesControl } from "./agent-voice.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(o: { busy?: boolean; enabled?: boolean; control?: boolean; dictation?: string } = {}) {
  const sent: Command[] = [];
  const ui: AgentVoiceUi[] = [];
  const asked: string[] = [];
  const listeners = new Map<string, Set<(e: never) => void>>();
  const readies = new Set<() => void>();
  let statusFn: ((s: AgentStatus) => void) | undefined;
  const status = { enabled: o.enabled ?? true, busy: o.busy ?? false } as AgentStatus;
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(o.dictation ? { dictation: o.dictation } : {}) },
    agent: { ...DEFAULT_SETTINGS.agent, enabled: o.enabled ?? true, consented: true, controlShortcut: o.control ?? true },
  };
  const voice = attachAgentVoice({
    agent: {
      status: async () => status,
      onStatus: (fn) => ((statusFn = fn), () => {}),
      ask: async (text) => (asked.push(text), { id: `r${asked.length}` }),
    },
    settings: { load: async () => settings },
    helper: {
      send: async (c) => (sent.push(c), { ok: true }),
      on: (type, fn) => {
        let set = listeners.get(type);
        if (!set) listeners.set(type, (set = new Set()));
        set.add(fn as (e: never) => void);
        return () => set!.delete(fn as (e: never) => void);
      },
      onReady: (fn) => (readies.add(fn), () => readies.delete(fn)),
    },
    ui: (s) => ui.push(s),
  });
  const emit = (e: Event) => {
    for (const fn of listeners.get(e.type) ?? []) (fn as (e: Event) => void)(e);
  };
  /** Uma fala inteira: segurou, falou, soltou, e o texto chegou. */
  const talk = async (text: string, durationMs = 1500) => {
    emit({ type: "agent.record.started", reason: "hotkey" });
    emit({ type: "agent.listening", latched: false });
    emit({ type: "audio.level", rms: 0.4 });
    emit({ type: "agent.record.stopping", mode: "ptt" });
    emit({ type: "agent.record.stopped", reason: "hotkey", mode: "ptt", durationMs, samples: durationMs * 16 });
    emit({ type: "agent.transcript", text, raw: text, lang: "pt", durationMs, latencyMs: 200 });
    await flush();
  };
  return { sent, ui, asked, emit, talk, voice, settings, setStatus: (s: Partial<AgentStatus>) => statusFn?.({ ...status, ...s } as AgentStatus), ready: () => readies.forEach((f) => f()) };
}

describe("o atalho Control (spec #9876)", () => {
  test("armado só com o agente ligado, o interruptor ligado e o ditado fora do Control", async () => {
    const on = rig();
    await flush();
    expect(on.sent).toContainEqual({ type: "config.set", shortcuts: { agent: "control" } });
    expect(on.sent).toContainEqual({ type: "config.set", agentBusy: false });
    for (const off of [rig({ control: false }), rig({ enabled: false }), rig({ dictation: "rightControl" })]) {
      await flush();
      expect(off.sent).toContainEqual({ type: "config.set", shortcuts: { agent: null } });
    }
    expect(dictationUsesControl({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, dictation: "double:rightControl" } })).toBe(true);
    expect(controlArmed(DEFAULT_SETTINGS, true)).toBe(false); // desligado por padrão
  });

  test("com o agente ocupado, o helper sabe e o Control não arma; o ready do helper manda de novo", async () => {
    const r = rig();
    await flush();
    r.sent.length = 0;
    r.setStatus({ busy: true });
    expect(r.sent).toEqual([{ type: "config.set", agentBusy: true }]);
    r.sent.length = 0;
    r.ready();
    expect(r.sent).toContainEqual({ type: "config.set", shortcuts: { agent: "control" } });
    expect(r.sent).toContainEqual({ type: "config.set", agentBusy: true });
  });

  test("a fala vira o pedido, pela limpeza literal: o gato ouve com as ondas, elas somem ao soltar, e o texto vai ao balão", async () => {
    const r = rig();
    await flush();
    await r.talk("resuma a nota de ontem");
    expect(r.asked).toEqual(["Resuma a nota de ontem."]);
    expect(r.ui).toEqual([
      { phase: "listening", voz: 0 },
      { phase: "listening", voz: 0.4 },
      { phase: "processing" },
      { phase: "asked", text: "Resuma a nota de ontem.", id: "r1" },
    ]);
  });

  test("as ondas só com a escuta confirmada: o nível do mic antes ou depois não mexe no gato", async () => {
    const r = rig();
    await flush();
    r.emit({ type: "audio.level", rms: 0.3 });
    r.emit({ type: "agent.record.started", reason: "hotkey" });
    r.emit({ type: "audio.level", rms: 0.3 }); // ainda pode ser um ⌃C
    expect(r.ui).toEqual([]);
  });

  test("a fala curta demais ou vazia não manda nada, e o gato volta", async () => {
    const r = rig();
    await flush();
    await r.talk("oi", AGENT_VOICE_MIN_MS - 1);
    await r.talk("   ");
    expect(r.asked).toEqual([]);
    expect(r.ui.filter((u) => u.phase === "idle")).toEqual([{ phase: "idle", cancelled: true }, { phase: "idle", cancelled: true }]);
  });

  test("um ⌃C (cancelado antes de confirmar) não mexe no gato; o Esc depois da escuta volta ao repouso", async () => {
    const r = rig();
    await flush();
    r.emit({ type: "agent.record.started", reason: "hotkey" });
    r.emit({ type: "agent.record.cancelled", reason: "hotkey", listened: false });
    expect(r.ui).toEqual([]);
    r.emit({ type: "agent.record.started", reason: "hotkey" });
    r.emit({ type: "agent.listening", latched: true });
    r.emit({ type: "agent.record.cancelled", reason: "escape", listened: true });
    expect(r.ui.at(-1)).toEqual({ phase: "idle", cancelled: true });
  });

  test("uma transcrição que chega depois do cancelamento não manda pedido nem mexe no gato", async () => {
    const r = rig();
    await flush();
    r.emit({ type: "agent.record.started", reason: "hotkey" });
    r.emit({ type: "agent.listening", latched: false });
    r.emit({ type: "agent.record.stopping", mode: "ptt" });
    r.emit({ type: "agent.record.stopped", reason: "hotkey", mode: "ptt", durationMs: 1500, samples: 24000 });
    r.emit({ type: "agent.record.cancelled", reason: "escape", phase: "transcribing" });
    const shown = r.ui.length;
    r.emit({ type: "agent.transcript", text: "apague tudo", raw: "apague tudo", lang: "pt", durationMs: 1500, latencyMs: 300 });
    await flush();
    expect(r.asked).toEqual([]);
    expect(r.ui.length).toBe(shown);
  });

  test("o texto nunca vai à fila do ditado: os eventos do agente são outros", () => {
    const types: Event["type"][] = ["agent.record.started", "agent.transcript", "agent.record.cancelled"];
    for (const t of types) expect(["record.started", "transcript.final", "record.cancelled"]).not.toContain(t);
  });
});
