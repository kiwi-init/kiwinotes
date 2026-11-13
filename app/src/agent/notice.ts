// O aviso quando o agente espera uma resposta sua (spec #9839, T10525). Quando o cartão da dúvida (spec #9873) abre e a
// janela principal não está na vista, o Kiwi mostra uma notificação do macOS: só que o agente espera, e de qual nota
// vem a dúvida, nunca o trecho. Uma por cartão; responder, o prazo passar ou a janela voltar à vista a retira; o clique
// traz a janela principal, que mostra o cartão.
//
// A permissão só é pedida em `allow()`, que a tela só chama no clique em "Ligar as notificações" (Ajustes › Agente).
// Os testes usam um `Notices` falso, que só registra (app/src/agent/notice.test.ts).

import type { NoticePermission, Notices } from "../bun/notices.ts";

/** O id de cada notificação: um por cartão. */
export const NOTICE_PREFIX = "kiwi.doubt.";
export const NOTICE_TITLE = "O agente espera uma resposta sua";
/** Quanto tempo o Kiwi relê a permissão depois do clique em "Ligar as notificações". */
export const ALLOW_WATCH_MS = 120_000;

export interface NoticeState {
  permission: NoticePermission;
  /** O liga/desliga "Avisar quando o agente esperar uma resposta"; ligado por padrão. */
  enabled: boolean;
}

/** O cartão aberto, só o que o aviso usa: o id e de onde vem cada dúvida. */
export interface NoticeCard {
  id: string;
  items: { path: string; answer?: unknown }[];
}

export interface WaitingNoticeDeps {
  notices: Notices;
  /** A janela principal está na vista: aberta, na frente, com o foco. */
  inView: () => boolean;
  /** O cartão aberto agora (`AgentService.question()`), ou null. */
  card: () => NoticeCard | null;
  enabled: () => Promise<boolean>;
  setEnabled: (on: boolean) => Promise<void>;
  /** Traz a janela principal para a frente (o cartão aparece nela). */
  show: () => void;
  onChange?: (s: NoticeState) => void;
  log?: (m: string) => void;
  pollMs?: number;
  allowWatchMs?: number;
}

/** De onde vem a dúvida, para o corpo da notificação: a nota sem o `.md`, ou o texto do pedido. */
export function noticeBody(card: NoticeCard): string {
  const open = card.items.find((i) => i.answer === undefined) ?? card.items[0];
  const note = open?.path ? open.path.replace(/\.md$/i, "") : "";
  return note ? `Dúvida em ${note}. Clique para responder.` : "Dúvida no texto do seu pedido. Clique para responder.";
}

export class WaitingNotice {
  /** O cartão com a notificação na tela, se houver. */
  private shown: string | null = null;
  /** O cartão aberto que ainda pode avisar (o que abriu com a janela na vista avisa se ela sair da vista). */
  private openCard: string | null = null;
  /** O cartão que já avisou uma vez: uma notificação por pergunta, mesmo que a janela entre e saia da vista. */
  private posted: string | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly d: WaitingNoticeDeps) {}

  async state(): Promise<NoticeState> {
    return { permission: this.d.notices.permission(), enabled: await this.d.enabled() };
  }

  /** O `agent.questionChanged`: só os ids. */
  async onQuestion(e: { card: string; open: boolean }): Promise<void> {
    if (!e.open) {
      if (this.openCard === e.card) this.openCard = null;
      if (this.shown === e.card) this.retract();
      return;
    }
    this.openCard = e.card;
    await this.maybePost();
  }

  /** A janela principal entrou ou saiu da vista. */
  async onView(inView: boolean): Promise<void> {
    if (inView) {
      if (this.shown) this.retract();
      return;
    }
    await this.maybePost();
  }

  /** O clique na notificação (o evento `notification-response` da engine). */
  onResponse(e: { id: string; action: string }): void {
    if (!e.id.startsWith(NOTICE_PREFIX) || e.action !== "default") return;
    this.d.log?.("notice: clicked, showing the main window");
    this.d.show();
  }

  /** O liga/desliga. Desligado com uma notificação na tela, ela sai. */
  async setEnabled(on: boolean): Promise<NoticeState> {
    await this.d.setEnabled(on);
    if (!on && this.shown) this.retract();
    const s = await this.state();
    this.d.onChange?.(s);
    return s;
  }

  /**
   * "Ligar as notificações": o único lugar que pede a permissão ao macOS, e só se ela nunca foi pedida. Volta na hora;
   * a resposta da pessoa chega pelo `onChange` quando o Kiwi a lê.
   */
  async allow(): Promise<NoticeState> {
    const before = this.d.notices.permission();
    if (before === "notDetermined") {
      this.d.log?.("notice: asking macOS for permission (the person clicked)");
      this.d.notices.request();
      this.watchPermission(before);
    }
    return this.state();
  }

  stop(): void {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    if (this.shown) this.retract();
  }

  private watchPermission(from: NoticePermission): void {
    if (this.watch) clearInterval(this.watch);
    const until = Date.now() + (this.d.allowWatchMs ?? ALLOW_WATCH_MS);
    this.watch = setInterval(() => {
      const now = this.d.notices.permission();
      if (now === from && Date.now() < until) return;
      if (this.watch) clearInterval(this.watch);
      this.watch = null;
      void this.state().then((s) => this.d.onChange?.(s));
    }, this.d.pollMs ?? 500);
  }

  private async maybePost(): Promise<void> {
    const id = this.openCard;
    if (!id || this.posted === id || this.d.inView()) return;
    if (this.d.notices.permission() !== "allowed" || !(await this.d.enabled())) return;
    const card = this.d.card();
    if (!card || card.id !== id || this.openCard !== id || this.d.inView()) return;
    this.d.notices.post(NOTICE_PREFIX + id, NOTICE_TITLE, noticeBody(card));
    this.shown = this.posted = id;
    this.d.log?.("notice: posted (the main window is out of view)");
  }

  private retract(): void {
    if (!this.shown) return;
    this.d.notices.remove(NOTICE_PREFIX + this.shown);
    this.shown = null;
  }
}
