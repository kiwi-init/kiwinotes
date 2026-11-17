// O aviso falso (spec #9839, T10525): o `Notices` dos testes e da CLI headless (`KIWI_FAKE_NOTICES=<permissão>`). Só
// registra cada pedido, numa lista e, se der o arquivo, em JSON Lines. Nunca chama o macOS: nem notificação, nem o
// pedido de permissão. O "pedido" falso troca `notDetermined` pelo que `answer` disser (`allowed` por padrão).

import { appendFileSync } from "node:fs";

import type { NoticePermission, Notices } from "../../bun/notices.ts";

export type FakeNoticeCall = { op: "post"; id: string; title: string; body: string } | { op: "remove"; id: string } | { op: "request" };

export interface FakeNotices extends Notices {
  calls: FakeNoticeCall[];
  set(permission: NoticePermission): void;
}

export function fakeNotices(o: { permission?: NoticePermission; answer?: NoticePermission; file?: string } = {}): FakeNotices {
  let permission: NoticePermission = o.permission ?? "allowed";
  const calls: FakeNoticeCall[] = [];
  const record = (c: FakeNoticeCall) => {
    calls.push(c);
    if (o.file) appendFileSync(o.file, `${JSON.stringify(c)}\n`, { mode: 0o600 });
  };
  return {
    calls,
    set: (p) => void (permission = p),
    permission: () => permission,
    request: () => {
      record({ op: "request" });
      if (permission === "notDetermined") permission = o.answer ?? "allowed";
    },
    post: (id, title, body) => {
      if (permission === "allowed") record({ op: "post", id, title, body });
    },
    remove: (id) => record({ op: "remove", id }),
  };
}

export const isNoticePermission = (v: unknown): v is NoticePermission =>
  v === "unavailable" || v === "notDetermined" || v === "denied" || v === "allowed";
