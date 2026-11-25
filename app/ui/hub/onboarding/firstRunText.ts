// Os textos do passo da primeira abertura (T20796, spec #20780): por que o Kiwi pede cada permissão, o botão de cada
// uma e a linha do modelo de voz baixando. TypeScript puro, testado no `bun test`.

import { SETUP_MODEL_MB, type SetupModel, type SetupPermission } from "../../../src/shared/first-run.ts";
import type { TextKey } from "../../../src/shared/i18n/index.ts";
import type { PermissionState } from "../../../src/shared/ipc.ts";
import { t } from "../../src/i18n.ts";

export const setupTitle = (): string => t("setup.title");
export const setupHint = (): string => t("setup.hint");

/** Cada permissão pelo nome que o Ajustes do Sistema usa, e por que o Kiwi a pede. */
const PERMISSION_KEYS: Record<SetupPermission, { name: TextKey; why: TextKey }> = {
  inputMonitoring: { name: "permission.inputMonitoring", why: "setup.why.inputMonitoring" },
  accessibility: { name: "permission.accessibility", why: "setup.why.accessibility" },
};
export const permissionText = (p: SetupPermission): { name: string; why: string } => ({ name: t(PERMISSION_KEYS[p].name), why: t(PERMISSION_KEYS[p].why) });

/** O botão de uma permissão: `null` quando já foi dada (a linha mostra "Permitido"). */
export function permissionButton(state: PermissionState | undefined): string | null {
  if (state === "granted") return null;
  return state === "undetermined" ? t("setup.allow") : t("setup.openSettings");
}

export const modelTitle = (): string => t("setup.model.title");
export const modelWhy = (): string => t("setup.model.why", { main: String(SETUP_MODEL_MB.main), boosting: String(SETUP_MODEL_MB.boosting) });

/** A linha do modelo agora, e a fração da barra (`null`: sem barra). */
export function modelLine(m: SetupModel): { text: string; fraction: number | null; done: boolean; failed: boolean } {
  if (m.state === "ready") {
    const text = m.boosting === "loading" ? t("setup.model.readyBoosting", { mb: String(SETUP_MODEL_MB.boosting) }) : t("setup.model.ready");
    return { text, fraction: 1, done: true, failed: false };
  }
  if (m.state === "unavailable")
    return { text: t("setup.model.failed"), fraction: null, done: false, failed: true };
  if (m.state === "starting") return { text: t("setup.model.starting"), fraction: null, done: false, failed: false };
  if (m.phase === "downloading" && m.fraction !== undefined) {
    const pct = Math.round(Math.min(Math.max(m.fraction, 0), 1) * 100);
    return { text: t("setup.model.downloading", { pct: String(pct), mb: String(SETUP_MODEL_MB.main) }), fraction: pct / 100, done: false, failed: false };
  }
  if (m.phase === "listing") return { text: t("setup.model.listing"), fraction: null, done: false, failed: false };
  if (m.phase === "compiling") return { text: t("setup.model.compiling"), fraction: null, done: false, failed: false };
  return { text: t("setup.model.loading"), fraction: null, done: false, failed: false };
}

/** O botão do fim: segue sem as permissões (o app pede depois), mas diz que falta. */
export function continueLabel(missing: number): string {
  return missing === 0 ? t("common.continue") : t("setup.continueWithout");
}
