// Os avisos do Kiwi no Calendário (spec #32129, T32156): um agendador no processo principal que, na hora do aviso de
// cada item, mostra a notificação do macOS e o Kiwi fala a frase na voz escolhida (a local ou o ElevenLabs, com a queda
// para a local). Roda com a janela fechada, porque o main fica de pé na barra de menus. Nada liga o microfone.
//
// - **Quais avisos:** os do `alertsBetween` do Calendário (T32154): já sem o feito, o `🔕` e a reunião gravada, e com as
//   repetições abertas. Cada um vem com um `key` que não muda com uma linha nova acima nem com o `🔔` gravado.
// - **Uma vez só:** o aviso dado fica guardado pelo `key` num JSON nos dados do app, gravado antes de avisar. Reabrir o
//   app, ou a conferência seguinte, não repete.
// - **Com o app fechado:** um aviso que passou da hora há até `ALERT_GRACE_MS` ainda sai quando o app abre; mais velho,
//   não (um "em 10 minutos" de ontem só confundiria).
// - **Calado quando grava:** com uma reunião ou um ditado gravando, só a notificação sai. A fala entraria na gravação.
//
// Os testes usam o relógio, as notificações e a fala falsos (`calendar-alerts.test.ts`).

import type { Notices } from "./notices.ts";
import { type CalendarKiwiKind, dayOf, spokenTime, startMs } from "../shared/calendar-kiwi.ts";
import { type Locale, translate } from "../shared/i18n/index.ts";
import { readJson, writeAtomic } from "../store/files.ts";

/** De quanto em quanto tempo o agendador confere. */
export const ALERT_TICK_MS = 30_000;
/** Até quanto tempo depois da hora um aviso ainda sai (o app estava fechado, ou o Mac dormia). */
export const ALERT_GRACE_MS = 15 * 60_000;
/** Por quanto tempo o aviso dado fica guardado: o bastante para a janela de cima e para um `🔔 1d`. */
export const FIRED_KEEP_MS = 3 * 86_400_000;
/** O começo do id das notificações do Calendário (o clique leva à aba Calendário). */
export const CALENDAR_NOTICE_PREFIX = "kiwi.calendar.";
/** Quantas frases a fala junta numa conferência: com mais avisos juntos, as notificações dizem o resto. */
export const SPEECH_MAX = 3;

export type AlertKind = CalendarKiwiKind;

/** O que o aviso usa do `CalendarItem` (src/shared/calendar.ts, T32154). */
export interface AlertItem {
  kind: AlertKind;
  title: string;
  project: string | null;
  /** ISO local: `2026-11-27T10:00`, ou `2026-11-27` no dia todo. */
  start: string;
  allDay: boolean;
}

/** Um aviso na hora: o item, quando avisar (ms) e a chave que o guarda como dado. */
export interface DueAlert<I extends AlertItem = AlertItem> {
  item: I;
  at: number;
  key: string;
}

/** Os avisos já dados: o `key` e a hora do aviso. */
export interface FiredStore {
  load(): Promise<Record<string, number>>;
  save(fired: Record<string, number>): Promise<void>;
}

export interface CalendarAlertsDeps {
  now(): number;
  /** Os avisos com a hora entre `fromMs` (entra) e `toMs` (não entra). */
  alertsBetween(fromMs: number, toMs: number): Promise<DueAlert[]>;
  notices: Pick<Notices, "post">;
  /** Fala o texto na voz escolhida. Rejeita sem a voz (o helper não subiu, nada baixado): só a notificação fica. */
  speak(text: string): Promise<void>;
  /** Uma reunião, um ditado ou o atalho do Kiwi gravando agora: a fala fica calada (só a notificação). */
  recording(): boolean;
  /** O Kiwi falando agora (uma resposta): o aviso não corta a fala dele, e fica só a notificação. */
  speaking(): boolean;
  fired: FiredStore;
  locale(): Locale;
  log?(m: string): void;
}

/** O arquivo dos avisos dados, em `<dados>/calendar-alerts.json`. Um arquivo ilegível conta como vazio. */
export function firedFile(file: string): FiredStore {
  return {
    load: async () => {
      const got = await readJson<unknown>(file).catch(() => undefined);
      if (!got || typeof got !== "object" || Array.isArray(got)) return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(got)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      return out;
    },
    save: (fired) => writeAtomic(file, JSON.stringify(fired)),
  };
}

/** Quando é o item, visto de `now`: "Agora", "Em 10 minutos", "Às 9h", "Amanhã às 9h". */
export function whenText(item: AlertItem, now: number, locale: Locale): string {
  const start = startMs(item.start);
  const tomorrow = dayOf(start) > dayOf(now);
  if (item.allDay) return tomorrow ? translate(locale, "calendarKiwi.when.tomorrow") : translate(locale, "calendarKiwi.when.now");
  const time = spokenTime(start, locale);
  if (tomorrow) return translate(locale, "calendarKiwi.when.tomorrowAt", { time });
  const min = Math.round((start - now) / 60_000);
  if (min <= 0 && min >= -1) return translate(locale, "calendarKiwi.when.now");
  if (min > 0 && min < 60) return translate(locale, "calendarKiwi.when.minutes", { n: min });
  return translate(locale, "calendarKiwi.when.at", { time });
}

/** A notificação e a frase de um aviso, na língua do app. */
export function alertTexts(item: AlertItem, now: number, locale: Locale): { title: string; body: string; speech: string } {
  const when = whenText(item, now, locale);
  const kind = translate(locale, `calendarKiwi.kind.${item.kind}`);
  return {
    title: translate(locale, "calendarKiwi.alert.title", { when, kind }),
    body: item.project ? translate(locale, "calendarKiwi.alert.bodyProject", { title: item.title, project: item.project }) : item.title,
    speech: translate(locale, "calendarKiwi.alert.speech", { when, kind, title: item.title }),
  };
}

/** O id da notificação: curto e o mesmo para o mesmo aviso (um aviso repetido troca o anterior, não empilha). */
export function noticeId(key: string): string {
  return CALENDAR_NOTICE_PREFIX + Bun.hash(key).toString(36);
}

export class CalendarAlerts {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private stopped = false;
  private cache: Record<string, number> | null = null;

  constructor(private readonly d: CalendarAlertsDeps) {}

  /** Liga: uma conferência agora (pega o aviso que passou com o app fechado) e outra a cada `everyMs`. */
  start(everyMs = ALERT_TICK_MS): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), everyMs);
    (this.timer as { unref?: () => void }).unref?.();
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Uma conferência: os avisos da janela que ainda não saíram viram notificação e fala. Devolve os que saíram (os
   * testes leem). Nunca lança; uma conferência por vez.
   */
  async tick(): Promise<DueAlert[]> {
    if (this.checking || this.stopped) return [];
    this.checking = true;
    try {
      const now = this.d.now();
      const due = (await this.d.alertsBetween(now - ALERT_GRACE_MS, now + 1)).filter((a) => a.at <= now && a.at > now - ALERT_GRACE_MS);
      if (!due.length) return [];
      const fired = (this.cache ??= await this.d.fired.load());
      const fresh = due.filter((a) => !(a.key in fired)).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
      // A mesma chave duas vezes na lista (duas leituras da mesma linha) avisa uma vez.
      const once = fresh.filter((a, i) => fresh.findIndex((b) => b.key === a.key) === i);
      if (!once.length) return [];
      for (const a of once) fired[a.key] = a.at;
      for (const [k, at] of Object.entries(fired)) if (at < now - FIRED_KEEP_MS) delete fired[k];
      // Grava antes de avisar: se o app cair no meio, o aviso não volta repetido.
      await this.d.fired.save(fired);
      this.announce(once, now);
      return once;
    } catch (e) {
      this.d.log?.(`calendar-alerts: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    } finally {
      this.checking = false;
    }
  }

  private announce(alerts: DueAlert[], now: number): void {
    const locale = this.d.locale();
    const texts = alerts.map((a) => ({ a, t: alertTexts(a.item, now, locale) }));
    for (const { a, t } of texts) this.d.notices.post(noticeId(a.key), t.title, t.body);
    this.d.log?.(`calendar-alerts: ${alerts.length} alert(s) posted`);
    if (this.d.recording()) {
      this.d.log?.("calendar-alerts: recording now, not speaking");
      return;
    }
    if (this.d.speaking()) {
      this.d.log?.("calendar-alerts: the Kiwi is speaking, not speaking over it");
      return;
    }
    const speech = texts.slice(0, SPEECH_MAX).map(({ t }) => t.speech).join(" ");
    void this.d.speak(speech).catch((e) => this.d.log?.(`calendar-alerts: couldn't speak: ${e instanceof Error ? e.message : String(e)}`));
  }
}

const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Os avisos de um período pelos itens do Calendário: lê do dia de `fromMs` até o fim do dia seguinte ao de `toMs` (o
 * `🔔 1d` de um item de amanhã avisa hoje; o `to` do `calendar.items` não entra) e deixa o `alertsBetween` (T32154)
 * escolher os da janela.
 */
export function alertsVia<I extends AlertItem>(
  items: (range: { from: string; to: string }) => Promise<{ items: readonly I[] }>,
  between: (items: readonly I[], fromMs: number, toMs: number) => DueAlert<I>[],
): (fromMs: number, toMs: number) => Promise<DueAlert<I>[]> {
  return async (fromMs, toMs) => {
    const r = await items({ from: isoDay(fromMs), to: isoDay(dayOf(toMs) + 60 * 3_600_000) });
    return between(r.items, fromMs, toMs);
  };
}

/** Os eventos do helper que abrem e fecham o mic: o ditado (`record.*`) e o atalho do Kiwi (`agent.record.*`). */
const MIC_EVENTS = {
  dictation: { start: "record.started", end: ["record.stopped", "record.cancelled", "record.error"] },
  kiwi: { start: "agent.record.started", end: ["agent.record.stopped", "agent.record.cancelled", "agent.record.error"] },
} as const;
export type MicEvent = (typeof MIC_EVENTS)[keyof typeof MIC_EVENTS]["start" | "end"] extends infer E ? (E extends readonly (infer I)[] ? I : E) : never;

/**
 * O mic aberto agora, pelos eventos do helper: o ditado e o atalho do Kiwi, cada um do started ao stopped (ou o
 * cancelado, o erro, ou um helper novo). A fala do aviso fica calada enquanto isso, senão cai na transcrição.
 */
export function micRecording(on: (type: MicEvent | "ready", fn: () => void) => () => void): {
  recording(): boolean;
  stop(): void;
} {
  const live = { dictation: false, kiwi: false };
  const offs: (() => void)[] = [];
  for (const k of ["dictation", "kiwi"] as const) {
    offs.push(on(MIC_EVENTS[k].start, () => (live[k] = true)));
    for (const t of MIC_EVENTS[k].end) offs.push(on(t, () => (live[k] = false)));
  }
  offs.push(on("ready", () => ((live.dictation = false), (live.kiwi = false))));
  return { recording: () => live.dictation || live.kiwi, stop: () => offs.forEach((off) => off()) };
}
