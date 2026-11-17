// O título e o tamanho de cada janela. Fica fora de src/bun/windows.ts (que importa o Electrobun) para que a CLI de
// teste (T1742), que roda no Bun puro, tire o print no mesmo tamanho da janela de verdade.

import type { UiWindow } from "./ui-contract.ts";

export const WINDOW_SPECS: Record<UiWindow, { title: string; width: number; height: number }> = {
  settings: { title: "Configurações", width: 640, height: 520 },
  history: { title: "Histórico", width: 760, height: 600 },
  // B v4: barra lateral de 220, a nota com até 760 de texto e o "Citada em" de 260.
  notes: { title: "Notas", width: 1180, height: 760 },
  // O hub (T2121): a barra de seções de 200 mais as Notas inteiras.
  hub: { title: "Kiwi Notes", width: 1380, height: 820 },
  // A intro (T14851): o KiwiCat num quadro de 320 px no meio da tela, sem borda nem fundo. 720×480 é a caixa em que o
  // gato tem o tamanho dele; com o hub planejado, a janela cresce para cobrir o hub também, e a moldura vazia cresce até
  // ele (T16769, `intro-layout.ts`).
  intro: { title: "Kiwi Notes", width: 720, height: 480 },
};
