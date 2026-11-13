// A notificação quando o agente espera uma resposta (spec #9839, T10525), com o aviso falso: nada chama o macOS.

import { describe, expect, test } from "bun:test";

import type { NoticePermission } from "../bun/notices.ts";
import { fakeNotices } from "./fake/notices.ts";
import { NOTICE_PREFIX, NOTICE_TITLE, noticeBody, type NoticeCard, type NoticeState, WaitingNotice } from "./notice.ts";

function make(o: { permission?: NoticePermission; answer?: NoticePermission; inView?: boolean; enabled?: boolean } = {}) {
  const notices = fakeNotices({ permission: o.permission ?? "allowed", ...(o.answer ? { answer: o.answer } : {}) });
  let card: NoticeCard | null = null;
  let inView = o.inView ?? false;
  let enabled = o.enabled ?? true;
  let shows = 0;
  const changes: NoticeState[] = [];
  const notice = new WaitingNotice({
    notices,
    inView: () => inView,
    card: () => card,
    enabled: async () => enabled,
    setEnabled: async (on) => void (enabled = on),
    show: () => void shows++,
    onChange: (s) => changes.push(s),
    pollMs: 5,
    allowWatchMs: 200,
  });
  return {
    notice,
    notices,
    changes,
    shows: () => shows,
    open: async (c: NoticeCard) => {
      card = c;
      await notice.onQuestion({ card: c.id, open: true });
    },
    close: async (id: string) => {
      card = null;
      await notice.onQuestion({ card: id, open: false });
    },
    view: async (v: boolean) => {
      inView = v;
      await notice.onView(v);
    },
  };
}

const CARD: NoticeCard = { id: "c1", items: [{ path: "Projetos/Kiwi.md" }, { path: "Projetos/Kiwi.md" }] };

describe("WaitingNotice", () => {
  test("fora da vista, uma pergunta aberta vira uma notificação só, com a nota e sem o trecho; fechar a retira", async () => {
    const m = make();
    await m.open(CARD);
    // O cartão muda a cada resposta e o evento vem de novo: continua uma só.
    await m.open(CARD);
    expect(m.notices.calls).toEqual([
      { op: "post", id: `${NOTICE_PREFIX}c1`, title: NOTICE_TITLE, body: "Dúvida em Projetos/Kiwi. Clique para responder." },
    ]);
    await m.close("c1");
    expect(m.notices.calls.at(-1)).toEqual({ op: "remove", id: `${NOTICE_PREFIX}c1` });
  });

  test("com a janela na vista não notifica; se ela sai da vista com a pergunta aberta, notifica; se volta, retira, sem repetir", async () => {
    const m = make({ inView: true });
    await m.open(CARD);
    expect(m.notices.calls).toEqual([]);
    await m.view(false);
    expect(m.notices.calls.map((c) => c.op)).toEqual(["post"]);
    await m.view(true);
    expect(m.notices.calls.map((c) => c.op)).toEqual(["post", "remove"]);
    // A mesma pergunta não avisa de novo: a pessoa já viu o cartão.
    await m.view(false);
    expect(m.notices.calls.map((c) => c.op)).toEqual(["post", "remove"]);
    // Fechada a pergunta, nada mais a retirar.
    await m.close("c1");
    expect(m.notices.calls.map((c) => c.op)).toEqual(["post", "remove"]);
  });

  test("sem a permissão ou com o aviso desligado não há notificação, e nada pede a permissão", async () => {
    for (const permission of ["notDetermined", "denied", "unavailable"] as const) {
      const m = make({ permission });
      await m.open(CARD);
      expect(m.notices.calls).toEqual([]);
    }
    const off = make({ enabled: false });
    await off.open(CARD);
    expect(off.notices.calls).toEqual([]);
  });

  test("desligar com a notificação na tela a retira", async () => {
    const m = make();
    await m.open(CARD);
    expect(await m.notice.setEnabled(false)).toEqual({ permission: "allowed", enabled: false });
    expect(m.notices.calls.map((c) => c.op)).toEqual(["post", "remove"]);
    expect(m.changes.at(-1)).toEqual({ permission: "allowed", enabled: false });
  });

  test("o clique na notificação do Kiwi traz a janela; o fechar sem clicar e outras notificações não", () => {
    const m = make();
    m.notice.onResponse({ id: `${NOTICE_PREFIX}c1`, action: "dismiss" });
    m.notice.onResponse({ id: "outra", action: "default" });
    expect(m.shows()).toBe(0);
    m.notice.onResponse({ id: `${NOTICE_PREFIX}c1`, action: "default" });
    expect(m.shows()).toBe(1);
  });

  test("Ligar as notificações pede uma vez, só se nunca foi pedida, e a resposta chega pelo onChange", async () => {
    const m = make({ permission: "notDetermined", answer: "denied" });
    await m.notice.allow();
    expect(m.notices.calls).toEqual([{ op: "request" }]);
    for (let i = 0; i < 100 && !m.changes.length; i++) await Bun.sleep(5);
    expect(m.changes).toEqual([{ permission: "denied", enabled: true }]);
    // Já respondida (negada ou dada), o botão não pede de novo: o macOS não perguntaria.
    await m.notice.allow();
    const given = make({ permission: "allowed" });
    await given.notice.allow();
    expect(m.notices.calls).toEqual([{ op: "request" }]);
    expect(given.notices.calls).toEqual([]);
  });

  test("o corpo diz a nota sem o .md, ou o texto do pedido, e nunca o trecho", () => {
    expect(noticeBody({ id: "x", items: [{ path: "A.md", answer: "send" }, { path: "Projetos/B.md" }] })).toBe(
      "Dúvida em Projetos/B. Clique para responder.",
    );
    expect(noticeBody({ id: "x", items: [{ path: "" }] })).toBe("Dúvida no texto do seu pedido. Clique para responder.");
  });
});
