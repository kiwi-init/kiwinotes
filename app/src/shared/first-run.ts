// O passo da primeira abertura (T20796, spec #20780): as duas permissões que o app pede e o modelo de voz baixando.
// O main monta o `SetupStatus` (o `firstRun` das settings, as permissões e o modelo do helper); a tela do onboarding mostra.

import type { PermissionState } from "./ipc.ts";

/** As permissões do passo, na ordem em que ele mostra: o atalho, depois colar. O microfone fica para o primeiro ditado. */
export const SETUP_PERMISSIONS = ["inputMonitoring", "accessibility"] as const;
export type SetupPermission = (typeof SETUP_PERMISSIONS)[number];

export function isSetupPermission(v: unknown): v is SetupPermission {
  return (SETUP_PERMISSIONS as readonly unknown[]).includes(v);
}

/** O modelo de voz: `starting` até o helper subir; `fraction` e `phase` só enquanto baixa (a primeira vez). */
export interface SetupModel {
  state: "starting" | "loading" | "ready" | "unavailable";
  fraction?: number;
  phase?: "listing" | "downloading" | "compiling";
  /**
   * O modelo do vocabulário (99 MB): só baixa e carrega com palavras no dicionário (T20949), depois do principal;
   * `off` sem palavras, `undefined` até o helper dizer.
   */
  boosting?: "loading" | "ready" | "unavailable" | "off";
}

export interface SetupStatus {
  firstRun: "pending" | "done";
  /** `null`: o helper não está de pé (o estado ainda não se sabe). */
  permissions: Record<SetupPermission, PermissionState> | null;
  model: SetupModel;
}

/** O tamanho do download na primeira vez, para o texto do passo: o modelo principal e o do vocabulário. */
export const SETUP_MODEL_MB = { main: 614, boosting: 99 } as const;
