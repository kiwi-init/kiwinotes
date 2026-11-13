// O cartão da pergunta na dúvida (spec #9873), na janela principal: o trecho em dúvida com um pouco do texto em volta,
// de onde ele vem, e "É segredo" ou "Pode mandar" para cada um, mais "É tudo segredo". O pedido espera até o prazo;
// sem resposta, o Kiwi segura o trecho e a dúvida fica na Atividade do agente.
//
// O trecho só chega aqui pela capacidade `agent.question`; o evento `agent.questionChanged` traz só os ids.

import { useEffect, useState } from "react";

import type { AgentDoubtCard } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button } from "../src/kit/index.tsx";

/** "Projetos/Kiwi" (sem o `.md`), ou "o seu pedido". */
const whereOf = (p: string) => (p ? p.replace(/\.md$/i, "") : "o seu pedido");
const hourOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** O texto em volta, com o trecho marcado. */
function Context({ context, value }: { context: string; value: string }) {
  const at = context.indexOf(value);
  if (at < 0) return <span className="kn-doubt-context">{context}</span>;
  return (
    <span className="kn-doubt-context">
      {context.slice(0, at)}
      <mark className="kn-doubt-value">{value}</mark>
      {context.slice(at + value.length)}
    </span>
  );
}

export function DoubtCard() {
  const [card, setCard] = useState<AgentDoubtCard | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!has("agent.question")) return;
    let alive = true;
    const read = () =>
      void api.agent.question().then(
        (c) => alive && setCard(c),
        () => {},
      );
    read();
    const off = api.agent.onQuestion(read);
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!card) return null;

  const answer = async (a: Parameters<typeof api.agent.answer>[0]) => {
    setFailure(null);
    try {
      await api.agent.answer(a);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };
  const open = card.items.filter((i) => !i.answer).length;

  return (
    <section className="kn-doubt" role="dialog" aria-modal="false" aria-labelledby="kn-doubt-title">
      <h2 id="kn-doubt-title" className="kn-doubt-title">
        O Kiwi ficou em dúvida
      </h2>
      <p className="kn-doubt-hint">
        {card.items.length === 1 ? "Isto pode ser uma senha ou um token." : "Estes trechos podem ser senhas ou tokens."} O agente espera a sua resposta;
        sem ela até as {hourOf(card.deadline)}, o Kiwi segura e você responde depois, na Atividade do agente.
      </p>
      <ul className="kn-doubt-list">
        {card.items.map((i) => (
          <li key={i.fingerprint} className="kn-doubt-item" data-answer={i.answer}>
            <div className="kn-doubt-where">
              em {whereOf(i.path)}
              {i.path ? `, linha ${i.line}` : ""}
            </div>
            <Context context={i.context} value={i.value} />
            <div className="kn-doubt-buttons">
              {i.answer ? (
                <span className="kn-doubt-answered">{i.answer === "send" ? "Vai para o agente." : "Fica de fora."}</span>
              ) : (
                <>
                  <Button onClick={() => void answer({ card: card.id, fingerprint: i.fingerprint, answer: "hold" })}>É segredo</Button>
                  {/* Os dois com o mesmo peso, sem principal e sem Enter padrão: a pessoa escolhe (#10168). */}
                  <Button onClick={() => void answer({ card: card.id, fingerprint: i.fingerprint, answer: "send" })}>Pode mandar</Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {open > 1 ? (
        <div className="kn-doubt-all">
          <Button onClick={() => void answer({ card: card.id, all: "hold" })}>É tudo segredo</Button>
        </div>
      ) : null}
      {failure ? (
        <p className="kn-doubt-hint" role="alert">
          {failure}
        </p>
      ) : null}
    </section>
  );
}
