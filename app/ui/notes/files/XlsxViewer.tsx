// O xlsx dentro das Notas (T7111, spec #7079): as abas da planilha e, em cada uma, as células com o valor que o Excel
// mostra (o resultado guardado das fórmulas, a data, a moeda). Só leitura: para editar, "Abrir no app padrão". O
// SheetJS CE (Apache-2.0) vai no pack e só carrega quando um xlsx abre. A tabela é a mesma do csv (`TableGrid`), com
// a letra de cada coluna e o número de cada linha, como na planilha.

import { useEffect, useState } from "react";

import { bytesOf } from "./csv.ts";
import { readWorkbook, TooLarge, type Workbook } from "./sheet.ts";
import { TableGrid } from "./TableViewer.tsx";
import type { FileViewerProps } from "./viewers.ts";

type State = { kind: "loading" } | { kind: "ready"; book: Workbook & { truncated: boolean } } | { kind: "tooLarge" } | { kind: "error" };

export function XlsxViewer({ file }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        const book = readWorkbook(XLSX, bytesOf(base64));
        if (!alive) return;
        setState({ kind: "ready", book });
        setTab((t) => (t < book.sheets.length ? t : 0));
      } catch (e) {
        if (alive) setState({ kind: e instanceof TooLarge ? "tooLarge" : "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [base64]);

  if (state.kind === "error") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para abrir esta planilha. Ela pode estar corrompida, ter senha ou ser de outro formato.</p>
      </div>
    );
  }
  if (state.kind === "tooLarge") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Esta planilha é grande demais para abrir aqui. Abra no app padrão.</p>
      </div>
    );
  }
  if (state.kind === "loading") return <div className="kn-file-table-wrap" aria-busy="true" />;
  const { sheets, hidden, truncated } = state.book;
  const sheet = sheets[tab];
  const notes = [
    hidden ? `${hidden} ${hidden === 1 ? "aba escondida" : "abas escondidas"} no Excel não ${hidden === 1 ? "aparece" : "aparecem"} aqui.` : "",
    truncated ? "Uma aba passa de 100.000 linhas: aqui aparecem as primeiras." : "",
  ].filter(Boolean);

  return (
    <div className="kn-file-sheet">
      {notes.length ? (
        <div className="kn-file-text-note kn-file-sheet-note" role="status">
          {notes.join(" ")}
        </div>
      ) : null}
      {sheets.length > 1 ? (
        <div className="kn-file-sheet-tabs" role="tablist" aria-label="Abas da planilha">
          {sheets.map((s, i) => (
            <button key={s.name} type="button" role="tab" className="kn-file-sheet-tab" aria-selected={i === tab} onClick={() => setTab(i)}>
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!sheet || !sheet.columns ? (
        <div className="kn-file-notice" role="status">
          <p>{sheets.length ? "Esta aba está vazia." : "Esta planilha não tem abas para mostrar."}</p>
        </div>
      ) : (
        <TableGrid key={sheet.name} header={[]} rows={sheet.rows} columns={sheet.columns} />
      )}
    </div>
  );
}
