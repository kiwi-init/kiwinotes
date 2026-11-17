// O nome do quadro e o trecho de nota que um nó mostra (T6600): fora do componente, para testar sem a tela.

/** O nome do quadro: o arquivo sem a pasta e sem `.canvas`. */
export const canvasName = (path: string) => path.split("/").at(-1)!.replace(/\.canvas$/i, "");

/** O trecho de uma nota que um nó `file` com `subpath` mostra: a seção do `#título` (até o próximo do mesmo nível). */
export function noteSection(body: string, subpath: string | undefined): string {
  const want = subpath?.replace(/^#/, "").trim();
  if (!want || want.startsWith("^")) return body;
  const lines = body.split("\n");
  const key = (s: string) => s.trim().toLocaleLowerCase("pt-BR");
  const start = lines.findIndex((l) => {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    return m && key(m[2]!) === key(want);
  });
  if (start < 0) return body;
  const level = /^(#{1,6})/.exec(lines[start]!)![1]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}
