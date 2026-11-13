// A página do gato no overlay (spec #9810): roda dentro da janela do helper (`native/.../CatOverlay.swift`), que a
// carrega dos arquivos do app, sem rede. O helper fala com ela por `window.kiwiOverlay.set(...)`.
//
// - Nasce pausada (`visibility(true)`): entre os pedidos, nada desenha.
// - `set({estado, visible: true})` volta a desenhar e muda o estado; `set({visible: false})` pausa antes de a janela
//   sumir. O desenho, os estados e a cor são os do gato do app (o mesmo módulo, recortado).
// - `window.kiwiOverlayStats` diz quanto levou do último `show` ao primeiro quadro apresentado (o `requestAnimationFrame`
//   depois do desenho), e qual caminho o gato usou (WebGPU, WebGL2 ou a imagem parada).

import { createKiwiCat } from "../kiwicat/cat";
import type { FogState } from "../kiwicat/state";

const STATES: readonly string[] = ["repouso", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"];

interface OverlayStats {
  ready: boolean;
  backend: string | null;
  /** Do `set({visible: true})` ao primeiro quadro apresentado, em ms (o último). */
  firstFrameMs: number | null;
  shows: number;
  visible: boolean;
  estado: string;
}

const stats: OverlayStats = { ready: false, backend: null, firstFrameMs: null, shows: 0, visible: false, estado: "repouso" };
const dark = matchMedia("(prefers-color-scheme: dark)");
const root = document.getElementById("root")!;
// Só a prova do helper (`kiwi-helper --cat-probe --backend …`) pede um caminho: o app usa o automático.
const asked = new URLSearchParams(location.search).get("backend");
const cat = await createKiwiCat(root, {
  mode: "runtime",
  backend: asked === "webgl2" || asked === "none" ? asked : "auto",
  width: 192,
  height: 240,
  cutout: true,
  background: dark.matches ? "dark" : "light",
  inputs: { estado: "repouso", cor: "claude", voz: null, parado: false },
});
cat.visibility(true);
dark.addEventListener("change", () => cat.setBackground(dark.matches ? "dark" : "light"));
stats.ready = true;
stats.backend = (cat.fogStats as { backend?: string }).backend ?? null;

/** O primeiro quadro depois do show: dois `requestAnimationFrame` (o desenho e a apresentação). */
function measureFirstFrame(start: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    stats.firstFrameMs = Math.round((performance.now() - start) * 10) / 10;
  }));
}

const api = {
  set(input: { estado?: string; visible?: boolean }) {
    if (input.estado && STATES.includes(input.estado) && input.estado !== stats.estado) {
      stats.estado = input.estado;
      cat.update({ estado: input.estado as FogState });
    }
    if (input.visible === true && !stats.visible) {
      const start = performance.now();
      stats.visible = true;
      stats.shows++;
      cat.visibility(false);
      measureFirstFrame(start);
    } else if (input.visible === false && stats.visible) {
      stats.visible = false;
      cat.visibility(true);
    }
  },
  async dispose() {
    stats.visible = false;
    await cat.dispose();
  },
};

Object.assign(window, { kiwiOverlay: api, kiwiOverlayStats: stats, kiwiCatReady: true });
