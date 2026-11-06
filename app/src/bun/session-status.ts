import type { SessionStatus } from "./session.ts";
import { PERMISSION_NAMES } from "./permissions.ts";

/** A primeira linha do menu diz se dá para ditar agora, e por que não. */
export function statusLabel(s: SessionStatus): string {
  if (s.supervision?.state === "failed") return "O ditado está com problema";
  if (!s.connected) return "Iniciando…";
  if (!s.hotkeyActive)
    return `Atalho desligado: falta ${s.missing.includes("inputMonitoring") ? PERMISSION_NAMES.inputMonitoring : "permissão"}`;
  if (s.stt === "loading" || s.stt === "starting")
    return "Preparando o modelo de voz…";
  if (s.stt === "unavailable") return "Modelo de voz indisponível";
  // O ditado já funciona; o vocabulário (DICOM, PACS…) ainda não ajuda o modelo a ouvir (T1973).
  if (s.boosting === "loading")
    return "Pronto para ditar · baixando o vocabulário…";
  return "Pronto para ditar";
}
