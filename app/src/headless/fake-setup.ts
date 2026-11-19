// O passo da primeira abertura de mentira do headless (T20796): `KIWI_FAKE_SETUP` é o `{permissions, model}` em JSON
// que o `setup.status` mostra, para os prints e os roteiros de cada estado. O botão de uma permissão só a marca como
// dada aqui dentro: nada vai ao helper nem ao macOS.

import type { CapabilityDeps } from "../bun/ui-capabilities.ts";
import { isSetupPermission, type SetupModel, type SetupStatus } from "../shared/first-run.ts";

const MODEL_STATES = new Set(["starting", "loading", "ready", "unavailable"]);

/** O que não for `{permissions, model}` com um estado conhecido lança, para o roteiro errado falhar logo. */
export function parseFakeSetup(raw: string): { permissions: NonNullable<SetupStatus["permissions"]>; model: SetupModel } {
  const v = JSON.parse(raw) as { permissions?: Record<string, unknown>; model?: { state?: unknown } };
  if (!v?.permissions || !Object.keys(v.permissions).every(isSetupPermission) || !MODEL_STATES.has(String(v.model?.state)))
    throw new Error(`KIWI_FAKE_SETUP: esperava {permissions, model} em ${raw}`);
  return { permissions: { inputMonitoring: "undetermined", accessibility: "undetermined", ...v.permissions } as NonNullable<SetupStatus["permissions"]>, model: v.model as SetupModel };
}

export function fakeSetup(raw: string): NonNullable<CapabilityDeps["setup"]> {
  const now = parseFakeSetup(raw);
  return {
    live: () => ({ permissions: { ...now.permissions }, model: { ...now.model } }),
    request: async (p) => {
      now.permissions[p] = "granted";
      console.log(`[headless] setup.request (fake): ${p}`);
    },
    done: () => console.log("[headless] setup.done (fake)"),
  };
}
