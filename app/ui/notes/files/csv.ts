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

/** A dica do Excel na primeira linha (`sep=;`): diz o separador, e não é dado. */
const SEP_HINT = /^\ufeff?sep=([,;\t])\r?(\n|$)/i;

/** Quantas linhas o separador olha: o bastante para ver se as colunas se repetem. */
const SAMPLE_LINES = 10;

/**
 * O separador: `.tsv` é tab; com a dica `sep=` do Excel, o que ela diz; no resto, o que divide as primeiras linhas no
 * mesmo número de colunas (fora das aspas). Só a primeira linha engana: em `Nome;Valor (R$ 1,00);Obs, etc` há tantas
 * vírgulas quanto pontos e vírgulas, e são as linhas de baixo que desempatam. No empate total, o ponto e vírgula (no
 * Excel em português a vírgula é o decimal). Um csv de uma coluna só fica com a vírgula, que não separa nada.
 */
export function detectDelimiter(text: string, name = ""): Delimiter {
  if (/\.tsv$/i.test(name)) return "\t";
  const hint = SEP_HINT.exec(text)?.[1];
  if (hint) return hint as Delimiter;
  const candidates: Delimiter[] = [";", ",", "\t"];
  // Por linha (até `SAMPLE_LINES`), quantas vezes cada separador aparece fora das aspas.
  const lines: Record<Delimiter, number>[] = [];
  let counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  let any = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length && lines.length < SAMPLE_LINES; i++) {
    const c = text[i]!;
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (any) lines.push(counts);
      counts = { ",": 0, ";": 0, "\t": 0 };
      any = false;
      continue;
    } else if (!quoted && (c === "," || c === ";" || c === "\t")) counts[c]++;
    any = true;
  }
  if (any && lines.length < SAMPLE_LINES) lines.push(counts);
  const first = lines[0];
  if (!first) return ",";
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of candidates) {
    if (!first[d]) continue;
    // As linhas com o mesmo número de separadores da primeira pesam mais que a contagem da primeira.
    const same = lines.filter((l) => l[d] === first[d]).length;
    const score = same * 1_000_000 + first[d];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
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
  // A linha da dica `sep=` não é cabeçalho.
  const all = parseDelimited(SEP_HINT.test(text) ? text.replace(SEP_HINT, "") : text, delimiter);
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

/**
 * O texto de um csv pelos bytes (revisão do T7107). O "CSV (separado por vírgulas)" do Excel no Windows sai em
 * Windows-1252, e lido como UTF-8 os acentos viram `\ufffd`. Como a tabela só lê, dá para tentar outra codificação sem
 * risco de gravar errado: UTF-8 se os bytes são UTF-8 válido; UTF-16 com BOM; senão Windows-1252, que aceita qualquer
 * byte. `encoding` diz qual foi, para a tela avisar quando não é UTF-8.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "utf-16" | "windows-1252" } {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return { text: new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes), encoding: "utf-16" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** Os bytes de um base64 (o `files.read` em binário). */
export function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
