// A planilha aberta e editável (T21109, spec #21065): a grade de agora, o desfazer e o refazer pelas operações, e a
// gravação sozinha, como a nota (um instante depois da última edição, condicional pela versão). O arquivo gravado é
// sempre o original mais as operações que valem (`docBytes`): desfazer e gravar devolve o arquivo como estava.

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DelimitedError } from "../../../src/shared/sheet/delimited.ts";
import { type Display, type Grid, SheetHistory, type SheetOp, SheetOpError } from "../../../src/shared/sheet/ops.ts";
import { moveCell, rebaseOps } from "../../../src/shared/sheet/rebase.ts";
import { base64Of, bytesOf } from "./csv.ts";
import type { KiwiPlay, KiwiSheetSource } from "./kiwi-sheet.ts";
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
  /** A gravação do Kiwi Cat que a grade toca agora (T21114), ou `null`; `kiwiEnd` a tira. */
  kiwi: KiwiPlay | null;
  kiwiEnd(): void;
  /**
   * A caixa de edição abriu numa célula do arquivo (a aba e a linha do arquivo), ou fechou (`null`): o app sabe, e o
   * Kiwi Cat espera antes de mudar essa célula. Fechar grava na hora o que a pessoa digitou (T21114).
   */
  editing(cell: SheetCell | null): void;
  /** O gato inseriu ou apagou linhas: a caixa aberta foi para cá (`cell: null`, a linha dela saiu). `n` muda a cada vez. */
  boxMoved: { cell: SheetCell | null; n: number } | null;
  /** A aba da caixa aberta agora, ou `null`. */
  editingSheet(): string | null;
}

/** Uma célula do arquivo: a aba (no csv, "") e a linha e a coluna a partir de 0. */
export interface SheetCell {
  sheet: string;
  row: number;
  col: number;
}

const LOST = "O arquivo mudou fora do Kiwi: abri a versão nova, e a última edição não foi gravada.";

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
  kiwi?: KiwiSheetSource;
}): SheetSession {
  const { path, name, base64, version, files, flushRef, display } = opts;
  const kiwiSource = useRef(opts.kiwi);
  kiwiSource.current = opts.kiwi;
  const [kiwi, setKiwi] = useState<KiwiPlay | null>(null);
  /** A grade que está na tela: o "antes" do toque do gato. */
  const shown = useRef<Grid | null>(null);
  const [state, setState] = useState<SheetState>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const history = useRef(new SheetHistory());
  const docRef = useRef<SheetDoc | null>(null);
  /** A versão do arquivo no disco que as operações têm por base, e a do último que gravamos. */
  const disk = useRef<string>("");
  const dirty = useRef(false);
  /** Os bytes (base64) da nossa última gravação: a leitura que volta com eles não reabre nada. */
  const written = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  /** As edições entram em fila: cada uma espera a de antes (o recálculo é assíncrono). */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const canSave = !!files.saveBytes;
  const reopenRef = useRef<(b64: string, ver: string) => void>(() => {});

  const show = useCallback(async () => {
    const doc = docRef.current;
    if (!doc || !display) return;
    const grid = await shownGrid(doc, history.current.ops, display);
    if (docRef.current === doc) setState({ kind: "ready", doc, grid });
  }, [display]);

  /** As operações que a última gravação levou ao disco: as que vêm depois delas ainda não gravaram. */
  const saved = useRef<readonly SheetOp[]>([]);
  /** A célula com a caixa aberta, no arquivo. */
  const box = useRef<SheetCell | null>(null);
  const [boxMoved, setBoxMoved] = useState<{ cell: SheetCell | null; n: number } | null>(null);
  const owner = useMemo(() => `planilha-${Math.random().toString(36).slice(2, 10)}`, []);
  const tell = useCallback((cell: SheetCell | null) => void files.editing?.(path, owner, cell).catch(() => {}), [files, path, owner]);

  /** As edições que ainda não gravaram, ou `null` quando não dá para saber (o desfazer passou da última gravação). */
  const pendingOps = () => {
    const ops = history.current.ops;
    const sv = saved.current;
    if (sv.length > ops.length || sv.some((o, i) => o !== ops[i])) return null;
    return ops.slice(sv.length);
  };

  /**
   * O arquivo mudou no disco (`base64` na `version`): abre a versão nova. Se foi o Kiwi Cat, a grade toca o que ele
   * fez (com o arquivo fechado antes, só o realce), e o que a pessoa digitou e ainda não gravou é refeito por cima,
   * com as linhas que ele inseriu ou apagou já contadas. Se foi outro app, vale o arquivo de lá, como antes.
   */
  const reopen = useCallback(
    (b64: string, ver: string) => {
      if (!display) return;
      let doc: SheetDoc;
      try {
        doc = openDoc(bytesOf(b64), name, display);
      } catch (e) {
        docRef.current = null;
        setState({ kind: e instanceof TooLarge ? "tooLarge" : "error" });
        return;
      }
      const src = kiwiSource.current;
      const first = !docRef.current;
      const wrote = src ? src.take(path, ver) : null;
      const theirs = wrote?.sheetOps?.length ? wrote.sheetOps : null;
      const pending = first ? [] : pendingOps();
      const play: KiwiPlay | null = theirs ? { ops: theirs, before: first ? null : shown.current, cor: src!.cor, ...(first ? { instant: true } : {}) } : null;
      docRef.current = doc;
      history.current = new SheetHistory();
      saved.current = [];
      disk.current = ver;
      written.current = null;
      // A caixa aberta noutra célula segue a célula dela.
      const moved = theirs && box.current ? { cell: moveCell(box.current, theirs), n: Date.now() } : null;
      if (moved) {
        box.current = moved.cell;
        tell(moved.cell);
      }
      const mine = pending?.length && theirs ? rebaseOps(pending, theirs) : [];
      if (!mine.length) {
        if (pending === null || (pending.length && !theirs)) setNotice(LOST);
        dirty.current = false;
        setKiwi(play);
        setBoxMoved(moved);
        setState({ kind: "ready", doc, grid: doc.base });
        return;
      }
      // O que a pessoa digitou vai por cima da versão do gato e grava logo depois.
      dirty.current = true;
      queue.current = queue.current.then(async () => {
        if (docRef.current !== doc) return;
        try {
          history.current.do(await editBatch(doc, doc.base, mine, display));
        } catch {
          setNotice(LOST);
        }
        if (docRef.current !== doc) return;
        await show();
        setKiwi(play);
        setBoxMoved(moved);
        schedule();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [display, name, path, tell],
  );

  // Abrir, e abrir de novo quando o arquivo muda fora do Kiwi (a nossa gravação volta com a versão que já temos).
  useEffect(() => {
    if (!display) return;
    if (docRef.current && (version === disk.current || base64 === written.current)) {
      // O aviso de mudança da nossa própria gravação pode chegar antes da resposta dela: os bytes são os nossos.
      if (base64 === written.current && !saving.current) disk.current = version;
      return;
    }
    reopenRef.current(base64, version);
  }, [base64, version, name, display, path]);

  useEffect(() => {
    if (state.kind === "ready") shown.current = state.grid;
  }, [state]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const doc = docRef.current;
    if (!doc || !dirty.current || !files.saveBytes || !display) return true;
    const run = (async () => {
      dirty.current = false;
      const ops = history.current.ops;
      const base = disk.current;
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
        const b64 = base64Of(bytes);
        written.current = b64;
        const r = await files.saveBytes!(path, b64, base);
        if (r.saved) {
          if (docRef.current === doc) {
            disk.current = r.version;
            saved.current = ops;
          }
          return true;
        }
        // Mudou no disco desde a nossa versão. A recarga pode já ter refeito estas edições sobre a versão nova; senão,
        // é agora: do Kiwi Cat, o que a pessoa digitou vai por cima; de outro app, vale o arquivo de lá.
        if (docRef.current === doc && disk.current === base && "base64" in r.current) reopenRef.current(r.current.base64, r.current.version);
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

  reopenRef.current = reopen;

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

  // Saiu do arquivo com uma gravação marcada: grava agora, e a caixa fecha para o app.
  useEffect(
    () => () => {
      void flush().finally(() => tell(null));
    },
    [flush, tell],
  );

  const editing = useCallback(
    (cell: SheetCell | null) => {
      box.current = cell;
      if (cell) return tell(cell);
      // Fechou: o que ela digitou grava antes de o app saber, e o gato que esperava relê o arquivo com o valor dela.
      void flush().finally(() => tell(box.current));
    },
    [flush, tell],
  );

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
    () => ({ state, readOnly, notice, edit, undo: () => step(false), redo: () => step(true), kiwi, kiwiEnd: () => setKiwi(null), editing, boxMoved, editingSheet: () => box.current?.sheet ?? null }),
    [state, readOnly, notice, edit, step, kiwi, editing, boxMoved],
  );
}
