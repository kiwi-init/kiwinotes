// O que pode ir ao kiwi.log de um erro (#456, #457). A mensagem de um erro das Notas ou do ditado costuma levar o
// caminho da nota, e o título da nota rápida é a 1ª frase do ditado. Então o log leva só o tipo e o código do erro.

/** O tipo e o código de um erro, sem a mensagem: `Error`, `Error (ENOENT)`. */
export function errorKind(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? `${e.name} (${code})` : e.name;
}

/**
 * O que vem logo depois da aspa que fecha um caminho: `,` `]` `}` `)` `;` (também depois de espaços, como no objeto curto
 * `{ path: '/…' }`, T33931), o ` -> ` do rename, o ` (` de um detalhe que segue (T33931) ou o fim da linha.
 */
const AFTER_PATH = /[ \t]*(?:[,\]});]|$)|[ \t]+(?:->|\()/y;
/** O ` -> '/…` do rename: o caminho de cima não passa dele, porque o de depois é outro caminho. */
const RENAME_ARROW = /[ \t]+->[ \t]+['"](?:\/|~\/)/g;
const LINE_BREAK = /(\r\n|[\n\r\u2028\u2029])/;

/**
 * Um caminho absoluto entre aspas (o `open '/…'` e o `path: '/…'` dos erros do fs) vira `'<caminho>'`. O nome pode ter
 * aspas (`Ana's plano.md`, `x', y.md`), então o caminho vai até a **última** aspa igual da linha seguida do que o erro
 * põe depois dele (`AFTER_PATH`), sem passar do ` -> '/…` do rename (T32572, #464). Esconde um pouco a mais, nunca a
 * menos.
 *
 * É a regex `(['"])(?:\/|~\/)(?:(?!<seta>).)*\1(?=<depois>)` gulosa, linha por linha, mas sem o custo dela: a regex
 * tentava cada aspa até o fim da linha (uma linha de 100 KB com 12.500 `'/` sem fechar levava segundos). Aqui, uma aspa
 * sem fecho até a seta garante que nenhuma aspa igual depois dela, antes da mesma seta, fecha, e o trecho é lido uma vez.
 */
export function redactQuotedPaths(text: string): string {
  const parts = text.split(LINE_BREAK);
  // Os separadores ficam nas posições ímpares do split com o grupo.
  for (let i = 0; i < parts.length; i += 2) parts[i] = redactLine(parts[i]!);
  return parts.join("");
}

function redactLine(line: string): string {
  if (!line.includes("'/") && !line.includes('"/') && !line.includes("'~/") && !line.includes('"~/')) return line;
  // Onde começa o espaço de cada seta da linha. O corpo do caminho começa logo depois de uma `/`, então nunca no meio
  // desse espaço: basta o começo dele.
  const arrows: number[] = [];
  RENAME_ARROW.lastIndex = 0;
  for (let m = RENAME_ARROW.exec(line); m; m = RENAME_ARROW.exec(line)) arrows.push(m.index);
  let arrow = 0;
  /** Onde o caminho cujo corpo começa em `from` tem de parar: a primeira seta a partir dele, ou o fim da linha. */
  const stopAt = (from: number): number => {
    while (arrow < arrows.length && arrows[arrow]! < from) arrow++;
    return arrow < arrows.length ? arrows[arrow]! : line.length;
  };
  // A aspa que já se sabe sem fecho até uma seta: guarda a seta (o `stopAt`) em que ela morreu.
  const dead: Record<string, number> = {};
  let out = "";
  let copied = 0;
  for (let i = 0; i < line.length; i++) {
    const q = line[i]!;
    if (q !== "'" && q !== '"') continue;
    const body = line.startsWith("/", i + 1) ? i + 2 : line.startsWith("~/", i + 1) ? i + 3 : -1;
    if (body < 0) continue;
    const stop = stopAt(body);
    if (dead[q] === stop) continue;
    let close = -1;
    for (let k = stop - 1; k >= body; k--) {
      if (line[k] !== q) continue;
      AFTER_PATH.lastIndex = k + 1;
      if (AFTER_PATH.test(line)) {
        close = k;
        break;
      }
    }
    // Sem fecho, ou com o último fecho já usado: nenhuma aspa igual daqui até a seta fecha.
    dead[q] = stop;
    if (close < 0) continue;
    out += `${line.slice(copied, i)}${q}<caminho>${q}`;
    copied = close + 1;
    i = close;
  }
  return copied === 0 ? line : out + line.slice(copied);
}
