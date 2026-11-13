// Test-only page; no production UI route imports this entrypoint.
import referenceUrl from "./assets/reference.webp";
import { createKiwiFog } from "./index";
import { STATES, type FogState } from "./state";
const query = new URLSearchParams(location.search),
  requested = query.get("state") ?? "repouso";
const estado = STATES.includes(requested as FogState)
  ? (requested as FogState)
  : "repouso";
const mode = query.get("mode") === "measure" ? "measure" : "capture";
const backend =
  query.get("backend") === "none"
    ? "none"
    : query.get("backend") === "webgl2"
      ? "webgl2"
      : "auto";
const api = await createKiwiFog(document.getElementById("fog")!, {
  mode, referenceUrl,
  backend,
  width: Number(query.get("width") ?? 640),
  height: Number(query.get("height") ?? 800),
  seed: Number(query.get("seed") ?? 17),
  densityScale: ([1, 0.5, 0.25].includes(Number(query.get("densityScale")))
    ? Number(query.get("densityScale"))
    : 1) as 1 | 0.5 | 0.25,
  idleFPS: Number(query.get("idleFPS") ?? 2),
  inputs: {
    estado,
    cor: query.get("color") ?? "padrao",
    voz: null,
    parado: query.get("parado") === "1",
  },
});
Object.assign(window, { kiwiFog: api, kiwiFogReady: true });

if (query.get("caption") === "1") {
  const caption = document.createElement("div");
  caption.textContent =
    "B1" +
    " / " +
    estado +
    " / " +
    (query.get("color") ?? "padrao") +
    " / " +
    api.stats.backend +
    " / idle " +
    (query.get("idleFPS") ?? 2) +
    "/s";
  caption.style.cssText =
    "position:absolute;top:12px;left:12px;color:white;font:13px system-ui;pointer-events:none";
  document.body.append(caption);
}
