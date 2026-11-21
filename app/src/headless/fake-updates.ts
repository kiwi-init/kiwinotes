// O atualizador de mentira do headless (T17098, spec #16837): `KIWI_FAKE_UPDATES` é o `UpdatesView` em JSON que o
// `app.about` mostra, para os prints e os roteiros de cada estado da faixa do Sobre. Nada vai à rede: o "Verificar"
// devolve o mesmo estado, e o "Atualizar e reiniciar" só passa a `applying` (não fecha nem troca nada).

import type { CapabilityDeps } from "../bun/ui-capabilities.ts";
import { type AppAbout, UPDATES_OFF_BY_SETTING, type UpdatesView } from "../shared/ui-contract.ts";

const STATES = new Set(["off", "idle", "checking", "downloading", "ready", "applying"]);

/** Lê o JSON; o que não for um `UpdatesView` com um estado conhecido lança, para o roteiro errado falhar logo. */
export function parseFakeUpdates(raw: string): UpdatesView {
  const v = JSON.parse(raw) as Record<string, unknown>;
  if (!v || typeof v !== "object" || typeof v.state !== "string" || !STATES.has(v.state)) throw new Error(`KIWI_FAKE_UPDATES: estado desconhecido em ${raw}`);
  return { lastCheck: null, ...v } as UpdatesView;
}

export function fakeAbout(raw: string): NonNullable<CapabilityDeps["about"]> {
  let view = parseFakeUpdates(raw);
  // "Buscar atualizações" desligado (T25110): a faixa fica desligada pela pessoa, e ligar volta ao estado de antes.
  let before: UpdatesView | null = null;
  return {
    info: (): Omit<AppAbout, "updates"> => ({ version: "2026.11.2", channel: "stable", releaseUrl: "https://github.com/kiwi-init/kiwinotes/releases/tag/v2026.11.2" }),
    view: () => view,
    check: async () => view,
    checkUpdatesChanged: (on) => {
      if (!on && !before) [before, view] = [view, { state: "off", reason: UPDATES_OFF_BY_SETTING, lastCheck: view.lastCheck }];
      else if (on && before) [view, before] = [before, null];
    },
    apply: async () => {
      if (view.state === "ready") view = { state: "applying", lastCheck: view.lastCheck };
      return view;
    },
  };
}
