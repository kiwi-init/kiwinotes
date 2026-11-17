// R3 (T4943): quando o app libera o áudio da reunião no helper (`meeting.ack`, R1). O áudio de um trecho só sai do
// disco depois que o texto dele está salvo na nota (o `onCommitted` do R4, #5061 e #5064). Puro: os eventos e as
// confirmações entram, os acks saem.
//
// - Canal "você": a marca d'água anda durante a reunião, até o menor entre o `meeting.settled` do helper (antes dali
//   não sai mais texto) e o começo do primeiro final ainda não salvo. O helper guarda 2 s de contexto (o padrão).
// - Canal "sistema" (opção B do harry, #5131): nada sai no meio da reunião. O VBx precisa do áudio inteiro no fim.
//   Só depois do `meeting.drained`, de todos os finais salvos e do `meeting.relabel` gravado, vem um ack só, com
//   contexto 0, que apaga tudo.
// - O fim de cada canal (`meeting.drained`) libera o resto com contexto 0, também só com tudo salvo.

export type MeetingChannel = "mine" | "system";

export interface MeetingAck {
  type: "meeting.ack";
  session: string;
  channel: MeetingChannel;
  finalThroughFrame: number;
  contextFrames?: number;
}

interface FinalSegment {
  session?: string;
  channel?: MeetingChannel;
  id?: string;
  start: number;
  end: number;
  startFrame?: number;
  final: boolean;
  text?: string;
}

interface ChannelState {
  /** Os finais mandados e ainda não salvos, pela chave, com onde começam. */
  pending: Map<string, number>;
  settled: number;
  acked: number;
  drained?: number;
  /** O VBx do sistema: a correção chegou e ainda não foi gravada. */
  relabeling: boolean;
  done: boolean;
}

const RATE = 16_000;
const keyOf = (s: FinalSegment) => s.id ?? `${s.channel}:${s.start}:${s.end}`;
const frameOf = (s: FinalSegment) => s.startFrame ?? Math.floor(s.start * RATE);

export class MeetingAcks {
  private states = new Map<string, ChannelState>();
  private readonly completed = new Set<string>();

  /**
   * `onComplete` (spec #8360): uma vez por reunião, quando todo canal dela chegou ao fim, com tudo salvo na nota e a
   * correção do VBx gravada. É quando a transcrição fica pronta para o agente propor a nota do projeto.
   */
  constructor(
    private readonly send: (ack: MeetingAck) => void,
    private readonly onComplete?: (session: string) => void,
  ) {}

  /** Todo canal visto desta reunião acabou: avisa uma vez. */
  private checkComplete(session: string): void {
    if (!this.onComplete || this.completed.has(session)) return;
    const channels = [...this.states.entries()].filter(([k]) => k.startsWith(`${session}|`)).map(([, s]) => s);
    if (!channels.length || !channels.every((s) => s.done)) return;
    this.completed.add(session);
    this.onComplete(session);
  }

  private state(session: string, channel: MeetingChannel): ChannelState {
    const key = `${session}|${channel}`;
    let s = this.states.get(key);
    if (!s) this.states.set(key, (s = { pending: new Map(), settled: 0, acked: 0, relabeling: false, done: false }));
    return s;
  }

  /** Um `meeting.segment`: só os finais com texto entram (o R4 não grava os outros). */
  segment(e: FinalSegment): void {
    if (!e.final || !e.session || !e.channel || !e.text?.trim()) return;
    const s = this.state(e.session, e.channel);
    if (s.done) return;
    s.pending.set(keyOf(e), frameOf(e));
  }

  /** O R4 salvou estes segmentos na nota. */
  committed(session: string, segments: FinalSegment[]): void {
    for (const seg of segments) {
      const channel = seg.channel ?? "system";
      this.state(session, channel).pending.delete(keyOf(seg));
    }
    // Só os canais que esta reunião tem: um canal que nunca apareceu não é criado aqui (o fim da reunião espera os que
    // existem). Num canal novo, o evaluate não mandaria nada mesmo.
    for (const channel of ["mine", "system"] as const) if (this.states.has(`${session}|${channel}`)) this.evaluate(session, channel);
  }

  settled(session: string, channel: MeetingChannel, frame: number): void {
    const s = this.state(session, channel);
    s.settled = Math.max(s.settled, frame);
    this.evaluate(session, channel);
  }

  drained(session: string, channel: MeetingChannel, frame: number): void {
    this.state(session, channel).drained = frame;
    this.evaluate(session, channel);
  }

  /** A correção do VBx chegou (vem antes do `drained` do sistema). */
  relabelStarted(session: string): void {
    this.state(session, "system").relabeling = true;
  }

  /** A correção está gravada na nota. Falhou: o áudio fica, e a recuperação tenta de novo. */
  relabelDone(session: string): void {
    this.state(session, "system").relabeling = false;
    this.evaluate(session, "system");
  }

  private evaluate(session: string, channel: MeetingChannel): void {
    const s = this.state(session, channel);
    if (s.done) return;
    if (s.drained !== undefined && s.pending.size === 0 && !s.relabeling) {
      s.done = true;
      this.send({ type: "meeting.ack", session, channel, finalThroughFrame: Math.max(s.drained, s.acked), contextFrames: 0 });
      this.checkComplete(session);
      return;
    }
    if (channel === "system") return; // opção B: o sistema fica inteiro até o fim
    const target = Math.min(s.settled, ...s.pending.values());
    if (target > s.acked) {
      s.acked = target;
      this.send({ type: "meeting.ack", session, channel, finalThroughFrame: target });
    }
  }
}
