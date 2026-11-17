// O atalho Control (spec #9876): falar com o agente segurando uma tecla. O helper grava e transcreve no Mac (eventos
// `agent.*`, que a fila do ditado nunca vê); este módulo liga o Control conforme os Ajustes e o agente, e leva o texto
// ao pedido. TypeScript puro com o helper e o agente de fora, testado no `bun test`.
//
// - **Armado** só com o agente ligado, o interruptor "Falar com o agente pelo Control" ligado e o ditado fora do Control
//   (`config.set {shortcuts: {agent}}`). Com um pedido em andamento, `agentBusy`: o Control não começa a ouvir.
// - **Do áudio ao pedido:** o texto do helper passa pela limpeza literal (as regras, sem LLM: nada vira lista nem muda de
//   palavra) e vai ao `agent.ask`, que o passa pelo filtro do guardrail antes do agente.
// - **Fala vazia ou curta demais** (menos de meio segundo) não manda nada. Uma transcrição que chega depois do
//   cancelamento é jogada fora (o helper já não a manda depois do Esc; aqui, nenhuma fora de hora passa).
// - **O que o gato mostra** sai como `AgentVoiceUi`: `listening` com a voz (as ondas), `processing` sem ondas (a escuta
//   encerrou, o texto ainda não ficou pronto), `asked` com o texto entendido (o balão) e `idle` (cancelado ou vazio).

import { cleanupWithRules } from "../cleanup/index.ts";
import type { DictionaryEntry } from "../cleanup/types.ts";
import type { Command, Event } from "../shared/ipc.ts";
import { DEFAULT_SHORTCUTS, shortcutsConflict } from "../shared/shortcuts.ts";
import type { AgentStatus, AgentVoiceUi, AppSettings } from "../shared/ui-contract.ts";

export type { AgentVoiceUi };

/** Menos que isso é um toque, ruído ou um "é…": não vira pedido. */
export const AGENT_VOICE_MIN_MS = 500;



export interface AgentVoiceWiring {
  agent: {
    status(): Promise<AgentStatus>;
    onStatus(fn: (s: AgentStatus) => void): () => void;
    ask(text: string): Promise<{ id: string }>;
  };
  settings: { load(): Promise<AppSettings> };
  /** O helper; sem ele (`--no-helper`), nada é armado. */
  helper?: {
    send(command: Command): Promise<{ ok: boolean; error?: string }>;
    on<T extends Event["type"]>(type: T, fn: (e: Extract<Event, { type: T }>) => void): () => void;
    onReady(fn: () => void): () => void;
  };
  /** O dicionário da pessoa, para a limpeza literal manter os termos. */
  dictionary?(): DictionaryEntry[];
  /** O que o gato mostra (o evento `agent.voice` para as janelas). */
  ui(state: AgentVoiceUi): void;
  log?(message: string): void;
}

/** O atalho do Kiwi Cat (spec #12946): o escolhido em Ajustes › Agente, ou o Control. */
export function agentShortcut(settings: Pick<AppSettings, "shortcuts">): string {
  return settings.shortcuts.agent ?? DEFAULT_SHORTCUTS.agent!;
}

/**
 * O ditado está nas mesmas teclas do atalho do Kiwi Cat (spec #9876; o atalho escolhido, #12946): o do Kiwi Cat fica
 * desligado. Os Ajustes não deixam salvar dois atalhos iguais; isto cobre um settings.json de antes.
 */
export function dictationUsesControl(settings: Pick<AppSettings, "shortcuts">): boolean {
  const text = settings.shortcuts.dictation;
  return !!text && shortcutsConflict(text, agentShortcut(settings));
}

/** O atalho armado, ou não: o agente ligado, o interruptor ligado e o ditado em outras teclas. */
export function controlArmed(settings: AppSettings, agentEnabled: boolean): boolean {
  return agentEnabled && settings.agent.enabled && settings.agent.controlShortcut && !dictationUsesControl(settings);
}

type Phase = "idle" | "recording" | "listening" | "processing";

export interface AttachedAgentVoice {
  settingsChanged(settings: AppSettings): void;
  stop(): void;
}

export function attachAgentVoice(w: AgentVoiceWiring): AttachedAgentVoice {
  let settings: AppSettings | undefined;
  let status: AgentStatus | undefined;
  let phase: Phase = "idle";
  /** Quanto durou a gravação que está sendo transcrita (do `agent.record.stopped`). */
  let durationMs = 0;
  /** O atalho que o helper escuta agora (null: nenhum). */
  let sentShortcut: string | null | undefined;
  let sentBusy: boolean | undefined;
  const log = (m: string) => w.log?.(`[agent-voice] ${m}`);

  const send = (command: Command, what: string) =>
    w.helper?.send(command).then(
      (r) => r.ok || log(`${what}: ${r.error ?? "failed"}`),
      () => {}, // sem o helper agora: o `ready` dele manda de novo
    );

  const sync = (force = false) => {
    if (!settings || !status) return;
    // O atalho escolhido (spec #12946): trocar nos Ajustes troca o que o helper escuta.
    const want = controlArmed(settings, status.enabled) ? agentShortcut(settings) : null;
    if (force || want !== sentShortcut) {
      sentShortcut = want;
      void send({ type: "config.set", shortcuts: { agent: want } }, "config.set shortcuts.agent");
    }
    if (force || status.busy !== sentBusy) {
      sentBusy = status.busy;
      void send({ type: "config.set", agentBusy: status.busy }, "config.set agentBusy");
    }
  };

  const idle = (cancelled: boolean, show: boolean) => {
    phase = "idle";
    if (show) w.ui({ phase: "idle", cancelled });
  };

  async function transcript(text: string) {
    // Fora de hora (depois do cancelamento, ou sem gravação nossa): jogada fora, sem mexer no gato.
    if (phase !== "processing") return;
    const cleaned = cleanupWithRules({ raw: text, tone: "literal", dictionary: w.dictionary?.() ?? [] }).text.trim();
    if (!cleaned || durationMs < AGENT_VOICE_MIN_MS) {
      log(`nothing to send (${durationMs} ms${cleaned ? "" : ", empty"})`);
      return idle(true, true);
    }
    phase = "idle";
    try {
      const { id } = await w.agent.ask(cleaned);
      w.ui({ phase: "asked", text: cleaned, id });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      log(`agent.ask: ${message}`);
      // O motivo vai junto (spec #12938): o gato do overlay o diz no balão, em vez de sumir calado.
      w.ui({ phase: "idle", cancelled: true, error: message });
    }
  }

  const offs: (() => void)[] = [
    w.agent.onStatus((s) => {
      status = s;
      sync();
    }),
  ];
  const h = w.helper;
  if (h) {
    offs.push(
      h.onReady(() => {
        // O helper reiniciou: ele esqueceu o atalho e o ocupado.
        sentShortcut = undefined;
        sentBusy = undefined;
        if (phase !== "idle") idle(true, true);
        sync(true);
      }),
      h.on("agent.record.started", () => {
        phase = "recording";
        durationMs = 0;
      }),
      h.on("agent.listening", () => {
        if (phase !== "recording" && phase !== "listening") return;
        phase = "listening";
        w.ui({ phase: "listening", voz: 0 });
      }),
      h.on("audio.level", (e) => {
        if (phase === "listening") w.ui({ phase: "listening", voz: e.rms });
      }),
      // A escuta encerrou: as ondas somem agora, antes de a transcrição terminar.
      h.on("agent.record.stopping", () => {
        if (phase !== "listening" && phase !== "recording") return;
        const shown = phase === "listening";
        phase = "processing";
        if (shown) w.ui({ phase: "processing" });
      }),
      h.on("agent.record.stopped", (e) => {
        if (phase === "recording" || phase === "listening") phase = "processing";
        durationMs = e.durationMs;
        if (e.samples === 0) idle(true, true);
      }),
      h.on("agent.transcript", (e) => void transcript(e.text)),
      h.on("agent.transcript.error", (e) => {
        if (phase === "idle") return;
        log(`transcript: ${e.error}`);
        idle(true, true);
      }),
      h.on("agent.record.cancelled", (e) => {
        if (phase === "idle") return;
        // Um ⌃C (antes de confirmar) não mostrou nada: nada a desfazer no gato.
        idle(true, phase !== "recording" || e.listened === true || e.phase === "transcribing");
      }),
      h.on("agent.record.error", (e) => {
        log(`record: ${e.error}`);
        idle(true, phase !== "recording");
      }),
    );
  }
  void w.agent.status().then((s) => {
    if (!status) status = s;
    sync();
  }, () => {});
  void w.settings.load().then((s) => {
    if (!settings) settings = s;
    sync();
  }, () => {});

  return {
    settingsChanged: (s) => {
      settings = s;
      sync();
    },
    stop: () => {
      for (const off of offs) off();
    },
  };
}
