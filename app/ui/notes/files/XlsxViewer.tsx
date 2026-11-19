// O xlsx dentro das Notas (T7111, spec #7079): as abas da planilha e, em cada uma, as células com o valor que o Excel
// mostra (o resultado guardado das fórmulas, a data, a moeda), na grade do csv (`TableGrid`, T21038). Editável (T21109,
// spec #21065): a pessoa digita, cola, insere e apaga, e o arquivo grava sozinho trocando só o que mudou; a fórmula
// que depende da célula recalcula (T21108). Um xlsx com senha ou com macros abre só para leitura, e diz por quê. O
// SheetJS CE (Apache-2.0) vai no pack e só carrega quando um xlsx abre: dele vem o texto de cada formato de número.

import { useEffect, useMemo, useState } from "react";

import { cellRef } from "../../../src/shared/file-view.ts";
import type { Display } from "../../../src/shared/sheet/ops.ts";
import { type Decimal, sheetDisplay } from "./sheet-doc.ts";
import { kiwiSheetOf } from "./kiwi-sheet.ts";
import { useSheetSession } from "./sheet-session.ts";
import { systemDecimal } from "./sheet.ts";
import { SheetPane } from "./SheetPane.tsx";
import type { FileViewerProps } from "./viewers.ts";

export function XlsxViewer({ path, file, files, flushRef, kiwi, readOnly, at }: FileViewerProps) {
  const base64 = "base64" in file ? file.base64 : "";
  const name = path.split("/").at(-1) ?? path;
  const decimal: Decimal = useMemo(() => systemDecimal(), []);
  const [display, setDisplay] = useState<Display | null>(null);
  useEffect(() => {
    let alive = true;
    void import("xlsx").then((XLSX) => alive && setDisplay(() => sheetDisplay(XLSX.SSF, decimal)));
    return () => {
      alive = false;
    };
  }, [decimal]);
  const session = useSheetSession({ path, name, base64, version: file.version, files, flushRef, display, kiwi, readOnly });
  const [tab, setTab] = useState<string | null>(null);
  // A célula que a busca achou (T22218): a aba dela vem para a frente, e a grade a seleciona. Um pedido novo a cada `at`.
  const found = useMemo(() => (at && "sheet" in at ? { sheet: at.sheet, cell: cellRef(at.cell) } : null), [at]);
  useEffect(() => {
    if (found) setTab(found.sheet);
  }, [found]);
  // O Kiwi Cat gravou: a aba onde ele mexeu vem para a frente (T21114).
  useEffect(() => {
    const at = session.kiwi ? kiwiSheetOf(session.kiwi.ops) : null;
    // Com a caixa aberta noutra aba, a pessoa fica onde está: trocar de aba levaria o que ela está digitando.
    const busy = session.editingSheet();
    if (at && (busy === null || busy.toLowerCase() === at.toLowerCase())) setTab(at);
    else if (session.kiwi) session.kiwiEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kiwi]);
  // As larguras que a pessoa arrastou, por aba: valem enquanto o arquivo está aberto, trocando de aba ou recarregando (T21040).
  const widthMemory = useMemo(() => new Map<string, Record<number, number>>(), [path]);
  const { state } = session;

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
  const { doc, grid } = state;
  const sheets = grid.sheets.filter((s) => !doc.hidden.includes(s.name));
  const sheet = sheets.find((s) => s.name === tab) ?? sheets[0];
  const hidden = doc.hidden.length;
  const notes = [
    session.notice ?? "",
    session.readOnly ? `Só leitura: ${session.readOnly}` : "",
    hidden ? `${hidden} ${hidden === 1 ? "aba escondida" : "abas escondidas"} no Excel não ${hidden === 1 ? "aparece" : "aparecem"} aqui.` : "",
  ].filter(Boolean);
  const empty = !sheet || !sheet.rows.some((r) => r?.some((c) => c && c.text !== ""));

  return (
    <div className="kn-file-sheet">
      {notes.length ? (
        <div className="kn-file-text-note kn-file-sheet-note" role="status">
          {notes.join(" ")}
        </div>
      ) : null}
      {sheets.length > 1 ? (
        <div className="kn-file-sheet-tabs" role="tablist" aria-label="Abas da planilha">
          {sheets.map((s) => (
            <button key={s.name} type="button" role="tab" className="kn-file-sheet-tab" aria-selected={s === sheet} onClick={() => setTab(s.name)}>
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!sheet || (empty && session.readOnly) ? (
        <div className="kn-file-notice" role="status">
          <p>{sheets.length ? "Esta aba está vazia." : "Esta planilha não tem abas para mostrar."}</p>
        </div>
      ) : (
        <SheetPane key={sheet.name} session={session} doc={doc} sheet={sheet} decimal={decimal} widthMemory={widthMemory} zoomKey={path} goTo={found?.cell && found.sheet === sheet.name ? found.cell : undefined} />
      )}
    </div>
  );
}
