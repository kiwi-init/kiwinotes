// T8959 standalone test entry: same loopback page as the fog; no app route.
import { createKiwiCat } from "./cat";
import referenceUrl from "./assets/reference.webp";
import cutoutReferenceUrl from "./assets/reference-cutout.webp";
import { createKiwiFog } from "./index";
import { STATES, type FogState } from "./state";
const q = new URLSearchParams(location.search), state = q.get("state") ?? "repouso";
const options = {
  edgeBand: Number(q.get("edgeBand") ?? .08),
  cutout: q.get("cutout") === "1", backing: Number(q.get("backing") ?? .5),
  mode: q.get("mode") === "measure" ? "measure" as const : "capture" as const,
  width: Number(q.get("width") ?? 640), height: Number(q.get("height") ?? 800),
  seed: Number(q.get("seed") ?? 17),
  backend: q.get("backend") === "none" ? "none" as const : q.get("backend") === "webgl2" ? "webgl2" as const : "auto" as const,
  inputs: { estado: STATES.includes(state as FogState) ? state as FogState : "repouso" as const,
    voz: q.has("voice") ? Number(q.get("voice")) : null,
    cor: q.get("color") ?? "padrao", parado: q.get("parado") === "1" },
};
const api = q.get("fogOnly") === "1" ? await createKiwiFog(document.getElementById("fog")!, { ...options, referenceUrl, cutoutReferenceUrl }) :
  await createKiwiCat(document.getElementById("fog")!, { ...options,
    outline: q.get("outline") === "1",
    background: q.get("symbolTheme") === "light" ? "light" : "dark",
    sleepSeconds: q.has("sleepSeconds") ? () => Number(q.get("sleepSeconds")) : undefined });
document.body.style.background = q.get("background") ?? "#000";
Object.assign(window, { kiwiCat: api, kiwiCatReady: true });
