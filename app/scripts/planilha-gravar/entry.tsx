// A página do `planilha-gravar.test.ts`: o visualizador de verdade das Notas (o `XlsxViewer` ou o `TableViewer`, com a
// grade, o recálculo e a gravação do app), com um disco falso que guarda os bytes que a grade grava.
import { createRoot } from "react-dom/client";

import "../../ui/notes/files/files.css";
import type { FileViewerProps } from "../../ui/notes/files/viewers.ts";
import { TableViewer } from "../../ui/notes/files/TableViewer.tsx";
import { XlsxViewer } from "../../ui/notes/files/XlsxViewer.tsx";

declare global {
  interface Window {
    __kiwiSheet: { saved: string[]; flush(): Promise<boolean> };
  }
}

const name = new URL(location.href).searchParams.get("arquivo")!;
const bytes = new Uint8Array(await (await fetch(`/arquivo/${encodeURIComponent(name)}`)).arrayBuffer());
let bin = "";
for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

const saved: string[] = [];
let version = 1;
const flushRef: FileViewerProps["flushRef"] = { current: null };
const files = {
  open: async () => true as const,
  onChanged: () => () => {},
  read: async () => ({ base64: saved.at(-1) ?? btoa(bin), version: String(version) }),
  saveBytes: async (_path: string, base64: string) => {
    saved.push(base64);
    version++;
    return { saved: true, version: String(version) };
  },
  editing: async () => ({ ok: true as const }),
} as unknown as FileViewerProps["files"];
window.__kiwiSheet = { saved, flush: async () => (flushRef.current ? flushRef.current() : true) };

const View = name.endsWith(".xlsx") ? XlsxViewer : TableViewer;
const file = { base64: btoa(bin), version: "1" } as unknown as FileViewerProps["file"];
createRoot(document.getElementById("root")!).render(
  <div className="kn-file" data-state="ready" style={{ height: 700, display: "flex", flexDirection: "column" }}>
    <View path={`Papelaria/${name}`} file={file} files={files} flushRef={flushRef} />
  </div>,
);
