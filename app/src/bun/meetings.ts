// A aba Reuniões do hub (R6, T4947): a lista das notas de reunião e a gravação ao vivo, pelo helper. Sem Electrobun
// aqui: o Session liga o rastreador aos eventos do helper, e o headless usa o falso (`FakeMeetingHost`) para os prints.

import { type MeetingLive, type MeetingNote, meetingFromNote, nextLive, NOT_RECORDING, sortMeetings } from "../shared/meetings.ts";
import type { Command } from "../shared/ipc.ts";
import type { NoteMeta } from "../notes/vault.ts";

/** O que as capacidades `meetings.*` usam: o estado ao vivo, parar e pausar o canal "você". */
export interface MeetingHost {
  live(): MeetingLive;
  onChange(fn: (live: MeetingLive) => void): () => void;
  stop(): Promise<void>;
  setMinePaused(paused: boolean): Promise<void>;
}

/** Um erro do helper ao parar ou pausar, com o código dele (`microphone_permission`, …). */
export class MeetingHostError extends Error {
  constructor(readonly code: string) {
    super(`helper: ${code}`);
  }
}

/** O `sidecar.send`: a resposta tem `ok` e, quando falha, o `error` do helper. */
type Send = (command: Command) => Promise<unknown>;

/** O código de erro de uma resposta do helper, ou null quando deu certo. */
function failure(reply: unknown, fallback: string): string | null {
  const r = (reply ?? {}) as { ok?: unknown; error?: unknown };
  if (r.ok === true) return null;
  return typeof r.error === "string" && r.error ? r.error : fallback;
}

/**
 * O estado da gravação pelos eventos do helper (`meeting.started`, `meeting.stopped`, `meeting.minePaused`). O helper
 * que cai (ou um `ready` novo) leva a captura junto: volta a "sem gravação".
 */
export class MeetingLiveTracker implements MeetingHost {
  private state: MeetingLive = NOT_RECORDING;
  private listeners = new Set<(live: MeetingLive) => void>();

  constructor(
    private readonly send: Send,
    private readonly now: () => Date = () => new Date(),
  ) {}

  live(): MeetingLive {
    return this.state;
  }

  onChange(fn: (live: MeetingLive) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Um evento do helper. Os que não são de reunião não mudam nada. */
  feed(event: { type: string; [k: string]: unknown }): void {
    this.set(nextLive(this.state, event, this.now()));
  }

  /** O helper caiu ou subiu de novo: a captura de antes não existe mais. */
  reset(): void {
    this.set(NOT_RECORDING);
  }

  async stop(): Promise<void> {
    const error = failure(await this.send({ type: "meeting.stop" }), "meeting_stop_failed");
    if (error) throw new MeetingHostError(error);
  }

  async setMinePaused(paused: boolean): Promise<void> {
    const error = failure(await this.send({ type: paused ? "meeting.pauseMine" : "meeting.resumeMine" }), "meeting_pause_failed");
    if (error) throw new MeetingHostError(error);
  }

  private set(next: MeetingLive): void {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }
}

/**
 * Uma gravação de mentira, para a CLI headless (`KIWI_FAKE_MEETING=Teams`): o card ao vivo aparece nos prints e nos
 * roteiros sem helper, sem mic e sem nada na tela de ninguém. Começou `minutesAgo` antes; parar e pausar só mudam o
 * estado.
 */
export class FakeMeetingHost implements MeetingHost {
  private state: MeetingLive;
  private listeners = new Set<(live: MeetingLive) => void>();

  constructor(app: string, minutesAgo = 12, now: () => Date = () => new Date(), warning?: string) {
    this.state = {
      recording: true,
      session: "fake-meeting",
      app: app || null,
      since: new Date(now().getTime() - minutesAgo * 60_000).toISOString(),
      minePaused: false,
      // O aviso do card ao vivo (`KIWI_FAKE_MEETING_WARNING`), para ver cada um sem gravar (T7723).
      ...(warning ? { warning } : {}),
    };
  }

  live(): MeetingLive {
    return this.state;
  }

  onChange(fn: (live: MeetingLive) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async stop(): Promise<void> {
    this.set(NOT_RECORDING);
  }

  async setMinePaused(paused: boolean): Promise<void> {
    if (this.state.recording) this.set({ ...this.state, minePaused: paused });
  }

  private set(next: MeetingLive): void {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }
}

/**
 * As notas de reunião do vault: as que têm `type:` no texto (o índice em memória) e, delas, as que o frontmatter diz
 * `type: meeting`. Lê só essas do disco.
 */
export async function listMeetings(notes: {
  notesContaining(text: string): NoteMeta[];
  get(path: string): Promise<{ content: string } & NoteMeta>;
}): Promise<MeetingNote[]> {
  const found: MeetingNote[] = [];
  for (const meta of notes.notesContaining("type:")) {
    const note = await notes.get(meta.path).catch(() => null);
    if (!note) continue; // sumiu entre o índice e a leitura
    const m = meetingFromNote(note, note.content);
    if (m) found.push(m);
  }
  return sortMeetings(found);
}
