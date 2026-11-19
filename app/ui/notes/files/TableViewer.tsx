// csv e tsv dentro das Notas (T7107, spec #7079): a grade da planilha (`TableGrid`, T21038), com a linha do cabeçalho
// como a linha 1, e editável (T21109, spec #21065): grava sozinho, com o mesmo separador, a mesma codificação e as
// linhas que não mudaram como estavam. O arquivo chega em bytes, e um csv que não é UTF-8 (o do Excel no Windows) é
// lido e gravado na codificação dele.

import { useMemo } from "react";

import { plainDisplay } from "../../../src/shared/sheet/ops.ts";
import { base64Of } from "./csv.ts";
import { useSheetSession } from "./sheet-session.ts";
import { SheetPane } from "./SheetPane.tsx";
import type { FileViewerProps } from "./viewers.ts";

export { TableGrid } from "./TableGrid.tsx";

const ENCODINGS = { "utf-8": "UTF-8", "utf-16le": "UTF-16", "utf-16be": "UTF-16", "windows-1252": "Windows-1252" } as const;

export function TableViewer({ path, file, files, flushRef, kiwi }: FileViewerProps) {
  // Um engine antigo entrega o texto: vira bytes em UTF-8, como estava.
  const base64 = useMemo(() => ("base64" in file ? file.base64 : "text" in file ? base64Of(new TextEncoder().encode(file.text)) : ""), [file]);
  const name = path.split("/").at(-1) ?? path;
  const session = useSheetSession({ path, name, base64, version: file.version, files, flushRef, display: plainDisplay, kiwi });
  // As larguras que a pessoa arrastou valem enquanto o arquivo está aberto, mesmo quando ele recarrega (T21040).
  const widthMemory = useMemo(() => new Map<string, Record<number, number>>(), [path]);
  const { state } = session;

  if (state.kind === "error" || state.kind === "tooLarge") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para ler este arquivo como tabela.</p>
      </div>
    );
  }
  if (state.kind === "loading") return <div className="kn-file-table-wrap" aria-busy="true" />;
  const sheet = state.grid.sheets[0]!;
  if (!sheet.rows.some((r) => r?.some((c) => c && c.text !== ""))) {
    return (
      <div className="kn-file-notice" role="status">
        <p>Este arquivo está vazio.</p>
      </div>
    );
  }
  const enc = state.doc.format?.encoding;
  return (
    <div className="kn-file-sheet">
      {session.notice ? (
        <div className="kn-file-text-note kn-file-sheet-note" role="status">
          {session.notice}
        </div>
      ) : null}
      <SheetPane session={session} doc={state.doc} sheet={sheet} decimal="," countHeader={false} widthMemory={widthMemory} zoomKey={path} foot={enc && enc !== "utf-8" ? `lido como ${ENCODINGS[enc]}` : null} />
    </div>
  );
}
