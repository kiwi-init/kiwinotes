// csv e tsv dentro das Notas (T7107, spec #7079): uma tabela com o cabeçalho fixo e rolagem para os dois lados. Só
// leitura na v1: para editar, o botão "Abrir no app padrão". Uma tabela comprida entra aos poucos (`PAGE` linhas por
// vez) e uma muito larga mostra só as primeiras `MAX_COLUMNS` colunas, para a janela não travar montando centenas de
// milhares de células de uma vez. Um csv que não é UTF-8 (o do Excel no Windows) é lido de novo pelos bytes.

import { useEffect, useMemo, useState } from "react";

import { bytesOf, columnName, decodeText, parseTable } from "./csv.ts";
import type { FileViewerProps } from "./viewers.ts";

export const PAGE = 500;
export const MAX_COLUMNS = 200;

const ENCODINGS = { "utf-8": "UTF-8", "utf-16": "UTF-16", "windows-1252": "Windows-1252" } as const;

export function TableViewer({ path, file, files }: FileViewerProps) {
  const utf8 = "text" in file && !file.readOnly;
  // O texto que não é UTF-8 veio com os acentos trocados: os bytes dizem a codificação certa (revisão do T7107).
  const [decoded, setDecoded] = useState<{ version: string; text: string; encoding: keyof typeof ENCODINGS } | "error" | null>(null);
  useEffect(() => {
    if (utf8) return;
    let alive = true;
    files.read(path, "binary").then(
      (binary) => {
        if (!alive) return;
        if (!("base64" in binary)) return setDecoded("error");
        setDecoded({ version: binary.version, ...decodeText(bytesOf(binary.base64)) });
      },
      () => alive && setDecoded("error"),
    );
    return () => {
      alive = false;
    };
  }, [files, path, utf8, file.version]);

  const text = utf8 ? file.text : decoded && decoded !== "error" ? decoded.text : null;
  const table = useMemo(() => (text === null ? null : parseTable(text, path)), [text, path]);

  if (decoded === "error" && !utf8) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para ler este arquivo como tabela.</p>
      </div>
    );
  }
  if (!table) return <div className="kn-file-table-wrap" aria-busy="true" />;
  if (!table.columns) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Este arquivo está vazio.</p>
      </div>
    );
  }

  const encoding = !utf8 && decoded && decoded !== "error" ? ENCODINGS[decoded.encoding] : null;
  return <TableGrid header={table.header} rows={table.rows} columns={table.columns} foot={encoding ? `lido como ${encoding}` : null} />;
}

interface GridProps {
  /** O nome de cada coluna; a que não tem nome mostra a letra (A, B…), como a planilha. */
  header: string[];
  rows: string[][];
  columns: number;
  /** Um trecho a mais no rodapé, depois de "N linhas, M colunas". */
  foot?: string | null;
  /** O número da primeira linha (a planilha começa no 1 da linha 1, e o csv conta depois do cabeçalho). */
  firstRow?: number;
}

/**
 * A tabela de leitura (T7107), para o csv e para a planilha (T7111): o cabeçalho fixo, a rolagem, o número de cada
 * linha, `PAGE` linhas por vez e no máximo `MAX_COLUMNS` colunas, com o aviso das que ficaram de fora.
 */
export function TableGrid({ header, rows: all, columns: total, foot, firstRow = 1 }: GridProps) {
  const [shown, setShown] = useState(PAGE);
  const columns = Array.from({ length: Math.min(total, MAX_COLUMNS) }, (_, i) => i);
  const rows = all.slice(0, shown);
  const more = all.length - rows.length;
  const hidden = total - columns.length;
  const n = (value: number) => value.toLocaleString("pt-BR");

  return (
    <div className="kn-file-table-wrap">
      {hidden > 0 ? (
        <div className="kn-file-text-note kn-file-table-note" role="status">
          {`Esta tabela tem ${n(total)} colunas. Aqui aparecem as primeiras ${n(MAX_COLUMNS)}; para ver todas, abra no app padrão.`}
        </div>
      ) : null}
      <div className="kn-file-table-scroll">
        <table className="kn-file-table">
          <thead>
            <tr>
              <th className="kn-file-table-n" aria-label="Linha" />
              {columns.map((c) => (
                <th key={c} scope="col">
                  {header[c] || <span className="kn-faint">{columnName(c)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="kn-file-table-n">{r + firstRow}</td>
                {columns.map((c) => (
                  <td key={c}>{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 ? (
          <button type="button" className="kn-bt kn-file-table-more" onClick={() => setShown((s) => s + PAGE)}>
            {`Mostrar mais ${n(Math.min(PAGE, more))} de ${n(more)} linhas`}
          </button>
        ) : null}
      </div>
      <div className="kn-file-table-foot" aria-live="polite">
        {`${n(all.length)} ${all.length === 1 ? "linha" : "linhas"}, ${n(total)} ${total === 1 ? "coluna" : "colunas"}`}
        {foot ? `, ${foot}` : ""}
      </div>
    </div>
  );
}
