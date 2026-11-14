// A proposta da reunião na tela (spec #8360, T11293): a mesma peça no balão do gato e na Atividade do agente.
//
// - **A pergunta do modo econômico:** [Preparar] (gasta o pedido) e [Agora não].
// - **Em dúvida entre projetos:** um botão para cada um, e "Nenhum: só a nota da reunião". A escolha não gasta pedido.
// - **Pronta:** [Ver a proposta] (a nota nova e as linhas que entram na nota principal), [Aplicar] e [Descartar].
// - **Aplicada:** [Desfazer], que é o `agent.undo` do pedido do [Aplicar], como na Atividade.
// Nada é escrito antes do [Aplicar].

import { Fragment, useEffect, useState } from "react";

import type { AgentProposalSummary, AgentProposalView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button } from "../src/kit/index.tsx";
import {
  choiceJoin,
  mainDiff,
  openProposals,
  PROPOSAL_APPLY,
  PROPOSAL_DISCARD,
  PROPOSAL_HIDE,
  PROPOSAL_NONE,
  PROPOSAL_NOT_NOW,
  PROPOSAL_PREPARE,
  PROPOSAL_UNDO,
  PROPOSAL_VIEW,
  proposalLine,
} from "./proposalText.ts";
import "./proposal.css";

/** As propostas, lidas de novo a cada `agent.proposalsChanged`. Null antes da primeira leitura. */
export function useProposals(): AgentProposalSummary[] | null {
  const [list, setList] = useState<AgentProposalSummary[] | null>(null);
  useEffect(() => {
    if (!has("agent.proposals")) return;
    let alive = true;
    let events = 0;
    const off = api.agent.onProposals((e) => {
      events++;
      if (alive) setList(e.proposals);
    });
    const before = events;
    void api.agent.proposals().then(
      (r) => alive && events === before && setList(r.proposals),
      () => {},
    );
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}

type ViewState = { phase: "loading" } | { phase: "ready"; view: AgentProposalView } | { phase: "error"; message: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** O [Ver a proposta]: a nota nova e a diferença na nota principal. */
export function ProposalView({ state }: { state: ViewState }) {
  if (state.phase === "loading") return <p className="kn-proposal-note">Lendo…</p>;
  if (state.phase === "error")
    return (
      <p className="kn-proposal-note" role="alert">
        {state.message}
      </p>
    );
  const v = state.view;
  const folder = v.note?.folder ? `${v.note.folder}/` : "";
  return (
    <div className="kn-proposal-view">
      {v.note ? (
        <h3 className="kn-proposal-h">
          A nota nova: <span className="kn-proposal-path">{`${folder}${v.note.title}.md`}</span>
        </h3>
      ) : (
        // O resumo executivo (spec #11546): a seção como vai ficar, no topo da nota principal.
        <h3 className="kn-proposal-h">
          O resumo executivo{v.replaces ? `, no lugar do de ${v.replaces.split("-").reverse().join("/")} (que fica nas Versões)` : ""}:
        </h3>
      )}
      <pre className="kn-diff" aria-label={v.note ? "O texto da nota nova" : "O resumo executivo"}>
        {v.noteContent.replace(/\n$/, "").split("\n").map((l, i) => (
          <div key={i} className="kn-diff-add">
            {"+ "}
            {l || " "}
          </div>
        ))}
      </pre>
      {v.main ? (
        <>
          <h3 className="kn-proposal-h">
            Na nota principal: <span className="kn-proposal-path">{v.main.path}</span>
          </h3>
          <pre className="kn-diff" aria-label="As linhas que entram na nota principal">
            {mainDiff(v.main.lines).map((l, i) =>
              l.kind === "gap" ? (
                <div key={i} className="kn-diff-gap">
                  … {l.count} {l.count === 1 ? "linha igual" : "linhas iguais"}
                </div>
              ) : (
                <div key={i} className={`kn-diff-${l.kind}`}>
                  {l.kind === "add" ? "+ " : "  "}
                  {l.text || " "}
                </div>
              ),
            )}
          </pre>
        </>
      ) : (
        <p className="kn-proposal-note">Sem nota principal: só a nota da reunião.</p>
      )}
    </div>
  );
}

/**
 * Uma proposta, com os botões do estado dela. `inline`: o [Ver] abre embaixo (a Atividade); senão quem chama mostra o
 * painel (o balão grande do gato), pelo `onView`.
 */
export function ProposalItem({
  p,
  onView,
  viewOpen,
  inline = true,
}: {
  p: AgentProposalSummary;
  onView?: (open: boolean) => void;
  viewOpen?: boolean;
  inline?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [undone, setUndone] = useState(false);
  const open = inline ? view !== null : !!viewOpen;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await fn();
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };
  const toggleView = () => {
    if (!inline) return onView?.(!open);
    if (view) return setView(null);
    setView({ phase: "loading" });
    void api.agent.proposal(p.id).then(
      (v) => setView({ phase: "ready", view: v }),
      (e) => setView({ phase: "error", message: message(e) }),
    );
  };

  const choosing = p.status === "pending" && !p.project && p.candidates.length > 0;
  return (
    <div className="kn-proposal" data-status={p.status} data-proposal={p.id}>
      {choosing ? (
        <p className="kn-proposal-line">
          {proposalLine(p)} É do{" "}
          {p.candidates.map((c, i) => (
            <Fragment key={c.folder}>
              {choiceJoin(i, p.candidates.length)}
              <strong>{c.name}</strong>
            </Fragment>
          ))}
          ?
        </p>
      ) : (
        <p className="kn-proposal-line">{undone || p.undoneAt ? "Desfeito: as notas voltaram como estavam." : proposalLine(p)}</p>
      )}
      <div className="kn-proposal-actions">
        {p.status === "offer" ? (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void run(() => api.agent.proposalPrepare(p.id))}>
              {PROPOSAL_PREPARE}
            </Button>
            <Button disabled={busy} onClick={() => void run(() => api.agent.proposalDiscard(p.id))}>
              {PROPOSAL_NOT_NOW}
            </Button>
          </>
        ) : choosing ? (
          <>
            {p.candidates.map((c) => (
              <Button key={c.folder} disabled={busy} onClick={() => void run(() => api.agent.proposalChoose(p.id, c.folder))}>
                {c.name}
              </Button>
            ))}
            <Button disabled={busy} onClick={() => void run(() => api.agent.proposalChoose(p.id, null))}>
              {PROPOSAL_NONE}
            </Button>
            <Button disabled={busy} onClick={() => void run(() => api.agent.proposalDiscard(p.id))}>
              {PROPOSAL_DISCARD}
            </Button>
          </>
        ) : p.status === "pending" ? (
          <>
            <Button aria-expanded={open} onClick={toggleView}>
              {open ? PROPOSAL_HIDE : PROPOSAL_VIEW}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void run(() => api.agent.proposalApply(p.id))}>
              {PROPOSAL_APPLY}
            </Button>
            <Button disabled={busy} onClick={() => void run(() => api.agent.proposalDiscard(p.id))}>
              {PROPOSAL_DISCARD}
            </Button>
          </>
        ) : p.status === "applied" && p.applyRequest && !undone && !p.undoneAt ? (
          <Button disabled={busy} onClick={() => void run(async () => (await api.agent.undo(p.applyRequest!), setUndone(true)))}>
            {PROPOSAL_UNDO}
          </Button>
        ) : null}
      </div>
      {failure ? (
        <p className="kn-proposal-note" role="alert">
          {failure}
        </p>
      ) : null}
      {inline && view ? <ProposalView state={view} /> : null}
    </div>
  );
}

/** As propostas abertas, na Atividade do agente: cada uma até ser aplicada ou descartada, por 30 dias. */
export function ProposalList({ list }: { list: readonly AgentProposalSummary[] }) {
  const open = openProposals(list);
  if (!open.length) return null;
  return (
    <ul className="kn-proposal-list" aria-label="Propostas das reuniões">
      {open.map((p) => (
        <li key={p.id}>
          <ProposalItem p={p} />
        </li>
      ))}
    </ul>
  );
}

/** O painel do [Ver a proposta] fora da Atividade (o balão grande do gato): lê a proposta ao abrir. */
export function ProposalPanel({ id }: { id: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    void api.agent.proposal(id).then(
      (v) => alive && setState({ phase: "ready", view: v }),
      (e) => alive && setState({ phase: "error", message: message(e) }),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return <ProposalView state={state} />;
}
