// O csv e o tsv das Notas (T7107, spec #7079): o texto vira linhas e colunas, para a tabela. Lógica pura. Segue o
// RFC 4180 com as folgas do mundo real: campo entre aspas com vírgula, quebra de linha e aspas dobradas dentro;
// CRLF, LF ou CR; o BOM do Excel; e o separador de quem exportou (vírgula, ponto e vírgula no Excel em português, tab).

export type Delimiter = "," | ";" | "\t";

export interface Table {
  /** A primeira linha, como cabeçalho. Vazio num arquivo sem nada. */
  header: string[];
  rows: string[][];
  /** O maior número de colunas entre o cabeçalho e as linhas. */
  columns: number;
  delimiter: Delimiter;
}

/**
 * O separador: `.tsv` é tab; no resto, o que mais aparece fora das aspas na primeira linha (no empate, a vírgula).
 * Um csv de uma coluna só fica com a vírgula, que não separa nada.
 */
export function detectDelimiter(text: string, name = ""): Delimiter {
  if (/\.tsv$/i.test(name)) return "\t";
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && (c === "," || c === ";" || c === "\t")) counts[c]++;
  }
  return (["," , ";", "\t"] as Delimiter[]).reduce((best, d) => (counts[d] > counts[best] ? d : best), ",");
}

/** As linhas do texto, campo a campo. Uma linha em branco no fim (a quebra final do arquivo) não conta. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  /** O campo começou com aspas: depois de fechar, o que vier até o separador entra como está. */
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) endField();
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  // O que sobrou sem quebra no fim; um arquivo que termina em quebra não ganha uma linha vazia.
  if (field !== "" || row.length) endRow();
  return rows;
}

export function parseTable(text: string, name = ""): Table {
  const delimiter = detectDelimiter(text, name);
  const all = parseDelimited(text, delimiter);
  // Linhas em branco de verdade (um campo só, vazio) saem: não são dados.
  const lines = all.filter((r) => !(r.length === 1 && r[0] === ""));
  const [header = [], ...rows] = lines;
  const columns = lines.reduce((n, r) => Math.max(n, r.length), 0);
  return { header, rows, columns, delimiter };
}

/** "A", "B", … "Z", "AA": o nome de uma coluna sem cabeçalho, como na planilha. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
