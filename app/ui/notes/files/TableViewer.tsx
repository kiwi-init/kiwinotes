// csv e tsv dentro das Notas (T7107, spec #7079): uma tabela com o cabeçalho fixo e rolagem para os dois lados. Só
// leitura na v1: para editar, o botão "Abrir no app padrão". Uma tabela comprida entra aos poucos (`PAGE` linhas por
// vez), para a janela não travar montando dezenas de milhares de linhas de uma vez.

import { useMemo, useState } from "react";

import { columnName, parseTable } from "./csv.ts";
import type { FileViewerProps } from "./viewers.ts";

export const PAGE = 500;

export function TableViewer({ path, file }: FileViewerProps) {
  const text = "text" in file ? file.text : "";
  const table = useMemo(() => parseTable(text, path), [text, path]);
  const [shown, setShown] = useState(PAGE);
  const columns = Array.from({ length: table.columns }, (_, i) => i);
  const rows = table.rows.slice(0, shown);
  const more = table.rows.length - rows.length;

  if (!table.columns) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Este arquivo está vazio.</p>
      </div>
    );
  }

  return (
    <div className="kn-file-table-wrap">
      <div className="kn-file-table-scroll">
        <table className="kn-file-table">
          <thead>
            <tr>
              <th className="kn-file-table-n" aria-label="Linha" />
              {columns.map((c) => (
                <th key={c} scope="col">
                  {table.header[c] || <span className="kn-faint">{columnName(c)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="kn-file-table-n">{r + 1}</td>
                {columns.map((c) => (
                  <td key={c}>{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 ? (
          <button type="button" className="kn-bt kn-file-table-more" onClick={() => setShown((n) => n + PAGE)}>
            {`Mostrar mais ${Math.min(PAGE, more).toLocaleString("pt-BR")} de ${more.toLocaleString("pt-BR")} linhas`}
          </button>
        ) : null}
      </div>
      <div className="kn-file-table-foot" aria-live="polite">
        {`${table.rows.length.toLocaleString("pt-BR")} ${table.rows.length === 1 ? "linha" : "linhas"} · ${table.columns} ${table.columns === 1 ? "coluna" : "colunas"}`}
      </div>
    </div>
  );
}
