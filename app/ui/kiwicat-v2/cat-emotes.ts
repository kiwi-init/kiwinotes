// Portado de docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx (o `<g>` dos emotes do ByteKiwiCat), T14885, spec #14813.
// Mudanças: o JSX virou o texto do SVG, que o gato põe no `<g>` dos emotes; os traços são os do pacote.
//
// Os emotes do gato novo, no `viewBox` de 240: as ondas do ouvindo, o pensamento, o zZ, o alerta, as estrelas do
// feliz (e do respondendo), o suor do cansado, a nuvem do confuso e o rabisco do limite.

import type { KiwiEmote, KiwiState } from "./cat-config";

/** O SVG do emote que aparece (`CatFrame.emote`), com a tinta do fundo: clara no escuro, escura no claro. */
export function emoteSvg(emote: KiwiEmote | KiwiState, light: boolean): string {
  const ink = light ? "#0A0B10" : "#FFFFFF";
  const fill = light ? "#FFFFFF" : "#090A0E";
  switch (emote) {
    case "ouvindo":
      return `<g fill="none" stroke="${ink}" stroke-width="2.8" stroke-linecap="round">` +
        `<path d="M 184 96 Q 192 108, 184 120"/>` +
        `<path d="M 192 90 Q 203 108, 192 126" opacity="0.88"/>` +
        `<path d="M 200 84 Q 214 108, 200 132" opacity="0.72"/></g>`;
    case "pensando":
      return `<g><circle cx="176" cy="78" r="2.5" fill="${ink}"/>` +
        `<path d="M 176 54 C 176 47, 184 44, 190 47 C 194 42, 204 43, 207 49 C 214 50, 217 58, 212 64 C 213 70, 205 74, 198 71 C 193 75, 182 74, 180 68 C 174 66, 173 59, 176 54 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<circle cx="188" cy="58" r="2" fill="${ink}"/><circle cx="195" cy="58" r="2" fill="${ink}"/>` +
        `<circle cx="202" cy="58" r="2" fill="${ink}"/></g>`;
    case "dormindo":
      return `<g fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M 172 68 L 184 68 L 172 80 L 184 80"/>` +
        `<path d="M 190 48 L 206 48 L 190 64 L 206 64" stroke-width="3.0"/></g>`;
    case "alerta":
      return `<g fill="${ink}" stroke="${ink}" stroke-linecap="round">` +
        `<path d="M 186 44 L 183 66" stroke-width="4.2"/><circle cx="182" cy="75" r="2.6" stroke="none"/>` +
        `<line x1="196" y1="54" x2="204" y2="50" stroke-width="2.4"/>` +
        `<line x1="198" y1="64" x2="206" y2="66" stroke-width="2.4"/></g>`;
    case "feliz":
    case "respondendo":
      return `<g fill="${ink}">` +
        `<path d="M 52 96 L 54.5 103 L 61.5 105.5 L 54.5 108 L 52 115 L 49.5 108 L 42.5 105.5 L 49.5 103 Z"/>` +
        `<path d="M 190 66 L 192.5 73 L 199.5 75.5 L 192.5 78 L 190 85 L 187.5 78 L 180.5 75.5 L 187.5 73 Z"/>` +
        `<path d="M 196 120 L 197.5 124.5 L 202 126 L 197.5 127.5 L 196 132 L 194.5 127.5 L 190 126 L 194.5 124.5 Z" opacity="0.85"/></g>`;
    case "cansado":
      return `<g><path d="M 192 78 C 192 78, 198 87, 198 91 A 6 6 0 1 1 186 91 C 186 87, 192 78, 192 78 Z" fill="${ink}"/>` +
        `<path d="M 205 96 C 205 96, 209 102, 209 105 A 4 4 0 1 1 201 105 C 201 102, 205 96, 205 96 Z" fill="${ink}" opacity="0.9"/>` +
        `<g stroke="${ink}" stroke-width="2.4" stroke-linecap="round">` +
        `<line x1="36" y1="104" x2="52" y2="108"/><line x1="33" y1="118" x2="50" y2="119"/>` +
        `<line x1="37" y1="132" x2="52" y2="130"/></g></g>`;
    case "confuso":
      return `<g><path d="M 178 58 C 175 50, 184 44, 191 48 C 197 42, 208 45, 210 53 C 216 56, 215 67, 207 68 C 202 74, 190 73, 187 68 C 179 69, 175 63, 178 58 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<path d="M 186 58 Q 190 53, 195 58 T 204 58" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/></g>`;
    case "limite":
      return `<path d="M 176 58 C 174 44, 188 40, 190 52 C 192 64, 180 68, 186 52 C 191 40, 204 42, 204 55 C 204 64, 196 68, 210 60" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`;
    default:
      // O `repouso` e o `auto` sem estado próprio não têm emote.
      return "";
  }
}
