// A notificação do macOS do próprio app (spec #9839, T10525), pela dylib KiwiNotify (native/Sources/KiwiNotify) que o
// build põe em bin/, ao lado do helper. Quem notifica é o processo do app: o helper não é um `.app` e o
// `UNUserNotificationCenter` só funciona dentro de um.
//
// Só `request()` pede a permissão ao macOS, e o app só a chama no clique da pessoa em "Ligar as notificações". Os testes
// nunca carregam a dylib: usam um `Notices` falso.

import { existsSync } from "node:fs";

/** O nome da dylib em bin/ (o build-helper copia, o release assina como os outros Mach-O). */
export const NOTIFY_LIBRARY = "libKiwiNotify.dylib";

/**
 * A permissão de notificar: `unavailable` fora do app de verdade (CLI, testes, dylib que falta), `notDetermined` quando o
 * Kiwi ainda não pediu, `denied` quando a pessoa negou, `allowed` quando pode.
 */
export type NoticePermission = "unavailable" | "notDetermined" | "denied" | "allowed";

export interface Notices {
  permission(): NoticePermission;
  /** Pede ao macOS. Só no clique da pessoa. O resultado se lê depois, pelo `permission()`. */
  request(): void;
  /** Mostra a notificação com este id (o mesmo id troca a anterior). Sem a permissão, não faz nada. */
  post(id: string, title: string, body: string): void;
  /** Tira da tela e da Central de Notificações. */
  remove(id: string): void;
}

export const NO_NOTICES: Notices = {
  permission: () => "unavailable",
  request: () => {},
  post: () => {},
  remove: () => {},
};

export function permissionOf(code: number): NoticePermission {
  if (code === 0) return "notDetermined";
  if (code === 1) return "denied";
  if (code === 2 || code === 3) return "allowed";
  return "unavailable";
}

const cstring = (s: string) => Buffer.from(`${s}\0`, "utf8");

/** Carrega a dylib; sem ela (ou num erro ao carregar), um aviso que não faz nada. */
export async function loadNotices(file: string, log: (m: string) => void = () => {}): Promise<Notices> {
  if (!existsSync(file)) {
    log(`notices: no ${NOTIFY_LIBRARY} at ${file}`);
    return NO_NOTICES;
  }
  try {
    const { dlopen, FFIType, ptr } = await import("bun:ffi");
    const { symbols } = dlopen(file, {
      kiwi_notify_status: { args: [], returns: FFIType.i32 },
      kiwi_notify_request: { args: [], returns: FFIType.i32 },
      kiwi_notify_post: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      kiwi_notify_remove: { args: [FFIType.ptr], returns: FFIType.void },
    });
    return {
      permission: () => permissionOf(symbols.kiwi_notify_status()),
      request: () => void symbols.kiwi_notify_request(),
      // Os buffers ficam em variáveis até a chamada voltar: o ponteiro não segura o buffer contra o GC.
      post: (id, title, body) => {
        const a = cstring(id), b = cstring(title), c = cstring(body);
        symbols.kiwi_notify_post(ptr(a), ptr(b), ptr(c));
      },
      remove: (id) => {
        const a = cstring(id);
        symbols.kiwi_notify_remove(ptr(a));
      },
    };
  } catch (e) {
    log(`notices: couldn't load ${file}: ${e instanceof Error ? e.message : String(e)}`);
    return NO_NOTICES;
  }
}
