// O Kiwi escrevendo ao vivo (spec #20843, T20868): o `agent.wrote` com o que uma escrita do agente mudou e onde.
//
// - **O escritor do agente avisa antes de gravar:** o `liveWriter` guarda o texto de antes e o que vai para o disco,
//   e só então chama o `save`. O cofre dispara o `notes.changed` (ou o `files.changed`, no `.txt`) de dentro do próprio
//   `save`; quem manda esse evento às janelas chama `take` antes, e o `agent.wrote` sai **no mesmo tick, logo antes**
//   dele. Assim a janela das Notas sabe que não deve recarregar aquela nota por cima da animação.
// - **Só a escrita aceita:** o aviso só sai se o caminho mudou e a versão do disco é a do texto gravado (quando o
//   evento traz a versão). O save recusado (a nota mudou no meio) não avisa nada, e o pendente sai no `finally`.
// - **Arquivo que não é nota** (o `files_create`): o evento leva só o caminho (e a versão), sem `edits`, logo depois
//   do `files.changed` dele.

import { liveEdits } from "../shared/live-edits.ts";
import type { SheetOp } from "../shared/sheet/ops.ts";
import type { DocxOp } from "../shared/docx/ops.ts";
import type { UiEvents } from "../shared/ui-contract.ts";
import { bytesVersion, versionOf } from "../notes/vault.ts";
import type { VaultWriter } from "./tools/writer.ts";
import { SheetEditing } from "./sheet-editing.ts";

/** O `agent.wrote` do contrato (1.87.0; as `sheetOps` da planilha, 1.90.0). */
export type AgentWrote = UiEvents["agent.wrote"];

interface Pending {
  path: string;
  /** A versão que o disco tem de ter quando o aviso chega (a do texto gravado). */
  version?: string;
  event: Omit<AgentWrote, "folderId">;
}

/** As escritas do agente que estão gravando agora, à espera do aviso do cofre. */
export class LiveWrites {
  private pending: Pending[] = [];
  /** As células que a pessoa está editando nas planilhas abertas (`files.editing`, T21114). */
  readonly editing = new SheetEditing();
  private listeners = new Set<(e: Omit<AgentWrote, "folderId">) => void>();

  /** Os avisos que não vão com um evento do cofre (o arquivo novo do `files_create`): saem na hora. */
  onAnnounce(fn: (e: Omit<AgentWrote, "folderId">) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  announce(e: Omit<AgentWrote, "folderId">): void {
    for (const fn of this.listeners) fn(e);
  }

  /** Uma escrita vai gravar: até o `done`, um aviso do cofre para `path` vira o `agent.wrote`. */
  expect(event: Omit<AgentWrote, "folderId">): () => void {
    const p: Pending = { path: event.path, ...(event.version ? { version: event.version } : {}), event };
    this.pending.push(p);
    return () => {
      this.pending = this.pending.filter((x) => x !== p);
    };
  }

  /**
   * Os `agent.wrote` das escritas que acabam de mudar `paths`, para mandar antes do `notes.changed`/`files.changed`. O
   * `versionNow` diz a versão do caminho no aviso (a do `listing`); sem ela, vale o caminho. Cada escrita avisa uma vez.
   */
  take(paths: readonly string[], folderId?: string, versionNow?: (path: string) => string | undefined): AgentWrote[] {
    if (!this.pending.length) return [];
    const out: AgentWrote[] = [];
    for (const p of [...this.pending]) {
      if (!paths.includes(p.path)) continue;
      const now = versionNow?.(p.path);
      if (now !== undefined && p.version !== undefined && now !== p.version) continue;
      this.pending = this.pending.filter((x) => x !== p);
      out.push({ ...p.event, ...(folderId ? { folderId } : {}) });
    }
    return out;
  }
}

/**
 * O escritor do agente com o aviso ao vivo: cada `save` com o texto de antes (`before`) avisa o `live`. O `turnId` é o
 * do pedido que está escrevendo agora.
 */
export function liveWriter(inner: VaultWriter, live: LiveWrites, turnId: () => string | null | undefined): VaultWriter {
  const turn = () => {
    const t = turnId();
    return t ? { turnId: t } : {};
  };
  return {
    get: (path) => inner.get(path),
    create: (folder, title, content) => inner.create(folder, title, content),
    folder: () => inner.folder(),
    save: async (path, content, baseVersion, before) => {
      // Sem o texto de antes (ou com outro texto na versão lida), não há como dizer onde mudou: o aviso não sai.
      if (before === undefined || versionOf(before) !== baseVersion) return inner.save(path, content, baseVersion, before);
      const done = live.expect({ path, baseVersion, version: versionOf(content), ...turn(), edits: liveEdits(before, content) });
      try {
        return await inner.save(path, content, baseVersion, before);
      } finally {
        done();
      }
    },
    // A planilha (T21114): o aviso leva as operações, e a grade aberta toca cada uma.
    ...(inner.getBytes ? { getBytes: inner.getBytes.bind(inner) } : {}),
    // A pessoa com a caixa aberta na célula que o gato vai mudar: ele espera (T21114).
    waitCells: (path: string, ops: readonly SheetOp[], ms?: number) => live.editing.waitFree(path, ops, ms),
    // A pessoa escrevendo no parágrafo do docx que o gato vai mudar: ele espera (T21231).
    waitParagraphs: (path: string, ids: readonly string[], ms?: number) => live.editing.waitParagraphs(path, ids, ms),
    ...(inner.saveBytes
      ? {
          saveBytes: async (path: string, base64: string, baseVersion: string, sheetOps?: readonly SheetOp[], docxOps?: readonly DocxOp[]) => {
            const version = bytesVersion(Buffer.from(base64, "base64"));
            const done = live.expect({
              path,
              baseVersion,
              version,
              ...turn(),
              ...(sheetOps?.length ? { sheetOps: [...sheetOps] } : {}),
              ...(docxOps?.length ? { docxOps: [...docxOps] } : {}),
            });
            try {
              return await inner.saveBytes!(path, base64, baseVersion, sheetOps, docxOps);
            } finally {
              done();
            }
          },
        }
      : {}),
    createFile: async (folder, name, bytes) => {
      // O caminho só se sabe depois do `files.changed` dele: o aviso sai em seguida, só com o caminho.
      const r = await inner.createFile(folder, name, bytes);
      live.announce({ path: r.path, version: r.version, ...turn() });
      return r;
    },
  };
}
