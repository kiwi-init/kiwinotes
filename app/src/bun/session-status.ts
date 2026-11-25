import type { SessionStatus } from "./session.ts";
import { permissionName } from "./permissions.ts";
import { type Locale, translate } from "../shared/i18n/index.ts";

/** A primeira linha do menu diz se dá para ditar agora, e por que não; na língua do app (T28192). */
export function statusLabel(s: SessionStatus, locale: Locale = "pt"): string {
  const t = translate.bind(null, locale);
  if (s.supervision?.state === "failed") return t("status.failed");
  if (!s.connected) return t("status.starting");
  if (!s.hotkeyActive)
    return t("status.hotkeyOff", {
      permission: s.missing.includes("inputMonitoring") ? permissionName("inputMonitoring", locale) : t("status.aPermission"),
    });
  if (s.stt === "loading" || s.stt === "starting") return t("status.modelLoading");
  if (s.stt === "unavailable") return t("status.modelUnavailable");
  // O ditado já funciona; o vocabulário (ORBIT, SILO…) ainda não ajuda o modelo a ouvir (T1973).
  if (s.boosting === "loading") return t("status.vocabularyLoading");
  // Os atalhos funcionam, mas o app da frente também recebe a tecla (T5349): falta a Acessibilidade.
  if (s.hotkeyPriority === false) return t("status.noPriority", { permission: permissionName("accessibility", locale) });
  return t("status.ready");
}
