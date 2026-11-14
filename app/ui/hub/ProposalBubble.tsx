// A proposta da reunião no balão do gato (spec #8360, T11293): a mais nova que espera a pessoa, com os botões dela.
// Aparece quando o balão da resposta não está na tela (o "Preparei a proposta…" passa primeiro) e some com o campo de
// falar aberto ou com o gato no overlay. [Depois] a tira do balão; ela continua na Atividade do agente.
//
// Nunca tira o foco: o mousedown não move o foco, como o balão da resposta.

import { useEffect, useRef, useState } from "react";

import { openProposals, PROPOSAL_LATER } from "../settings/proposalText.ts";
import { ProposalItem, ProposalPanel, useProposals } from "../settings/Proposals.tsx";
import { onAdjust } from "../settings/routineAdjust.ts";
import { BubblePresence } from "./BubblePresence";

export function ProposalBubble({ hidden, reduced = false }: { hidden: boolean; reduced?: boolean }) {
  const list = useProposals();
  const [later, setLater] = useState<ReadonlySet<string>>(new Set());
  /** A proposta que o balão mostrava: aplicada ali, ela fica com o [Desfazer] até o [Depois]. */
  const [shown, setShown] = useState<string | null>(null);
  const [bigOpen, setBigOpen] = useState(false);
  const big = useRef<HTMLDivElement>(null);

  // O [Ajustar] de uma rotina (spec #12944) leva a proposta para o cartão em Ajustes: o balão sai, como no [Depois].
  useEffect(() => onAdjust((r) => setLater((s) => (s.has(r.proposal) ? s : new Set(s).add(r.proposal)))), []);

  const open = openProposals(list ?? []).filter((p) => !later.has(p.id));
  const kept = list?.find((p) => p.id === shown && p.status === "applied" && !later.has(p.id));
  const p = open[0] ?? kept ?? null;

  useEffect(() => {
    if (p && p.id !== shown) setShown(p.id);
    if (!p || p.status !== "pending") setBigOpen(false);
  }, [p?.id, p?.status]);

  // O balão grande: um clique fora ou o Esc fecha. Os dois só são ouvidos com ele aberto.
  useEffect(() => {
    if (!bigOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setBigOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (big.current && !big.current.contains(e.target as Node)) setBigOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [bigOpen]);

  const keepFocus = (e: React.MouseEvent) => {
    // Os botões recebem o clique, mas o foco fica onde estava (quem digita numa nota continua digitando).
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  };
  const dismiss = () => p && setLater((s) => new Set(s).add(p.id));

  const small = p && !hidden && !bigOpen ? p : null;
  return (
    <>
      {p && !hidden && bigOpen ? (
        <div className="kn-bubble-big kn-proposal-big" ref={big} onMouseDown={keepFocus} role="dialog" aria-label="A proposta da reunião">
          <ProposalItem p={p} inline={false} viewOpen onView={setBigOpen} />
          <ProposalPanel id={p.id} />
        </div>
      ) : null}
      {/* A troca entre os balões (spec #11652): a proposta entra e sai pela mesma passagem que a resposta. */}
      <BubblePresence itemKey={small ? `proposta-${small.id}` : null} reduced={reduced}>
        {small ? (
          <div className="kn-bubble-shell kn-bubble kn-proposal-bubble" onMouseDown={keepFocus} role="region" aria-label="A proposta da reunião">
            <ProposalItem p={small} inline={false} viewOpen={false} onView={setBigOpen} />
            <button type="button" className="kn-proposal-later" onClick={dismiss}>
              {PROPOSAL_LATER}
            </button>
          </div>
        ) : null}
      </BubblePresence>
    </>
  );
}
