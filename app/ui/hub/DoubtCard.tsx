// O cartão da pergunta na dúvida (spec #9873), na janela principal: o trecho em dúvida com um pouco do texto em volta,
// de onde ele vem, e "É segredo" ou "Pode mandar" para cada um, mais "É tudo segredo". O pedido espera até o prazo;
// sem resposta, o Kiwi segura o trecho e a dúvida fica na Atividade do agente.
//
// O trecho só chega aqui pela capacidade `agent.question`; o evento `agent.questionChanged` traz só os ids.
//
// O mesmo cartão leva a confirmação de "organizar a pasta inteira" (spec #11102, `kind: "confirm"`): a pergunta e
// [Agora não] [Organizar]. A resposta vale só para aquele pedido, e sem ela no prazo é "Agora não".

import { useEffect, useState } from "react";

import type { AgentDoubtCard } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button } from "../src/kit/index.tsx";
import { useT } from "../src/i18n.ts";

/** "Projetos/Kiwi" (sem o `.md`); o pedido, `null` (a tela diz "o seu pedido" na língua). */
const whereOf = (p: string) => (p ? p.replace(/\.md$/i, "") : null);

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
  const { t, time } = useT();
  /** A hora do prazo, no costume da língua (`18:40` / `6:40 PM`). */
  const hourOf = (iso: string) => time(new Date(iso));
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
  const confirms = card.items.filter((i) => i.kind === "confirm");
  const doubts = card.items.filter((i) => i.kind !== "confirm");
  const open = doubts.filter((i) => !i.answer).length;

  return (
    <section className="kn-doubt" role="dialog" aria-modal="false" aria-labelledby="kn-doubt-title">
      <h2 id="kn-doubt-title" className="kn-doubt-title">
        {doubts.length ? t("hub.doubt.title") : t("hub.doubt.confirmTitle")}
      </h2>
      {confirms.length ? (
        <ul className="kn-doubt-list">
          {confirms.map((i) => (
            <li key={i.fingerprint} className="kn-doubt-item kn-confirm-item" data-answer={i.answer}>
              <p className="kn-confirm-question">{i.value}</p>
              <p className="kn-doubt-hint">{t("hub.doubt.confirmHint", { time: hourOf(card.deadline) })}</p>
              <div className="kn-doubt-buttons">
                {i.answer ? (
                  <span className="kn-doubt-answered">{i.answer === "send" ? t("hub.doubt.confirmSent") : t("hub.doubt.confirmHeld")}</span>
                ) : (
                  <>
                    <Button onClick={() => void answer({ card: card.id, fingerprint: i.fingerprint, answer: "hold" })}>{t("hub.doubt.notNow")}</Button>
                    {/* Os dois com o mesmo peso, sem principal: a pessoa escolhe. */}
                    <Button onClick={() => void answer({ card: card.id, fingerprint: i.fingerprint, answer: "send" })}>{t("hub.doubt.organize")}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {doubts.length ? (
        <>
        <p className="kn-doubt-hint">
          {t("hub.doubt.hint", { n: doubts.length, time: hourOf(card.deadline) })}
        </p>
        <ul className="kn-doubt-list">
          {doubts.map((i) => (
            <li key={i.fingerprint} className="kn-doubt-item" data-answer={i.answer}>
              <div className="kn-doubt-where">
                {i.path ? t("hub.doubt.whereLine", { where: whereOf(i.path) ?? "", line: String(i.line) }) : t("hub.doubt.whereRequest")}
              </div>
              <Context context={i.context} value={i.value} />
              <div className="kn-doubt-buttons">
                {i.answer ? (
                  <span className="kn-doubt-answered">{i.answer === "send" ? t("hub.doubt.sent") : t("hub.doubt.held")}</span>
                ) : (
                  <>
                    <Button onClick={() => void answer({ card: card.id, fingerprint: i.fingerprint, answer: "hold" })}>{t("hub.doubt.secret")}</Button>
                    {/* Os dois com o mesmo peso, sem principal e sem Enter padrão: a pessoa escolhe (#10168). */}
                    <Button onClick={() => void answer({ card: card.id, fingerprint: i.fingerprint, answer: "send" })}>{t("hub.doubt.send")}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        </>
      ) : null}
      {open > 1 ? (
        <div className="kn-doubt-all">
          <Button onClick={() => void answer({ card: card.id, all: "hold" })}>{t("hub.doubt.allSecret")}</Button>
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
