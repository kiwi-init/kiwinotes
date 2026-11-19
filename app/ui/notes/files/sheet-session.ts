// A planilha aberta e editável (T21109, spec #21065): a grade de agora, o desfazer e o refazer pelas operações, e a
// gravação sozinha, como a nota (um instante depois da última edição, condicional pela versão). O arquivo gravado é
// sempre o original mais as operações que valem (`docBytes`): desfazer e gravar devolve o arquivo como estava.

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DelimitedError } from "../../../src/shared/sheet/delimited.ts";
import { type Display, type Grid, SheetHistory, type SheetOp, SheetOpError } from "../../../src/shared/sheet/ops.ts";
import { base64Of, bytesOf } from "./csv.ts";
import { docBytes, editBatch, openDoc, replay, type SheetDoc, shownGrid } from "./sheet-doc.ts";
import { TooLarge } from "./sheet.ts";
import type { FilesApi } from "./viewers.ts";

/** Quanto a gravação espera depois da última edição (ms). */
export const SAVE_DELAY = 400;

export type SheetState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "tooLarge" }
  | { kind: "ready"; doc: SheetDoc; grid: Grid };

export interface SheetSession {
  state: SheetState;
  /** Por que não edita (só de leitura), ou `null`. */
  readOnly: string | null;
  /** Um aviso na barra: a gravação que falhou, a operação que não cabe. */
  notice: string | null;
  edit(ops: SheetOp[]): void;
  undo(): void;
  redo(): void;
}

/**
 * `bytes` e `version`: o arquivo como o `files.read` o leu; mudam quando ele muda no disco. A leitura que volta depois
 * da nossa própria gravação (a mesma versão) não reabre nada.
 */
export function useSheetSession(opts: {
  path: string;
  name: string;
  base64: string;
  version: string;
  files: FilesApi;
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  display: Display | null;
}): SheetSession {
  const { path, name, base64, version, files, flushRef, display } = opts;
  const [state, setState] = useState<SheetState>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const history = useRef(new SheetHistory());
  const docRef = useRef<SheetDoc | null>(null);
  /** A versão do arquivo no disco que as operações têm por base, e a do último que gravamos. */
  const disk = useRef<string>("");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  /** As edições entram em fila: cada uma espera a de antes (o recálculo é assíncrono). */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const canSave = !!files.saveBytes;

  const show = useCallback(async () => {
    const doc = docRef.current;
    if (!doc || !display) return;
    const grid = await shownGrid(doc, history.current.ops, display);
    if (docRef.current === doc) setState({ kind: "ready", doc, grid });
  }, [display]);

  // Abrir, e abrir de novo quando o arquivo muda fora do Kiwi (a nossa gravação volta com a versão que já temos).
  useEffect(() => {
    if (!display) return;
    if (version === disk.current && docRef.current) return;
    try {
      const doc = openDoc(bytesOf(base64), name, display);
      if (dirty.current) setNotice("O arquivo mudou fora do Kiwi: abri a versão nova, e a última edição não foi gravada.");
      docRef.current = doc;
      history.current = new SheetHistory();
      disk.current = version;
      dirty.current = false;
      setState({ kind: "ready", doc, grid: doc.base });
    } catch (e) {
      docRef.current = null;
      setState({ kind: e instanceof TooLarge ? "tooLarge" : "error" });
    }
  }, [base64, version, name, display]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const doc = docRef.current;
    if (!doc || !dirty.current || !files.saveBytes || !display) return true;
    const run = (async () => {
      dirty.current = false;
      const ops = history.current.ops;
      let bytes: Uint8Array;
      try {
        bytes = docBytes(doc, ops, replay(doc, ops, display));
      } catch (e) {
        // Um texto que a codificação do csv não tem: a edição sai, e a barra diz o porquê.
        if (e instanceof DelimitedError) {
          history.current.undo();
          dirty.current = true;
          setNotice(`Não deu para gravar: ${e.message}. A edição foi desfeita.`);
          void show();
          return save();
        }
        setNotice("Não deu para gravar esta planilha.");
        return false;
      }
      try {
        const r = await files.saveBytes!(path, base64Of(bytes), disk.current);
        if (r.saved) {
          disk.current = r.version;
          return true;
        }
        // Mudou no disco desde a nossa versão: vale o arquivo de lá, como numa nota com conflito.
        setNotice("O arquivo mudou fora do Kiwi: abri a versão nova, e a última edição não foi gravada.");
        if ("base64" in r.current) {
          const next = openDoc(bytesOf(r.current.base64), name, display);
          docRef.current = next;
          history.current = new SheetHistory();
          disk.current = r.current.version;
          setState({ kind: "ready", doc: next, grid: next.base });
        }
        return false;
      } catch {
        dirty.current = true;
        setNotice("Não deu para gravar esta planilha agora. O Kiwi tenta de novo na próxima edição.");
        return false;
      }
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      if (saving.current === run) saving.current = null;
    }
  }, [files, path, name, display, show]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, SAVE_DELAY);
  }, [save]);

  const flush = useCallback(async () => {
    await queue.current;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return save();
  }, [save]);

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = null;
    };
  }, [flushRef, flush]);

  // Saiu do arquivo com uma gravação marcada: grava agora.
  useEffect(() => () => void flush(), [flush]);

  const readOnly = state.kind === "ready" ? (state.doc.readOnly ?? (canSave ? null : "Este Kiwi ainda não grava planilhas.")) : null;

  const edit = useCallback(
    (ops: SheetOp[]) => {
      if (!ops.length) return;
      queue.current = queue.current.then(async () => {
        const doc = docRef.current;
        if (!doc || !display || readOnly) return;
        try {
          const grid = replay(doc, history.current.ops, display);
          const op = await editBatch(doc, grid, ops, display);
          if (docRef.current !== doc) return;
          history.current.do(op);
          setNotice(null);
        } catch (e) {
          setNotice(e instanceof SheetOpError ? `Não deu: ${e.message}.` : "Não deu para fazer esta edição.");
          return;
        }
        await show();
        schedule();
      });
    },
    [display, readOnly, show, schedule],
  );

  const step = useCallback(
    (redo: boolean) => {
      queue.current = queue.current.then(async () => {
        if (!(redo ? history.current.redo() : history.current.undo())) return;
        setNotice(null);
        await show();
        schedule();
      });
    },
    [show, schedule],
  );

  return useMemo(
    () => ({ state, readOnly, notice, edit, undo: () => step(false), redo: () => step(true) }),
    [state, readOnly, notice, edit, step],
  );
}
