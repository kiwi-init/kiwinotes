// A seção "Atividade do agente" dos Ajustes (spec #9480): cada pedido dos últimos 30 dias, com o que o agente leu e
// mudou, o [Ver] (o antes e o depois de uma mudança, pelo comparador das Versões) e o [Desfazer] (uma mudança ou o
// pedido inteiro). Só lê o registro e as notas; o desfazer é o `agent.undo` (spec #9353), sem regra nova.
//
// - Aparece com o agente desligado: o desfazer não precisa dele.
// - Lê de novo sozinha a cada `agent.activityChanged` (um pedido, uma leitura, uma mudança ou um desfazer, também pela
//   CLI) e no fim de cada pedido.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import type { AgentActivityRequest, AgentChangeView, AgentUndoNote } from "../../src/shared/ui-contract.ts";
import { collapse, lineDiff } from "../notes/diff.ts";
import { api, has } from "../src/api.ts";
import { Button, Section } from "../src/kit/index.tsx";
import {
  ACTIVITY_FIRST,
  ACTIVITY_HINT,
  ACTIVITY_MORE,
  changeLine,
  EMPTY_ACTIVITY,
  goneRequest,
  openChanges,
  readsLine,
  requestLine,
  undoLine,
  undoneLine,
  viewNotice,
  whenOf,
} from "./activityText.ts";

/** O [Ver] aberto de uma mudança: carregando, os dois textos, ou o erro. */
type View = { phase: "loading" } | { phase: "ready"; view: AgentChangeView } | { phase: "error"; message: string };

/** O que o último desfazer de um pedido respondeu, nota por nota (ou o erro). */
type Outcome = { lines: { text: string; ok: boolean }[] };

const keyOf = (request: string, change?: number) => (change ? `${request}:${change}` : request);

export function AgentActivitySection() {
  const [requests, setRequests] = useState<AgentActivityRequest[] | null>(null);
  const [limit, setLimit] = useState(ACTIVITY_FIRST);
  const [failure, setFailure] = useState<string | null>(null);
  /** O aviso de um pedido que saiu do registro com a tela aberta: fica fora da lista, e o `load` não o limpa. */
  const [notice, setNotice] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, View>>({});
  /** Os desfazer em curso (o pedido, ou o pedido e a mudança): cada botão espera o seu. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;

  /** Lê a lista de novo; devolve a lista lida (null se falhou). */
  const load = useCallback(async (): Promise<AgentActivityRequest[] | null> => {
    try {
      const { requests } = await api.agent.activity(limitRef.current);
      setRequests(requests);
      setFailure(null);
      return requests;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  /** Depois de um clique: se o pedido saiu do registro (passou dos 30 dias), a seção diz, e a lista já não o tem. */
  const afterClick = async (request: string, at: string | undefined, gone: boolean) => {
    const list = await load();
    if (gone || (list && !list.some((r) => r.id === request))) {
      setNotice(goneRequest(at));
      setOutcomes(({ [request]: _, ...rest }) => rest);
      setViews((v) => Object.fromEntries(Object.entries(v).filter(([key]) => !key.startsWith(`${request}:`))));
    }
  };

  useEffect(() => {
    if (!has("agent.activity")) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Vários avisos seguidos (o agente lendo várias notas) viram uma leitura só.
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => alive && void load(), 120);
    };
    void load();
    const offActivity = api.agent.onActivity(soon);
    const offTurn = api.agent.onTurn((e) => {
      if (e.type === "done" || e.type === "error") soon();
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      offActivity();
      offTurn();
    };
  }, [load]);

  useEffect(() => {
    if (has("agent.activity") && limit !== ACTIVITY_FIRST) void load();
  }, [limit, load]);

  if (!has("agent.activity")) return null;

  /** Abre ou fecha o [Ver]: cada abertura lê de novo, porque a nota pode ter mudado. */
  const toggleView = async (request: string, change: number) => {
    const k = keyOf(request, change);
    if (views[k]) {
      setViews(({ [k]: _, ...rest }) => rest);
      return;
    }
    const at = requestsRef.current?.find((r) => r.id === request)?.at;
    setNotice(null);
    setViews((v) => ({ ...v, [k]: { phase: "loading" } }));
    try {
      const view = await api.agent.change(request, change);
      setViews((v) => (v[k] ? { ...v, [k]: { phase: "ready", view } } : v));
    } catch (e) {
      const gone = (e as { code?: string })?.code === "E_NOT_FOUND";
      setViews((v) => (v[k] ? { ...v, [k]: { phase: "error", message: e instanceof Error ? e.message : String(e) } } : v));
      if (gone) await afterClick(request, at, true);
    }
  };

  const runUndo = async (request: string, change?: number) => {
    const k = keyOf(request, change);
    const at = requestsRef.current?.find((r) => r.id === request)?.at;
    let gone = false;
    setNotice(null);
    setBusy((b) => new Set(b).add(k));
    try {
      const r = await api.agent.undo(request, change);
      const lines = r.notes.map((n: AgentUndoNote) => ({ text: undoLine(n, request), ok: n.result === "restored" || n.result === "trashed" }));
      setOutcomes((o) => ({ ...o, [request]: { lines } }));
      // Uma nota voltou: o [Ver] aberto deste pedido mostrava um depois que já não vale, então fecha. Recusado, nada
      // mudou, e ele fica.
      if (lines.some((l) => l.ok)) setViews((v) => Object.fromEntries(Object.entries(v).filter(([key]) => !key.startsWith(`${request}:`))));
    } catch (e) {
      gone = (e as { code?: string })?.code === "E_NOT_FOUND";
      if (!gone) setOutcomes((o) => ({ ...o, [request]: { lines: [{ text: e instanceof Error ? e.message : String(e), ok: false }] } }));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(k);
        return next;
      });
      await afterClick(request, at, gone);
    }
  };

  return (
    <Section title="Atividade do agente">
      <div className="kn-activity">
        <p className="kn-row-hint kn-activity-hint">{ACTIVITY_HINT}</p>
        {failure ? (
          <p className="kn-activity-failure" role="alert">
            {failure}
          </p>
        ) : null}
        {notice ? (
          <p className="kn-activity-failure kn-activity-gone" role="status">
            {notice}
          </p>
        ) : null}
        {requests === null ? null : requests.length === 0 ? (
          notice ? null : <p className="kn-activity-empty">{EMPTY_ACTIVITY}</p>
        ) : (
          <ul className="kn-activity-list" aria-label="Pedidos ao agente">
            {requests.map((r) => (
              <Request
                key={r.id}
                r={r}
                busy={busy}
                views={views}
                outcome={outcomes[r.id]}
                onView={(n) => void toggleView(r.id, n)}
                onUndo={(n) => void runUndo(r.id, n)}
              />
            ))}
          </ul>
        )}
        {requests && requests.length >= limit && limit < ACTIVITY_MORE ? (
          <div className="kn-activity-more">
            <Button onClick={() => setLimit(ACTIVITY_MORE)}>Mostrar mais</Button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function Request({
  r,
  busy,
  views,
  outcome,
  onView,
  onUndo,
}: {
  r: AgentActivityRequest;
  busy: ReadonlySet<string>;
  views: Record<string, View>;
  outcome?: Outcome;
  onView: (change: number) => void;
  onUndo: (change?: number) => void;
}) {
  const open = openChanges(r);
  const running = [...busy].some((b) => b === r.id || b.startsWith(`${r.id}:`));
  return (
    <li className="kn-activity-req" data-request={r.id}>
      <div className="kn-activity-head">
        <time className="kn-activity-when" dateTime={r.at}>
          {whenOf(r.at)}
        </time>
        <span className="kn-activity-text" title={r.request}>
          {requestLine(r.request) || "(sem texto)"}
        </span>
        {r.changes.length > 1 && open > 0 ? (
          <Button onClick={() => onUndo()} disabled={running} aria-label={`Desfazer o pedido de ${whenOf(r.at)}`}>
            {busy.has(r.id) ? "Desfazendo…" : "Desfazer o pedido"}
          </Button>
        ) : null}
      </div>
      <p className="kn-activity-reads">{readsLine(r.reads)}</p>
      {r.changes.length === 0 ? (
        <p className="kn-activity-none">Não mudou nada.</p>
      ) : (
        <ul className="kn-activity-changes">
          {r.changes.map((c, i) => {
            const n = i + 1;
            const k = keyOf(r.id, n);
            const view = views[k];
            const viewId = `kn-activity-view-${r.id}-${n}`;
            return (
              <Fragment key={k}>
                <li className="kn-activity-change" data-undone={c.undone ? "true" : undefined}>
                  <span className="kn-activity-what">{changeLine(c)}</span>
                  {c.undone ? <span className="kn-activity-undone">{undoneLine(c.undone)}</span> : null}
                  <span className="kn-activity-actions">
                    <Button onClick={() => onView(n)} aria-expanded={!!view} aria-controls={viewId}>
                      {view ? "Fechar" : "Ver"}
                    </Button>
                    {c.undone ? null : (
                      <Button onClick={() => onUndo(n)} disabled={running} aria-label={`Desfazer: ${changeLine(c)}`}>
                        {busy.has(k) ? "Desfazendo…" : "Desfazer"}
                      </Button>
                    )}
                  </span>
                </li>
                {view ? (
                  <li className="kn-activity-view" id={viewId}>
                    <ViewPanel view={view} />
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ul>
      )}
      {outcome ? (
        <ul className="kn-activity-outcome" aria-live="polite">
          {outcome.lines.map((l, i) => (
            <li key={i} data-ok={l.ok ? "true" : "false"}>
              {l.text}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** O [Ver]: o aviso, e o antes contra o depois com as linhas mudadas marcadas (ou só um dos dois). */
function ViewPanel({ view }: { view: View }) {
  if (view.phase === "loading") return <p className="kn-activity-notice">Lendo…</p>;
  if (view.phase === "error") return <p className="kn-activity-notice" role="alert">{view.message}</p>;
  const v = view.view;
  const notice = viewNotice(v);
  // Numa nota criada, o antes é vazio: a tela mostra só o texto dela.
  const both = v.before !== null && v.after !== undefined && v.kind !== "created";
  // A última quebra de linha da nota não vira uma linha vazia no fim.
  const trim = (t: string) => t.replace(/\n$/, "");
  const lines = both
    ? collapse(lineDiff(trim(v.before!), trim(v.after!)))
    : trim(v.after ?? v.before ?? "").split("\n").map((text) => ({ kind: "same" as const, text }));
  const shown = v.before !== null || v.after !== undefined;
  return (
    <>
      {notice ? <p className="kn-activity-notice">{notice}</p> : null}
      {shown ? (
        <pre className="kn-diff" aria-label={both ? "O texto de antes e o que o agente deixou" : "O texto"}>
          {lines.map((l, i) =>
            l.kind === "gap" ? (
              <div key={i} className="kn-diff-gap">
                … {l.count} {l.count === 1 ? "linha igual" : "linhas iguais"}
              </div>
            ) : (
              <div key={i} className={`kn-diff-${l.kind}`}>
                {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                {l.text || " "}
              </div>
            ),
          )}
        </pre>
      ) : null}
    </>
  );
}
