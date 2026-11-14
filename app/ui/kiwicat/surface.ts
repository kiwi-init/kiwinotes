// A superfície atrás da névoa (T11696, o harry no #12150): a luz só soma no fundo preto. Em qualquer outro (o claro, um
// tema escuro colorido ou cinza) ela vira tinta, com o corpo pela silhueta inteira.

/** "dark" para uma cor de fundo (CSS `rgb()`/`rgba()`) preta ou quase; "light" para qualquer outra. */
export function fogSurface(background: string): "light" | "dark" {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(background);
  if (!m) return "dark";
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const y = 0.2126 * lin(Number(m[1])) + 0.7152 * lin(Number(m[2])) + 0.0722 * lin(Number(m[3]));
  return y < 0.01 ? "dark" : "light";
}
