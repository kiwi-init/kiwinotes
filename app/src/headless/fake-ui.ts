// A aparência de mentira do headless (T25031, spec #25011): `KIWI_FAKE_UI` é um JSON com a UI das janelas, para os
// prints e os roteiros da faixa "Nova aparência pronta" e do Sobre. Nada vai à rede e nada troca de verdade: o
// Recarregar só passa a nova para a tela, e o Voltar põe todas na de fábrica.
//
//   { "uiVersion": "2026.11.12", "builtIn": false, "pending": "2026.11.13", "factory": "2026.11.9" }
//
// `uiVersion` e `builtIn`: a UI na tela de toda janela. `pending`: a nova que espera o Recarregar (ou null).
// `factory`: a versão de fábrica, para onde o Voltar leva.

import type { CapabilityDeps } from "../bun/ui-capabilities.ts";
import { UI_WINDOWS, type UiAppearance, type UiStatus } from "../shared/ui-contract.ts";

interface FakeUi {
  uiVersion: string;
  builtIn: boolean;
  pending: string | null;
  factory: string;
}

/** Lê o JSON; o que não tiver a forma certa lança, para o roteiro errado falhar logo. */
export function parseFakeUi(raw: string): FakeUi {
  const v = JSON.parse(raw) as Record<string, unknown>;
  const ok =
    v && typeof v === "object" &&
    typeof v.uiVersion === "string" &&
    typeof v.builtIn === "boolean" &&
    (v.pending === undefined || v.pending === null || typeof v.pending === "string") &&
    typeof v.factory === "string";
  if (!ok) throw new Error(`KIWI_FAKE_UI: esperava {uiVersion, builtIn, pending?, factory} em ${raw}`);
  return { uiVersion: v.uiVersion as string, builtIn: v.builtIn as boolean, pending: (v.pending as string | null | undefined) ?? null, factory: v.factory as string };
}

export function fakeAppearance(raw: string): NonNullable<CapabilityDeps["appearance"]> {
  const ui = parseFakeUi(raw);
  const status = (): UiStatus => ({ uiVersion: ui.uiVersion, builtIn: ui.builtIn, pending: ui.pending });
  const about = (): UiAppearance => {
    const windows = UI_WINDOWS.map((window) => ({ window, ...status() }));
    return { windows, canRevert: windows.some((w) => !w.builtIn) };
  };
  return {
    status,
    reload: () => {
      if (ui.pending) Object.assign(ui, { uiVersion: ui.pending, builtIn: false, pending: null });
      return status();
    },
    about,
    revert: async () => {
      Object.assign(ui, { uiVersion: ui.factory, builtIn: true, pending: null });
      return about();
    },
  };
}
