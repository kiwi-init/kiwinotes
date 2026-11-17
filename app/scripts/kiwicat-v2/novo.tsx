// A página do gato novo para o peso (T14773) e o gato-igual (T14899): o ByteKiwiCat do pacote, sem mudança, com o
// padrão dele. Lê `?state=&size=&emote=` (o emote, `auto` se faltar) e, desde a T15035 (spec #14963), `?palette=`: a
// paleta do `KIWI_COLOR_PALETTES` do próprio pacote, pelo `config`, só nos campos que o app desenha (`prismStops`,
// `accentColor` e `eyeColor`), e com o fundo escuro de verdade (`backdropTone`), como o gato do app, e não o `surfaceBg`.
import "./instrumento";
import { createRoot } from "react-dom/client";
import { ByteKiwiCat, KIWI_COLOR_PALETTES, type KiwiComicEmote, type KiwiConfig, type KiwiState } from "../../../docs/design/kiwicat-v2/agente/ByteKiwiCat";
const q = new URLSearchParams(location.search);
const size = Number(q.get("size") ?? 240);
const paletteId = q.get("palette");
const palette = paletteId ? KIWI_COLOR_PALETTES.find((p) => p.id === paletteId) : undefined;
if (paletteId && !palette) throw new Error(`paleta desconhecida no pacote: ${paletteId}`);
const config: Partial<KiwiConfig> | undefined = palette
  ? { paletteId: palette.id, prismStops: palette.prismStops, accentColor: palette.accentColor, eyeColor: palette.eyeColor }
  : undefined;
createRoot(document.getElementById("cat")!).render(
  <ByteKiwiCat state={(q.get("state") ?? "repouso") as KiwiState} size={size} simulateVoice={false} emote={(q.get("emote") ?? "auto") as KiwiComicEmote}
    config={config} backdropTone={palette ? "dark" : undefined} />,
);
requestAnimationFrame(() => Object.assign(window, { kiwiReady: true }));
